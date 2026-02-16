# Memoria del Proyecto — Panel de Guardias Jotasones

## IES Alixar — Desarrollo Web Entorno Cliente

---

## 1. Introducción

El objetivo de este proyecto es construir un **panel de gestión de guardias** que centralice las ausencias y guardias de profesores provenientes de **4 grupos diferentes**, cada uno con su propia base de datos y tecnología. El panel actúa como un **gateway unificado** que consulta, normaliza y presenta todos los datos en una única interfaz web.

### Grupos integrados

| Grupo | Tecnología de datos | URL de acceso |
|---|---|---|
| **Jotasones** | MySQL (API REST propia) | `http://172.22.0.152:3000/api/v1` |
| **Los Moteros** | MongoDB Atlas (API REST Node.js) | `http://localhost:3001` |
| **Célula Eucariota** | Google Apps Script (JSON) | `https://script.google.com/macros/s/...` |
| **IA / Duoia** | Google Sheets (CSV público) | `https://docs.google.com/spreadsheets/...` |

> **[CAPTURA: Diagrama de arquitectura del sistema mostrando los 4 grupos conectándose al gateway central]**
> Puedes hacer un diagrama en Paint/draw.io mostrando: Panel (centro) ← flechas ← Jotasones API, Moteros, Célula, Duoia

---

## 2. Arquitectura del sistema

El sistema sigue una arquitectura **Gateway / Aggregator**. El archivo `server.js` de Jotasones actúa como punto central que:

1. **Arranca** en el puerto `3000`
2. **Lanza automáticamente** el servidor de Moteros en el puerto `3001`
3. **Consulta en paralelo** las 4 fuentes de datos usando `Promise.all`
4. **Normaliza** los datos a un formato común
5. **Devuelve** una respuesta JSON unificada al frontend

### Flujo de datos

```
Frontend (panel.html)
    │
    ▼ GET /api/panel?fecha=2026-02-09
    │
    ├── Gateway (server.js :3000)
    │   │
    │   ├── fetch → Jotasones API (172.22.0.152:3000/api/v1/ausencias)
    │   ├── fetch → Moteros (localhost:3001/api/panel)
    │   ├── fetch → Célula Eucariota (Google Apps Script)
    │   └── fetch → Duoia/IA (Google Sheets CSV)
    │
    ▼ Respuesta JSON unificada con todas las ausencias
```

> **[CAPTURA: Consola del servidor al arrancar mostrando "GATEWAY JOTASONES → http://localhost:3000" y "Arrancando Moteros en puerto 3001"]**

---

## 3. Base de datos — MySQL (Jotasones)

La base de datos de Jotasones se define en `scriptsql.sql` y contiene 3 tablas:

### 3.1 Tablas

```sql
-- Tabla de profesores
CREATE TABLE profesores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50),
    apellidos VARCHAR(100)
);

-- Tabla de grupos/aulas
CREATE TABLE grupos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(10)
);

-- Tabla de reportes de ausencia
CREATE TABLE reportes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    profesor_id INT,
    grupo_id INT,
    hora_inicio INT,
    hora_fin INT,
    tarea TEXT,
    fecha DATE,
    FOREIGN KEY (profesor_id) REFERENCES profesores(id),
    FOREIGN KEY (grupo_id) REFERENCES grupos(id)
);

-- Tabla de guardias asignadas
CREATE TABLE guardias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reporte_id INT,
    profesor_guardia_id INT,
    hora INT,
    fecha DATE,
    FOREIGN KEY (reporte_id) REFERENCES reportes(id),
    FOREIGN KEY (profesor_guardia_id) REFERENCES profesores(id)
);
```

### 3.2 Datos de prueba

Se incluyen **8 profesores**, **8 grupos** (1ºA-4ºB) y **reportes para todo febrero 2026**, con especial énfasis en el **9 de febrero** que contiene 8 ausencias para pruebas exhaustivas.

> **[CAPTURA: Resultado de la consulta SQL `SELECT * FROM reportes WHERE fecha = '2026-02-09';` en MySQL mostrando las 8 ausencias del día de prueba]**

---

## 4. Backend — `server.js` (Gateway)

### 4.1 Dependencias

```json
{
  "express": "^5.x",
  "cors": "^2.x",
  "node-fetch": "^3.x"
}
```

