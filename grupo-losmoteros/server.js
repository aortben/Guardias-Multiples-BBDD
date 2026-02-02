const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const os = require("os");
const path = require("path"); // <--- AÑADIDO: Necesario para las rutas de carpetas
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.use(cors());
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

// ---------------------------------------------------------
// --- PARTE AÑADIDA: SERVIR ARCHIVOS ESTÁTICOS (HTML) ---
// ---------------------------------------------------------

// 1. Decimos que la carpeta "public" tiene la web
app.use(express.static(path.join(__dirname, 'public')));

// 2. Si entran a la raíz, enviamos el index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------

// --- 1. MODELOS ---

const profesorSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true }, 
  nombre: { type: String, required: true },
  apellidos: { type: String, required: true },
}, { collection: 'profesores' });

const aulaSchema = new mongoose.Schema({
  codigo: { type: String, required: true, unique: true }, 
  nombre: { type: String, required: true }
}, { collection: 'aulas' });

const horarioSchema = new mongoose.Schema({
  profesor: { type: mongoose.Schema.Types.ObjectId, ref: 'Profesor', required: true },
  aula: { type: mongoose.Schema.Types.ObjectId, ref: 'Aula' }, 
  diaSemana: { type: String, enum: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], required: true },
  hora: { type: String, enum: ['1º', '2º', '3º', '4º', '5º', '6º'], required: true },
  tipo: { type: String, enum: ['clase', 'guardia'], default: 'clase' } 
}, { collection: 'horarios' });

const ausenciaSchema = new mongoose.Schema({
  profesor: { type: mongoose.Schema.Types.ObjectId, ref: 'Profesor', required: true },
  fecha: { type: String, required: true }, 
  hora: { type: String, required: true },
  tarea: { type: String, default: "Sin tarea especificada" },
  grupo: { type: String, default: "General" }
}, { collection: 'ausencias' });

const Profesor = mongoose.model("Profesor", profesorSchema);
const Aula = mongoose.model("Aula", aulaSchema);
const Horario = mongoose.model("Horario", horarioSchema);
const Ausencia = mongoose.model("Ausencia", ausenciaSchema);

// --- 2. CONEXIÓN Y LOGS ---

app.use((req, res, next) => {
    const start = process.hrtime();
    res.on('finish', () => {
        const diff = process.hrtime(start);
        const timeMs = (diff[0] * 1e9 + diff[1]) / 1e6;
        console.log(`📡 [${req.method}] ${req.originalUrl} - Procesado en: ${timeMs.toFixed(3)} ms`);
    });
    next();
});

mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/guardiasDB")
  .then(() => {
    console.log("🟢 Conectado a MongoDB");
    inicializarDatos();

    const db = mongoose.connection;
    const watchAusencias = db.collection('ausencias').watch();
    
    watchAusencias.on('change', (change) => {
      console.log("🔔 Cambio en DB (Real-time):", change.operationType);
      io.emit("datos-actualizados"); 
    });
  })
  .catch(err => console.error(err));

io.on("connection", (socket) => {
  console.log("👤 Cliente conectado");
});

// --- 3. SEED DE DATOS ---
async function inicializarDatos() {
  try {
    const cuenta = await Profesor.countDocuments();
    if (cuenta > 0) return;

    console.log("🧹 Insertando datos de prueba...");
    
    const listaProfes = [
      { n: "Juan", a: "Martínez" }, { n: "Ana", a: "Soria" },
      { n: "Pedro", a: "Ramírez" }, { n: "Lucía", a: "Fernández" },
      { n: "Carlos", a: "Ruiz" }, { n: "Elena", a: "Gómez" },
      { n: "Miguel", a: "Torres" }, { n: "Sofia", a: "Díaz" },
      { n: "David", a: "Vázquez" }, { n: "Maria", a: "Jiménez" },
      { n: "Raúl", a: "Castro" }, { n: "Irene", a: "Molina" }
    ];
    
    let profesDB = [];
    for(let i=0; i < listaProfes.length; i++) {
      profesDB.push(await new Profesor({
        codigo: `P${i+100}`, nombre: listaProfes[i].n, apellidos: listaProfes[i].a
      }).save());
    }

    const aulasNombres = ["1º ESO A", "1º ESO B", "2º ESO A", "3º ESO A", "4º ESO B", "Bachillerato C", "Biblioteca", "Informática 1", "Gimnasio"];
    let aulasDB = [];
    for(let i=0; i<aulasNombres.length; i++) {
        aulasDB.push(await new Aula({ codigo: `A${i}`, nombre: aulasNombres[i] }).save());
    }

    const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
    const horas = ['1º', '2º', '3º', '4º', '5º', '6º'];
    
    let c = 0;
    for (let d of dias) {
      for (let h of horas) {
        await new Horario({ profesor: profesDB[c % 12]._id, diaSemana: d, hora: h, tipo: 'guardia' }).save();
        await new Horario({ profesor: profesDB[(c + 1) % 12]._id, diaSemana: d, hora: h, tipo: 'guardia' }).save();
        await new Horario({ profesor: profesDB[(c + 2) % 12]._id, aula: aulasDB[c % 9]._id, diaSemana: d, hora: h, tipo: 'clase' }).save();
        c++;
      }
    }
    console.log("🚀 Datos iniciales cargados correctamente.");
  } catch (error) { console.error("Error seed:", error); }
}

// --- 4. RUTAS API ---

app.get("/api/panel", async (req, res) => {
  try {
    const { diaSemana, fecha } = req.query; 
    const ausencias = await Ausencia.find({ fecha }).populate('profesor');
    const guardiasProgramadas = await Horario.find({ diaSemana, tipo: 'guardia' }).populate('profesor');

    const guardiasProcesadas = guardiasProgramadas.map(guardia => {
        const estaAusente = ausencias.some(ausencia => 
            ausencia.profesor._id.toString() === guardia.profesor._id.toString() && 
            ausencia.hora === guardia.hora
        );
        return {
            ...guardia.toObject(),
            status: estaAusente ? 'ausente' : 'disponible'
        };
    });

    res.json({ ausencias, guardias: guardiasProcesadas });
  } catch (error) {
    res.status(500).json({ error: "Error de servidor" });
  }
});

app.post("/api/ausencias", async (req, res) => {
  try {
    const nuevaAusencia = new Ausencia(req.body);
    await nuevaAusencia.save();
    res.json({ msg: "Ok" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/profesores", async (req, res) => {
  const profes = await Profesor.find().sort({ apellidos: 1 });
  res.json(profes);
});

app.get("/api/reset", async (req, res) => {
    await Profesor.deleteMany({}); await Aula.deleteMany({}); await Horario.deleteMany({}); await Ausencia.deleteMany({});
    await inicializarDatos();
    res.json({ msg: "Reset completo" });
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 3000;

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 SERVIDOR LISTO`);
  console.log(`💻 Local:   http://localhost:${PORT}`);
  console.log(`📡 Red:     http://${getLocalIp()}:${PORT}`);
  console.log(`-------------------------------------------\n`);
});