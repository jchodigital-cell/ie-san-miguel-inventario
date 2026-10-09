const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logoIE = path.join(root, 'Logo IE San Miguel.png');
const logoJcho = path.join(root, 'Logo Marca Jcho.jpeg');
const outputPath = path.join(root, 'Informe_Tecnico_JCHO_IE_San_Miguel.pdf');

const doc = new PDFDocument({ margin: 50, size: 'A4' });
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

const PRIMARY = '#083764';
const GRAY = '#444444';

function title(text) {
  doc.moveDown(0.8);
  doc.fontSize(14).fillColor(PRIMARY).text(text, { underline: false });
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor('#cccccc').stroke();
  doc.moveDown(0.6);
  doc.fillColor('#000000');
}

function para(text) {
  doc.fontSize(10).fillColor(GRAY).text(text, { align: 'justify', lineGap: 3 });
  doc.moveDown(0.4);
}

function bullet(text) {
  doc.fontSize(10).fillColor(GRAY).text('• ' + text, { lineGap: 2, indent: 10 });
}

function tableRow(cols, options = {}) {
  const y = doc.y;
  let x = 50;
  const widths = options.widths || [150, 200, 190];
  doc.fontSize(9).fillColor(options.header ? PRIMARY : GRAY);
  cols.forEach((text, i) => {
    doc.text(text, x, y, { width: widths[i], ellipsis: true });
    x += widths[i];
  });
  doc.moveDown(0.7);
}

// ===== PORTADA =====
doc.image(logoIE, 50, 50, { width: 80 });
doc.image(logoJcho, 470, 50, { width: 80 });
doc.moveDown(6);
doc.fontSize(22).fillColor(PRIMARY).text('INFORME TÉCNICO', { align: 'center' });
doc.fontSize(16).text('Sistema de Control de Herramientas y Material de Ferretería', { align: 'center' });
doc.moveDown(1);
doc.fontSize(12).fillColor(GRAY).text('Institución Educativa San Miguel', { align: 'center' });
doc.text('Fecha: ' + new Date().toLocaleDateString('es-CO'), { align: 'center' });
doc.moveDown(2);
doc.fontSize(10).fillColor(PRIMARY).text('Desarrollado y verificado por:', { align: 'center' });
doc.fontSize(14).fillColor(PRIMARY).text('JCHO - Digital Solutions', { align: 'center' });
doc.moveDown(1);
doc.image(logoJcho, (doc.page.width - 80) / 2, doc.y, { width: 80 });
doc.moveDown(5);
doc.fontSize(9).fillColor(GRAY).text('Firma digital: ____________________________', { align: 'center' });
doc.moveDown(0.3);
doc.text('JCHO - Juan Carlos Hernández', { align: 'center' });

doc.addPage();

// ===== 1. RESUMEN =====
title('1. RESUMEN GENERAL');
para('El proyecto "Herramientas y Material de Ferretería - IE San Miguel" es un sistema web completo para el control de inventario de materiales y herramientas adquiridas por la Institución Educativa San Miguel. El sitio cuenta con dos versiones: una versión local de escritorio basada en Node.js/Express/SQLite/Socket.io, y una versión publicada en GitHub Pages sincronizada mediante Firebase Realtime Database. Ambas versiones están adaptadas para funcionar en computador y celular, y la versión web está preparada para operar con poco o ningún internet.');

// ===== 2. ESTRUCTURA =====
title('2. ESTRUCTURA DEL PROYECTO');
bullet('backend/src/server.js — Servidor Express con rutas API, Socket.io y exportación Excel/PDF.');
bullet('backend/src/db.js — Base de datos SQLite (mejor-sqlite3) con tablas de institución, usuarios, categorías, materiales, movimientos, herramientas y su historial.');
bullet('backend/src/auth.js — Autenticación JWT y middleware de roles.');
bullet('backend/src/seed.js — Usuarios iniciales y carga del logo institucional.');
bullet('frontend/ — Interfaz web de la versión local (HTML, CSS, JS).');
bullet('docs/ — Versión publicada en GitHub Pages (app.js, index.html, styles.css, manifest, service worker e íconos).');
bullet('Logo IE San Miguel.png / Logo Marca Jcho.jpeg — Identidad visual institucional y de marca.');
bullet('scripts/importar-nube.js — Importa los datos de Firebase a la base local (herramientas o todo).');
bullet('scripts/generar-informe.js — Genera este informe técnico en PDF.');
bullet('iniciar.bat — Acceso directo de escritorio que arranca el servidor local y lo reinicia si se cae.');