### 4.2 Configuración de URLs

```javascript
const JOTASONES_API_URL = 'http://172.22.0.152:3000/api/v1';
const MOTEROS_URL      = 'http://localhost:3001';
const CELULA_SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
const DUOIA_CSV_URL     = 'https://docs.google.com/spreadsheets/.../output=csv';
```

### 4.3 Endpoints del Gateway

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/panel?fecha=YYYY-MM-DD` | **Endpoint principal** — Agrega datos de los 4 grupos |
| `GET` | `/api/profesores` | Lista profesores de todas las fuentes (deduplicados) |
| `GET` | `/api/grupos` | Lista grupos/aulas |
| `POST` | `/api/ausencias` | Crear nueva ausencia local |
| `DELETE` | `/api/ausencias/:id` | Eliminar ausencia local |
| `POST` | `/api/guardias` | Asignar un profesor de guardia a una ausencia |
| `DELETE` | `/api/guardias/:id` | Desasignar guardia |
| `GET` | `/api/trafico` | Log de tráfico (últimas 100 peticiones) |

> **[CAPTURA: Navegador mostrando la respuesta JSON de `http://localhost:3000/api/panel?fecha=2026-02-09` con datos de los 4 grupos]**

### 4.4 Cómo se conecta con cada grupo

#### A. Jotasones (MySQL)

El servidor del instituto en `172.22.0.152:3000` expone una API REST v1 construida con Express + MySQL. Nuestro gateway llama a:

```
GET http://172.22.0.152:3000/api/v1/ausencias?fecha=2026-02-09
```

La respuesta tiene esta estructura:
```json
{
  "success": true,
  "data": [
    {
      "id": 9,
      "fecha": "2026-02-09",
      "hora_inicio": 2,
      "hora_fin": 3,
      "tarea": "Actividad Moodle",
      "profesor_nombre": "María Fernández Ruiz",
      "grupo_nombre": "1ºB"
    }
  ],
  "count": 1
}
```

El gateway extrae `data.data` y mapea los campos `profesor_nombre`, `grupo_nombre`, `hora_inicio`, etc. al formato común.

> **[CAPTURA: Navegador accediendo a `http://172.22.0.152:3000/api/v1/ausencias?fecha=2026-02-09` desde la red del instituto mostrando los datos JSON]**

#### B. Los Moteros (MongoDB)

El servidor de Moteros arranca automáticamente desde el gateway y usa MongoDB Atlas (base de datos en la nube). El gateway consulta:

```
GET http://localhost:3001/api/panel?fecha=2026-02-09&diaSemana=Lunes
```

La respuesta contiene:
```json
{
  "ausencias": [
    {
      "profesor": { "nombre": "Sofía", "apellidos": "Díaz" },
      "grupo": "2º ESO A",
      "hora": 3,
      "tarea": "Ejercicios tema 5"
    }
  ]
}
```

El gateway normaliza el campo `profesor` (que viene como objeto con `nombre` + `apellidos`) al formato string: `"Sofía Díaz"`.

> **[CAPTURA: Navegador mostrando la respuesta de `http://localhost:3001/api/panel?fecha=2026-02-16&diaSemana=Lunes` con las ausencias de Moteros]**

#### C. Célula Eucariota (Google Apps Script)

Célula expone un endpoint público de Google Apps Script. El gateway calcula el día de la semana a partir de la fecha y consulta:

```
GET https://script.google.com/macros/s/.../exec?dia=Lunes
```

La respuesta tiene esta estructura:
```json
{
  "faltas": [
    { "hora": "1", "profesor": "García López", "aula": "2ºA" }
  ],
  "guardias": [
    { "hora": "1", "profesores": ["Pérez Ruiz", "Sánchez Gómez"] }
  ]
}
```

**Nota importante:** Célula no incluye campo de "tarea", por lo que siempre se muestra "Sin tarea". Además, filtra por **día de la semana** (no por fecha concreta), por lo que se muestran los mismos datos para todos los lunes, todos los martes, etc.

> **[CAPTURA: Navegador accediendo directamente a la URL de Google Apps Script con `?dia=Miercoles` mostrando el JSON con faltas y guardias de Célula]**

#### D. IA / Duoia (Google Sheets CSV)

