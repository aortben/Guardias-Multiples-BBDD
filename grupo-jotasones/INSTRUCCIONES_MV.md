# Instrucciones de Despliegue en Máquina Virtual (Lubuntu)

Dado que la aplicación debe correr **desde dentro** de la máquina virtual (IP 172.22.0.205) para poder comunicarse con las bases de datos y la API de "Los Moteros", aquí tienes los pasos a seguir una vez estés en Lubuntu.

## 1. Transferir el proyecto a la MV
Sube la carpeta `grupo-jotasones` (sin la carpeta `node_modules` para que vaya más rápido) a tu Máquina Virtual. Puedes usar FileZilla, WinSCP, o Git si lo tienes subido a GitHub.

## 2. Instalar Dependencias
Una vez tengas la carpeta en la MV, abre la terminal, navega a la carpeta del proyecto e instala las dependencias:
```bash
cd /ruta/a/tu/grupo-jotasones
npm install
```

## 3. Preparar la Base de Datos (MySQL)
El código ahora lee las credenciales del archivo `.env`. Usamos `admin` y `1234`. Vamos a crearlo en el MySQL de la MV e importar tus tablas.

Abre la terminal y entra a MySQL como root:
```bash
sudo mysql -u root
```
Dentro de MySQL, pega esto (asegúrate de cambiar `/ruta/a/...` por la ruta real donde hayas subido `scriptsql.sql`):
```sql
-- 1. Crear usuario admin con contraseña 1234
CREATE USER IF NOT EXISTS 'admin'@'localhost' IDENTIFIED BY '1234';

-- 2. Crear la base de datos e importar la estructura
SOURCE /ruta/a/tu/grupo-jotasones/scriptsql.sql;

-- 3. Darle permisos al usuario admin sobre la base de datos guardias
GRANT ALL PRIVILEGES ON guardias.* TO 'admin'@'localhost';
FLUSH PRIVILEGES;

EXIT;
```

## 4. Ejecución Permanente con PM2
Para que el servidor se quede encendido en segundo plano y puedas cerrar la terminal sin que se caiga la API, usamos **PM2**:

```bash
# 1. Instalar PM2 globalmente en la MV
sudo npm install -g pm2

# 2. Asegúrate de estar en la carpeta del proyecto
cd /ruta/a/tu/grupo-jotasones

# 3. Arrancar el servidor
pm2 start server.js --name "api-jotasones"

# (Opcional) Hacer que el servidor arranque solo cuando se encienda la MV
pm2 startup
pm2 save
```

¡Listo! Tu API Jotasones estará corriendo en el puerto 3000 de la Máquina Virtual, leyendo "Los Moteros" en el puerto 3001, y ambas a través de `localhost` internamente. Desde tu casa, solo tendrías que acceder a `http://172.22.0.205:3000/`.
