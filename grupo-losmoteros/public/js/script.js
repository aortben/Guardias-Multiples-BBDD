// Detectar si estamos en localhost o IP para conectar al socket correctamente
const HOST = window.location.hostname;
const PORT = "3000";
const API_URL = `http://${HOST}:${PORT}/api`;

let fechaSeleccionada = new Date(); 
let fechaActual = new Date(); 
let profesoresCache = [];

// Elementos DOM
const domElements = {
    tituloFecha: document.getElementById('tituloFecha'),
    tablaBody: document.getElementById('tablaBody'),
    modal: document.getElementById('modalAusencia'),
    selectProfesor: document.getElementById('selectProfesor'),
    calendarGrid: document.getElementById('calendarGrid'),
    currentMonthDisplay: document.getElementById('currentMonth'),
    inputFecha: document.getElementById('inputFecha'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    // Métricas
    metricsLogContainer: document.getElementById('metricsLogContainer'),
    metricTotal: document.getElementById('metricTotal')
};

function logProcess(type, detail, timeMs) {
    const row = document.createElement('div');
    row.style.marginBottom = '4px';
    row.style.paddingBottom = '4px';
    row.style.borderBottom = '1px dashed #333';
    
    let color = '#fff';
    if (type.includes('Fetch')) color = '#4da6ff'; 
    if (type.includes('DOM')) color = '#ffb366';   
    
    row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="color:${color}; font-weight:bold;">${type}</span>
            <span style="color:#00ff9d;">${timeMs} ms</span>
        </div>
        <div style="color:#888; font-size:0.7rem;">${detail}</div>
    `;
    domElements.metricsLogContainer.appendChild(row);
    domElements.metricsLogContainer.scrollTop = domElements.metricsLogContainer.scrollHeight;
}

function clearMetricsLog() {
    domElements.metricsLogContainer.innerHTML = '';
}

const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// --- 1. SOCKET.IO & INICIO ---
const socket = io(`http://${HOST}:${PORT}`);

socket.on("connect", () => console.log("🟢 Conectado TR"));
socket.on("datos-actualizados", () => {
    mostrarToast();
    cargarDatos(fechaSeleccionada);
});

socket.on("usuarios-conectados", (count) => {
    const container = document.getElementById('usersConnectedContainer');
    if(container) {
        container.innerHTML = '';
        for(let i=0; i<count; i++) {
            container.innerHTML += '<i class="ph-fill ph-user"></i>';
        }
    }
    const textCount = document.getElementById('usersCountText');
    if(textCount) textCount.innerText = count;
});

async function actualizarTotalProfesores() {
    try {
        const res = await fetch(`${API_URL}/profesores`);
        const profes = await res.json();
        const el = document.getElementById('totalProfesores');
        if(el) el.innerText = profes.length;
        profesoresCache = profes;
    } catch(e) { console.error("Error fetching professors count", e); }
}

document.addEventListener('DOMContentLoaded', () => {
    cargarDatos(fechaSeleccionada);
    renderCalendar();
    actualizarTotalProfesores();
});

// --- 2. LÓGICA DE DATOS Y MÉTRICAS ---
async function cargarDatos(fecha) {
    const fechaStr = fecha.toISOString().split('T')[0]; 
    const diaStr = diasSemana[fecha.getDay()];
    
    // UI Updates Pre-Load
    const esHoy = fecha.toDateString() === new Date().toDateString();
    domElements.tituloFecha.innerText = esHoy ? "Hoy" : `${diaStr}, ${fecha.getDate()} ${meses[fecha.getMonth()]}`;
    actualizarBotonesFiltro(esHoy);

    // INICIO TIMER GLOBAL
    const t0_Global = performance.now();

    // Limpiar logs anteriores si es una carga principal
    clearMetricsLog();

    // 1. Mostrar Spinner (Fuerza visualización mínima)
    domElements.loadingOverlay.classList.add('visible');
    
    // Promesa para forzar retardo mínimo de 400ms (para que se vea la animación)
    const minLoadTime = new Promise(resolve => setTimeout(resolve, 400));
    
    try {
        // INICIO TIMER ASÍNCRONO (Red)
        const t0_Async = performance.now();
        const url = `${API_URL}/panel?diaSemana=${diaStr}&fecha=${fechaStr}`;
        
        // Ejecutamos Fetch y el Timer mínimo en paralelo
        const [res, _] = await Promise.all([
            fetch(url),
            minLoadTime
        ]);
        
        const data = await res.json();
        const t1_Async = performance.now(); // FIN TIMER ASÍNCRONO

        logProcess('Fetch (GET)', url.replace(API_URL, '/api'), (t1_Async - t0_Async).toFixed(2));

        // INICIO TIMER SÍNCRONO (DOM Render)
        const t0_Sync = performance.now();
        renderizarTabla(data.guardias, data.ausencias);
        const t1_Sync = performance.now(); // FIN TIMER SÍNCRONO

        logProcess('Síncrono (DOM)', 'Renderizado Tabla Guardias', (t1_Sync - t0_Sync).toFixed(2));

        // Actualizar Métricas en Pantalla
        const timeTotal = (performance.now() - t0_Global).toFixed(2);
        domElements.metricTotal.innerText = `${timeTotal} ms`;

        // Colorear métricas según rendimiento
        domElements.metricTotal.style.color = timeTotal > 1000 ? '#ff4444' : '#00ff9d';

    } catch (error) {
        console.error("Error cargando datos:", error);
        logProcess('Error', error.message, 0);
    } finally {
        // Ocultar Spinner
        domElements.loadingOverlay.classList.remove('visible');
    }
}

function renderizarTabla(guardias, ausencias) {
    domElements.tablaBody.innerHTML = "";
    const horas = ['1º', '2º', '3º', '4º', '5º', '6º'];

    horas.forEach(hora => {
        const guardiasHora = guardias.filter(g => g.hora === hora);
        const ausenciasHora = ausencias.filter(a => a.hora === hora);

        // Render Profesores de Guardia
        let htmlGuardias = "";
        
        if (guardiasHora.length > 0) {
            htmlGuardias = guardiasHora.map(g => {
                // Si status es 'ausente', significa que está cubriendo una guardia
                const claseEstado = g.status === 'ausente' ? 'ausente' : 'disponible';
                // Icono: Persona (User) para disponible, Flecha para asignado
                const icono = g.status === 'ausente' ? 'ph-arrow-right' : 'ph-user';
                
                return `
                <div class="profesor-tag ${claseEstado}">
                    <i class="ph-bold ${icono} icon-lg"></i>
                    <div class="profe-texto">
                        <span class="profe-nombre">${g.profesor.nombre}</span>
                        <span class="profe-apellidos">${g.profesor.apellidos}</span>
                    </div>
                </div>`;
            }).join('');
        } else {
            htmlGuardias = '<span style="color:var(--text-light); font-size:0.9rem; font-style:italic">Sin asignaciones</span>';
        }

        // Render Ausencias (Lado derecho de la tabla)
        let htmlAusencias = ausenciasHora.length > 0
            ? '<div class="ausencias-grid">' + ausenciasHora.map(a => `
                <div class="ausencia-card" style="position:relative;">
                    <button onclick="borrarAusencia('${a._id}')" class="btn-borrar-ausencia" title="Borrar">
                        <i class="ph-bold ph-trash"></i>
                    </button>
                    <div class="ausencia-header">
                        <span class="grupo-badge-lg">${a.grupo}</span>
                    </div>
                    <div class="ausencia-info">
                        <span class="ausencia-nombre">${a.profesor.nombre}</span>
                        <span class="ausencia-apellidos">${a.profesor.apellidos}</span>
                    </div>
                    <div class="ausencia-tarea-box" title="${a.tarea}">
                        <i class="ph-bold ph-notebook"></i>
                        <span>${a.tarea}</span>
                    </div>
                </div>
            `).join('') + '</div>'
            : '<span style="color:var(--text-light); font-size:0.9rem;">Sin incidencias</span>';

        domElements.tablaBody.innerHTML += `
            <tr>
                <td class="col-hora">${hora}</td>
                <td>${htmlGuardias}</td>
                <td>${htmlAusencias}</td>
            </tr>
        `;
    });
}

// --- 3. CALENDARIO LÓGICA ---
function renderCalendar() {
    const year = fechaActual.getFullYear();
    const month = fechaActual.getMonth();
    
    domElements.currentMonthDisplay.innerText = `${meses[month]} ${year}`;
    domElements.calendarGrid.innerHTML = '';

    const shortDays = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];
    shortDays.forEach(d => domElements.calendarGrid.innerHTML += `<div class="cal-day-name">${d}</div>`);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        domElements.calendarGrid.innerHTML += `<div class="cal-day empty"></div>`;
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const div = document.createElement('div');
        div.className = 'cal-day';
        div.innerText = i;
        
        const thisDate = new Date(year, month, i);
        if (thisDate.toDateString() === fechaSeleccionada.toDateString()) {
            div.classList.add('active');
        }

        div.onclick = () => {
            fechaSeleccionada = new Date(year, month, i);
            cargarDatos(fechaSeleccionada); 
            renderCalendar(); 
        };
        
        domElements.calendarGrid.appendChild(div);
    }
}

