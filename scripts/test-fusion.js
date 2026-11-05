// Prueba de la lógica anti-pérdida de docs/app.js (fusión, tumbas, respaldos).
// Ejecutar: node scripts/test-fusion.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'docs', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

const start = src.indexOf('function normalizeCloudData');
const end = src.indexOf('// ===== TRABAJO SIN INTERNET');
if (start < 0 || end < 0) throw new Error('No se encontró el bloque de helpers en app.js');
const block = src.slice(start, end);

// Globales simuladas
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
let cloudData = null;
eval(block); // expone normalizeCloudData, mergeCloudDocs, markDeleted, etc.

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  OK   ' + name);
  } else {
    failures += 1;
    console.log('  FALLO ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
  }
}

const nowIso = () => new Date().toISOString();
const oldIso = () => new Date(Date.now() - 60000).toISOString();

// ---------------------------------------------------------------
console.log('\n1) Protección contra nube vacía (el escenario de la pérdida):');
{
  const remote = {
    institution: { name: 'IE San Miguel', logo_data: 'LOGO', updated_at: oldIso() },
    tools: [
      { id: 1, code: 'H-001', name: 'Martillo', updated_at: oldIso() },
      { id: 19, code: 'H-019', name: 'Nivel', updated_at: oldIso() },
    ],
    materials: [{ id: 1, code: 'ARB001', name: 'Arbol', stock: 3, updated_at: oldIso() }],
    users: [{ id: 4, username: 'Jcho', role: 'ADMIN', updated_at: oldIso() }],
    lastUpdated: Date.now(),
  };
  const local = {
    institution: { name: 'Por defecto', updated_at: nowIso() }, // sin logo, más reciente
    tools: [], materials: [], users: [
      { id: 1, username: 'admin', role: 'ADMIN', updated_at: nowIso() },
    ],
    categories: [], movements: [], tool_movements: [],
    lastUpdated: Date.now() + 1000,
  };
  const merged = mergeCloudDocs(remote, local);
  check('las 19 herramientas de la nube sobreviven a un equipo con lista vacía', merged.tools.length === 2);
  check('el material de la nube sobrevive', merged.materials.length === 1);
  check('el usuario Jcho de la nube sobrevive', merged.users.some((u) => u.username === 'Jcho'));
  check('el usuario local admin también se conserva (unión)', merged.users.length === 2);
  check('gana el logo de la nube aunque lo local sea más reciente', merged.institution.logo_data === 'LOGO');
  check('no inventa registros fantasma', countRecords(merged) === 5);
}

console.log('\n2) Edición: gana el registro más reciente de cualquier equipo:');
{
  const remote = {
    institution: { name: 'IE', logo_data: 'L', updated_at: nowIso() },
    tools: [
      { id: 1, name: 'Versión nube', updated_at: oldIso() },
      { id: 2, name: 'Solo nube', updated_at: oldIso() },
    ],
    lastUpdated: Date.now(),
  };
  const local = {
    institution: { name: 'IE', logo_data: 'L', updated_at: oldIso() },
    tools: [
      { id: 1, name: 'Versión equipo (nueva)', updated_at: nowIso() },
      { id: 3, name: 'Solo equipo', updated_at: oldIso() },
    ],
    lastUpdated: Date.now(),
  };
  const merged = mergeCloudDocs(remote, local);
  check('herramienta editada localmente (más nueva) gana', merged.tools.find((t) => t.id === 1).name === 'Versión equipo (nueva)');
  check('herramienta solo-nube se conserva', merged.tools.some((t) => t.id === 2));
  check('herramienta solo-equipo se conserva (subida pendiente)', merged.tools.some((t) => t.id === 3));
}

console.log('\n3) Tumbas: los borrados se propagan y no resucitan:');
{
  const remote = {
    institution: { name: 'IE', logo_data: 'L', updated_at: nowIso() },
    tools: [
      { id: 1, name: 'Vivo', updated_at: oldIso() },
      { id: 2, name: 'Borrado en nube', updated_at: oldIso() },
    ],
    _borrados: { 'tools:2': Date.now() },
    lastUpdated: Date.now(),
  };
  const local = {
    institution: { name: 'IE', logo_data: 'L', updated_at: oldIso() },
    tools: [
      { id: 1, name: 'Vivo', updated_at: oldIso() },
      { id: 2, name: 'Borrado en nube', updated_at: oldIso() }, // equipo desactualizado
      { id: 3, name: 'Borrado en equipo', updated_at: oldIso() },
    ],
    _borrados: { 'tools:3': Date.now() },
    lastUpdated: Date.now(),
  };
  const merged = mergeCloudDocs(remote, local);
  check('el registro borrado en la nube NO resucita en el equipo desactualizado', !merged.tools.some((t) => t.id === 2));
  check('el registro borrado en el equipo se propaga (tumba presente)', !merged.tools.some((t) => t.id === 3));
  check('el registro vivo sigue vivo', merged.tools.length === 1);
  check('las tumbas de ambos lados se unen', Object.keys(merged._borrados).sort().join(',') === 'tools:2,tools:3');
}