// ===== 3. TECNOLOGÍAS =====
title('3. TECNOLOGÍAS UTILIZADAS');
bullet('Node.js v24, Express 4, Socket.io, SQLite (better-sqlite3), JWT, bcryptjs, ExcelJS, PDFKit.');
bullet('HTML5, CSS3, JavaScript vanilla, PWA (service worker + manifest).');
bullet('Firebase Realtime Database para sincronización en la nube.');
bullet('Git/GitHub para control de versiones y GitHub Pages para publicación.');

// ===== 4. MÓDULOS =====
title('4. MÓDULOS Y FUNCIONALIDADES');
bullet('Inicio de sesión con roles: ADMIN, ALMACENISTA y RECTOR (solo consulta).');
bullet('Dashboard con estadísticas en tiempo real (materiales, alertas, herramientas, movimientos).');
bullet('Inventario: CRUD de materiales, filtros, estados de stock y alertas BAJO/AGOTADO.');
bullet('Herramientas: registro de existentes y futuras, estado (BUENA/REGULAR/MALA/MANTENIMIENTO), préstamos, devoluciones, revisiones y bajas con historial.');
bullet('Entradas, Salidas y Ajustes con Kardex por material.');
bullet('Herramientas: columna Serial visible en tabla, reportes y exportaciones (Excel/PDF).');
bullet('Reportes: tres submódulos independientes (Material de Ferretería, Herramientas y Bajas) con selección de registros y exportación independiente de cada uno.');
bullet('Usuarios: gestión CRUD (ADMIN).');
bullet('Configuración: logo institucional y de marca.');
bullet('Versiones (GitHub): historial de commits y estado del repositorio.');

// ===== 5. ROLES =====
title('5. ROLES Y PERMISOS');
tableRow(['ROL', 'PERMISOS'], { header: true, widths: [150, 390] });
tableRow(['ADMIN', 'Acceso total: usuarios, configuración, categorías, inventario, herramientas, movimientos, reportes, versiones.'], { widths: [150, 390] });
tableRow(['ALMACENISTA', 'Inventario, herramientas, movimientos, kardex, reportes, categorías (crear/editar).'], { widths: [150, 390] });
tableRow(['RECTOR', 'Solo consulta: dashboard, inventario, herramientas, kardex y reportes.'], { widths: [150, 390] });

// ===== 6. REPORTES POR MÓDULO =====
title('6. REPORTES SEPARADOS POR MÓDULO');
para('El módulo de reportes está dividido en tres bloques independientes. Cada uno permite seleccionar con casillas los registros a exportar y ofrece tres acciones: EXPORTAR EXCEL, IMPRIMIR y DESCARGAR PDF.');
tableRow(['SUBMÓDULO', 'CONTENIDO'], { header: true, widths: [170, 370] });
tableRow(['Material de Ferretería', 'Materiales con stock, estado y ubicación.'], { widths: [170, 370] });
tableRow(['Herramientas', 'Herramientas con marca, serial, estado y responsable.'], { widths: [170, 370] });
tableRow(['Bajas', 'Materiales agotados y herramientas dadas de baja (MALA).'], { widths: [170, 370] });
para('La opción IMPRIMIR genera una vista aislada con únicamente el módulo solicitado. La opción DESCARGAR PDF produce un archivo PDF exclusivo del módulo, con el texto ajustado al ancho de cada columna para evitar superposiciones.');

