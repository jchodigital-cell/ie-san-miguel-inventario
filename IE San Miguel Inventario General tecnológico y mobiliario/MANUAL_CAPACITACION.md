# MANUAL DE CAPACITACIÓN
# Sistema de Inventario General Tecnológico y Mobiliario

> Institución Educativa San Miguel Payande - San Luis  
> Versión: 2.0.0 | Octubre 2026  
> Para: Docentes, Almacenistas, Rectoría y Administración

---

## ÍNDICE

1. [Introducción](#1-introducción)
2. [Acceso al Sistema](#2-acceso-al-sistema)
3. [Usuarios y Contraseñas por Defecto](#3-usuarios-y-contraseñas-por-defecto)
4. [Dashboard (Panel Principal)](#4-dashboard-panel-principal)
5. [Módulo de Inventario](#5-módulo-de-inventario)
6. [Módulo de Movimientos](#6-módulo-de-movimientos)
7. [Módulo de Bajas y Deterioro](#7-módulo-de-bajas-y-deterioro)
8. [Reportes y Exportación](#8-reportes-y-exportación)
9. [Exportación por Sede](#9-exportación-por-sede)
10. [Gestión de Usuarios, Sedes y Dependencias](#10-gestión-de-usuarios-sedes-y-dependencias)
11. [Configuración de la Institución](#11-configuración-de-la-institución)
12. [Uso en Celular (Responsivo y PWA)](#12-uso-en-celular-responsivo-y-pwa)
13. [Preguntas Frecuentes](#13-preguntas-frecuentes)
14. [Contacto y Soporte](#14-contacto-y-soporte)

---

## 1. INTRODUCCIÓN

Bienvenido al **Sistema de Control General de Inventario Tecnológico y Mobiliario** de la Institución Educativa San Miguel Payande - San Luis.

Este sistema permite llevar un control profesional y organizado de todos los activos tecnológicos (computadoras, impresoras, proyectores, equipos de audio, etc.) y mobiliario (escritorios, sillas, pizarras, archiveros, etc.) de la institución, distribuidos por sedes y dependencias.

### Características Principales

- ✅ Funciona en computadora y celular
- ✅ Control por sedes y dependencias
- ✅ Roles de usuario con diferentes niveles de acceso
- ✅ Reportes exportables a Excel y PDF
- ✅ Registro de movimientos (entradas, salidas, traslados, préstamos)
- ✅ Módulo de bajas y deterioro
- ✅ Funciona sin internet (modo offline)
- ✅ Logos institucional y marca JCHO incluidos

---

## 2. ACCESO AL SISTEMA

### 2.1 Desde Computadora

1. Asegúrese de que XAMPP esté iniciado con MySQL activo
2. Ejecute el archivo `iniciar.bat` (doble clic)
3. Se abrirá automáticamente el navegador en: `http://localhost:3000`
4. Inicie sesión con su usuario y contraseña

### 2.2 Desde Celular

1. Conecte su celular a la misma red Wi-Fi que la computadora servidor
2. Abra el navegador del celular
3. Escriba la dirección: `http://<IP-de-la-computadora>:3000`
   - Ejemplo: `http://192.168.1.15:3000`
4. Inicie sesión normalmente

### 2.3 Instalación como Aplicación (PWA)

Desde el navegador (Chrome o Edge):
1. Acceda al sistema
2. Menú del navegador (⋮) → **Agregar a pantalla de inicio**
3. Confirme la instalación
4. El sistema quedará instalado como una aplicación nativa en su celular

---

## 3. USUARIOS Y CONTRASEÑAS POR DEFECTO

| Rol | Usuario | Contraseña | Qué puede hacer |
|-----|---------|------------|-----------------|
| **Administrador** | `admin` | `admin123` | Acceso total a todos los módulos |
| **Almacenista** | `almacenista` | `almacen123` | Inventario, movimientos, categorías, reportes |
| **Rector** | `rector` | `rector123` | Solo consulta (ver reportes e inventario) |
| **Docente Miller** | `miller` | `123456` | Solo ve su sede y dependencia (Sala Sistemas Bachiller) |
| **Docente Alba Rocío** | `alba` | `123456` | Solo ve su sede y dependencia (Sala Sistemas Bachiller) |
| **Coordinadora Sol** | `sol` | `123456` | Solo ve su sede y dependencia (Coordinación) |
| **Docente Elkin** | `elkin` | `123456` | Solo ve su sede y dependencia (Sede Porvenir) |
| **Docente Marcos** | `marcos` | `123456` | Solo ve su sede y dependencia (Sede El Salitre) |

> **Nota:** Los docentes solo pueden ver y trabajar con los artículos de su propia sede y dependencia asignada.

---

## 4. DASHBOARD (PANEL PRINCIPAL)

Al iniciar sesión, verá el dashboard con un resumen general:

### ¿Qué información muestra?

- **Total de artículos** registrados en el inventario
- **Artículos en buen estado**
- **Artículos con stock regular / bajo**
- **Artículos en mal estado o dados de baja**
- **Total de artículos tecnológicos** (computadoras, impresoras, etc.)
- **Total de mobiliario** (escritorios, sillas, etc.)
- **Movimientos recientes** (últimos ingresos y salidas)
- **Artículos por sede** (distribución de inventario)

### ¿Para qué sirve?

Le da una visión rápida del estado general del inventario sin necesidad de revisar cada artículo individualmente.

---

## 5. MÓDULO DE INVENTARIO

Este es el módulo principal donde se gestionan todos los artículos.

### 5.1 Ver el Inventario

1. Haga clic en **"Inventario"** en el menú lateral
2. Verá una tabla con todos los artículos registrados
3. Cada fila muestra: Código, Artículo, Tipo, Estado, Cantidad, Sede, Dependencia, Responsable

### 5.2 Buscar y Filtrar

Use los filtros superiores para encontrar artículos específicos:

- **Buscar:** Escriba código, nombre, marca o serial
- **Tipo:** Tecnológico o Mobiliario
- **Estado:** Bueno, Regular, Malo, Mantenimiento, Baja
- **Sede:** Seleccione una sede específica
- **Dependencia:** Seleccione una dependencia específica

Haga clic en **"Aplicar"** para aplicar los filtros o **"Limpiar"** para ver todos.

### 5.3 Registrar un Nuevo Artículo (Solo Admin y Almacenista)

1. Haga clic en **+ Nuevo artículo**
2. Complete los campos obligatorios:
   - **Código:** Identificador único del artículo (ej: PC-001)
   - **Nombre:** Nombre del artículo (ej: Computadora Dell OptiPlex)
   - **Categoría:** Seleccione la categoría correspondiente
   - **Tipo:** Tecnológico o Mobiliario
3. Complete los campos opcionales según sea necesario:
   - Marca, Modelo, Serial
   - Cantidad, Unidad de medida
   - Estado (Bueno, Regular, Malo, etc.)
   - Sede y Dependencia
   - Responsable
   - Fecha de adquisición, Costo
   - Ubicación, Observaciones
4. Haga clic en **Guardar**

### 5.4 Editar un Artículo

1. En la tabla de inventario, haga clic en **Editar** en la fila del artículo
2. Modifique los campos necesarios
3. Haga clic en **Guardar**

### 5.5 Ver Historial de un Artículo

1. Haga clic en **Historial** en la fila del artículo
2. Verá todos los movimientos y cambios de estado realizados

---

## 6. MÓDULO DE MOVIMIENTOS

Permite registrar el movimiento de artículos entre ubicaciones.

### Tipos de Movimiento

| Tipo | Descripción |
|------|-------------|
| ENTRADA | Artículo que entra al inventario (compra, donación) |
| SALIDA | Artículo que sale del inventario (entrega, consumo) |
| AJUSTE | Corrección de stock (inventario físico) |
| TRASLADO | Artículo movido de una sede/dependencia a otra |
| PRESTAMO | Artículo prestado a alguien temporalmente |
| DEVOLUCION | Artículo devuelto después de un préstamo |

### Registrar un Movimiento

1. Haga clic en **"Movimientos"** en el menú lateral
2. Complete el formulario con los datos del movimiento
3. Especifique la cantidad, sede origen, sede destino, responsable y observación
4. Haga clic en **Guardar**

> **Importante:** Para salidas, no puede registrar una cantidad mayor al stock disponible.

---

## 7. MÓDULO DE BAJAS Y DETERIORO

Permite gestionar artículos que están en mal estado o han sido dados de baja.

### 7.1 Ver Artículos en Baja

1. Haga clic en **"Bajas"** en el menú lateral
2. Verá todos los artículos con estado **MALO** o **BAJA**
3. Se muestra un resumen con el total, malos, bajas, tecnológicos y mobiliario

### 7.2 Cambiar Estado de un Artículo

Solo Administradores y Almacenistas pueden cambiar estados:

1. En la tabla de bajas, encuentre el artículo
2. Haga clic en **"Dar de Baja"** (si está en MALO) o **"Restaurar a Malo"** (si está en BAJA)
3. Confirme la acción

### 7.3 Exportar Reporte de Bajas

1. En la página de Bajas, haga clic en:
   - **📊 Exportar a Excel** - Descarga un archivo .xlsx
   - **📄 Descargar PDF** - Descarga un archivo .pdf

---

## 8. REPORTES Y EXPORTACIÓN

### 8.1 Reportes Generales

Desde la página **"Reportes"**:

- **📊 Exportar a Excel:** Descarga todo el inventario en formato Excel
- **📄 Descargar PDF:** Descarga todo el inventario en formato PDF
- **📈 Ver resumen:** Muestra un resumen estadístico en pantalla

### 8.2 Exportar por Sede (Nuevo)

Permite descargar el inventario de una sede específica:

1. En la página de Reportes, seleccione una sede en el desplegable
2. Haga clic en **📊 Excel por Sede** o **📄 PDF por Sede**
3. Se descargará un archivo con solo los artículos de esa sede

Esto es útil para entregar reportes individuales a cada responsable de sede.

---

## 9. EXPORTACIÓN POR SEDE

Esta función permite generar reportes independientes por cada sede de la institución.

### Pasos

1. Vaya a **Reportes**
2. En la sección **"Exportar por Sede"**, seleccione la sede deseada
3. Elija el formato:
   - **Excel por Sede:** Para trabajar los datos en hojas de cálculo
   - **PDF por Sede:** Para imprimir o compartir como documento
4. El archivo se descargará automáticamente con el nombre de la sede

### Sedes disponibles para exportar

- Sede Principal - Bachiller
- Sede Primaria
- Área Administrativa
- Sede Porvenir
- Sede El Salitre

---

## 10. GESTIÓN DE USUARIOS, SEDES Y DEPENDENCIAS

### Solo para Administradores

#### Usuarios

1. Haga clic en **"Usuarios"** en el menú lateral
2. Verá la lista de todos los usuarios del sistema
3. Para crear uno nuevo: haga clic en **+ Nuevo usuario**
4. Complete: usuario, contraseña, nombre completo, rol, sede y dependencia
5. Haga clic en **Guardar**

#### Sedes

1. Haga clic en **"Sedes"** en el menú lateral
2. Verá las 5 sedes configuradas
3. Puede agregar nuevas sedes o editar las existentes

#### Dependencias

1. Haga clic en **"Dependencias"** en el menú lateral
2. Verá las dependencias organizadas por sede
3. Puede agregar nuevas dependencias o editarlas

---

## 11. CONFIGURACIÓN DE LA INSTITUCIÓN

### Solo para Administradores

Desde **"Configuración"** puede modificar:

- **Nombre de la institución**
- **Subtítulo**
- **Logo institucional** (subir imagen en base64)
- **Logo de la marca JCHO**

Estos datos aparecen en todos los reportes exportados (Excel y PDF) y en el encabezado del sistema.

---

## 12. USO EN CELULAR (RESPONSIVO Y PWA)

El sistema está diseñado para funcionar perfectamente en teléfonos celulares.

### Diseño Responsivo

- El menú lateral se convierte en un menú desplegable en pantallas pequeñas
- Las tablas se adaptan al ancho de la pantalla
- Los botones son fáciles de tocar con el dedo

### Modo Offline (Sin Internet)

Si no hay conexión a internet:
- Puede seguir usando el sistema
- Los cambios se guardan localmente
- Al recuperar internet, los datos se sincronizan automáticamente
- Verá un indicador de estado en la parte superior

### Instalación como App

1. Abra el sistema en el navegador del celular
2. Menú (⋮) → **Agregar a pantalla de inicio**
3. El ícono del sistema aparecerá en su pantalla de inicio
4. Puede abrirlo como cualquier otra aplicación

---

## 13. PREGUNTAS FRECUENTES

### ¿Qué hago si olvido mi contraseña?

Contacte al administrador del sistema para que le restablezca la contraseña.

### ¿Un docente puede ver artículos de otras sedes?

No. Los docentes solo pueden ver y trabajar con los artículos de su propia sede y dependencia asignada.

### ¿Puedo eliminar un artículo?

Solo el Administrador puede eliminar artículos, y solo si no tienen movimientos registrados asociados.

### ¿Qué pasa si hago una salida con más cantidad del stock disponible?

El sistema no lo permitirá. Mostrará un error indicando que no hay suficiente stock.

### ¿Cómo sé si un artículo está en mal estado?

En la tabla de inventario, la columna **Estado** muestra el estado actual con una etiqueta de color:
- 🟢 Bueno
- 🟡 Regular
- 🔴 Malo / Baja

### ¿Puedo usar el sistema sin internet?

Sí, gracias al modo PWA y Service Worker. Los cambios se sincronizan cuando recupere la conexión.

---

## 14. CONTACTO Y SOPORTE

Para soporte técnico, consultas o reportes de errores:

**Institución Educativa San Miguel Payande - San Luis**  
Área de Sistemas / Coordinación

**Marca JCHO** - Soluciones profesionales de inventario

---

## RESUMEN RÁPIDO DE ACCIONES

| Acción | Módulo | Quién puede hacerlo |
|--------|--------|---------------------|
| Ver inventario | Inventario | Todos los roles |
| Agregar artículo | Inventario | Admin, Almacenista |
| Editar artículo | Inventario | Admin, Almacenista |
| Registrar movimiento | Movimientos | Admin, Almacenista |
| Ver bajas | Bajas | Todos los roles |
| Cambiar estado a baja | Bajas | Admin, Almacenista |
| Exportar Excel general | Reportes | Todos los roles |
| Exportar PDF general | Reportes | Todos los roles |
| Exportar por sede | Reportes | Todos los roles |
| Gestionar usuarios | Usuarios | Solo Admin |
| Gestionar sedes | Sedes | Solo Admin |
| Gestionar dependencias | Dependencias | Solo Admin |
| Configurar institución | Configuración | Solo Admin |

---

¡Gracias por usar el Sistema de Inventario General de la IE San Miguel Payande - San Luis!

**Marca JCHO** - Comprometidos con la excelencia educativa.