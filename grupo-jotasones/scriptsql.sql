DROP DATABASE IF EXISTS guardias;
CREATE DATABASE guardias;
USE guardias;

CREATE TABLE profesores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50),
    apellidos VARCHAR(100)
);

CREATE TABLE grupos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(20)
);

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

CREATE TABLE guardias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reporte_id INT,
    profesor_guardia_id INT,
    hora INT,
    fecha DATE,
    FOREIGN KEY (reporte_id) REFERENCES reportes(id) ON DELETE CASCADE,
    FOREIGN KEY (profesor_guardia_id) REFERENCES profesores(id)
);

-- =====================
-- PROFESORES
-- =====================
INSERT INTO profesores (nombre,apellidos) VALUES
('María','Fernández Ruiz'),
('Laura','Pérez Gómez'),
('Juan','López García'),
('Ana','Martín Díaz'),
('Carlos','Sánchez Mora'),
('Lucía','Navarro Gil'),
('Pedro','Romero Torres'),
('Elena','Vega Castillo');

-- =====================
-- GRUPOS
-- =====================
INSERT INTO grupos (nombre) VALUES
('1ºA'),('1ºB'),('2ºA'),('2ºB'),
('3ºA'),('3ºB'),('4ºA'),('4ºB');

-- =====================
-- REPORTES FEBRERO 2026
-- =====================
INSERT INTO reportes (profesor_id, grupo_id, hora_inicio, hora_fin, tarea, fecha) VALUES
(1,1,1,2,'Trabajo en Moodle','2026-02-01'),
(2,2,2,3,'Ejercicios tema 4','2026-02-02'),
(3,3,3,4,'Lectura comprensiva','2026-02-03'),
(4,4,1,1,'Repaso examen','2026-02-04'),
(5,5,2,3,'Actividad práctica','2026-02-05'),
(6,6,4,5,'Trabajo en grupo','2026-02-06'),
(7,7,1,2,'Ejercicios página 32','2026-02-07'),
(8,8,3,4,'Resumen del tema','2026-02-08'),
(1,2,2,3,'Actividad Moodle','2026-02-09'),
(2,3,3,4,'Problemas unidad 5','2026-02-10'),
(3,4,1,2,'Lectura y preguntas','2026-02-11'),
(4,5,2,3,'Ejercicios cuaderno','2026-02-12'),
(5,6,4,5,'Trabajo cooperativo','2026-02-13'),
(6,7,1,2,'Ficha de repaso','2026-02-14'),
(7,8,3,4,'Actividad práctica','2026-02-15'),
(8,1,2,3,'Resumen tema','2026-02-16'),
(1,3,1,2,'Ejercicios Moodle','2026-02-17'),
(2,4,3,4,'Problemas página 56','2026-02-18'),
(3,5,2,3,'Lectura guiada','2026-02-19'),
(4,6,4,5,'Actividad escrita','2026-02-20'),
(5,7,1,2,'Repaso general','2026-02-21'),
(6,8,3,4,'Trabajo individual','2026-02-22'),
(7,1,2,3,'Ejercicios tema 6','2026-02-23'),
(8,2,1,2,'Resumen unidad','2026-02-24'),
(1,4,3,4,'Actividad práctica','2026-02-25'),
(2,5,2,3,'Ficha ejercicios','2026-02-26'),
(3,6,4,5,'Trabajo en grupo','2026-02-27'),
(4,7,1,2,'Repaso final','2026-02-28');

-- =====================
-- GUARDIAS FEBRERO 2026
-- =====================
INSERT INTO guardias (reporte_id, profesor_guardia_id, hora, fecha) VALUES
(1,2,2,'2026-02-01'),
(2,3,3,'2026-02-02'),
(3,4,4,'2026-02-03'),
(4,5,1,'2026-02-04'),
(5,6,3,'2026-02-05'),
(6,7,5,'2026-02-06'),
(7,8,2,'2026-02-07'),
(8,1,4,'2026-02-08'),
(9,3,3,'2026-02-09'),
(10,4,4,'2026-02-10'),
(11,5,2,'2026-02-11'),
(12,6,3,'2026-02-12'),
(13,7,5,'2026-02-13'),
(14,8,2,'2026-02-14'),
(15,1,4,'2026-02-15'),
(16,2,3,'2026-02-16'),
(17,4,2,'2026-02-17'),
(18,5,4,'2026-02-18'),
(19,6,3,'2026-02-19'),
(20,7,5,'2026-02-20'),
(21,8,2,'2026-02-21'),
(22,1,4,'2026-02-22'),
(23,2,3,'2026-02-23'),
(24,3,2,'2026-02-24'),
(25,5,4,'2026-02-25'),
(26,6,3,'2026-02-26'),
(27,7,5,'2026-02-27'),
(28,8,2,'2026-02-28');