El grupo Duoia publica sus datos como un CSV en Google Sheets. El gateway descarga el CSV y lo parsea filtrando por día de la semana:

```
GET https://docs.google.com/spreadsheets/.../output=csv
```

El CSV tiene estas columnas:
```
Dia,Tipo,Profesor,Orden,Ubicacion,Tarea
Lunes,AUSENCIA,García López,2,Aula 3B,Ejercicios página 45
Martes,GUARDIA,Pérez Ruiz,1,,
```

El gateway filtra las filas donde `Dia` coincide con el día de la semana y `Tipo === 'AUSENCIA'`.

> **[CAPTURA: Abrir la hoja de Google Sheets directamente en el navegador mostrando las columnas Dia, Tipo, Profesor, Orden, Ubicacion, Tarea]**

### 4.5 Normalización de datos

Cada fuente devuelve datos con formatos diferentes. El gateway **normaliza** todos al siguiente formato:

```javascript
{
    id: 'j-abc123',           // Prefijo según origen: j-, m-, c-, d-
    origen: 'Jotasones (API)', // Nombre del grupo de origen
    profesor: 'María Fernández Ruiz',
    grupo: '1ºB',
    hora_inicio: 2,
    hora_fin: 3,
    tarea: 'Actividad Moodle',
    es_externo: false,         // true si viene de otro grupo
    guardia_asignada: null     // Profesor de guardia asignado (si lo hay)
}
```

### 4.6 Monitor de tráfico

El gateway incluye un **middleware** que registra cada petición API:

```javascript
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        // Log: método, URL, tiempo en ms, status code, origen
    });
    next();
});
```

Esto permite ver en tiempo real cuánto tarda cada llamada a las APIs externas.

> **[CAPTURA: Panel del navegador con la barra lateral de tráfico mostrando las peticiones GET a cada API con sus tiempos de respuesta en ms]**

### 4.7 Arranque automático de Moteros

Al arrancar el gateway, este **lanza automáticamente** el servidor de Moteros como proceso hijo:

```javascript
const moteros = spawn('node', ['server.js'], {
    cwd: path.dirname(rutaMoteros),
    shell: true,
    stdio: 'pipe'
});
```

Los logs de Moteros se muestran con el prefijo `[Moteros]` en la consola del gateway.

> **[CAPTURA: Consola mostrando los logs intercalados del gateway y de Moteros con los prefijos correspondientes]**

---

## 5. Frontend — `panel.html`

### 5.1 Diseño y estética

El panel utiliza un diseño **dark mode** con glassmorphism, la fuente **Inter** de Google Fonts, y un sistema de colores por variable CSS:

```css
:root {
    --bg: #0f1117;        /* Fondo principal */
    --surface: #1a1d27;   /* Superficies/tarjetas */
    --accent: #6366f1;    /* Color principal (índigo) */
    --green: #10b981;     /* Éxito / Célula */
    --orange: #f59e0b;    /* Moteros */
    --red: #ef4444;       /* Errores */
    --purple: #a855f7;    /* Duoia */
}
```

> **[CAPTURA: Vista general del panel con el tema oscuro, mostrando la topbar, los controles y la línea temporal — usar fecha 2026-02-09 para ver datos de los 4 grupos]**

### 5.2 Estructura de la interfaz

1. **Topbar:** Título "Panel Jotasones" y subtítulo "Centro de Guardias — IES Alixar"
2. **Barra de controles:**
   - Selector de fecha (datePicker) — sincroniza automáticamente al cambiar
   - Botón "Sincronizar"
   - Botón "+ Nueva Ausencia"
   - Badges con el resumen de cada grupo (Jotasones: N, Moteros: N, etc.)
3. **Línea temporal:** Organizada por horas (1ª a 6ª), cada hora muestra las tarjetas de ausencias
4. **Barra lateral:** Monitor de tráfico con las peticiones HTTP en tiempo real

> **[CAPTURA: Detalle de la barra de controles con la fecha seleccionada, los botones y los badges de resumen de cada grupo con sus colores]**

### 5.3 Tarjetas de ausencia

Cada ausencia se muestra como una tarjeta con:

- **Nombre del profesor** ausente
- **Badge del grupo de origen** con color identificativo:
  - 🔵 Azul: Jotasones
  - 🟠 Naranja: Moteros
  - 🟢 Verde: Célula Eucariota
  - 🟣 Morado: Duoia/IA
