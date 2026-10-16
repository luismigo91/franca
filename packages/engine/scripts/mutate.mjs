// Mutación dirigida sin dependencias (D17 de engine-http).
//
// Para cada entrada de tests/mutations.json: comprueba que `find` aparece exactamente una vez en
// `file`, guarda una copia del original en .mutate-backup/, escribe el fichero mutado, ejecuta los
// tests que deben matarla y restaura REESCRIBIENDO el contenido original (sin git: los ficheros
// nuevos aún no están versionados). Una mutación sobrevive si los tests pasan.
//
// Antes de mutar nada ejecuta una línea base (la unión de los tests sobre el original): si no está
// en verde, aborta, porque entonces cualquier mutación parecería «muerta». Un fallo del propio
// proceso (binario que no arranca, señal, tiempo agotado distinto del de una mutación) también
// aborta y nunca cuenta como «muerta». SIGINT y SIGTERM restauran el fichero de forma síncrona.
//
// Uso: node scripts/mutate.mjs [--only id,id]   (código 1 si sobrevive alguna o algo falla; 130 si se interrumpe)
// Variables de entorno (para probar el script): MUTATE_VITEST (ejecutable de Vitest),
// MUTATE_TIMEOUT_MS (por defecto 300000) y MUTATE_MUTATIONS (ruta del JSON de mutaciones).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = join(root, '.mutate-backup');
const vitest = process.env.MUTATE_VITEST ?? join(root, 'node_modules/.bin/vitest');
const timeoutMs = Number(process.env.MUTATE_TIMEOUT_MS ?? 300_000);
const mutationsFile = process.env.MUTATE_MUTATIONS ?? join(root, 'tests/mutations.json');
// El nombre de la copia codifica la ruta relativa del fichero.
const backupName = (file) => encodeURIComponent(file);
const restoreName = (name) => decodeURIComponent(name);

/** El fichero que está mutado ahora mismo, para restaurarlo si llega una señal, y el Vitest en marcha. */
let active = null;
let currentChild = null;

function recoverLeftovers() {
  if (!existsSync(backupDir)) return false;
  const names = readdirSync(backupDir);
  for (const name of names) {
    writeFileSync(join(root, restoreName(name)), readFileSync(join(backupDir, name), 'utf8'));
    console.error(`restaurado ${restoreName(name)} desde una ejecución anterior que se mató a medias`);
  }
  rmSync(backupDir, { recursive: true, force: true });
  return names.length > 0;
}

function loadMutations() {
  const all = JSON.parse(readFileSync(mutationsFile, 'utf8'));
  const onlyArg = process.argv.indexOf('--only');
  if (onlyArg === -1) return all;
  const wanted = new Set(process.argv[onlyArg + 1].split(','));
  return all.filter((m) => wanted.has(m.id));
}

function occurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count++;
  return count;
}

/** Falla antes de mutar nada si alguna entrada está obsoleta. */
function validate(mutations) {
  const problems = [];
  for (const m of mutations) {
    if (!existsSync(join(root, m.file))) {
      problems.push(`${m.id}: no existe ${m.file}`);
      continue;
    }
    const n = occurrences(readFileSync(join(root, m.file), 'utf8'), m.find);
    if (n !== 1) problems.push(`${m.id}: «find» aparece ${n} veces en ${m.file} (debe ser exactamente 1)`);
    if (m.find === m.replace) problems.push(`${m.id}: «find» y «replace» son iguales`);
    for (const t of m.tests) if (!existsSync(join(root, t))) problems.push(`${m.id}: no existe el test ${t}`);
  }
  return problems;
}

/**
 * Ejecuta Vitest sobre `tests`.
 * @returns `{ status }` con el código de salida; `{ timedOut: true }` si se agotó el tiempo; `{ error }` si el proceso no pudo ejecutarse.
 */
function runTests(tests) {
  return new Promise((resolveRun) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun(value);
    };
    const child = spawn(vitest, ['run', ...tests], { cwd: root, stdio: 'ignore' });
    currentChild = child;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ timedOut: true });
    }, timeoutMs);
    child.on('error', (error) => settle({ error: error.message }));
    child.on('close', (status, signal) => settle(signal ? { error: `terminado por la señal ${signal}` } : { status }));
  });
}

function fatal(message) {
  console.error(message);
  rmSync(backupDir, { recursive: true, force: true });
  process.exit(1);
}

async function runOne(m) {
  const path = join(root, m.file);
  const original = readFileSync(path, 'utf8');
  mkdirSync(backupDir, { recursive: true });
  const copy = join(backupDir, backupName(m.file));
  writeFileSync(copy, original);
  active = { path, original, copy };
  try {
    writeFileSync(path, original.replace(m.find, () => m.replace));
    const run = await runTests(m.tests);
    if (run.error !== undefined) return { abort: `${m.id}: no se pudo ejecutar Vitest (${run.error}); no se cuenta como mutación muerta` };
    if (run.timedOut) return { verdict: 'muerta (timeout)' };
    return { verdict: run.status === 0 ? 'SOBREVIVE' : 'muerta' };
  } finally {
    writeFileSync(path, original);
    rmSync(copy, { force: true });
    active = null;
    if (readFileSync(path, 'utf8') !== original) throw new Error(`no se pudo restaurar ${m.file}`);
  }
}

function onSignal() {
  currentChild?.kill('SIGKILL');
  if (active) {
    // Síncrono: el proceso va a salir y no hay otra oportunidad de restaurar.
    writeFileSync(active.path, active.original);
    console.error(`interrumpido: restaurado ${active.path}`);
  }
  rmSync(backupDir, { recursive: true, force: true });
  process.exit(130);
}
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

if (recoverLeftovers()) {
  console.error('Se restauraron ficheros de una ejecución anterior: revisa el árbol de trabajo y vuelve a ejecutar.');
  process.exit(1);
}
const mutations = loadMutations();
const problems = validate(mutations);
if (problems.length) fatal(`tests/mutations.json está obsoleto:\n  ${problems.join('\n  ')}`);

const baseline = await runTests([...new Set(mutations.flatMap((m) => m.tests))]);
if (baseline.error !== undefined) fatal(`línea base: no se pudo ejecutar Vitest (${baseline.error})`);
if (baseline.timedOut) fatal('línea base: se agotó el tiempo');
if (baseline.status !== 0) fatal('línea base rota: los tests no pasan sobre el código sin mutar, así que ninguna mutación sería concluyente');
console.log(`línea base en verde (${new Set(mutations.flatMap((m) => m.tests)).size} ficheros de test)`);

const survivors = [];
for (const m of mutations) {
  const outcome = await runOne(m);
  if (outcome.abort) fatal(outcome.abort);
  console.log(`${outcome.verdict.startsWith('muerta') ? 'ok  ' : 'FALLA'} ${m.id}  (${m.file})${outcome.verdict === 'muerta' ? '' : `  ${outcome.verdict}`}`);
  if (!outcome.verdict.startsWith('muerta')) survivors.push(m.id);
}
rmSync(backupDir, { recursive: true, force: true });
console.log(`\n${mutations.length - survivors.length}/${mutations.length} mutaciones muertas`);
if (survivors.length) {
  console.error(`SOBREVIVEN: ${survivors.join(', ')}`);
  process.exit(1);
}
