# Memoria Técnica — Panel de Guardias Jotasones

## IES Alixar — Desarrollo Web Entorno Cliente

---

## 1. Introducción

Este proyecto es un **panel de gestión de guardias** que centraliza las ausencias de profesores de **4 grupos diferentes**, cada uno con su propia base de datos y tecnología. El panel actúa como un **gateway** que consulta, normaliza y presenta todos los datos en una única interfaz web.

### Grupos integrados

| Grupo | Tecnología de datos | URL |
|---|---|---|
| **Jotasones** | MySQL (API REST propia) | `http://172.22.0.152:3000/api/v1` |
| **Los Moteros** | MongoDB Atlas (API REST Node.js) | `http://localhost:3001` |
| **Célula Eucariota** | Google Apps Script (JSON) | Endpoint de Google Apps Script |
| **IA / Duoia** | Google Sheets (CSV público) | Hoja de cálculo publicada como CSV |

---

## 2. Base de datos MySQL — `scriptsql.sql`

El archivo `scriptsql.sql` crea la base de datos `guardias` y define 4 tablas:

### 2.1 Tabla `profesores`

```sql
CREATE TABLE profesores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50),
    apellidos VARCHAR(100)
);
```

Almacena los 8 profesores del centro con nombre y apellidos separados.

### 2.2 Tabla `grupos`

```sql
CREATE TABLE grupos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(20)
);
```

Contiene los 8 grupos/aulas: 1ºA, 1ºB, 2ºA, 2ºB, 3ºA, 3ºB, 4ºA, 4ºB.

### 2.3 Tabla `reportes`

```sql
CREATE TABLE reportes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    profesor_id INT,
    grupo_id INT,
    hora_inicio INT,
    hora_fin INT,
    tarea TEXT,
    fecha DATE,
    FOREIGN KEY (profesor_id) REFERENCES profesores(id) ON DELETE CASCADE,
    FOREIGN KEY (grupo_id) REFERENCES grupos(id)
);
```

Es la tabla principal: cada fila es una **ausencia**. Relaciona un profesor con un grupo en una franja horaria concreta (hora_inicio/hora_fin como enteros del 1 al 6) y una fecha. El campo `tarea` guarda lo que el profesor deja mandado. El `ON DELETE CASCADE` en `profesor_id` hace que si se elimina un profesor, se borren sus reportes automáticamente.

### 2.4 Tabla `guardias`

```sql
CREATE TABLE guardias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reporte_id INT,
    profesor_guardia_id INT,
    hora INT,
    fecha DATE,
    FOREIGN KEY (reporte_id) REFERENCES reportes(id) ON DELETE CASCADE,
    FOREIGN KEY (profesor_guardia_id) REFERENCES profesores(id)
);
```

Registra qué profesor cubre cada ausencia. `reporte_id` apunta a la ausencia original, `profesor_guardia_id` al profesor que hace la guardia. También tiene `ON DELETE CASCADE` en el reporte, así si se elimina una ausencia se elimina la guardia vinculada.

### 2.5 Datos de prueba

El SQL incluye **INSERT** con datos de ejemplo para todo febrero 2026. El día **9 de febrero** tiene 8 ausencias y 6 guardias asignadas, pensado para pruebas exhaustivas con datos abundantes.

---

## 3. Backend — `server.js` (470 líneas)

### 3.1 Dependencias y configuración inicial (líneas 1–17)

```javascript
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
```

- **express**: Framework web para crear el servidor HTTP y definir las rutas API.
- **cors**: Middleware que permite peticiones desde cualquier origen (necesario porque el navegador bloquea peticiones cross-origin por defecto).
- **spawn**: Se usa para lanzar el servidor de Moteros como proceso hijo (se explica más adelante).
- **path / fs**: Utilidades de Node.js para manejar rutas de archivos y comprobar si existen.

Las URLs de los 4 grupos se definen usando variables de entorno (`process.env`) para facilitar el despliegue tanto en local como en la Máquina Virtual:

```javascript
const JOTASONES_API_URL = process.env.JOTASONES_API_URL || 'http://localhost:3000/api/v1';
const MOTEROS_URL = process.env.MOTEROS_URL || 'http://localhost:3001';
const CELULA_SCRIPT_URL = process.env.CELULA_SCRIPT_URL || 'https://script.google.com/macros/s/.../exec';
const DUOIA_CSV_URL = process.env.DUOIA_CSV_URL || 'https://docs.google.com/spreadsheets/.../output=csv';
```

### 3.2 Sistema de log de tráfico (líneas 19–47)

El gateway registra todas las peticiones HTTP que pasan por él para poder verlas en el panel:

```javascript
const trafficLog = [];
const MAX_LOG = 100;

function addTrafficEntry(method, url, timeMs, status, source) {
    trafficLog.unshift({
        timestamp: new Date().toISOString(),
        method, url,
        timeMs: Math.round(timeMs),
        status, source
    });
    if (trafficLog.length > MAX_LOG) trafficLog.pop();
}
```

- Se usa un array `trafficLog` que guarda las últimas 100 peticiones con `.unshift()` (inserta al principio) y `.pop()` (elimina la más vieja si supera 100).
- Cada entrada tiene: método HTTP, URL, tiempo en ms, código de estado, y origen (qué API la generó).

El **middleware** mide el tiempo de **todas** las peticiones que pasan por Express:

```javascript
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        if (req.originalUrl.startsWith('/api')) {
            addTrafficEntry(req.method, req.originalUrl, elapsed, res.statusCode, 'gateway');
        }
    });
    next();
});
```

**Cómo funciona:** `process.hrtime.bigint()` da un timestamp en nanosegundos. Se registra al inicio, y cuando la respuesta termina (`res.on('finish')`), se calcula la diferencia y se convierte a milisegundos dividiendo por `1e6`. Solo se loguean las rutas `/api` (no los archivos estáticos). El `next()` es fundamental: sin él, la petición se quedaría colgada porque el middleware no pasaría el control al siguiente handler.

### 3.3 Archivos estáticos y webs de otros grupos (líneas 49–59)

```javascript
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 
        fs.existsSync(path.join(__dirname, 'panel.html')) ? 'panel.html' : 'index.html'));
});

app.use('/ia', express.static(path.join(__dirname, '../grupo-ia')));
app.use('/celula', express.static(path.join(__dirname, '../grupo-celula-eucariota')));
```

- `express.static(__dirname)` sirve todos los archivos de la carpeta como estáticos (HTML, CSS, JS).
- La ruta raíz `/` comprueba si existe `panel.html` y lo sirve; si no, sirve `index.html`.
- Las rutas `/ia` y `/celula` sirven las webs originales de los otros dos grupos directamente. Así se acceden desde `http://localhost:3000/ia` y `http://localhost:3000/celula`.

### 3.4 Datos de respaldo en memoria (líneas 61–86)

```javascript
const PROFESORES_RESPALDO = [
    { id: 1, nombre: "María", apellidos: "Fernández Ruiz" },
    // ... 8 profesores
];

const GRUPOS_RESPALDO = [
    { id: 1, nombre: "1ºA" }, { id: 2, nombre: "1ºB" },
    // ... 8 grupos
];

let ausenciasLocales = [];
let guardiasAsignadas = [];
let nextAusenciaId = 1000;
let nextGuardiaId = 5000;
```

**¿Por qué datos de respaldo?** Si la API remota de Jotasones (la del servidor del instituto en `172.22.0.152`) no está accesible, el panel sigue funcionando con estos datos locales. Es un **fallback** para que la aplicación no se rompa.

Las variables `ausenciasLocales` y `guardiasAsignadas` son **almacenamiento en memoria**: las ausencias creadas desde el panel y las guardias asignadas se guardan en estos arrays mientras el servidor esté arrancado. Si se reinicia el servidor, se pierden (solo persisten las que están en MySQL).

Los contadores `nextAusenciaId` y `nextGuardiaId` empiezan en 1000 y 5000 respectivamente para no colisionar con los IDs de la base de datos.

### 3.5 Función `fetchConTiempo` — fetch con timeout (líneas 88–104)

```javascript
async function fetchConTiempo(url, opciones = {}, source = 'externo') {
    const start = performance.now();
    const method = opciones.method || 'GET';
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(4000), ...opciones });
        const elapsed = performance.now() - start;
        addTrafficEntry(method, url, elapsed, r.status, source);
        return { response: r, timeMs: elapsed };
    } catch (e) {
        const elapsed = performance.now() - start;
        addTrafficEntry(method, url, elapsed, 'FAIL', source);
        throw e;
    }
}
```

Esta función envuelve el `fetch` nativo de Node.js con dos añadidos:

1. **Timeout de 4 segundos:** `AbortSignal.timeout(4000)` cancela la petición si tarda más de 4s. Esto es crucial porque las APIs externas (Google Apps Script, Google Sheets) pueden tardar mucho o no responder.
2. **Registro de tráfico:** Tanto si tiene éxito como si falla, se registra en el log de tráfico con el tiempo que tardó.

Devuelve un objeto `{ response, timeMs }` para que el código que la llama pueda usar tanto la respuesta como el tiempo.

### 3.6 Endpoint `/api/profesores` — Agregación de profesores (líneas 106–191)

Este endpoint es el más complejo porque **agrega profesores de las 4 fuentes** y los deduplica:

```javascript
app.get('/api/profesores', async (req, res) => {
    const todosNombres = new Map(); // nombre_completo -> {id, nombre, apellidos, origen}
    
    const agregar = (nombre, apellidos, origen) => {
        const full = `${nombre} ${apellidos}`.trim();
        if (full && !todosNombres.has(full.toLowerCase())) {
            todosNombres.set(full.toLowerCase(), { id: nextId++, nombre, apellidos, origen });
        }
    };
```

**Deduplicación con `Map`:** Se usa un `Map` donde la clave es el nombre completo en minúsculas. Así, "María Fernández" y "maría fernández" se tratan como el mismo profesor. Solo se añade si no existe ya en el Map.

Luego consulta cada fuente en orden:

1. **Respaldo local** — siempre se añaden los 8 profesores base.
2. **Jotasones API** — llama a `GET /api/v1/profesores`. La respuesta puede tener varios formatos (`data.data`, `data.profesores`, o un array directo), por lo que se usa: `data.data || data.profesores || (Array.isArray(data) ? data : [])`.
3. **Moteros** — llama a `GET /api/profesores` en localhost:3001.
4. **Célula** — extrae nombres de los campos `guardias[].profesores[]` y `faltas[].profesor` del JSON. Como vienen como string único ("García López"), se hace `.split(' ')` para separar nombre y apellidos.
5. **Duoia** — parsea el CSV, busca la columna "profesor" por índice, y extrae los nombres únicos.

Cada fuente está envuelta en `try/catch` vacío — si falla, simplemente se ignora y se sigue con las demás.

### 3.7 Endpoint `/api/grupos` (líneas 193–204)

```javascript
app.get('/api/grupos', async (req, res) => {
    try {
        const { response } = await fetchConTiempo(`${JOTASONES_API_URL}/grupos`, {}, 'jotasones-api');
        if (!response.ok) throw new Error("API error");
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) return res.json(data);
        res.json(GRUPOS_RESPALDO);
    } catch (e) { res.json(GRUPOS_RESPALDO); }
});
```

Intenta obtener los grupos de la API remota. Si falla o devuelve un array vacío, usa `GRUPOS_RESPALDO`. Es el mismo patrón de fallback que en profesores.

### 3.8 CRUD de ausencias (líneas 206–252)

#### Crear ausencia — `POST /api/ausencias`