- **Grupo/Aula** afectada
- **Tarea** dejada por el profesor
- **Acciones:**
  - "Asignar Guardia" — abre un modal para seleccionar profesor de guardia
  - "Eliminar" — solo visible en ausencias propias (no externas)
  - Si ya tiene guardia: muestra el nombre con botón ✕ para desasignar

> **[CAPTURA: Detalle de varias tarjetas de ausencia de distintos orígenes mostrando los diferentes colores de badge (una de Jotasones en azul, una de Moteros en naranja, una de Célula en verde, una de Duoia en morado)]**

### 5.4 Asignación de guardias

El proceso de asignación de guardias funciona así:

1. El usuario pulsa **"Asignar Guardia"** en una tarjeta
2. Se abre un modal con un desplegable de **todos los profesores** (agregados de los 4 grupos, sin duplicados)
3. Al confirmar, se envía un `POST /api/guardias` al servidor
4. La tarjeta se actualiza **localmente** sin volver a sincronizar (rendimiento instantáneo)
5. Se muestra el nombre del guardia asignado con un botón ✕ para desasignar

> **[CAPTURA: Modal de "Asignar Guardia" abierto sobre una tarjeta de ausencia, mostrando el desplegable con la lista de profesores]**

> **[CAPTURA: Tarjeta de ausencia con un guardia ya asignado mostrando el nombre en verde con el botón ✕ junto a él]**

### 5.5 Sincronización automática

Al cambiar la fecha en el datePicker, se lanza automáticamente la sincronización sin necesidad de pulsar el botón:

```html
<input type="date" id="datePicker" onchange="sincronizar()">
```

La sincronización ejecuta `Promise.all` en el servidor, consultando las 4 APIs en paralelo. El tiempo total depende de la API más lenta (típicamente ~4 segundos por los timeouts a las APIs externas).

> **[CAPTURA: Panel mostrando diferentes datos para dos fechas distintas — hacer dos capturas cambiando la fecha para demostrar que se sincronizan datos diferentes]**

---

## 6. Integración de webs originales

El gateway también sirve las webs originales de otros grupos como rutas estáticas:

```javascript
app.use('/ia', express.static(path.join(__dirname, '../grupo-ia-duoia')));
app.use('/celula', express.static(path.join(__dirname, '../grupo-celula-eucariota')));
```

Accesibles en:
- `http://localhost:3000/ia` — Web original del grupo IA/Duoia
- `http://localhost:3000/celula` — Web original de Célula Eucariota

> **[CAPTURA: Navegador accediendo a `http://localhost:3000/ia` mostrando la web original del grupo IA]**

> **[CAPTURA: Navegador accediendo a `http://localhost:3000/celula` mostrando la web original de Célula Eucariota]**

---

## 7. Problemas encontrados y soluciones

### 7.1 Formato diferente de cada API

**Problema:** Cada grupo devuelve los datos con estructuras completamente distintas.

**Solución:** Se creó una capa de normalización en el gateway que mapea cada formato al formato común. Por ejemplo:

```javascript
// Jotasones devuelve: { profesor_nombre: "María Fernández Ruiz" }
// Moteros devuelve:   { profesor: { nombre: "Sofía", apellidos: "Díaz" } }
// Célula devuelve:    { profesor: "García López" }
// Duoia devuelve:     fila CSV con columna "Profesor"
```

### 7.2 Comparación de IDs (tipos diferentes)

**Problema:** Al asignar una guardia, el ID de la ausencia llegaba como string (`"39"`) pero en la base de datos era un número (`39`). La comparación estricta `===` fallaba.

**Solución:** Se cambió la comparación a `String(a.id) === String(g.ausencia_id)` para normalizar ambos tipos.

### 7.3 Problema de timezone en las fechas

**Problema:** Al crear un `new Date('2026-02-09')`, JavaScript lo interpreta como medianoche UTC. En timezone GMT+1, esto da el **día anterior** (8 de febrero a las 23:00).

**Solución:** Se añade `T12:00:00` a la fecha: `new Date('2026-02-09T12:00:00')` para que siempre caiga en el día correcto independientemente de la zona horaria.

```javascript
const diaSemana = dias[new Date(fecha + 'T12:00:00').getDay()];
```

### 7.4 Conflicto de puertos

