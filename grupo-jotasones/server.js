const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
//  URLS
// ========================================================
const JOTASONES_API_URL = 'http://172.22.0.152:3000/api/v1';
const MOTEROS_URL = 'http://localhost:3001';
const CELULA_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz6veJ_02mh-L1-LmzJTfQpFgUBHKKg3MN__4OQ_NHleaaS2gFz_Yy-CNwqDgNi5jQwzw/exec';
const DUOIA_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRLBHYrwNyk20UoDwqBu-zfDXWSyeRtsg536axelI0eEHYsovoMiwgoS82tjGRy6Tysw3Pj6ovDiyzo/pub?gid=1908899796&single=true&output=csv';

// ========================================================
//  CONFIGURACIÓN MYSQL
// ========================================================
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'guardias',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};
let pool;
try {
    pool = mysql.createPool(dbConfig);
} catch (e) {
    console.error('Error creando pool MySQL:', e);
}

// ========================================================
//  LOG DE TRÁFICO (últimas 100 peticiones)
// ========================================================
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
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        if (req.originalUrl.startsWith('/api')) {
            addTrafficEntry(req.method, req.originalUrl, elapsed, res.statusCode, 'gateway');
            console.log(`📡 [${req.method}] ${req.originalUrl} → ${res.statusCode} (${elapsed.toFixed(1)} ms)`);
        }
    });
    next();
});

// ========================================================
//  SERVIR ARCHIVOS ESTÁTICOS
// ========================================================
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, fs.existsSync(path.join(__dirname, 'panel.html')) ? 'panel.html' : 'index.html'));
});

// // Webs de otros grupos
// app.use('/ia', express.static(path.join(__dirname, '../grupo-ia')));
// app.use('/celula', express.static(path.join(__dirname, '../grupo-celula-eucariota')));

// ========================================================
//  DATOS LOCALES DE RESPALDO
// ========================================================
const PROFESORES_RESPALDO = [
    { id: 1, nombre: "María", apellidos: "Fernández Ruiz" },
    { id: 2, nombre: "Laura", apellidos: "Pérez Gómez" },
    { id: 3, nombre: "Juan", apellidos: "López García" },
    { id: 4, nombre: "Ana", apellidos: "Martín Díaz" },
    { id: 5, nombre: "Carlos", apellidos: "Sánchez Mora" },
    { id: 6, nombre: "Lucía", apellidos: "Navarro Gil" },
    { id: 7, nombre: "Pedro", apellidos: "Romero Torres" },
    { id: 8, nombre: "Elena", apellidos: "Vega Castillo" }
];

const GRUPOS_RESPALDO = [
    { id: 1, nombre: "1ºA" }, { id: 2, nombre: "1ºB" },
    { id: 3, nombre: "2ºA" }, { id: 4, nombre: "2ºB" },
    { id: 5, nombre: "3ºA" }, { id: 6, nombre: "3ºB" },
    { id: 7, nombre: "4ºA" }, { id: 8, nombre: "4ºB" }
];

// Almacén en memoria para ausencias locales y guardias asignadas
let ausenciasLocales = [];
let guardiasAsignadas = [];
let nextAusenciaId = 1000;
let nextGuardiaId = 5000;

// ========================================================
//  HELPER: fetch con timeout y tracking de tráfico
// ========================================================
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