console.log('\n4) Reutilización de id tras borrado (tumba limpia al crear):');
{
  cloudData = { _borrados: {}, tools: [], tool_movements: [], users: [], categories: [], materials: [], movements: [], institution: null };
  markDeleted('tools', 19);
  check('tumba registrada', !!cloudData._borrados['tools:19']);
  markCreated('tools', 19);
  check('tumba eliminada al reutilizar el id', !cloudData._borrados['tools:19']);
}

console.log('\n5) Respaldo automático:');
{
  const remote = {
    institution: { name: 'IE', logo_data: 'X'.repeat(100), brand_logo_data: 'Y'.repeat(100), updated_at: nowIso() },
    tools: Array.from({ length: 19 }, (_, i) => ({ id: i + 1, name: 'T' + i, updated_at: oldIso() })),
    lastUpdated: Date.now(),
  };
  // Equipo con menos registros que la nube -> debe respaldar (habría pérdida)
  const merged = { ...remote, tools: remote.tools.slice(0, 3) };
  check('si la escritura reduciría registros, se respalda', shouldBackup(remote, merged) === true);
  // Misma cantidad y sin respaldo previo en 24h -> también respalda (copia periódica)
  check('sin respaldo en 24h se crea copia periódica', shouldBackup(remote, { ...remote }) === true);
  store.set('ie-last-backup', String(Date.now()));
  check('con respaldo reciente y sin pérdida, no respalda', shouldBackup(remote, { ...remote }) === false);

  const backups = addCloudBackup({}, remote);
  const key = Object.keys(backups)[0];
  check('el respaldo guarda el estado previo', backups[key].tools.length === 19);
  check('el respaldo no incluye logos (pesan mucho)', backups[key].institution.logo_data === null && backups[key].institution.brand_logo_data === null);
  let many = {};
  for (let i = 1; i <= 5; i += 1) many['resp-' + (1000 * i)] = { tools: [{ id: i }] }; // 5 respaldos previos
  many = addCloudBackup(many, remote); // entra uno nuevo
  check('se conservan máximo 5 respaldos', Object.keys(many).length === 5);
  check('se elimina siempre el más antiguo', !many['resp-1000'] && Object.keys(many).some((k) => k.startsWith('resp-') && Number(k.slice(5)) > 1000));
}

console.log('\n6) docsDataEqual ignora claves ausentes vs listas vacías:');
{
  const a = { institution: { name: 'IE' }, tools: [{ id: 1, name: 'x' }], movements: [] };
  const b = { institution: { name: 'IE' }, tools: [{ id: 1, name: 'x' }] }; // movements ausente (RTDB borra [])
  check('listas vacías y claves ausentes se consideran iguales', docsDataEqual(a, b) === true);
  const c = { ...b, tools: [] };
  check('diferencia real de contenido se detecta', docsDataEqual(a, c) === false);
}

console.log('\n7) countRecords:');
{
  check('cuenta todas las colecciones', countRecords({ tools: [1, 2], materials: [1], users: [1, 2, 3] }) === 6);
  check('claves ausentes cuentan 0', countRecords({}) === 0);
}

console.log('\n8) Empate determinista (mismo resultado en todos los equipos):');
{
  const r = { id: 1, name: 'B', updated_at: oldIso() };
  const l = { id: 1, name: 'A', updated_at: oldIso() };
  const m1 = mergeCloudDocs({ institution: { name: 'IE', logo_data: 'L' }, tools: [r] }, { institution: null, tools: [l] });
  const m2 = mergeCloudDocs({ institution: { name: 'IE', logo_data: 'L' }, tools: [r] }, { institution: null, tools: [l] });
  check('la fusión es estable/determinista', JSON.stringify(m1.tools) === JSON.stringify(m2.tools));
  const flip1 = mergeCloudDocs({ institution: { name: 'IE', logo_data: 'L' }, tools: [l] }, { institution: null, tools: [r] });
  check('con los mismos dos registros, todos deciden igual aunque cambie el lado', JSON.stringify(flip1.tools[0]) === JSON.stringify(m1.tools[0]));
}

console.log('\n' + (failures === 0 ? 'TODO OK (' + 'pruebas superadas' + ')' : failures + ' PRUEBAS FALLARON'));
process.exit(failures === 0 ? 0 : 1);