```javascript
app.post('/api/ausencias', (req, res) => {
    const { profesor, grupo, hora_inicio, hora_fin, tarea, fecha } = req.body;
    const nueva = {
        id: 'local-' + (nextAusenciaId++),
        origen: 'Jotasones',
        profesor: profesor || 'Sin nombre',
        // ...
    };
    ausenciasLocales.push(nueva);
    
    // Fire-and-forget: intentar enviar al remoto
    fetchConTiempo(`${JOTASONES_API_URL}/ausencias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
    }, 'jotasones-api').catch(() => { });
    
    res.json({ ok: true, ausencia: nueva });
});
```

La ausencia se guarda **localmente en memoria** con un ID prefijado con `'local-'` para distinguirla de las remotas. Además, se intenta reenviar a la API remota como **fire-and-forget** (`.catch(() => {})` ignora el resultado), así si la API remota está disponible también se guarda allí, pero no se espera su respuesta.

#### Eliminar ausencia — `DELETE /api/ausencias/:id`

```javascript
app.delete('/api/ausencias/:id', (req, res) => {
    const id = req.params.id;
    ausenciasLocales = ausenciasLocales.filter(a => a.id !== id);
    guardiasAsignadas = guardiasAsignadas.filter(g => g.ausencia_id !== id);
    // ...
});
```

Filtra del array la ausencia con ese ID y también elimina las guardias vinculadas a ella. Solo funciona con ausencias locales (las que empiezan por `'local-'`).

### 3.9 Asignación y desasignación de guardias (líneas 254–289)

#### Asignar guardia — `POST /api/guardias`

```javascript
app.post('/api/guardias', (req, res) => {
    const { ausencia_id, profesor_nombre, hora, fecha } = req.body;
    const guardia = {
        id: 'g-' + (nextGuardiaId++),
        ausencia_id, profesor_nombre, hora: parseInt(hora) || 1, fecha
    };
    guardiasAsignadas.push(guardia);
    
    // Marcar en la ausencia local si existe
    const aus = ausenciasLocales.find(a => a.id === ausencia_id);
    if (aus) aus.guardia_asignada = profesor_nombre;
});
```

La guardia se almacena en el array `guardiasAsignadas` con un ID prefijado `'g-'`. Si la ausencia es local, se actualiza directamente su campo `guardia_asignada`. Las guardias pueden asignarse tanto a ausencias locales como a externas (de otros grupos).

#### Desasignar guardia — `DELETE /api/guardias/:id`

Busca la guardia por ID, limpia el campo `guardia_asignada` de la ausencia local asociada, y filtra la guardia del array.

### 3.10 El endpoint principal — `/api/panel` (líneas 298–451)

Este es el **cerebro del gateway**. Recibe una fecha y consulta **las 4 fuentes en paralelo**:

```javascript
app.get('/api/panel', async (req, res) => {
    const { fecha } = req.query;
    const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
    const diaSemana = dias[new Date(fecha + 'T12:00:00').getDay()];
```

**Problema del timezone:** Se añade `'T12:00:00'` a la fecha porque si se hace `new Date('2026-02-09')`, JavaScript lo interpreta como medianoche UTC. En la zona horaria GMT+1, eso da el **día anterior** (8 de febrero a las 23:00). Añadiendo `T12:00:00` se fuerza al mediodía, evitando este desfase.

#### Consulta a Jotasones (API REST con MySQL)

```javascript
const jotasonesPromise = fetchConTiempo(
    `${JOTASONES_API_URL}/ausencias?fecha=${fecha}`, {}, 'jotasones-api'
).then(async ({ response }) => {
    const data = await response.json();
    const lista = data.data || data.ausencias || (Array.isArray(data) ? data : []);
    return lista.map(a => ({
        id: a.id || 'j-' + Math.random().toString(36).substr(2, 6),
        origen: 'Jotasones (API)',
        profesor: a.profesor_nombre || a.profesor || 'Docente',
        grupo: a.grupo_nombre || a.grupo || '?',
        hora_inicio: parseInt(a.hora_inicio || a.horaInicio || a.hora || 1),
        hora_fin: parseInt(a.hora_fin || a.horaFin || a.hora || 1),
        tarea: a.tarea || 'Sin tarea',
        es_externo: false,
        guardia_asignada: a.guardiaNombre || null
    }));
}).catch(() => []);
```

**Normalización:** La API remota devuelve los datos con ciertos nombres de campo (`profesor_nombre`, `grupo_nombre`). El gateway los mapea al formato común. Se usan múltiples fallbacks (`a.profesor_nombre || a.profesor || 'Docente'`) porque la API podría cambiar de formato. Si falla, devuelve `[]` — el `.catch(() => [])` es clave para que el `Promise.all` no se rompa.

Los IDs se generan con `Math.random().toString(36).substr(2, 6)` que produce strings aleatorios como `'abc123'`, prefijados con una letra por origen: `j-` (Jotasones), `m-` (Moteros), `c-` (Célula), `d-` (Duoia).

#### Consulta a Moteros (MongoDB)

```javascript
const moterosPromise = fetchConTiempo(
    `${MOTEROS_URL}/api/panel?fecha=${fecha}&diaSemana=${diaSemana}`, {}, 'moteros'
).then(async ({ response }) => {
    const d = await response.json();
    const ausencias = (d.ausencias || []).map(a => ({
        profesor: a.profesor?.nombre 
            ? `${a.profesor.nombre} ${a.profesor.apellidos || ''}`.trim() 
            : (a.profesor || '?'),
        // ... normalización al formato común
    }));
    // Extraer profesores de guardia disponibles
    const guardias = (d.guardias || []).filter(g => g.status === 'disponible').map(g => {
        const nombre = g.profesor?.nombre ? `${g.profesor.nombre} ${g.profesor.apellidos || ''}`.trim() : '?';
        const horaNum = parseInt(String(g.hora).replace(/[^0-9]/g, '')) || 1;
        return { nombre, hora: horaNum, origen: 'Los Moteros' };
    });
    return { ausencias, guardias };
});
```

**Diferencia clave:** Moteros devuelve el profesor como un **objeto** `{ nombre: "Sofía", apellidos: "Díaz" }` en lugar de un string. Se usa optional chaining (`a.profesor?.nombre`) para comprobar si es un objeto, y si lo es, se concatenan nombre y apellidos.

**Guardias:** La API de Moteros devuelve además un campo `guardias` con los profesores que tienen guardia programada en su horario. Se filtran solo los que tienen `status: 'disponible'` (los que no están ausentes ese mismo día). La hora viene como string `'1º'`, `'2º'`, etc., así que se usa una regex `replace(/[^0-9]/g, '')` para extraer solo el número.

#### Consulta a Célula Eucariota (Google Apps Script)

```javascript
const celulaPromise = fetchConTiempo(
    `${CELULA_SCRIPT_URL}?dia=${diaSemana}`, {}, 'celula'
).then(async ({ response }) => {
    const d = await response.json();
    const ausencias = (d.faltas || []).map(f => ({ /* ... */ }));
    // Extraer profesores de guardia de Célula
    const guardias = [];
    (d.guardias || []).forEach(g => {
        const horaNum = parseInt(g.hora) || 1;
        (g.profesores || []).forEach(nombre => {
            guardias.push({ nombre: nombre.trim(), hora: horaNum, origen: 'Célula Eucariota' });
        });
    });
    return { ausencias, guardias };
});
```

Célula filtra por **día de la semana** (no por fecha), así que se le pasa `?dia=Lunes`, `?dia=Martes`, etc. No incluye campo de tarea, por lo que siempre se pone `'Sin tarea'`.

**Guardias:** La respuesta de Célula incluye un campo `guardias` con estructura `{ hora: "1", profesores: ["Pérez Ruiz", "Sánchez"] }`. Se itera cada hora y cada profesor dentro del array `profesores`, creando una entrada por cada uno.

#### Consulta a Duoia (Google Sheets CSV)

```javascript
const duoiaPromise = fetchConTiempo(DUOIA_CSV_URL, {}, 'duoia')
    .then(async ({ response }) => {
        const txt = await response.text();
        const filas = txt.split('\n').map(l => l.trim());
        const h = filas[0].toLowerCase().split(',');
        const idx = { dia, tipo, prof, hora, aula, tarea }; // índices de columnas
        const ausencias = [];
        const guardias = [];
        filas.slice(1).forEach(l => {
            const c = l.split(',');
            if (c[idx.dia] !== diaSemana) return;
            if (tipo === 'AUSENCIA') ausencias.push({ /* ... */ });
            else if (tipo === 'GUARDIA') guardias.push({ nombre, hora, origen: 'IA (Duoia)' });
        });
        return { ausencias, guardias };
    });
```

**Parseo manual de CSV:** Se descarga todo el CSV como texto, se divide por saltos de línea, y la primera fila se usa como cabecera para buscar los índices de cada columna. Luego se recorre cada fila y se clasifica según el campo `Tipo`:

- `Tipo === 'AUSENCIA'` → se añade al array de ausencias con el formato normalizado.
- `Tipo === 'GUARDIA'` → se añade al array de guardias con el nombre del profesor y la hora.

#### Combinación final con Promise.all

```javascript
const [jotasones, moterosData, celulaData, duoiaData] = await Promise.all([
    jotasonesPromise, moterosPromise, celulaPromise, duoiaPromise
]);

// Jotasones devuelve array directo, los demás devuelven { ausencias, guardias }
const moteros = moterosData.ausencias || [];
const celula = celulaData.ausencias || [];
const duoia = duoiaData.ausencias || [];

const todas = [...jotasones, ...moteros, ...celula, ...duoia];

// Combinar profesores de guardia de todas las fuentes, agrupados por hora
const todasGuardias = [
    ...(moterosData.guardias || []),
    ...(celulaData.guardias || []),
    ...(duoiaData.guardias || [])
];
const profesoresGuardia = {};
for (let h = 1; h <= 6; h++) profesoresGuardia[h] = [];
todasGuardias.forEach(g => {
    if (g.hora >= 1 && g.hora <= 6) {
        profesoresGuardia[g.hora].push({ nombre: g.nombre, origen: g.origen });
    }
});
```

`Promise.all` ejecuta las 4 consultas **en paralelo**. Ahora las promesas de Moteros, Célula y Duoia devuelven un objeto `{ ausencias, guardias }` en vez de un array simple. Jotasones sigue devolviendo solo un array de ausencias (no tiene datos de horario de guardias).

Los profesores de guardia se agrupan en un objeto `profesoresGuardia` con claves del 1 al 6 (una por hora). Cada entrada contiene el nombre del profesor y su origen.

La respuesta incluye ahora un campo `profesores_guardia`:

```javascript
res.json({
    ausencias: todas,
    resumen: { jotasones: N, moteros: N, celula: N, duoia: N, total: N },
    guardias_asignadas: guardiasAsignadas.filter(g => g.fecha === fecha),
    profesores_guardia: profesoresGuardia  // NUEVO
});
```

### 3.11 Arranque y lanzamiento de Moteros (líneas 453–470)

```javascript
app.listen(3000, () => {
    console.log('  ✅ GATEWAY JOTASONES → http://localhost:3000');

    // Arranque automático de Moteros
    const rutaMoteros = path.resolve(__dirname, '../grupo-losmoteros/server.js');
    if (fs.existsSync(rutaMoteros)) {
        const moteros = spawn('node', ['server.js'], { 
            cwd: path.dirname(rutaMoteros), shell: true, stdio: 'pipe' 
        });
        moteros.stdout.on('data', d => console.log(`[Moteros] ${d.toString().trim()}`));
        moteros.stderr.on('data', d => console.error(`[Moteros ERR] ${d.toString().trim()}`));
    }
});
```

Al arrancar en el puerto 3000, el gateway **lanza automáticamente** el servidor de Moteros como proceso hijo:

- `spawn('node', ['server.js'], { cwd: ... })` ejecuta `node server.js` en la carpeta de Moteros.
- `stdio: 'pipe'` redirige stdout/stderr para capturar los logs.
- Los logs de Moteros se muestran con el prefijo `[Moteros]` en la misma consola.
- Moteros está configurado para usar el **puerto 3001** mediante su archivo `.env` (`PORT=3001`), evitando así conflicto con el gateway que usa el 3000.

---

## 4. Frontend — `panel.html` (1081 líneas)

### 4.1 Diseño y sistema de colores

El panel es un **single-file application** (todo en un solo HTML: estructura, estilos y JavaScript). Usa diseño **dark mode** con variables CSS:

```css
:root {
    --bg: #0f1117;        /* Fondo principal */
    --surface: #1a1d27;   /* Superficies/tarjetas */
    --accent: #6366f1;    /* Color principal (índigo) */
    --green: #10b981;     /* Éxito / Célula Eucariota */
    --orange: #f59e0b;    /* Moteros */
    --purple: #a855f7;    /* Duoia/IA */
    --blue: #3b82f6;      /* Jotasones */
}
```

Cada grupo tiene un color asignado que se usa tanto en los bordes de las tarjetas como en los badges de resumen. La fuente es **Inter** (Google Fonts).

### 4.2 Estructura HTML

El layout se divide con CSS Grid en dos columnas:

```css
.layout {
    display: grid;
    grid-template-columns: 1fr 340px;
}
```

- **Panel principal (izquierda):** Controles + línea temporal de ausencias
- **Sidebar (derecha, 340px fijos):** Monitor de tráfico

La **topbar** es sticky (`position: sticky; top: 0`) con `backdrop-filter: blur(12px)` para el efecto glassmorphism al hacer scroll.

### 4.3 JavaScript — Variables y inicialización

```javascript
const API = '/api';
let datosPanel = [];         // Ausencias actuales
let profesores = [];         // Lista de profesores para desplegables
let grupos = [];             // Lista de grupos para desplegables
let guardias = [];           // Guardias asignadas actualmente
let profesoresGuardia = {};  // Profesores de guardia agrupados por hora (1-6)
let ausenciaParaGuardia = null; // Ausencia seleccionada para asignar guardia

window.onload = async () => {
    document.getElementById('datePicker').valueAsDate = new Date();
    await cargarDesplegables();
    sincronizar();
};
```

Al cargar la página:
1. Se establece la fecha de hoy en el datePicker.
2. Se cargan profesores y grupos para los desplegables.
3. Se lanza la sincronización automáticamente.
4. La función `cargarDesplegables` carga `datosPanel` y otros elementos necesarios.

La variable `profesoresGuardia` es un objeto donde cada clave es un número de hora (1-6) y el valor es un array de `{ nombre, origen }` con los profesores que tienen guardia esa hora.

### 4.4 Sistema de monitorización de tráfico (frontend)

```javascript
async function fetchLog(url, opts = {}) {
    const method = opts.method || 'GET';
    const start = performance.now();
    try {
        const res = await fetch(url, opts);
        const elapsed = performance.now() - start;
        logTraffic(method, url, elapsed, res.status);
        return res;
    } catch (e) {
        logTraffic(method, url, elapsed, 'ERR');
        throw e;
    }
}
```

`fetchLog` es un wrapper de `fetch` que mide cuánto tarda cada petición y la registra en la barra lateral de tráfico. Cada función del panel usa `fetchLog` en vez de `fetch` directamente. Las entradas se muestran con colores según el tiempo de respuesta: verde (<500ms), naranja (<2000ms), rojo (>2000ms).

### 4.5 Función `sincronizar()` — La función central del frontend

```javascript
async function sincronizar() {
    const fecha = document.getElementById('datePicker').value;
    const btn = document.getElementById('btnSync');
    
    btn.classList.add('loading');          // Desactiva el botón
    btn.textContent = 'Sincronizando...'; // Feedback visual
    
    const res = await fetchLog(`${API}/panel?fecha=${fecha}`);
    const data = await res.json();
    
    datosPanel = data.ausencias || [];
    guardias = data.guardias_asignadas || [];
    const resumen = data.resumen || {};
    
    // Renderizar badges de resumen
    // Renderizar timeline
    renderTimeline();
    
    btn.classList.remove('loading');
    btn.textContent = 'Sincronizar';
}
```

Se activa al pulsar "Sincronizar" o al cambiar la fecha (`onchange="sincronizar()"`). Hace una sola petición a `/api/panel?fecha=...` que devuelve todo. También intenta cargar el log de tráfico del servidor para mostrar las peticiones a APIs externas en la barra lateral.

### 4.6 Función `renderTimeline()` — Layout de dos columnas por hora

Cada fila horaria se divide en **dos zonas**: profesores de guardia (izquierda) y ausencias a cubrir (derecha).

```javascript
function renderTimeline() {
    for (let h = 1; h <= 6; h++) {
        const eventos = datosPanel.filter(e => e.hora_inicio == h);
        const guardiasHora = profesoresGuardia[h] || [];

        // Panel izquierdo: chips con nombre del profesor de guardia y badge de origen
        // Panel derecho: tarjetas de ausencias (como antes)

        html += `<div class="hora-row">
            <div class="hora-label">${h}ª</div>
            <div class="hora-content">
                <div class="guardias-panel">🛡️ Guardia: ${guardiasHtml}</div>
                <div class="cards-grid">${cartas}</div>
            </div>
        </div>`;
    }
}
```

El **panel de guardias** (`.guardias-panel`) tiene un ancho fijo de 240px y muestra cada profesor como un "chip" con su nombre y un badge de color según su origen (Moteros naranja, Célula verde, Duoia morado). Si no hay datos de guardia para esa hora, muestra "Sin datos de guardia".

El **panel de ausencias** (`.cards-grid`) ocupa el espacio restante con `flex: 1` y funciona igual que antes: tarjetas con nombre del profesor ausente, grupo, tarea y botón de asignar/eliminar.

En pantallas estrechas (<1100px), los dos paneles se apilan verticalmente gracias a:

```css
@media (max-width: 1100px) {
    .hora-content { flex-direction: column; }
    .guardias-panel { width: 100%; }
}
```

### 4.7 Asignación contextual de guardias (frontend)

El flujo de asignación ahora es **contextual**: al pulsar "Asignar Guardia" en una ausencia, el modal muestra preferentemente los profesores que tienen guardia en esa hora concreta.

```javascript
function abrirGuardia(ausenciaId, profesorAusente, hora) {
    const guardiasHora = profesoresGuardia[hora] || [];
    const selPG = document.getElementById('selProfesorGuardia');
    
    if (guardiasHora.length > 0) {
        // Dos optgroups: primero los de guardia, luego todos los profesores
        selPG.innerHTML = `
            <optgroup label="De guardia esta hora">
                ${guardiasHora.map(g => `<option>${g.nombre} (${g.origen})</option>`).join('')}
            </optgroup>
            <optgroup label="Todos los profesores">
                ${profesores.map(p => `<option>${p.nombre} ${p.apellidos}</option>`).join('')}
            </optgroup>`;
    } else {
        // Fallback: mostrar todos los profesores
        selPG.innerHTML = profesores.map(p => `<option>...</option>`).join('');
    }
}
```

Se usa `<optgroup>` para dividir visualmente el desplegable entre los profesores de guardia de esa hora (sección superior, la que el usuario debería elegir) y todos los profesores (sección inferior, como fallback). Si no hay datos de guardia para esa hora, se muestra directamente la lista completa.

Una vez seleccionado, **`confirmarGuardia()`** envía `POST /api/guardias` y **actualiza localmente** sin re-sincronizar:

```javascript
const aus = datosPanel.find(a => String(a.id) === String(ausenciaParaGuardia.id));
if (aus) {
    aus.guardia_asignada = profesorNombre;
    aus.guardia_id = data.guardia ? data.guardia.id : '';
}
renderTimeline(); // Re-renderiza sin llamar al servidor
```

La actualización local es más eficiente que volver a sincronizar los 4 grupos (~4 segundos).

**`quitarGuardia(ausenciaId, guardiaId)`** funciona igual que antes: si no tiene `guardiaId`, consulta `/api/panel` para obtenerlo, y luego hace `DELETE /api/guardias/:id`.

---

## 5. Problemas encontrados y soluciones en el código

### 5.1 Comparación de IDs con tipos mixtos

**Problema:** Al vincular guardias con ausencias, el ID puede ser un número (de MySQL: `39`) o un string (generado: `'m-abc123'`). La comparación estricta `===` fallaba.

**Solución:** Se usa `String()` en ambos lados:
```javascript
const aus = todas.find(a => String(a.id) === String(g.ausencia_id));
```

### 5.2 Timezone en las fechas

**Problema:** `new Date('2026-02-09')` en GMT+1 da el **8 de febrero a las 23:00** (es medianoche UTC).

**Solución:** Añadir `T12:00:00` para fijar la hora al mediodía:
```javascript
const diaSemana = dias[new Date(fecha + 'T12:00:00').getDay()];
```

### 5.3 Conflicto de puertos

**Problema:** Jotasones y Moteros usaban el mismo puerto 3000.

**Solución:** Moteros usa el puerto 3001 configurado en su `.env`:
```
PORT=3001
```

### 5.4 APIs externas lentas o caídas

**Problema:** Google Apps Script y Google Sheets a veces no responden.

**Solución:** Timeout de 4 segundos en `fetchConTiempo` con `AbortSignal.timeout(4000)`. Si falla cualquier fuente, devuelve `[]` y las demás siguen funcionando gracias a que cada promesa tiene su propio `.catch(() => [])`.

### 5.5 Profesores duplicados

**Problema:** El mismo profesor aparece en varias fuentes.

**Solución:** Deduplicación con `Map` usando el nombre completo en minúsculas como clave:
```javascript
if (!todosNombres.has(full.toLowerCase())) { ... }
```

---

## 6. Estructura de archivos

```
proyecto-grupal-pablo/
├── grupo-jotasones/           ← GATEWAY CENTRAL
│   ├── server.js              ← Backend Express (470 líneas)
│   ├── panel.html             ← Frontend completo (1081 líneas)
│   ├── scriptsql.sql          ← Base de datos MySQL (150 líneas)
│   ├── package.json           ← Dependencias Node.js
│   └── MEMORIA.md             ← Este documento
│
├── grupo-losmoteros/          ← Moteros (MongoDB Atlas)
│   ├── server.js              ← API REST (puerto 3001)
│   ├── .env                   ← PORT=3001
│   └── package.json
│
├── grupo-celula-eucariota/    ← Célula (Google Apps Script)
│   ├── index.html
│   └── script.js
│
└── grupo-ia-duoia/            ← Duoia (Google Sheets CSV)
    ├── index.html
    └── script.js
```

---

## 7. Cómo ejecutar el proyecto

### Requisitos
- **Node.js** v18+
- Acceso a la red del instituto (para la API MySQL de Jotasones)

### Pasos

```bash
# 1. Instalar dependencias de Jotasones
cd grupo-jotasones
npm install

# 2. Instalar dependencias de Moteros
cd ../grupo-losmoteros
npm install

# 3. Arrancar gateway
cd ../grupo-jotasones
node server.js
```

El servidor arranca en `http://localhost:3000` y lanza automáticamente Moteros en `http://localhost:3001`.

---

## 8. API REST MySQL y Despliegue en VM

### 8.1 API JSON para base de datos MySQL

Para permitir que otros compañeros consuman los datos de la base de datos `guardias` (creada por `scriptsql.sql`) desde la red local, se han añadido endpoints específicos en `server.js` conectando directamente con MySQL.

#### **Endpoints creados**

| Método | URL | Descripción |
|---|---|---|
| `GET` | `/api/sql/profesores` | Devuelve lista JSON de todos los profesores |
| `GET` | `/api/sql/grupos` | Devuelve lista JSON de grupos |
| `GET` | `/api/sql/reportes` | Devuelve el histórico de reportes de ausencias |
| `GET` | `/api/sql/guardias` | Devuelve el histórico de asignaciones de guardia |

#### **Implementación técnica**

Se utiliza la librería `mysql2/promise` para conexiones asíncronas.

```javascript
const mysql = require('mysql2/promise');
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'guardias',
    // ...
};

// Ejemplo de endpoint
app.get('/api/sql/profesores', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM profesores');
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: 'Error accediendo a BD' });
    }
});
```

### 8.2 Despliegue en Máquina Virtual Lubuntu

Para centralizar el servicio y que no dependa de un ordenador personal, se ha preparado el despliegue en una VM Lubuntu (`172.22.0.205`).

#### **Estrategia de despliegue**

1.  **Repositorio Git:** Se clona el proyecto completo en la VM para facilitar actualizaciones (`git pull`).
2.  **Gestor de Procesos (PM2):** Se utiliza `pm2` en lugar de ejecutar `node server.js` manualmente. Esto asegura que:
    *   La aplicación se reinicie automáticamente tras fallos.
    *   El servicio arranque solo al iniciar la máquina virtual.
3.  **Base de datos MySQL:** Se configura MySQL en la VM con el esquema `guardias`.

#### **Comandos clave**

```bash
# Lanzar aplicación con PM2
pm2 start server.js --name "api-jotasones"

# Guardar lista de procesos para el reinicio
pm2 save
pm2 startup
```

Con este despliegue, cualquier compañero en la red puede acceder a la API mediante:
`http://172.22.0.205:3000/api/sql/profesores`
