# DOCUMENTACIÓN TÉCNICA
# IE San Miguel - Inventario General Tecnológico y Mobiliario

> Institución Educativa San Miguel Payande - San Luis  
> Versión: 2.0.0 | Fecha: Octubre 2026  
> Desarrollado con arquitectura profesional de talla internacional

---

## 1. RESUMEN EJECUTIVO

El **Sistema de Control General de Inventario Tecnológico y Mobiliario** es una aplicación web profesional diseñada para gestionar el inventario de activos tecnológicos y mobiliario de la Institución Educativa San Miguel Payande - San Luis. Permite el control completo de activos por sedes y dependencias, con roles de usuario, sincronización en tiempo real, reportes exportables a Excel y PDF, y funcionamiento offline (modo PWA).

---

## 2. ESTRUCTURA DE LA INSTITUCIÓN IMPLEMENTADA

### 2.1 Sedes (5)

| ID | Sede | Tipo | Responsable | Descripción |
|----|------|------|-------------|-------------|
| 1 | Sede Principal - Bachiller | principal | — | Sede principal del nivel bachillerato |
| 2 | Sede Primaria | primaria | — | Sede del nivel primaria |
| 3 | Área Administrativa | administrativa | — | Área administrativa central |
| 4 | Sede Porvenir | porvenir | Docente Elkin | Sede Porvenir a cargo del docente Elkin |
| 5 | Sede El Salitre | el_salitre | Docente Marcos | Sede El Salitre a cargo del docente Marcos |

### 2.2 Dependencias (9)

| Sede | Dependencia | Tipo | Responsable |
|------|-------------|------|-------------|
| Sede Principal - Bachiller | Sala de Sistemas | sala_sistemas | Docente Miller |
| Sede Principal - Bachiller | Sala de Sistemas | sala_sistemas | Docente Alba Rocío |
| Sede Principal - Bachiller | Sala Audiovisuales | sala_audiovisuales | Docente que la solicite |
| Sede Principal - Bachiller | Coordinación | coordinacion | Coordinadora Sol |
| Sede Principal - Bachiller | Sala Múltiple | sala_multiple | Docente que la solicite |
| Sede Primaria | Sala de Sistemas | sala_sistemas | Docente que la solicite |
| Área Administrativa | Área Administrativa | area_administrativa | — |
| Sede Porvenir | Sala de Sistemas | sala_sistemas | Docente Elkin |
| Sede El Salitre | Sala de Sistemas | sala_sistemas | Docente Marcos |

### 2.3 Categorías (10)

| Categoría | Tipo | Descripción |
|-----------|------|-------------|
| Computadoras | tecnológico | Equipos de cómputo y laptops |
| Impresoras | tecnológico | Impresoras y escáneres |
| Proyectores | tecnológico | Proyectores y pantallas |
| Equipos de Audio | tecnológico | Sonido y micrófonos |
| Muebles | mobiliario | Escritorios, sillas y archiveros |
| Pizarras | mobiliario | Pizarras blancas y tradicionales |
| Aire Acondicionado | tecnológico | Equipos de climatización |
| Cámaras | tecnológico | Cámaras de seguridad y video |
| Redes | tecnológico | Switches, routers y cableado |
| Otros Mobiliario | mobiliario | Muebles diversos y enseres |

---

## 3. ARQUITECTURA DEL SISTEMA

### 3.1 Diagrama de Capas

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENTE (Frontend)                       │
│              HTML5 + CSS3 + JavaScript Vanilla              │
│                    Diseño Responsivo (PWA)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket (Socket.io)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   SERVIDOR (Backend)                        │
│              Node.js + Express + Socket.io                  │
│              Autenticación JWT + bcryptjs                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ mysql2 (Pool de conexiones)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  BASE DE DATOS (MySQL / XAMPP)              │
│           ie_san_miguel_inventario (utf8mb4)                │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Tecnologías Utilizadas

| Componente | Tecnología | Versión | Propósito |
|------------|-----------|---------|-----------|
| Servidor | Node.js | v24.x | Runtime del backend |
| Framework Web | Express | 4.x | API REST y servidor web |
| Tiempo Real | Socket.io | 4.x | Sincronización entre dispositivos |
| Base de Datos | MySQL / MariaDB | XAMPP | Almacenamiento de datos persistentes |
| Driver BD | mysql2 | 3.x | Conexión a MySQL |
| Autenticación | JWT + bcryptjs | 9.x / 2.x | Tokens de sesión y hash de contraseñas |
| Exportación Excel | ExcelJS | 4.x | Generación de archivos .xlsx |
| Exportación PDF | PDFKit | 0.15.x | Generación de archivos .pdf |
| Frontend | HTML5/CSS3/JS Vanilla | — | Interfaz de usuario responsiva |
| PWA | Service Worker + Manifest | — | Funcionamiento offline e instalación |

