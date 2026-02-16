const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
//  CONFIGURACIÓN
// ========================================================
const JOTASONES_API_URL = 'http://172.22.0.152:3000/api/v1';
const MOTEROS_URL = 'http://localhost:3001';
const CELULA_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz6veJ_02mh-L1-LmzJTfQpFgUBHKKg3MN__4OQ_NHleaaS2gFz_Yy-CNwqDgNi5jQwzw/exec';
const DUOIA_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRLBHYrwNyk20UoDwqBu-zfDXWSyeRtsg536axelI0eEHYsovoMiwgoS82tjGRy6Tysw3Pj6ovDiyzo/pub?gid=1908899796&single=true&output=csv';

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

// Middleware: mide TODAS las peticiones que pasan por Express
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        // Solo logueamos rutas /api (NO intentar set headers aquí, ya se enviaron)
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

// Webs de otros grupos
app.use('/ia', express.static(path.join(__dirname, '../grupo-ia')));
app.use('/celula', express.static(path.join(__dirname, '../grupo-celula-eucariota')));

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
let guardiasAsignadas = []; // { id, ausencia_id, profesor_nombre, hora, fecha }
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
//  API: PROFESORES
// ========================================================
app.get('/api/profesores', async (req, res) => {
    try {
        const { response } = await fetchConTiempo(`${JOTASONES_API_URL}/profesores`, {}, 'jotasones-api');
        if (!response.ok) throw new Error("API error");
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) return res.json(data);
        res.json(PROFESORES_RESPALDO);
    } catch (e) {
        console.log("⚠️ API Profesores fallida → usando respaldo local");
        res.json(PROFESORES_RESPALDO);
    }
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
//  EL CEREBRO: PANEL UNIFICADO
// ========================================================
app.get('/api/panel', async (req, res) => {
    const { fecha } = req.query;
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    // Usar T12:00:00 para evitar problemas de timezone (UTC midnight puede dar día anterior)
    const diaSemana = dias[new Date(fecha + 'T12:00:00').getDay()];

    console.log(`\n🔎 SINCRONIZACIÓN: ${fecha} (${diaSemana})`);
    console.log('─'.repeat(50));

    // A. JOTASONES (API remota con respaldo)
    const jotasonesPromise = fetchConTiempo(
        `${JOTASONES_API_URL}/ausencias?fecha=${fecha}`, {}, 'jotasones-api'
    )
        .then(async ({ response }) => {
            const data = await response.json();
            const lista = Array.isArray(data) ? data : (data.ausencias || []);
            return lista.map(a => ({
                id: a.id || 'j-' + Math.random().toString(36).substr(2, 6),
                origen: 'Jotasones (API)',
                profesor: a.profesor || 'Docente',
                grupo: a.grupo || '?',
                hora_inicio: parseInt(a.horaInicio || a.hora || 1),
                hora_fin: parseInt(a.horaFin || a.hora || 1),
                tarea: a.tarea || 'Sin tarea',
                es_externo: false,
                guardia_asignada: a.guardiaNombre || null
            }));
        })
        .catch(() => {
            console.log('  ⚠️ Jotasones API no accesible');
            return [];
        });

    // B. MOTEROS (localhost:3001)
    const moterosPromise = fetchConTiempo(
        `${MOTEROS_URL}/api/panel?fecha=${fecha}&diaSemana=${diaSemana}`, {}, 'moteros'
    )
        .then(async ({ response }) => {
            const d = await response.json();
            return (d.ausencias || []).map(a => ({
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
        })
        .catch(() => {
            console.log('  ⚠️ Moteros no accesible');
            return [];
        });

    // C. CÉLULA EUCARIOTA (Google Apps Script)
    const celulaPromise = fetchConTiempo(
        `${CELULA_SCRIPT_URL}?dia=${diaSemana}`, {}, 'celula'
    )
        .then(async ({ response }) => {
            const d = await response.json();
            return (d.faltas || []).map(f => ({
                id: 'c-' + Math.random().toString(36).substr(2, 6),
                origen: 'Célula Eucariota',
                profesor: f.profesor || '?',
                grupo: f.aula || '?',
                hora_inicio: parseInt(f.hora) || 1,
                hora_fin: parseInt(f.hora) || 1,
                tarea: 'Ver web original',
                es_externo: true,
                guardia_asignada: null
            }));
        })
        .catch(() => {
            console.log('  ⚠️ Célula Eucariota no accesible');
            return [];
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
            return filas.slice(1).map(l => {
                const c = l.split(',');
                if (c[idx.dia]?.trim().toLowerCase() === diaSemana.toLowerCase() && c[idx.tipo]?.trim() === 'AUSENCIA') {
                    return {
                        id: 'd-' + Math.random().toString(36).substr(2, 6),
                        origen: 'IA (Duoia)',
                        profesor: c[idx.prof]?.trim() || '?',
                        grupo: c[idx.aula]?.trim() || '?',
                        hora_inicio: parseInt(c[idx.hora]) || 1,
                        hora_fin: parseInt(c[idx.hora]) || 1,
                        tarea: c[idx.tarea]?.trim() || 'Sin tarea',
                        es_externo: true,
                        guardia_asignada: null
                    };
                }
            }).filter(Boolean);
        })
        .catch(() => {
            console.log('  ⚠️ IA/Duoia no accesible');
            return [];
        });

    try {
        const [jotasones, moteros, celula, duoia] = await Promise.all([
            jotasonesPromise, moterosPromise, celulaPromise, duoiaPromise
        ]);

        // Filtrar ausencias locales por fecha
        const locales = ausenciasLocales.filter(a => a.fecha === fecha);

        // Juntar guardias asignadas
        const todas = [...jotasones, ...moteros, ...celula, ...duoia, ...locales];

        // Vincular guardias asignadas a ausencias externas
        guardiasAsignadas
            .filter(g => g.fecha === fecha)
            .forEach(g => {
                const aus = todas.find(a => a.id === g.ausencia_id);
                if (aus) aus.guardia_asignada = g.profesor_nombre;
            });

        console.log(`  📊 Resultados: Jotasones=${jotasones.length}, Moteros=${moteros.length}, Célula=${celula.length}, Duoia=${duoia.length}, Local=${locales.length}`);
        console.log('─'.repeat(50));

        res.json({
            ausencias: todas,
            resumen: {
                jotasones: jotasones.length,
                moteros: moteros.length,
                celula: celula.length,
                duoia: duoia.length,
                local: locales.length,
                total: todas.length
            },
            guardias_asignadas: guardiasAsignadas.filter(g => g.fecha === fecha)
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