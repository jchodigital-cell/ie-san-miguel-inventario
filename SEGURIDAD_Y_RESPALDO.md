# SEGURIDAD Y RESPALDO DE LA INFORMACIÓN
## Sistema de Inventario — Institución Educativa San Miguel (Payande)
### Garantía de que la información no se vuelve a perder

> Documento técnico para el cliente. Describe las capas de protección que impiden
> la pérdida de datos, cómo se recuperó la información incidente del 4 de noviembre
> de 2026 y qué hacer si algún día hace falta restaurar.

---

## 1. Resumen ejecutivo

El sistema cuenta hoy con **7 capas independientes de protección**. Para que la
información se pierda nuevamente tendrían que fallar **al mismo tiempo** las 7
capas, incluyendo las reglas del servidor de Firebase (que se aplican aunque un
equipo tenga código viejo o un navegador malicioso).

| # | Capa | Protege contra | Dónde vive |
|---|------|----------------|------------|
| 1 | Fusión antes de escribir | Equipos que sobrescriben la nube | `docs/app.js` |
| 2 | Tumbas (borrados marcados) | Datos que "resucitan" o borrados perdidos | `docs/app.js` |
| 3 | Respaldo automático en la nube | Escrituras con riesgo / errores humanos | `/inventario/_respaldos` |
| 4 | Reglas de validación de Firebase | Cualquier borrado total, incluso con código viejo | Consola de Firebase |
| 5 | Copia automática de la base local | Corrupción o borrado del PC | `backend/data/backups/` |
| 6 | Exportar / importar / restaurar JSON | Errores humanos, migraciones, auditoría | Configuración de la app |
| 7 | Autorreparación (self-heal) | La nube pierde registros | `docs/app.js` |

Además: **cola de cambios sin internet** (`ie-sync-pending`) — los cambios hechos
sin conexión se guardan en el equipo y se envían solos al reconectar.

---

## 2. Qué ocurrió y cómo se recuperó (incidente 04/11/2026)

**Qué pasó:** un equipo con datos en blanco (o una lectura fallida de Firebase
interpretada como "base vacía") escribió datos por defecto sobre la nube y borró
19 herramientas, sus movimientos y los materiales.

**Recuperación realizada (04/11/2026):** la información se restauró desde:
1. Caché del navegador Chrome (`data/respaldo-navegador-2026-11-04.json`).
2. Base de datos local SQLite del PC (`data/inventory.db`).
3. Exportación Excel del 11 de septiembre.

**Estado restaurado verificado:** 19 herramientas, 20 movimientos de herramientas,
11 materiales, 11 categorías, 5 usuarios, nombre e logos de la institución.

**Lección aplicada:** el sistema ya no interpreta errores como base vacía y ya no
escribe a ciegas — lee, **fusiona**, respalda y recién entonces escribe.

---

## 3. Las capas explicadas

### Capa 1 — Fusión antes de escribir (merge)
Cada vez que un equipo envía cambios a la nube, `pushToCloud()`:
1. **Lee** el estado real de la nube (nunca escribe sin leer).
2. **Fusiona** nube + equipo: unión de todos los registros por `id`;
   si un mismo registro existe en los dos lados, **gana el más reciente**.
3. **Respaldan** el estado previo si algo podría perderse (Capa 3).
4. Escribe el resultado fusionado.

Consecuencia: **ningún equipo puede borrar lo que otro creó**, ni siquiera uno
recién instalado con la base "vacía" o con datos por defecto.

### Capa 2 — Tumbas (tombstones)
Al eliminar un registro, el sistema guarda `fecha de borrado` en `_borrados`.
La fusión respeta esa marca: el registro no vuelve a aparecer en otros equipos,
pero tampoco borra nada más. Las tumbas se limpian a los 180 días y se limpian
solas si el mismo `id` se vuelve a usar.

### Capa 3 — Respaldo automático en la nube
Antes de una escritura que reduciría información, y como mínimo cada 24 horas,
se guarda una copia del estado previo en `/inventario/_respaldos/`
(clave `resp-<fecha>`). Se conservan **las 5 copias más recientes**; se guardan
sin logos para que pesen poco. Se restauran desde **Configuración → Respaldo**.