document.getElementById('prevMonth').onclick = () => {
    fechaActual.setMonth(fechaActual.getMonth() - 1);
    renderCalendar();
};
document.getElementById('nextMonth').onclick = () => {
    fechaActual.setMonth(fechaActual.getMonth() + 1);
    renderCalendar();
};

// --- 4. INTERACTIVIDAD ---
function seleccionarDia(modo) {
    const hoy = new Date();
    if (modo === 'hoy') fechaSeleccionada = hoy;
    if (modo === 'manana') {
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);
        fechaSeleccionada = manana;
    }
    fechaActual = new Date(fechaSeleccionada);
    renderCalendar();
    cargarDatos(fechaSeleccionada);
}

function actualizarBotonesFiltro(esHoy) {
    document.getElementById('btnHoy').classList.toggle('active', esHoy);
    document.getElementById('btnManana').classList.remove('active'); 
}

// Modal
async function abrirModal() {
    domElements.modal.style.display = 'flex';
    domElements.inputFecha.value = fechaSeleccionada.toISOString().split('T')[0];

    // 1. Asegurar que tenemos datos
    if (profesoresCache.length === 0) {
        try {
            const t0 = performance.now();
            const res = await fetch(`${API_URL}/profesores`);
            profesoresCache = await res.json();
            const t1 = performance.now();
            
            logProcess('Fetch (GET)', '/api/profesores', (t1 - t0).toFixed(2));
        } catch(e) { console.error("Error profes:", e); }
    }

    // 2. Renderizar si es necesario (si el select está vacío o solo tiene el placeholder)
    if (domElements.selectProfesor.options.length <= 1 && profesoresCache.length > 0) {
        const t0_DOM = performance.now();
        domElements.selectProfesor.innerHTML = '<option value="">Selecciona profesor...</option>';
        profesoresCache.forEach(p => {
            domElements.selectProfesor.innerHTML += `<option value="${p._id}">${p.apellidos}, ${p.nombre}</option>`;
        });
        const t1_DOM = performance.now();
        logProcess('Síncrono (DOM)', 'Render Select Profesores', (t1_DOM - t0_DOM).toFixed(2));
    }
}

