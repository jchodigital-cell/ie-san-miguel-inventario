# JCHO Inventario Ferretería — IE San Miguel

Sistema web de control de **herramientas** y **material de ferretería** para la Institución Educativa San Miguel.
Funciona en computador y celular, **sincroniza entre dispositivos** y **trabaja sin internet**.

- 🌐 **Web publicada (GitHub Pages + Firebase):** https://jchodigital-cell.github.io/ie-san-miguel-inventario/
- 🖥️ **Versión local (Node + SQLite):** `http://localhost:3000` — acceso directo en el Escritorio
- 📄 **Informe técnico:** `Informe_Tecnico_JCHO_IE_San_Miguel.pdf`

---

## 1. Módulos del sistema

| Módulo | Qué hace |
|---|---|
| **Inicio de sesión** | Acceso por usuario y contraseña con roles |
| **Dashboard** | Totales de materiales, alertas de stock, herramientas y movimientos |
| **Inventario** | Material de ferretería: CRUD, filtros, stock mínimo, alertas BAJO/AGOTADO |
| **Herramientas** | Herramientas existentes y futuras: código, marca, **serial**, estado, ubicación, responsable, costo e historial |
| **Entradas / Salidas** | Movimientos de materiales con actualización automática de stock |
| **Kardex** | Historial por material con saldo resultante |
| **Reportes** | **3 submódulos independientes** (ver sección 3) |
| **Usuarios** | Alta, edición y activación de usuarios (solo ADMIN) |
| **Configuración** | Nombre de la institución y logos (institución y marca JCHO) |
| **Versiones (GitHub)** | Rama, commits y estado del repositorio (solo ADMIN) |

### Módulo de Herramientas (detalle)

- Estados: `BUENA`, `REGULAR`, `MALA`, `MANTENIMIENTO`.
- Movimientos con historial: `INGRESO`, `PRESTAMO`, `DEVOLUCION`, `REVISION`, `BAJA`.
- El préstamo asigna responsable automáticamente; la revisión pasa la herramienta a `MANTENIMIENTO` y la baja la marca como `MALA`.
- Columna **Serial** visible en tabla, reportes, Excel y PDF.

---

## 2. Roles y permisos

| Rol | Usuario | Contraseña | Permisos |
|---|---|---|---|
| ADMIN | `admin` | `admin123` | Todo: usuarios, configuración, categorías, inventario, herramientas, movimientos, reportes, versiones |
| ALMACENISTA | `almacenista` | `almacen123` | Inventario, herramientas, movimientos, kardex, reportes y **editar categorías** |
| RECTOR | `rector` | `rector123` | Solo consulta: Dashboard, Inventario, Herramientas, Kardex y Reportes |

---

## 3. Reportes separados por módulo

En **Reportes** existen tres bloques independientes. Cada uno permite **seleccionar** (checkboxes) qué registros exportar:

| Submódulo | Contenido | Botones |
|---|---|---|
| **Material de Ferretería** | Materiales con stock y estado | EXPORTAR EXCEL · IMPRIMIR · DESCARGAR PDF |
| **Herramientas** | Herramientas con serial y estado | EXPORTAR EXCEL · IMPRIMIR · DESCARGAR PDF |
| **Bajas** | Materiales agotados + herramientas dadas de baja | EXPORTAR EXCEL · IMPRIMIR · DESCARGAR PDF |

- **IMPRIMIR** abre una vista aislada con **solo ese módulo** (encabezado, logo y tabla del reporte).
- **DESCARGAR PDF** genera un archivo PDF con **solo ese módulo**; el texto se ajusta a cada columna (no se sobrepone).

---

## 4. Funcionamiento sin internet (offline-first)

La versión web está diseñada para trabajar con **poco o ningún internet**:

1. **Primera visita con internet:** se instala la app (PWA) y se descargan las librerías de Excel y PDF.
2. **Sin internet:** se puede iniciar sesión, registrar materiales y herramientas, hacer movimientos, ver kardex, generar reportes y exportar a Excel/PDF. Todo se guarda en el equipo.
3. **Indicador de estado** en la barra superior:
   - `● En vivo · sincronizado con la nube`
   - `● Sin internet · N cambio(s) pendiente(s) de sincronizar`
   - `● Reconectando (intento N)`