**Problema:** Jotasones y Moteros intentaban arrancar en el mismo puerto 3000.

**Solución:** Se configuró Moteros para usar el puerto 3001 mediante variable de entorno en su archivo `.env`:

```
PORT=3001
```

### 7.5 Célula no accesible algunos días

**Problema:** La API de Célula (Google Apps Script) a veces no responde o tarda demasiado.

**Solución:** Se implementó un timeout de 4 segundos con `AbortController`:

```javascript
const controller = new AbortController();
setTimeout(() => controller.abort(), 4000);
```

Si la API falla, simplemente devuelve un array vacío `[]` y el panel funciona con los datos de los otros grupos.

### 7.6 Profesores duplicados en los desplegables

**Problema:** Al agregar profesores de los 4 grupos, aparecían duplicados (mismo profesor en distintas fuentes).

**Solución:** Se usa un `Map` para deduplicar por nombre completo en minúsculas:

```javascript
const todosNombres = new Map(); // nombre_completo -> {id, nombre, apellidos, origen}
const agregar = (nombre, apellidos, origen) => {
    const full = `${nombre} ${apellidos}`.trim();
    if (full && !todosNombres.has(full.toLowerCase())) {
        todosNombres.set(full.toLowerCase(), { id: nextId++, nombre, apellidos, origen });
    }
};
```

> **[CAPTURA: Captura del modal "Nueva Ausencia" con el desplegable de profesores abierto mostrando los 73 profesores únicos agregados de múltiples fuentes]**

---

## 8. Estructura de archivos

```
proyecto-grupal-pablo/
├── grupo-jotasones/           ← GATEWAY CENTRAL
│   ├── server.js              ← Backend (Express, ~470 líneas)
│   ├── panel.html             ← Frontend (~1080 líneas)
│   ├── scriptsql.sql          ← Base de datos MySQL
│   ├── package.json           ← Dependencias Node.js
│   └── MEMORIA.md             ← Este documento
│
├── grupo-losmoteros/          ← Moteros (MongoDB)
│   ├── server.js              ← API REST (puerto 3001)
│   ├── .env                   ← Variables de entorno
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

> **[CAPTURA: Explorador de archivos del VS Code mostrando la estructura del proyecto con las 4 carpetas de los grupos]**

---

## 9. Cómo ejecutar el proyecto

### Requisitos previos

- **Node.js** v18+
- **npm** instalado
- Acceso a la red del instituto (para la API MySQL de Jotasones)

### Pasos

```bash
# 1. Instalar dependencias de Jotasones
cd grupo-jotasones
npm install

# 2. Instalar dependencias de Moteros
cd ../grupo-losmoteros
npm install

# 3. Volver a Jotasones y arrancar el gateway (lanza Moteros automáticamente)
cd ../grupo-jotasones
node server.js
```

### Verificar que funciona

1. Abrir `http://localhost:3000/panel.html` en el navegador
2. Seleccionar una fecha (ej: 9 de febrero de 2026)
3. La sincronización se ejecuta automáticamente
4. Verificar que aparecen datos de los 4 grupos en los badges de resumen

> **[CAPTURA: Panel completamente cargado con datos de los 4 grupos, mostrando los badges de resumen arriba y varias tarjetas de ausencia en la línea temporal]**

---

## 10. Repositorio Git

El proyecto se gestiona con Git y está alojado en GitHub:

```
Remoto: guardias → https://github.com/aortben/Guardias-Multiples-BBDD.git
Rama: main
```

Para subir cambios:

```bash
git add .
git commit -m "Descripción del cambio"
git push
```

---

## 11. Conclusiones

El panel de Jotasones demuestra cómo es posible **integrar datos de múltiples fuentes heterogéneas** (MySQL, MongoDB, Google Apps Script, CSV) en una interfaz unificada. Los retos principales fueron:

- **Normalización de datos:** cada grupo usa formatos diferentes
- **Tolerancia a fallos:** la caída de un grupo no afecta a los demás
- **Rendimiento:** las consultas se ejecutan en paralelo con `Promise.all`
- **Experiencia de usuario:** actualización local sin recargar toda la página

El resultado es un sistema funcional que permite gestionar las guardias del centro desde un único punto, independientemente de la tecnología que use cada grupo para almacenar sus datos.
