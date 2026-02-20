const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
//  1. CONFIGURACIÓN
// ========================================================
const JOTASONES_API_URL = process.env.JOTASONES_API_URL || 'http://localhost:3000/api/v1';
const MOTEROS_URL = process.env.MOTEROS_URL || 'http://localhost:3001';
const CELULA_SCRIPT_URL = process.env.CELULA_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz6veJ_02mh-L1-LmzJTfQpFgUBHKKg3MN__4OQ_NHleaaS2gFz_Yy-CNwqDgNi5jQwzw/exec';
const DUOIA_CSV_URL = process.env.DUOIA_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRLBHYrwNyk20UoDwqBu-zfDXWSyeRtsg536axelI0eEHYsovoMiwgoS82tjGRy6Tysw3Pj6ovDiyzo/pub?gid=1908899796&single=true&output=csv';

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASS || '1234',
    database: process.env.DB_NAME || 'guardias',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;
try {
    pool = mysql.createPool(dbConfig);
    console.log("🔌 Pool MySQL conectado.");
} catch (e) { console.error('Error MySQL:', e); }

// ========================================================
//  2. SERVIDOR WEB Y LOGS
// ========================================================
app.use((req, res, next) => {
    console.log(`📡 [${req.method}] ${req.url}`);
    next();
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, fs.existsSync(path.join(__dirname, 'panel.html')) ? 'panel.html' : 'index.html'));
});

// Helper para Fetch con Timeout
async function fetchConTiempo(url, opciones = {}) {
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3000), ...opciones });
        return { response: r };
    } catch (e) { throw e; }
}

// ========================================================
//  3. API: LECTURA DE DATOS (GET)
// ========================================================

// --- PROFESORES (AGREGADO) ---
app.get('/api/profesores', async (req, res) => {
    const todosNombres = new Map();
    let nextId = 100;
    const agregar = (nombre, apellidos, origen) => {
        const full = `${nombre} ${apellidos}`.trim();
        if (full && !todosNombres.has(full.toLowerCase())) {
            todosNombres.set(full.toLowerCase(), { id: nextId++, nombre, apellidos, origen });
        }
    };

    // 1. MySQL Local
    try {
        const [rows] = await pool.query('SELECT * FROM profesores');
        rows.forEach(p => agregar(p.nombre, p.apellidos, 'Local'));
    } catch (e) { }

    // 2. Remotos (Jotasones API, Moteros, Célula, Duoia)
    try {
        const { response } = await fetchConTiempo(`${JOTASONES_API_URL}/profesores`);
        if (response.ok) { const d = await response.json(); (d.data || d).forEach(p => agregar(p.nombre, p.apellidos || '', 'Jotasones')); }
    } catch (e) { }

    try {
        const { response } = await fetchConTiempo(`${MOTEROS_URL}/api/profesores`);
        if (response.ok) { const d = await response.json(); if (Array.isArray(d)) d.forEach(p => agregar(p.nombre, p.apellidos || '', 'Moteros')); }
    } catch (e) { }

    // (Omitimos Célula/Duoia en profesores para ahorrar espacio, el panel ya los trae)

    res.json(Array.from(todosNombres.values()));
});

// --- GRUPOS ---
app.get('/api/grupos', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM grupos');
        if (rows.length > 0) return res.json(rows);
    } catch (e) { }
    res.json([{ id: 1, nombre: "1º ESO A" }, { id: 2, nombre: "2º ESO B" }, { id: 3, nombre: "Sala Profesores" }]);
});

