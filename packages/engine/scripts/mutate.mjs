// Mutación dirigida sin dependencias (D17 de engine-http).
//
// Para cada entrada de tests/mutations.json: comprueba que `find` aparece exactamente una vez en
// `file`, guarda una copia del original en .mutate-backup/, escribe el fichero mutado, ejecuta los
// tests que deben matarla y restaura REESCRIBIENDO el contenido original (sin git: los ficheros
// nuevos aún no están versionados). Una mutación sobrevive si los tests pasan.
//
// Uso: node scripts/mutate.mjs [--only id,id]   (código 1 si sobrevive alguna o algo falla)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = join(root, '.mutate-backup');
// El nombre de la copia codifica la ruta relativa del fichero.
const backupName = (file) => encodeURIComponent(file);
const restoreName = (name) => decodeURIComponent(name);

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
  const all = JSON.parse(readFileSync(join(root, 'tests/mutations.json'), 'utf8'));
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

function runOne(m) {
  const path = join(root, m.file);
  const original = readFileSync(path, 'utf8');
  mkdirSync(backupDir, { recursive: true });
  const copy = join(backupDir, backupName(m.file));
  writeFileSync(copy, original);
  try {
    writeFileSync(path, original.replace(m.find, () => m.replace));
    const run = spawnSync('node_modules/.bin/vitest', ['run', ...m.tests], { cwd: root, encoding: 'utf8' });
    return run.status === 0 ? 'SOBREVIVE' : 'muerta';
  } finally {
    writeFileSync(path, original);
    rmSync(copy, { force: true });
    if (readFileSync(path, 'utf8') !== original) throw new Error(`no se pudo restaurar ${m.file}`);
  }
}

if (recoverLeftovers()) {
  console.error('Se restauraron ficheros de una ejecución anterior: revisa el árbol de trabajo y vuelve a ejecutar.');
  process.exit(1);
}
const mutations = loadMutations();
const problems = validate(mutations);
if (problems.length) {
  console.error(`tests/mutations.json está obsoleto:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const survivors = [];
for (const m of mutations) {
  const verdict = runOne(m);
  console.log(`${verdict === 'muerta' ? 'ok  ' : 'FALLA'} ${m.id}  (${m.file})`);
  if (verdict !== 'muerta') survivors.push(m.id);
}
rmSync(backupDir, { recursive: true, force: true });
console.log(`\n${mutations.length - survivors.length}/${mutations.length} mutaciones muertas`);
if (survivors.length) {
  console.error(`SOBREVIVEN: ${survivors.join(', ')}`);
  process.exit(1);
}