function cerrarModal() {
    domElements.modal.style.display = 'none';
}

document.getElementById('formAusencia').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const nuevaAusencia = {
        profesor: domElements.selectProfesor.value,
        fecha: domElements.inputFecha.value, 
        hora: document.getElementById('selectHora').value,
        grupo: document.getElementById('inputGrupo').value,
        tarea: document.getElementById('inputTarea').value
    };

    try {
        const t0 = performance.now();
        await fetch(`${API_URL}/ausencias`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nuevaAusencia)
        });
        const t1 = performance.now();

        logProcess('Fetch (POST)', '/api/ausencias', (t1 - t0).toFixed(2));

        cerrarModal();
        e.target.reset();
        mostrarToast("Ausencia guardada");
    } catch(error) {
        alert("Error al guardar");
    }
});

function mostrarToast(msg = "Datos actualizados en tiempo real") {
    const toast = document.getElementById("toast");
    toast.querySelector('span').innerText = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

window.onclick = (e) => {
    if (e.target == domElements.modal) cerrarModal();
    if (e.target == modalConfirmacion) cerrarModalConfirmacion();
}

// --- NUEVAS FUNCIONES ---

let idAusenciaABorrar = null;
const modalConfirmacion = document.getElementById('modalConfirmacion');

function borrarAusencia(id) {
    idAusenciaABorrar = id;
    modalConfirmacion.style.display = 'flex';
}

function cerrarModalConfirmacion() {
    modalConfirmacion.style.display = 'none';
    idAusenciaABorrar = null;
}

async function confirmarBorrado() {
    if (!idAusenciaABorrar) return;
    
    const id = idAusenciaABorrar;
    cerrarModalConfirmacion(); // Cerramos modal inmediatamente para mejor UX

    try {
        const t0 = performance.now();
        await fetch(`${API_URL}/ausencias/${id}`, { method: "DELETE" });
        const t1 = performance.now();
        logProcess('Fetch (DELETE)', `/api/ausencias/${id}`, (t1 - t0).toFixed(2));
        mostrarToast("Ausencia eliminada");
    } catch (e) {
        console.error(e);
        alert("Error al borrar");
    }
}

// --- SIDEBAR TOGGLE ---
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('expanded');
    
    // Si queremos rotar el icono, podemos hacerlo por CSS (como ya está definido)
    // Opcionalmente podemos guardar el estado en localStorage si se desea
}