---

## 4. ESQUEMA DE BASE DE DATOS (MySQL)

### 4.1 Tablas Principales

| Tabla | Descripción |
|-------|-------------|
| `institution` | Datos de la institución (nombre, logos, subtítulo) |
| `roles` | Roles del sistema (ADMIN, ALMACENISTA, RECTOR, DOCENTE) |
| `sedes` | Sedes institucionales (5 sedes configuradas) |
| `dependencias` | Dependencias asignadas a cada sede (9 dependencias) |
| `users` | Usuarios del sistema con autenticación |
| `categorias` | Categorías de artículos (tecnológico / mobiliario) |
| `inventario` | Catálogo de artículos tecnológicos y mobiliario |
| `movimientos` | Historial de entradas, salidas, ajustes, traslados |
| `item_movements` | Historial de cambios de estado y préstamos |

### 4.2 Estados de Artículos

| Estado | Significado | Uso |
|--------|-------------|-----|
| BUENO | En buen estado operativo | Artículo disponible para uso |
| REGULAR | Stock bajo o uso regular | Alerta de reposición |
| MALO | En mal estado / deteriorado | Requiere reparación o revisión |
| BAJA | Dado de baja del inventario | Ya no forma parte del inventario activo |
| MANTENIMIENTO | En proceso de mantenimiento | Temporalmente no disponible |

---

## 5. MÓDULOS Y FUNCIONALIDADES

### 5.1 Inicio de Sesión y Autenticación

- Autenticación mediante usuario y contraseña
- Tokens JWT con expiración de 8 horas
- Contraseñas cifradas con bcrypt (costo 10)
- Control de acceso por roles (RBAC)
- Sesión persistente en localStorage

### 5.2 Dashboard (Panel Principal)

- Resumen general de artículos por estado
- Total de artículos tecnológicos y mobiliario
- Alertas de stock bajo o agotado
- Movimientos recientes
- Distribución de artículos por sede

### 5.3 Inventario General

- CRUD completo de artículos (crear, leer, actualizar, eliminar)
- Campos: código, nombre, descripción, categoría, tipo, marca, modelo, serial, cantidad, unidad, estado, sede, dependencia, responsable, fecha adquisición, costo, stock mínimo, ubicación, observaciones
- Filtros por búsqueda, categoría, tipo, estado, sede y dependencia
- Acceso restringido: DOCENTE solo ve su sede y dependencia asignada

### 5.4 Movimientos

- Tipos: ENTRADA, SALIDA, AJUSTE, TRASLADO, PRESTAMO, DEVOLUCION
- Registro con actualización automática de stock
- Historial completo con usuario, fecha y observaciones
- Control de stock suficiente para salidas

### 5.5 Categorías, Sedes y Dependencias

- Gestión completa de categorías (solo ADMIN y ALMACENISTA)
- Gestión de sedes (solo ADMIN)
- Gestión de dependencias por sede (solo ADMIN)

### 5.6 Usuarios (solo ADMIN)

- Crear, editar y eliminar usuarios
- Asignar rol, sede y dependencia a cada usuario
- Contraseñas seguras con hash bcrypt
- Control de no eliminar el último administrador

### 5.7 Módulo de Bajas y Deterioro

- Listado de artículos en estado MALO o BAJA
- Estadísticas por estado (total, malos, bajas, tecnológico, mobiliario)
- Cambio de estado entre MALO y BAJA
- Exportación a Excel y PDF de reportes de bajas

### 5.8 Reportes

- Resumen general del inventario
- Exportación completa a Excel y PDF
- Exportación por sede específica a Excel y PDF
- Exportación de bajas a Excel y PDF
- Filtros por tipo, estado y sede

### 5.9 Configuración (solo ADMIN)

- Nombre de la institución
- Subtítulo
- Logo institucional (base64)
- Logo marca JCHO (base64)

### 5.10 Perfil de Usuario

- Visualización de información del usuario autenticado
- Sede y dependencia asignada
- Rol y estado de cuenta

---

## 6. ROLES Y PERMISOS