// ========================================================
//  API: PROFESORES (agregados de TODOS los grupos)
// ========================================================
app.get('/api/profesores', async (req, res) => {
    const todosNombres = new Map();
    let nextId = 100;

    // Helper para añadir si no existe
    const agregar = (nombre, apellidos, origen) => {
        const full = `${nombre} ${apellidos}`.trim();
        if (full && !todosNombres.has(full.toLowerCase())) {
            todosNombres.set(full.toLowerCase(), {
                id: nextId++, nombre, apellidos, origen
            });
        }
    };

    // 1. Respaldo local (siempre disponible)
    PROFESORES_RESPALDO.forEach(p => agregar(p.nombre, p.apellidos, 'Jotasones'));

    // 2. Jotasones API remota (devuelve {success, data: [{id, nombre, apellidos}]})
    try {
        const { response } = await fetchConTiempo(`${JOTASONES_API_URL}/profesores`, {}, 'jotasones-api');
        if (response.ok) {
            const data = await response.json();
            const lista = data.data || data.profesores || (Array.isArray(data) ? data : []);
            lista.forEach(p => agregar(p.nombre, p.apellidos || '', 'Jotasones'));
        }
    } catch (e) { /* sin acceso */ }

    // 3. Moteros
    try {
        const { response } = await fetchConTiempo(`${MOTEROS_URL}/api/profesores`, {}, 'moteros');
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) data.forEach(p => agregar(p.nombre, p.apellidos || '', 'Moteros'));
        }
    } catch (e) { /* sin acceso */ }

    // 4. Célula (Google Apps Script) - extraer profesores de guardias
    try {
        const { response } = await fetchConTiempo(`${CELULA_SCRIPT_URL}?dia=Lunes`, {}, 'celula');
        if (response.ok) {
            const d = await response.json();
            (d.guardias || []).forEach(g => {
                (g.profesores || []).forEach(nombre => {
                    const partes = nombre.trim().split(' ');
                    agregar(partes[0] || nombre, partes.slice(1).join(' '), 'Célula');
                });
            });
            (d.faltas || []).forEach(f => {
                if (f.profesor) {
                    const partes = f.profesor.trim().split(' ');
                    agregar(partes[0] || f.profesor, partes.slice(1).join(' '), 'Célula');
                }
            });
        }
    } catch (e) { /* sin acceso */ }

    // 5. Duoia (CSV) - extraer nombres de la columna profesor
    try {
        const { response } = await fetchConTiempo(DUOIA_CSV_URL, {}, 'duoia');
        if (response.ok) {
            const txt = await response.text();
            const filas = txt.split('\n').map(l => l.trim());
            const h = filas[0].toLowerCase().split(',');
            const idxProf = h.indexOf('profesor');
            if (idxProf >= 0) {
                const vistos = new Set();
                filas.slice(1).forEach(l => {
                    const c = l.split(',');
                    const nombre = (c[idxProf] || '').trim();
                    if (nombre && !vistos.has(nombre.toLowerCase())) {
                        vistos.add(nombre.toLowerCase());
                        const partes = nombre.split(' ');
                        agregar(partes[0], partes.slice(1).join(' '), 'Duoia');
                    }
                });
            }
        }
    } catch (e) { /* sin acceso */ }

    const resultado = Array.from(todosNombres.values());
    console.log(`👥 Profesores agregados: ${resultado.length} (de múltiples fuentes)`);
    res.json(resultado);
});

// ========================================================
//  API: GRUPOS
// ========================================================
app.get('/api/grupos', async (req, res) => {
    try {
        const { response } = await fetchConTiempo(`${JOTASONES_API_URL}/grupos`, {}, 'jotasones-api');
        if (!response.ok) throw new Error("API error");
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) return res.json(data);
        res.json(GRUPOS_RESPALDO);
    } catch (e) { res.json(GRUPOS_RESPALDO); }
});