// ===== 7. FUNCIONAMIENTO SIN INTERNET =====
title('7. FUNCIONAMIENTO SIN INTERNET (OFFLINE-FIRST)');
bullet('Primera visita con internet: la app se instala (PWA) y descarga las librerías de Excel y PDF.');
bullet('Sin internet: se puede iniciar sesión, registrar materiales y herramientas, hacer movimientos, consultar el kardex, generar reportes y exportar a Excel/PDF.');
bullet('Los cambios se guardan de inmediato en el equipo y quedan en cola hasta que vuelva la conexión.');
bullet('Indicador de estado: "En vivo", "Sin internet · N cambio(s) pendiente(s)" o "Reconectando (intento N)".');
bullet('Al restablecerse el internet, los cambios pendientes se envían automáticamente a Firebase y se confirma la sincronización.');
bullet('El sistema no se duerme: Wake Lock API mantiene la pantalla activa y la sincronización sigue consultando cada 5 segundos con reconexión indefinida.');
bullet('Los módulos se cargan de forma independiente: si uno falla, el resto del sistema sigue funcionando.');

// ===== 8. SINCRONIZACIÓN =====
title('8. SINCRONIZACIÓN EN LA NUBE');
para('La versión web (GitHub Pages) sincroniza todos los datos con Firebase Realtime Database en la ruta /inventario. Cada vez que un dispositivo modifica datos (materiales, herramientas, usuarios, movimientos), los demás dispositivos detectan el cambio (polling cada 5 segundos por la marca de tiempo lastUpdated) y actualizan su vista automáticamente. El caché local de localStorage asegura operación sin conexión temporal.');

// ===== 9. SEGURIDAD =====
title('9. SEGURIDAD');
bullet('Contraseñas cifradas (bcryptjs en versión local, SHA-256 en versión web).');
bullet('Autenticación mediante JWT en la versión local.');
bullet('Reglas de producción en Firebase Realtime Database: acceso limitado a /inventario y validación básica de la estructura.');
bullet('Comunicación HTTPS en la versión publicada.');

// ===== 10. DESPLIEGUE =====
title('10. DESPLIEGUE Y CONTROL DE VERSIONES');
bullet('Repositorio: https://github.com/jchodigital-cell/ie-san-miguel-inventario');
bullet('Ramas: main y principal. GitHub Pages publica desde la rama principal/docs.');
bullet('URL publicada: https://jchodigital-cell.github.io/ie-san-miguel-inventario/');
bullet('Flujo de versiones: git add . && git commit -m "..." && git push origin main');
bullet('La versión local se ejecuta con npm run dev y el acceso directo de escritorio.');

// ===== 11. BACKUP =====
title('11. RESPALDO Y CONSISTENCIA');
para('La versión local almacena los datos en data/inventory.db (SQLite) y se recomienda copiar periódicamente ese archivo. En la versión web los datos residen en Firebase Realtime Database y pueden exportarse a Excel desde el módulo Reportes.');
para('Para igualar la información entre el equipo local y la nube se ejecuta: node scripts/importar-nube.js herramientas (o "todo" para categorías, materiales, movimientos y herramientas). Se recomienda evitar que dos equipos trabajen sin conexión al mismo tiempo.');

// ===== FIRMA FINAL =====
title('12. FIRMA DIGITAL');
para('El presente informe técnico fue elaborado, verificado y aprobado por:');
doc.moveDown(0.5);
doc.image(logoJcho, 90, doc.y, { width: 60 });
doc.moveDown(3);
doc.fontSize(11).fillColor(PRIMARY).text('JCHO - Juan Carlos Hernández', { align: 'center' });
doc.fontSize(9).fillColor(GRAY).text('Desarrollador de Software · Marca JCHO', { align: 'center' });
doc.text('Firma digital certificada: JCHO', { align: 'center' });
doc.moveDown(0.5);
doc.moveTo(150, doc.y).lineTo(450, doc.y).strokeColor(PRIMARY).stroke();

doc.end();

stream.on('finish', () => {
  console.log('PDF generado: ' + outputPath);
});
stream.on('error', (err) => console.error(err));