### Capa 4 — Reglas de validación de Firebase (aplicar una vez)
Ver archivo [`firebase-rules.json`](firebase-rules.json) y sección 4.
Impiden en el **servidor**:
- Borrar la institución, los usuarios o `lastUpdated` en cualquier escritura.
- Eliminar por completo herramientas / materiales / categorías / movimientos /
  movimientos de herramientas, salvo confirmación explícita y reciente
  (`vacio_confirmado`, válido 24 horas) — algo que solo el sistema nuevo envía.
- Un equipo con código viejo o un script externo **no puede vaciar la base**.

### Capa 5 — Copia automática de la base local (SQLite)
Al arrancar el servidor local (`iniciar.bat` o `node backend/src/server.js`) se
copia `data/inventory.db` a `data/backups/inventory-AAAA-MM-DD.db` (una por día,
se conservan **las 7 más recientes`). Incluso si la base local se corrompe, se
pierde como máximo un día de trabajo.

### Capa 6 — Exportar, importar y restaurar (Configuración → Respaldo)
- **Descargar respaldo (.json):** copia completa descargable (guardar en USB o
  disco externo para auditoría).
- **Importar respaldo (.json):** fusiona un archivo con la información actual
  sin borrar nada.
- **Restaurar** una copia de la nube: recupera los registros que ya no existen
  sin tocar los datos más recientes.

### Capa 7 — Autorreparación (self-heal)
Si en algún momento la nube tuviera menos registros que un equipo (por cualquier
falla), el equipo lo detecta al sincronizar y **vuelve a subir los que faltan**.
La información solo puede recuperarse hacia la nube, nunca perderse desde ella.

---

## 4. Cómo aplicar las reglas de Firebase (una sola vez)

1. Entrar a [https://console.firebase.google.com](https://console.firebase.google.com)
   → proyecto **ie-san-miguel-inventario**.
2. En el menú lateral: **Build → Realtime Database → pestaña Rules**.
3. Reemplazar todo el contenido por el de [`firebase-rules.json`](firebase-rules.json)
   (selección total → pegar).
4. Pulsar **Publish** (Publicar).

**Verificación inmediata (2 minutos):**
1. Abrir el sistema → entrar con `admin`.
2. Crear una herramienta de prueba y eliminarla: debe funcionar sin error.
3. En Configuración → Respaldo → **Actualizar respaldos de la nube**: debe
   listar al menos una copia.
4. Si algún equipo mostrara error 401/400 al sincronizar: revisar que la
   escritura venga desde la app actualizada (Service Worker v9) y, si persiste,
   volver temporalmente a las reglas simples de la sección 6.

## 5. Reglas simples de respaldo (plan B)

Si por cualquier motivo las reglas de validación bloquearan al sistema, volver a
la consola de Firebase → Rules y publicar esto:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "inventario": { ".read": true, ".write": true }
  }
}
```

Con las reglas simples el sistema sigue protegido por las capas 1, 2, 3, 5, 6 y 7;
la capa 4 es refuerzo adicional.

---

## 6. Qué hacer si algún día falta información

1. **No escribir nada** en la nube desde ningún equipo.
2. **Configuración → Respaldo → Actualizar respaldos de la nube** → probar
   **Restaurar** el respaldo más reciente anterior al problema.
3. Si no hay respaldo en la nube: revisar el USB con el `.json` descargado
   (**Importar respaldo**).
4. Último recurso: copia local `data/backups/inventory-*.db` (o el respaldo del
   navegador descrito en el informe del incidente) — contactar soporte técnico
   (JCHO) para importarla.

## 7. Verificación de integridad (lista de control semanal)

- [ ] Configuración → Respaldo muestra respaldos recientes en la nube.
- [ ] Indicador superior: "● En vivo · sincronizado con la nube".
- [ ] Recuento de registros: herramientas 19, materiales 11, categorías 11,
      movimientos de herramientas 20 (o más, según actividad).
- [ ] Existe `data/backups/inventory-AAAA-MM-DD.db` del día en el PC.
- [ ] El respaldo `.json` del mes está guardado fuera del equipo.

---

*Documento parte de la documentación del sistema: `README.md` e `Informe_Tecnico_JCHO_IE_San_Miguel.pdf`. Código verificado con `node scripts/test-fusion.js` (27 pruebas anti-pérdida).*
