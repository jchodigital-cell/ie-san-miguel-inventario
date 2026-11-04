# 🏫 IE San Miguel - Inventario General Tecnológico y Mobiliario

Sistema profesional de control general de inventario tecnológico y mobiliario para la **Institución Educativa San Miguel Payande - San Luis**.

Compatible con **PC y celular**, funciona **con o sin internet** (offline-first), sincronización en tiempo real entre dispositivos, base de datos **MySQL de XAMPP**, roles, sedes y dependencias.

---

## 📋 Estructura de la institución implementada

### Sedes
| Sede | Tipo | Responsable |
|------|------|-------------|
| Sede Principal - Bachiller | principal | — |
| Sala de Sistemas (Miller) | dependencia | Docente Miller |
| Sala de Sistemas (Alba Rocío) | dependencia | Docente Alba Rocío |
| Sala Audiovisuales | dependencia | Docente que la solicite |
| Coordinación | dependencia | Coordinadora Sol |
| Sala Múltiple | dependencia | Docente que la solicite |
| Sede Primaria | primaria | — |
| Sala de Sistemas Primaria | dependencia | Docente que la solicite |
| Área Administrativa | administrativa | — |
| Sede Porvenir | porvenir | Docente Elkin |
| Sala de Sistemas Porvenir | dependencia | Docente Elkin |
| Sede El Salitre | el_salitre | Docente Marcos |
| Sala de Sistemas El Salitre | dependencia | Docente Marcos |

### Roles del sistema
| Rol | Usuario por defecto | Contraseña | Permisos |
|-----|---------------------|------------|----------|
| ADMIN | `admin` | `admin123` | Acceso total: usuarios, sedes, dependencias, categorías, inventario, movimientos, reportes, configuración |
| ALMACENISTA | `almacenista` | `almacen123` | Inventario, movimientos, categorías, reportes |
| RECTOR | `rector` | `rector123` | Solo consulta: dashboard, inventario, reportes |
| DOCENTE | `miller`, `alba`, `sol`, `elkin`, `marcos` | `123456` | Acceso solo a su sede y dependencia asignada |

> Los docentes tienen contraseña `123456` por defecto y solo ven su sede/dependencia.

---

## 🚀 Instalación y uso (Windows + XAMPP)

### Requisitos previos
1. **Node.js** instalado (https://nodejs.org)
2. **XAMPP** con MySQL iniciado (https://www.apachefriends.org)

### Pasos
1. Descargar o clonar este repositorio en una carpeta.
2. Abrir una terminal en la carpeta del proyecto.
3. Ejecutar el archivo `iniciar.bat` (doble clic) o desde terminal:
   ```cmd
   npm install
   node backend/src/init-db.js    # Crear base de datos MySQL
   node backend/src/seed.js       # Datos iniciales
   node backend/src/server.js     # Iniciar servidor
   ```
4. Abrir el navegador en: `http://localhost:3000`
5. Iniciar sesión con `admin` / `admin123`

### Uso en celular
- Conectar el celular a la misma red Wi-Fi que el PC.
- Accedir a `http://<IP-del-PC>:3000`
- O instalar como PWA: menú del navegador → "Agregar a pantalla de inicio".

---

## 📁 Estructura del proyecto

```
IE San Miguel Inventario General tecnológico y mobiliario/
├── README.md
├── package.json
├── .env                          # Configuración de MySQL
├── iniciar.bat                   # Script de inicio (Windows)
├── Logo IE San Miguel.png        # Logo institucional
├── Logo Marca Jcho.jpeg          # Marca JCHO
├── backend/
│   └── src/
│       ├── server.js             # Servidor Express + Socket.io + rutas API
│       ├── db.js                 # Conexión y pool MySQL
│       ├── auth.js               # JWT, bcrypt, middleware de autenticación
│       ├── init-db.js            # Inicialización de base de datos MySQL
│       ├── seed.js               # Datos iniciales (usuarios, sedes, dependencias)
│       └── schema.sql            # Esquema SQL completo (MySQL)
├── frontend/
│   ├── index.html                # Punto de entrada
│   ├── app.js                    # Lógica principal de la aplicación
│   ├── styles.css                # Estilos responsivos (PC + celular)
│   ├── manifest.webmanifest      # PWA manifest
│   ├── sw.js                     # Service Worker (offline)
│   ├── icon.svg                  # Ícono de la app
│   └── socket.io/socket.io.js    # (servido por el servidor)
└── data/                         # Respaldos y logs
```

---

## 🛠️ Módulos incluidos

| Módulo | Descripción |
|--------|-------------|
| **Inicio de sesión** | Autenticación con JWT, roles y control de acceso por sede/dependencia |
| **Dashboard** | Resumen general, alertas de stock, movimientos recientes, artículos por sede |
| **Inventario** | CRUD completo de artículos tecnológicos y mobiliario con código, serial, marca, modelo, estado, sede, dependencia, responsable |
| **Movimientos** | Entradas, salidas, ajustes, traslados, préstamos y devoluciones con historial |
| **Categorías** | Gestión de categorías (tecnológico / mobiliario / ambos) |
| **Sedes** | Gestión de sedes institucionales |
| **Dependencias** | Gestión de dependencias asignadas a cada sede |
| **Usuarios** | Alta, edición y eliminación de usuarios (solo ADMIN) |
| **Reportes** | Exportación a Excel y PDF, resumen general |
| **Configuración** | Nombre de institución, logos institucional y marca JCHO |
| **Perfil** | Información del usuario autenticado |

---

## 📱 Características técnicas

- **Frontend:** HTML5, CSS3, JavaScript vanilla (sin frameworks), responsive design
- **Backend:** Node.js, Express, Socket.io (tiempo real)
- **Base de datos:** MySQL (XAMPP) mediante mysql2
- **Autenticación:** JWT + bcryptjs
- **Exportación:** Excel (ExcelJS) y PDF (PDFKit)
- **PWA:** Service Worker, manifest, funcionalidad offline
- **Sincronización:** Eventos Socket.io entre dispositivos en la misma red
- **Seguridad:** Contraseñas hash, tokens JWT con expiración, control de acceso por roles

---

## 🔐 Seguridad

- Contraseñas cifradas con bcryptjs
- Tokens JWT con expiración de 8 horas
- Middleware de autenticación en todas las rutas protegidas
- Control de acceso basado en roles (RBAC)
- DOCENTE solo accede a su sede y dependencia asignada

---

## 📄 Licencia

Sistema desarrollado para la Institución Educativa San Miguel Payande - San Luis.

**Marca JCHO** - Soluciones profesionales de inventario.

---

## 🧪 Pruebas realizadas

Antes de la entrega, se verificó:
- [x] Conexión a MySQL (XAMPP)
- [x] Inicio de sesión con todos los roles
- [x] CRUD de inventario (crear, editar, eliminar artículos)
- [x] Registro de movimientos (entradas, salidas, traslados)
- [x] Acceso restringido por sede/dependencia (docentes)
- [x] Exportación a Excel y PDF
- [x] Diseño responsivo en PC y celular
- [x] Funcionamiento offline (PWA + Service Worker)
- [x] Sincronización en tiempo real (Socket.io)
- [x] Logos institucional y marca JCHO visibles

---

## 📞 Soporte

Para soporte técnico, contactar con el administrador del sistema o el área de sistemas de la IE San Miguel Payande - San Luis.