| Rol | Usuario | Contraseña | Permisos |
|-----|---------|------------|----------|
| ADMIN | `admin` | `admin123` | Acceso total: todos los módulos, usuarios, configuración |
| ALMACENISTA | `almacenista` | `almacen123` | Inventario, movimientos, categorías, reportes, bajas |
| RECTOR | `rector` | `rector123` | Solo consulta: dashboard, inventario, reportes |
| DOCENTE | `miller` | `123456` | Solo su sede/dependencia asignada |
| DOCENTE | `alba` | `123456` | Solo su sede/dependencia asignada |
| DOCENTE | `sol` | `123456` | Solo su sede/dependencia asignada |
| DOCENTE | `elkin` | `123456` | Solo su sede/dependencia asignada |
| DOCENTE | `marcos` | `123456` | Solo su sede/dependencia asignada |

---

## 7. API REST - ENDPOINTS

### Autenticación
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| POST | `/api/auth/login` | Iniciar sesión | Público |
| GET | `/api/auth/verify` | Verificar token | Autenticado |

### Institución
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/institution` | Obtener datos de institución | Autenticado |
| PUT | `/api/institution` | Actualizar institución y logos | ADMIN |

### Sedes
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/sedes` | Listar sedes | Autenticado |
| POST | `/api/sedes` | Crear sede | ADMIN |
| PUT | `/api/sedes/:id` | Actualizar sede | ADMIN |

### Dependencias
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/dependencias` | Listar dependencias | Autenticado |
| POST | `/api/dependencias` | Crear dependencia | ADMIN |
| PUT | `/api/dependencias/:id` | Actualizar dependencia | ADMIN |
| DELETE | `/api/dependencias/:id` | Eliminar dependencia | ADMIN |

### Categorías
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/categorias` | Listar categorías | Autenticado |
| POST | `/api/categorias` | Crear categoría | ADMIN, ALMACENISTA |
| PUT | `/api/categorias/:id` | Actualizar categoría | ADMIN, ALMACENISTA |
| DELETE | `/api/categorias/:id` | Eliminar categoría | ADMIN |

### Inventario
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/inventario` | Listar artículos (con filtros) | Autenticado |
| POST | `/api/inventario` | Crear artículo | ADMIN, ALMACENISTA |
| PUT | `/api/inventario/:id` | Actualizar artículo | ADMIN, ALMACENISTA |
| DELETE | `/api/inventario/:id` | Eliminar artículo | ADMIN |
| GET | `/api/inventario/:id/movements` | Historial de un artículo | Autenticado |

### Movimientos
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/movimientos` | Listar movimientos | Autenticado |
| POST | `/api/movimientos` | Registrar movimiento | ADMIN, ALMACENISTA |

### Reportes
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/reports/summary` | Resumen general | Autenticado |
| GET | `/api/reports/bajas` | Artículos en baja/malo | Autenticado |
| GET | `/api/reports/export/excel` | Exportar Excel general | Autenticado |
| GET | `/api/reports/export/pdf` | Exportar PDF general | Autenticado |
| GET | `/api/reports/export/excel-bajas` | Exportar Excel de bajas | Autenticado |
| GET | `/api/reports/export/pdf-bajas` | Exportar PDF de bajas | Autenticado |
| GET | `/api/reports/export/excel-by-sede?sede_id=X` | Exportar Excel por sede | Autenticado |
| GET | `/api/reports/export/pdf-by-sede?sede_id=X` | Exportar PDF por sede | Autenticado |

### Usuarios (solo ADMIN)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/users` | Listar usuarios |
| POST | `/api/users` | Crear usuario |
| PUT | `/api/users/:id` | Actualizar usuario |
| DELETE | `/api/users/:id` | Eliminar usuario |

### Sistema
| Método | Endpoint | Descripción | Acceso |
|--------|----------|-------------|--------|
| GET | `/api/health` | Estado del servidor y BD | Público |
| GET | `/api/versions` | Rama y último commit Git | ADMIN |

---

## 8. SEGURIDAD

- ✅ Contraseñas cifradas con bcryptjs (factor de costo 10)
- ✅ Tokens JWT con expiración de 8 horas
- ✅ Middleware de autenticación en todas las rutas protegidas
- ✅ Control de acceso basado en roles (RBAC)
- ✅ DOCENTE solo accede a su sede y dependencia asignada
- ✅ Validación de datos de entrada en todos los endpoints
- ✅ CORS habilitado para acceso desde múltiples dispositivos
- ✅ Transacciones de base de datos para movimientos atómicos

---

## 9. FUNCIONAMIENTO OFFLINE (PWA)

