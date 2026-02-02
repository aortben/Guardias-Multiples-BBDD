const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors()); // Permite peticiones desde cualquier origen
app.use(express.json()); // Permite recibir JSON
app.use(express.static('.'));

// --- CONFIGURACIÓN DE LA BASE DE DATOS ---
const db = mysql.createConnection({
    host: 'localhost',      // IP de tu MySQL (localhost si está en la misma máquina)
    user: 'rootG',
    password: 'root2025G',
    database: 'guardias'
});

// Conectar a MySQL
db.connect(err => {
    if (err) {
        console.error('Error conectando a la BD:', err);
        return;
    }
    console.log('¡Conectado a MySQL exitosamente!');
});

// --- ENDPOINTS ---

// GET /profesores
app.get('/api/profesores', (req, res) => {
    const sql = 'SELECT * FROM profesores'; 
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message }); 
        res.json(results); 
    });
});

// POST /reportes
app.post('/api/reportes', (req, res) => {
    const { profesor_id, grupo, hora_inicio, hora_fin, tarea, es_ausencia } = req.body;

    const sql = `
        INSERT INTO reportes_guardias 
        (profesor_id, grupo, hora_inicio, hora_fin, tarea, es_ausencia) 
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [profesor_id, grupo, hora_inicio, hora_fin, tarea, es_ausencia], (err, result) => {
        if (err) return res.status(500).json({ error: 'Error al guardar en BD' });
        res.json({ mensaje: 'Guardia registrada correctamente', id: result.insertId });
    });
});

// GET /historial
app.get('/api/historial', (req, res) => {
    const sql = `
        SELECT 
            r.id, 
            p.nombre, 
            p.apellidos,       -- Asegúrate de que la columna existe
            r.grupo, 
            r.hora_inicio, 
            r.hora_fin, 
            r.tarea, 
            r.fecha 
        FROM reportes_guardias r
        JOIN profesores p ON r.profesor_id = p.id
        WHERE r.es_ausencia = 1
        ORDER BY r.fecha DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// DELETE /reportes/:id
app.delete('/api/reportes/:id', (req, res) => {
    const id = req.params.id;
    const sql = 'DELETE FROM reportes_guardias WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ mensaje: 'Guardia cancelada' });
    });
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Servidor corriendo en http://0.0.0.0:3000');
    console.log('Accesible desde la red local en http://172.22.0.195:3000');
});
