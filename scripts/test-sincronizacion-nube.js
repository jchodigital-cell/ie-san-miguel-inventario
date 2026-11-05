// Prueba de INTEGRACIÓN: ejecuta la sincronización real de docs/app.js
// contra la nube de Firebase y verifica que NADA se pierde.
// Ejecutar: node scripts/test-sincronizacion-nube.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'docs', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

const FIREBASE_URL = 'https://ie-san-miguel-inventario-default-rtdb.firebaseio.com';
const CLOUD_DOC = 'inventario';

// Globales simuladas (solo las que el bloque usa en tiempo de ejecución)
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Variables de estado que pushToCloud referencia en el ámbito externo
let cloudData = null;
let localVersion = 0;
let pendingChanges = 0;

// Extraer el bloque de sincronización de app.js (normalizeCloudData ... antes de cloudLoad)
const start = src.indexOf('function normalizeCloudData');
const end = src.indexOf('async function cloudLoad');
if (start < 0 || end < 0) throw new Error('No se encontró el bloque de sincronización');
const block = src.slice(start, end);
eval(block); // expone mergeCloudDocs, pushToCloud, markDeleted, countRecords...

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  OK   ' + name);
  else { failures += 1; console.log('  FALLO ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

async function getRemote() {
  const res = await fetch(`${FIREBASE_URL}/${CLOUD_DOC}.json`);
  const data = await res.json();
  if (!res.ok || (data && data.error)) throw new Error('No se pudo leer la nube');
  return data;
}

(async () => {
  console.log('\nA) Lectura del estado real de la nube:');
  const remote = await getRemote();
  const counts = (d) => ({
    tools: (d.tools || []).length,
    materials: (d.materials || []).length,
    categories: (d.categories || []).length,
    tool_movements: (d.tool_movements || []).length,
    users: (d.users || []).length,
    backups: d._respaldos ? Object.keys(d._respaldos).length : 0,
  });
  const antes = counts(remote);
  console.log('   antes:', JSON.stringify(antes));
  check('la nube tiene 19 herramientas', antes.tools === 19, antes);
  check('la nube tiene 11 materiales', antes.materials === 11, antes);
  check('la nube conserva el respaldo pre-recuperacion', Object.keys(remote._respaldos || {}).some((k) => k.startsWith('pre-')));

  console.log('\nB) Fusión con un equipo "en blanco" (el escenario de la pérdida):');
  const equipoEnBlanco = {
    institution: { name: 'Por defecto', updated_at: new Date().toISOString() },
    tools: [], materials: [], categories: [], movements: [], tool_movements: [],
    users: [{ id: 1, username: 'admin', updated_at: new Date().toISOString() }],
    lastUpdated: Date.now(),
  };
  const fusionBlanco = mergeCloudDocs(remote, equipoEnBlanco);
  check('ninguna herramienta se pierde con un equipo en blanco', fusionBlanco.tools.length === antes.tools, fusionBlanco.tools.length);
  check('ningún material se pierde', fusionBlanco.materials.length === antes.materials);
  check('ninguna categoría se pierde', fusionBlanco.categories.length === antes.categories);
  check('ningún movimiento de herramienta se pierde', fusionBlanco.tool_movements.length === antes.tool_movements);
  check('los 5 usuarios reales siguen (los por defecto se suman)', fusionBlanco.users.length >= antes.users, fusionBlanco.users.length);
  check('el logo real de la institución se conserva', Boolean(fusionBlanco.institution.logo_data));

  console.log('\nC) Fusión con un equipo desactualizado (datos viejos locales):');
  const equipoViejo = JSON.parse(JSON.stringify(remote));
  equipoViejo.tools = equipoViejo.tools.slice(0, 5); // solo ve5 de19
  equipoViejo.materials = [];
  const fusionVieja = mergeCloudDocs(remote, equipoViejo);
  check('el equipo viejo recupera las 19 herramientas de la nube', fusionVieja.tools.length === antes.tools);
  check('recupera los 11 materiales', fusionVieja.materials.length === antes.materials);

  console.log('\nD) Tumba local no resucita y no borra lo demás (seco, sin escribir):');
  cloudData = mergeCloudDocs(remote, JSON.parse(JSON.stringify(remote)));
  const idBorrado = cloudData.tools[cloudData.tools.length - 1].id;
  cloudData.tools = cloudData.tools.filter((t) => t.id !== idBorrado);
  markDeleted('tools', idBorrado);
  const fusionTumba = mergeCloudDocs(remote, cloudData);
  check('la herramienta borrada desaparece de la fusión', !fusionTumba.tools.some((t) => t.id === idBorrado));
  check('las demás 18 herramientas siguen', fusionTumba.tools.length === antes.tools - 1);

  console.log('\nE) pushToCloud() real: escribe la fusión sin pérdida:');
  // Dispositivo "ya sincronizado" (mismo contenido que la nube)
  cloudData = mergeCloudDocs(remote, JSON.parse(JSON.stringify(remote)));
  await pushToCloud(); // lee + fusiona + respalda + escribe (o se salta si no hay cambios)
  const despues = await getRemote();
  const c = counts(despues);
  console.log('   después:', JSON.stringify(c));
  check('herramientas intactas tras sincronizar', c.tools === antes.tools, c.tools);
  check('materiales intactos', c.materials === antes.materials);
  check('categorías intactas', c.categories === antes.categories);
  check('movimientos de herramienta intactos', c.tool_movements === antes.tool_movements);
  check('usuarios intactos', c.users === antes.users);
  check('nombre de la institución intacto', despues.institution.name === remote.institution.name);
  check('logo de la institución intacto', Boolean(despues.institution.logo_data));
  check('logo de marca intacto', Boolean(despues.institution.brand_logo_data));
  check('el respaldo pre-recuperacion sigue ahí', Object.keys(despues._respaldos || {}).some((k) => k.startsWith('pre-')));
  check('lastUpdated es una fecha real (no basura)', Number(despues.lastUpdated) > 1700000000000, despues.lastUpdated);
  check('no se crearon claves basura', !('username' in despues) && !('password' in despues));

  console.log('\nF) Idempotencia: segunda sincronización no duplica ni cambia:');
  cloudData = mergeCloudDocs(despues, JSON.parse(JSON.stringify(despues)));
  await pushToCloud();
  const final = await getRemote();
  const cf = counts(final);
  check('los conteos no cambian tras una segunda sincronización',
    cf.tools === antes.tools && cf.materials === antes.materials && cf.users === antes.users, cf);

  console.log('\n' + (failures === 0 ? 'TODO OK — la sincronización real preserva la información' : failures + ' PRUEBAS FALLARON'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
