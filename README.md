# JCHO Inventario Ferretería

## Institución

Institución Educativa San Miguel

## Tecnologías

- Node.js
- Express
- Socket.io (sincronización en vivo entre PC y celular)
- SQLite con better-sqlite3
- JWT
- bcryptjs
- ExcelJS
- PDFKit
- HTML5, CSS3 y JavaScript vanilla (responsive, PWA)
- Git / GitHub (control de versiones integrado)

## Instalación

1. Clona o descarga el proyecto.
2. En la raíz del proyecto ejecuta:

```bash
npm install
npm run seed
npm run dev
```

3. Abre el sistema en:

```text
http://localhost:3000
```

## Usuarios iniciales

- Usuario: `admin`
  - Contraseña: `admin123`
  - Rol: `ADMIN`

- Usuario: `almacenista`
  - Contraseña: `almacen123`
  - Rol: `ALMACENISTA`

- Usuario: `rector`
  - Contraseña: `rector123`
  - Rol: `RECTOR`
  - Permisos: solo consulta (Dashboard, Inventario, Kardex y Reportes)

## Roles y permisos

### ADMIN
- Administra usuarios
- Crea y modifica materiales y categorías
- Registra entradas, salidas y ajustes
- Consulta inventario, Kardex, movimientos y alertas
- Genera reportes, PDF y Excel
- Configura la institución y el logo

### ALMACENISTA
- Inicia sesión
- Consulta inventario y materiales
- Registra entradas y salidas
- Consulta Kardex, movimientos y alertas
- Genera reportes, PDF y Excel
- No puede administrar usuarios ni configurar la institución

## Configuración del logo

1. Inicia sesión como administrador.
2. Ingresa a Configuración.
3. Sube una imagen en formato PNG, JPG o JPEG.
4. Guarda los cambios.
5. El logo se usará en el encabezado, el login y los reportes exportados.

Se recomienda usar imágenes pequeñas para mantener el archivo ligero.

## Acceso desde el celular (misma red WiFi)

1. Ejecuta `npm run dev` en la PC.
2. Averigua la IP local de la PC (en Windows: `ipconfig`, busca "Dirección IPv4").
3. En el celular abre el navegador y entra a `http://<IP-DE-LA-PC>:3000`.
4. También puedes "Agregar a pantalla de inicio" para usarlo como app (PWA).

## Sincronización en vivo PC ↔ Celular

Cuando un usuario registra, edita o elimina datos desde cualquier dispositivo, todos los demás dispositivos conectados se actualizan automáticamente (Socket.io). En la barra superior se muestra el indicador "● En vivo · N dispositivo(s) conectado(s)".

## Control de versiones (GitHub)

El módulo **Versiones (GitHub)** del menú (rol ADMIN) muestra la rama actual, los cambios pendientes y los últimos commits. Para subir el proyecto a GitHub:

```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git branch -M main
git push -u origin main
```

Después de cada mejora:

```bash
git add .
git commit -m "Descripción del cambio"
git push
```

## Acceso directo de escritorio

Hay un acceso directo **JCHO Inventario Ferreteria** en el escritorio. Al abrirlo:

1. Ejecuta el seed si es la primera vez.
2. Inicia el servidor.
3. Abre el navegador en `http://localhost:3000`.

También puedes ejecutar manualmente el archivo `iniciar.bat` de la carpeta del proyecto.

## Respaldo de SQLite

El archivo de base de datos principal se encuentra en:

```text
data/inventory.db
```

Puedes respaldarlo con un comando como:

```bash
copy data\inventory.db data\inventory-backup.db
```

En Linux o macOS:

```bash
cp data/inventory.db data/inventory-backup.db
```

## Comandos útiles

```bash
npm install
npm run seed
npm run dev
```