- Service Worker para caché de recursos estáticos
- Manifest para instalación como aplicación nativa
- Funcionamiento sin conexión a internet
- Sincronización automática al recuperar conectividad
- Indicador de estado de conexión en tiempo real

---

## 10. SINCRONIZACIÓN EN TIEMPO REAL

- Socket.io para comunicación bidireccional servidor-cliente
- Notificación automática de cambios de datos entre dispositivos
- Indicador de estado: En línea / Sin conexión / Sincronizando
- Sincronización cada 5 segundos y al cambiar de pestaña

---

## 11. INSTALACIÓN Y CONFIGURACIÓN

### Requisitos Previos

1. **Node.js** (https://nodejs.org) - Versión 18 o superior
2. **XAMPP** con MySQL activo (https://www.apachefriends.org)

### Pasos de Instalación

```cmd
1. Descomprimir o clonar el proyecto en una carpeta
2. Abrir terminal en la carpeta del proyecto
3. Ejecutar: npm install
4. Iniciar XAMPP y asegurar que MySQL esté activo
5. Ejecutar: node backend/src/init-db.js   (crea la base de datos)
6. Ejecutar: node backend/src/seed.js      (datos iniciales)
7. Ejecutar: node backend/src/server.js    (inicia el servidor)
8. Abrir navegador: http://localhost:3000
```

### Uso en Celular

1. Conectar el celular a la misma red Wi-Fi que el PC
2. Acceder a: `http://<IP-del-PC>:3000`
3. O instalar como PWA: menú del navegador → "Agregar a pantalla de inicio"

### Script de Inicio (Windows)

Doble clic en `iniciar.bat` para iniciar todo automáticamente.

---

## 12. ARCHIVOS DEL PROYECTO

```
IE San Miguel Inventario General tecnológico y mobiliario/
├── DOCUMENTACION_TECNICA.md       # Este archivo
├── MANUAL_CAPACITACION.md         # Manual de usuario
├── README.md                      # Resumen rápido
├── package.json                   # Dependencias de Node.js
├── .env                           # Configuración de entorno
├── iniciar.bat                    # Script de inicio Windows
├── Logo IE San Miguel.png         # Logo institucional
├── Logo Marca Jcho.jpeg           # Marca JCHO
├── backend/
│   └── src/
│       ├── server.js              # Servidor Express + rutas API
│       ├── db.js                  # Conexión MySQL y consultas
│       ├── auth.js                # Autenticación JWT y roles
│       ├── init-db.js             # Inicialización de base de datos
│       ├── seed.js                # Datos iniciales (usuarios, sedes)
│       └── schema.sql             # Esquema SQL completo
├── frontend/
│   ├── index.html                 # Punto de entrada
│   ├── app.js                     # Lógica principal de la aplicación
│   ├── styles.css                 # Estilos responsivos
│   ├── manifest.webmanifest       # PWA manifest
│   ├── sw.js                      # Service Worker (offline)
│   └── icon.svg                   # Ícono de la aplicación
└── data/                          # Carpeta para respaldos y logs
```

---

## 13. PRUEBAS REALIZADAS

Todas las siguientes funcionalidades fueron verificadas y funcionan correctamente:

| # | Prueba | Resultado |
|---|--------|-----------|
| 1 | Login con todos los roles (admin, rector, almacenista, docentes) | ✅ |
| 2 | Listado de 5 sedes y 9 dependencias | ✅ |
| 3 | Listado de 10 categorías | ✅ |
| 4 | Crear artículo en inventario | ✅ |
| 5 | Listar inventario con filtros | ✅ |
| 6 | Registrar movimiento de salida con actualización de stock | ✅ |
| 7 | Dashboard con resumen general | ✅ |
| 8 | Acceso restringido de docentes a su sede/dependencia | ✅ |
| 9 | Rector y almacenista con acceso a consulta | ✅ |
| 10 | Docente sin acceso a módulo de usuarios (403) | ✅ |
| 11 | Exportación a Excel general | ✅ |
| 12 | Exportación a PDF general | ✅ |
| 13 | Módulo de bajas (consultar artículos MALO/BAJA) | ✅ |
| 14 | Cambio de estado entre MALO y BAJA | ✅ |
| 15 | Exportación de bajas a Excel y PDF | ✅ |
| 16 | Exportación de inventario por sede a Excel y PDF | ✅ |

---

## 14. SOPORTE Y MANTENIMIENTO

Para soporte técnico o consultas sobre el sistema, contactar con el área de sistemas de la Institución Educativa San Miguel Payande - San Luis.

**Marca JCHO** - Soluciones profesionales de inventario.

---