4. **Al volver el internet:** los cambios pendientes se envían automáticamente y se confirma con el aviso
   *"Internet restablecido: cambios guardados y sincronizados"*.

> **Buena práctica:** evita que dos equipos trabajen sin conexión al mismo tiempo. La base local del PC (`data/inventory.db`) funciona 100% offline y sirve como plan B.

### El sistema no se duerme

- Wake Lock API: la pantalla no se apaga mientras el sistema está abierto.
- La sincronización sigue activa (consulta cada 5 segundos) y reconecta de forma indefinida.
- Al volver a la pestaña se sincroniza inmediatamente.
- Los módulos se cargan de forma independiente: si uno falla, el resto sigue funcionando.

---

## 5. Sincronización entre equipos

- **Versión web:** Firebase Realtime Database (`ie-san-miguel-inventario-default-rtdb`), documento `/inventario`.
- **Versión local:** Socket.io (evento `data:changed`) entre dispositivos de la misma red.

Para pasar los datos de la nube a la base local del PC:

```bash
node scripts/importar-nube.js herramientas   # solo herramientas
node scripts/importar-nube.js todo          # categorías, materiales, movimientos y herramientas
```

---

## 6. Tecnologías

- Node.js, Express, Socket.io, SQLite (better-sqlite3), JWT, bcryptjs
- ExcelJS (Excel), PDFKit (PDF local), jsPDF (PDF en la web)
- HTML5, CSS3, JavaScript vanilla — responsive y PWA
- Firebase Realtime Database, Git, GitHub y GitHub Pages

---

## 7. Estructura del proyecto

```text
backend/src/server.js     Servidor Express + Socket.io + rutas API y exportaciones
backend/src/db.js         Esquema SQLite (institución, usuarios, categorías, materiales,
                          movimientos, herramientas y tool_movements)
backend/src/auth.js       JWT, bcrypt y control de acceso por roles
backend/src/seed.js       Usuarios iniciales y logos por defecto
frontend/                 Interfaz de la versión local de escritorio
docs/                     Versión publicada en GitHub Pages (app.js, index.html, styles.css,
                          manifest, service worker e íconos)
scripts/importar-nube.js  Importa datos de Firebase a la base local
scripts/generar-informe.js Genera el informe técnico en PDF
iniciar.bat               Acceso directo de escritorio (reinicia el servidor si se cae)
```

---

## 8. Instalación y uso

### Versión web (recomendada)

1. Abre https://jchodigital-cell.github.io/ie-san-miguel-inventario/
2. Inicia sesión (con internet la primera vez).
3. Menú del navegador → **Agregar a pantalla de inicio**.

### Versión local

```bash
npm install
npm run seed
npm run dev
```

O haz doble clic en el acceso directo **JCHO Inventario Ferreteria** del Escritorio
(`iniciar.bat` reinicia el servidor automáticamente si se detiene).

---

## 9. Publicación y control de versiones

Repositorio: https://github.com/jchodigital-cell/ie-san-miguel-inventario
Ramas: `main` y `principal` — GitHub Pages publica desde `principal/docs`.

```bash
git add .
git commit -m "Descripción del cambio"
git push origin main
```

El módulo **Versiones (GitHub)** del sistema muestra la rama, los cambios pendientes y los últimos commits.

---

## 10. Respaldo

- Base local: `data/inventory.db`

```bash
copy data\inventory.db data\inventory-backup.db
```

- Nube: los datos están en Firebase y se pueden exportar a Excel desde el módulo Reportes.

---

## 11. Seguridad

- Contraseñas cifradas: `bcryptjs` (local) y `SHA-256` (web).
- Tokens JWT en la versión local.
- Reglas de Firebase que limitan el acceso al nodo `/inventario` con validación básica.
- HTTPS en la versión publicada.