// ========================================================
//  API: CREAR AUSENCIA (local)
// ========================================================
app.post('/api/ausencias', (req, res) => {
    const { profesor, grupo, hora_inicio, hora_fin, tarea, fecha } = req.body;
    const nueva = {
        id: 'local-' + (nextAusenciaId++),
        origen: 'Jotasones',
        profesor: profesor || 'Sin nombre',
        grupo: grupo || '?',
        hora_inicio: parseInt(hora_inicio) || 1,
        hora_fin: parseInt(hora_fin) || parseInt(hora_inicio) || 1,
        tarea: tarea || '',
        fecha: fecha || new Date().toISOString().split('T')[0],
        es_externo: false,
        guardia_asignada: null
    };
    ausenciasLocales.push(nueva);
    console.log(`✅ Ausencia creada: ${nueva.id} → ${nueva.profesor}`);

    // También intentamos enviar al remoto (fire-and-forget)
    fetchConTiempo(`${JOTASONES_API_URL}/ausencias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
    }, 'jotasones-api').catch(() => { });

    res.json({ ok: true, ausencia: nueva });
});

// ========================================================
//  API: ELIMINAR AUSENCIA (local)
// ========================================================
app.delete('/api/ausencias/:id', (req, res) => {
    const id = req.params.id;
    const antes = ausenciasLocales.length;
    ausenciasLocales = ausenciasLocales.filter(a => a.id !== id);
    // También quitamos guardias vinculadas
    guardiasAsignadas = guardiasAsignadas.filter(g => g.ausencia_id !== id);

    if (ausenciasLocales.length < antes) {
        console.log(`🗑️ Ausencia eliminada: ${id}`);
        res.json({ ok: true });
    } else {
        res.status(404).json({ ok: false, error: 'Ausencia no encontrada' });
    }
});

// ========================================================
//  API: ASIGNAR GUARDIA
// ========================================================
app.post('/api/guardias', (req, res) => {
    const { ausencia_id, profesor_nombre, hora, fecha } = req.body;
    const guardia = {
        id: 'g-' + (nextGuardiaId++),
        ausencia_id,
        profesor_nombre,
        hora: parseInt(hora) || 1,
        fecha
    };
    guardiasAsignadas.push(guardia);

    // Marcamos la guardia en la ausencia local si existe
    const aus = ausenciasLocales.find(a => a.id === ausencia_id);
    if (aus) aus.guardia_asignada = profesor_nombre;

    console.log(`👮 Guardia asignada: ${profesor_nombre} → ausencia ${ausencia_id}`);
    res.json({ ok: true, guardia });
});

// ========================================================
//  API: DESASIGNAR GUARDIA
// ========================================================
app.delete('/api/guardias/:id', (req, res) => {
    const id = req.params.id;
    const guardia = guardiasAsignadas.find(g => g.id === id);
    if (guardia) {
        // Limpiar en la ausencia local
        const aus = ausenciasLocales.find(a => a.id === guardia.ausencia_id);
        if (aus) aus.guardia_asignada = null;
    }
    guardiasAsignadas = guardiasAsignadas.filter(g => g.id !== id);
    res.json({ ok: true });
});

// ========================================================
//  API: LOG DE TRÁFICO
// ========================================================
app.get('/api/trafico', (req, res) => {
    res.json(trafficLog);
});

// ========================================================
//  API: MYSQL (Datos directos DB)
// ========================================================
app.get('/api/sql/profesores', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM profesores');
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error accediendo a BD', detalle: e.message });
    }
});

app.get('/api/sql/grupos', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM grupos');
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error accediendo a BD', detalle: e.message });
    }
});

app.get('/api/sql/reportes', async (req, res) => {
    try {
        // JOIN opcional para ver nombres en vez de IDs si se prefiere
        // const [rows] = await pool.query(`
        //     SELECT r.*, p.nombre as profe, p.apellidos, g.nombre as grupo 
        //     FROM reportes r 
        //     JOIN profesores p ON r.profesor_id = p.id 
        //     JOIN grupos g ON r.grupo_id = g.id
        // `);
        const [rows] = await pool.query('SELECT * FROM reportes');
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error accediendo a BD', detalle: e.message });
    }
});

app.get('/api/sql/guardias', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM guardias');
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error accediendo a BD', detalle: e.message });
    }
});