// --- PANEL UNIFICADO ---
app.get('/api/panel', async (req, res) => {
    const { fecha } = req.query;
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const diaSemana = dias[new Date(fecha + 'T12:00:00').getDay()];

    console.log(`🔎 Panel: ${fecha}`);

    // A. MySQL Local (Con JOINs para nombres)
    const localPromise = pool.query(`
        SELECT r.id, r.hora_inicio, r.hora_fin, r.tarea, 
               p.nombre as p_nom, p.apellidos as p_ape, 
               g.nombre as g_nom,
               pg.nombre as guard_n, pg.apellidos as guard_a,
               ga.id as guardia_id
        FROM reportes r
        LEFT JOIN profesores p ON r.profesor_id = p.id
        LEFT JOIN grupos g ON r.grupo_id = g.id
        LEFT JOIN guardias ga ON ga.reporte_id = r.id
        LEFT JOIN profesores pg ON ga.profesor_guardia_id = pg.id
        WHERE r.fecha = ?
    `, [fecha]).then(([rows]) => rows.map(r => ({
        id: r.id, origen: 'Jotasones Local', profesor: `${r.p_nom} ${r.p_ape}`,
        grupo: r.g_nom, hora_inicio: r.hora_inicio, hora_fin: r.hora_fin, tarea: r.tarea,
        nombre_guardia: r.guard_n ? `${r.guard_n} ${r.guard_a}` : null,
        guardia_id: r.guardia_id,
        es_externo: false
    }))).catch(() => []);

    // B. Moteros
    const moterosPromise = fetchConTiempo(`${MOTEROS_URL}/api/panel?fecha=${fecha}&diaSemana=${diaSemana}`)
        .then(async ({ response }) => {
            const d = await response.json();
            return (d.ausencias || []).map(a => ({
                id: 'm' + Math.random(), origen: 'Los Moteros', profesor: a.profesor?.nombre || '?', grupo: a.grupo,
                hora_inicio: parseInt(a.hora), hora_fin: parseInt(a.hora), tarea: a.tarea, es_externo: true
            }));
        }).catch(() => []);

    // C. Célula
    const celulaPromise = fetchConTiempo(`${CELULA_SCRIPT_URL}?dia=${diaSemana}`)
        .then(async ({ response }) => {
            const d = await response.json();
            return (d.faltas || []).map(f => ({
                id: 'c' + Math.random(), origen: 'Célula', profesor: f.profesor, grupo: f.aula,
                hora_inicio: parseInt(f.hora), hora_fin: parseInt(f.hora), tarea: 'Ver web original', es_externo: true
            }));
        }).catch(() => []);

    // D. Duoia
    const duoiaPromise = fetchConTiempo(DUOIA_CSV_URL)
        .then(async ({ response }) => {
            const txt = await response.text();
            const filas = txt.split('\n');
            const h = filas[0].toLowerCase().split(',');
            const idx = { dia: h.indexOf('dia'), tipo: h.indexOf('tipo'), prof: h.indexOf('profesor'), hora: h.indexOf('orden'), aula: h.indexOf('ubicacion'), tarea: h.indexOf('tarea') };
            return filas.slice(1).map(l => {
                const c = l.split(',');
                if (c[idx.dia]?.toLowerCase() === diaSemana.toLowerCase() && c[idx.tipo] === 'AUSENCIA') {
                    return { id: 'd' + Math.random(), origen: 'IA (Duoia)', profesor: c[idx.prof], grupo: c[idx.aula], hora_inicio: parseInt(c[idx.hora]), hora_fin: parseInt(c[idx.hora]), tarea: c[idx.tarea], es_externo: true };
                }
            }).filter(Boolean);
        }).catch(() => []);

    try {
        const [local, moteros, celula, duoia] = await Promise.all([localPromise, moterosPromise, celulaPromise, duoiaPromise]);
        res.json([...local, ...moteros, ...celula, ...duoia]);
    } catch (e) { res.status(500).json({ error: "Error combinando" }); }
});

// --- PROFESORES DISPONIBLES (Para el modal de asignar guardia) ---
app.get('/api/profesores-disponibles', async (req, res) => {
    const { hora, fecha } = req.query;
    try {
        // Profes que NO están ausentes Y NO están ya de guardia
        const [rows] = await pool.query(`
            SELECT * FROM profesores 
            WHERE id NOT IN (SELECT profesor_id FROM reportes WHERE fecha=? AND hora_inicio<=? AND hora_fin>=?)
            AND id NOT IN (SELECT profesor_guardia_id FROM guardias WHERE fecha=? AND hora=?)
            ORDER BY apellidos
        `, [fecha, hora, hora, fecha, hora]);
        res.json(rows);
    } catch (e) { res.json([]); }
});

// ========================================================
//  4. API: ESCRITURA (POST/DELETE) - ¡ESTO FALTABA!
// ========================================================

// Crear Ausencia
app.post('/api/reportes', async (req, res) => {
    const { profesor_id, grupo_id, hora_inicio, hora_fin, tarea, fecha } = req.body;
    try {
        await pool.query('INSERT INTO reportes (profesor_id, grupo_id, hora_inicio, hora_fin, tarea, fecha) VALUES (?,?,?,?,?,?)',
            [profesor_id, grupo_id, hora_inicio, hora_fin, tarea, fecha]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borrar Ausencia
app.delete('/api/reportes/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM reportes WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Asignar Guardia
app.post('/api/guardias', async (req, res) => {
    const { reporte_id, profesor_guardia_id, hora, fecha } = req.body;
    try {
        await pool.query('INSERT INTO guardias (reporte_id, profesor_guardia_id, hora, fecha) VALUES (?,?,?,?)',
            [reporte_id, profesor_guardia_id, hora, fecha]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borrar Guardia
app.delete('/api/guardias/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM guardias WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========================================================
//  5. ARRANQUE
// ========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Servidor JOTASONES (Producción MV) listo en puerto ${PORT}`);
});