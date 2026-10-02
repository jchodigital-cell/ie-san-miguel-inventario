# JCHO Inventario Ferretería

## Institución

Institución Educativa San Miguel

## Tecnologías

- Node.js
- Express
- SQLite con better-sqlite3
- JWT
- bcryptjs
- ExcelJS
- PDFKit
- HTML5, CSS3 y JavaScript vanilla

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