// ========================================================
//  EL CEREBRO: PANEL UNIFICADO
// ========================================================
app.get('/api/panel', async (req, res) => {
    const { fecha } = req.query;
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    // Usar T12:00:00 para evitar problemas de timezone (UTC midnight puede dar día anterior)
    const diaSemana = dias[new Date(fecha + 'T12:00:00').getDay()];

    console.log(`\n🔎 SINCRONIZACIÓN: ${fecha} (${diaSemana})`);
    console.log('─'.repeat(50));

    // A. JOTASONES (API remota — devuelve {success, data: [{profesor_nombre, grupo_nombre, hora_inicio, ...}]})
    const jotasonesPromise = fetchConTiempo(
        `${JOTASONES_API_URL}/ausencias?fecha=${fecha}`, {}, 'jotasones-api'
    )
        .then(async ({ response }) => {
            const data = await response.json();
            // La API real devuelve {success: true, data: [...], count: N}
            const lista = data.data || data.ausencias || (Array.isArray(data) ? data : []);
            console.log(`  ✅ Jotasones API: ${lista.length} ausencias`);
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
        })
        .catch((e) => {
            console.log('  ⚠️ Jotasones API no accesible:', e.message);
            return [];
        });

    // B. MOTEROS (localhost:3001)
    const moterosPromise = fetchConTiempo(
        `${MOTEROS_URL}/api/panel?fecha=${fecha}&diaSemana=${diaSemana}`, {}, 'moteros'
    )
        .then(async ({ response }) => {
            const d = await response.json();
            const ausencias = (d.ausencias || []).map(a => ({
                id: 'm-' + Math.random().toString(36).substr(2, 6),
                origen: 'Los Moteros',
                profesor: a.profesor?.nombre ? `${a.profesor.nombre} ${a.profesor.apellidos || ''}`.trim() : (a.profesor || '?'),
                grupo: a.grupo || '?',
                hora_inicio: parseInt(a.hora) || 1,
                hora_fin: parseInt(a.hora) || 1,
                tarea: a.tarea || 'Sin tarea',
                es_externo: true,
                guardia_asignada: null
            }));
            // Extraer profesores de guardia de Moteros
            const guardias = (d.guardias || []).filter(g => g.status === 'disponible').map(g => {
                const nombre = g.profesor?.nombre ? `${g.profesor.nombre} ${g.profesor.apellidos || ''}`.trim() : '?';
                const horaNum = parseInt(String(g.hora).replace(/[^0-9]/g, '')) || 1;
                return { nombre, hora: horaNum, origen: 'Los Moteros' };
            });
            return { ausencias, guardias };
        })
        .catch(() => {
            console.log('  ⚠️ Moteros no accesible');
            return { ausencias: [], guardias: [] };
        });

    // C. CÉLULA EUCARIOTA (Google Apps Script)
    const celulaPromise = fetchConTiempo(
        `${CELULA_SCRIPT_URL}?dia=${diaSemana}`, {}, 'celula'
    )
        .then(async ({ response }) => {
            const d = await response.json();
            const ausencias = (d.faltas || []).map(f => ({
                id: 'c-' + Math.random().toString(36).substr(2, 6),
                origen: 'Célula Eucariota',
                profesor: f.profesor || '?',
                grupo: f.aula || '?',
                hora_inicio: parseInt(f.hora) || 1,
                hora_fin: parseInt(f.hora) || 1,
                tarea: 'Sin tarea',
                es_externo: true,
                guardia_asignada: null
            }));
            // Extraer profesores de guardia de Célula
            const guardias = [];
            (d.guardias || []).forEach(g => {
                const horaNum = parseInt(g.hora) || 1;
                (g.profesores || []).forEach(nombre => {
                    guardias.push({ nombre: nombre.trim(), hora: horaNum, origen: 'Célula Eucariota' });
                });
            });
            return { ausencias, guardias };
        })
        .catch(() => {
            console.log('  ⚠️ Célula Eucariota no accesible');
            return { ausencias: [], guardias: [] };
        });

    // D. IA / DUOIA (Google Sheets CSV)
    const duoiaPromise = fetchConTiempo(DUOIA_CSV_URL, {}, 'duoia')
        .then(async ({ response }) => {
            const txt = await response.text();
            const filas = txt.split('\n').map(l => l.trim());
            const h = filas[0].toLowerCase().split(',');
            const idx = {
                dia: h.indexOf('dia'), tipo: h.indexOf('tipo'),
                prof: h.indexOf('profesor'), hora: h.indexOf('orden'),
                aula: h.indexOf('ubicacion'), tarea: h.indexOf('tarea')
            };
            const ausencias = [];
            const guardias = [];
            filas.slice(1).forEach(l => {
                const c = l.split(',');
                if (c[idx.dia]?.trim().toLowerCase() !== diaSemana.toLowerCase()) return;
                const tipo = c[idx.tipo]?.trim();
                if (tipo === 'AUSENCIA') {
                    ausencias.push({
                        id: 'd-' + Math.random().toString(36).substr(2, 6),
                        origen: 'IA (Duoia)',
                        profesor: c[idx.prof]?.trim() || '?',
                        grupo: c[idx.aula]?.trim() || '?',
                        hora_inicio: parseInt(c[idx.hora]) || 1,
                        hora_fin: parseInt(c[idx.hora]) || 1,
                        tarea: c[idx.tarea]?.trim() || 'Sin tarea',
                        es_externo: true,
                        guardia_asignada: null
                    });
                } else if (tipo === 'GUARDIA') {
                    guardias.push({
                        nombre: c[idx.prof]?.trim() || '?',
                        hora: parseInt(c[idx.hora]) || 1,
                        origen: 'IA (Duoia)'
                    });
                }
            });
            return { ausencias, guardias };
        })
        .catch(() => {
            console.log('  ⚠️ IA/Duoia no accesible');
            return { ausencias: [], guardias: [] };
        });

    try {
        const [jotasones, moterosData, celulaData, duoiaData] = await Promise.all([
            jotasonesPromise, moterosPromise, celulaPromise, duoiaPromise
        ]);

        // Extraer ausencias (Jotasones devuelve array directo, los demás {ausencias, guardias})
        const moteros = moterosData.ausencias || [];
        const celula = celulaData.ausencias || [];
        const duoia = duoiaData.ausencias || [];

        const todas = [...jotasones, ...moteros, ...celula, ...duoia];

        // Vincular guardias asignadas a ausencias externas
        guardiasAsignadas
            .filter(g => g.fecha === fecha)
            .forEach(g => {
                const aus = todas.find(a => String(a.id) === String(g.ausencia_id));
                if (aus) {
                    aus.guardia_asignada = g.profesor_nombre;
                    aus.guardia_id = g.id;
                }
            });

        // Combinar profesores de guardia de todas las fuentes, agrupados por hora
        const todasGuardias = [
            ...(moterosData.guardias || []),
            ...(celulaData.guardias || []),
            ...(duoiaData.guardias || [])
        ];
        const profesoresGuardia = {};
        for (let h = 1; h <= 6; h++) profesoresGuardia[h] = [];
        todasGuardias.forEach(g => {
            const h = g.hora;
            if (h >= 1 && h <= 6) {
                profesoresGuardia[h].push({ nombre: g.nombre, origen: g.origen });
            }
        });

        console.log(`  📊 Resultados: Jotasones=${jotasones.length}, Moteros=${moteros.length}, Célula=${celula.length}, Duoia=${duoia.length}`);
        console.log(`  👮 Guardias disponibles: ${todasGuardias.length} profesores`);
        console.log('─'.repeat(50));

        res.json({
            ausencias: todas,
            resumen: {
                jotasones: jotasones.length,
                moteros: moteros.length,
                celula: celula.length,
                duoia: duoia.length,
                total: todas.length
            },
            guardias_asignadas: guardiasAsignadas.filter(g => g.fecha === fecha),
            profesores_guardia: profesoresGuardia
        });
    } catch (e) {
        console.error('❌ Error combinando:', e.message);
        res.status(500).json({ error: "Error combinando datos" });
    }
});

// ========================================================
//  ARRANQUE
// ========================================================
app.listen(3000, () => {
    console.log('\n' + '═'.repeat(50));
    console.log('  ✅ GATEWAY JOTASONES → http://localhost:3000');
    console.log('  🌍 Webs integradas: /ia y /celula');
    console.log('═'.repeat(50) + '\n');

    // Arranque automático de Moteros
    const rutaMoteros = path.resolve(__dirname, '../grupo-losmoteros/server.js');
    if (fs.existsSync(rutaMoteros)) {
        console.log('🚀 Arrancando Moteros en puerto 3001...');
        const moteros = spawn('node', ['server.js'], { cwd: path.dirname(rutaMoteros), shell: true, stdio: 'pipe' });
        moteros.stdout.on('data', d => console.log(`[Moteros] ${d.toString().trim()}`));
        moteros.stderr.on('data', d => console.error(`[Moteros ERR] ${d.toString().trim()}`));
    }
});