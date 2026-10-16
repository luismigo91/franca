#!/usr/bin/env node
/**
 * Lint de la wiki de conocimiento (.claude/wiki/).
 *
 * Convierte en gate mecánico la regla de oro del repo ("un MUST sin
 * enforcement es un deseo") aplicada a la propia wiki: 23 de 81 gotchas
 * volvieron a morder DESPUÉS de estar documentados, porque la ficha era
 * advisory y nada obligaba a mecanizar la lección.
 *
 * Comprueba:
 *   1. Frontmatter válido en todo fichero de la wiki (name/description/type),
 *      con `name` igual al slug del fichero.
 *   2. Todo fichero tiene su línea en el índice auto-cargado
 *      (.claude/rules/always/knowledge-wiki.md).
 *   3. Todo `gotcha-*.md` NUEVO o MODIFICADO declara `metadata.enforcement`:
 *        - una o más rutas del repo (separadas por coma), opcionalmente con
 *          `#ancla` — cada ruta debe existir; o
 *        - `none — <razón>` (mínimo 12 caracteres de razón) cuando la lección
 *          no es mecanizable. Declararlo en voz alta es el objetivo: la
 *          decisión de no mecanizar tiene que ser consciente, no por omisión.
 *      Los gotchas preexistentes sin el campo NO fallan hasta que alguien los
 *      toque (ratchet: el campo entra con la próxima edición).
 *
 * Uso:
 *   node scripts/wiki-lint.mjs --changed-since <git-ref>   # CI (PR): diff vs base
 *   node scripts/wiki-lint.mjs --changed                   # local: working tree
 *   node scripts/wiki-lint.mjs --all                       # exige enforcement en TODOS
 *   node scripts/wiki-lint.mjs --self-test                 # aserciones de la lógica pura
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI_DIR = '.claude/wiki';
const INDEX_FILE = '.claude/rules/always/knowledge-wiki.md';
const ENFORCED_PREFIX = 'gotcha-';
const MIN_REASON = 12;

/** Extrae el bloque YAML del frontmatter (entre las dos primeras `---`). */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  let section = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const top = /^([A-Za-z_]+):\s*(.*)$/.exec(raw);
    const nested = /^\s+([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (top) {
      section = top[2] === '' ? top[1] : null;
      out[top[1]] = top[2] === '' ? {} : top[2].trim();
    } else if (nested && section) {
      out[section][nested[1]] = nested[2].trim();
    }
  }
  return out;
}

/**
 * Valida el valor de `enforcement`. Devuelve null si es válido, o el motivo.
 * `exists(path)` se inyecta para poder testear sin tocar disco.
 */
export function validateEnforcement(value, exists) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'falta `metadata.enforcement` (ruta(s) del gate, o `none — <razón>`)';
  }
  const v = String(value).trim();
  if (/^none\b/i.test(v)) {
    const reason = v.replace(/^none\s*[—:-]*\s*/i, '');
    if (reason.length < MIN_REASON) {
      return `\`none\` exige una razón de al menos ${MIN_REASON} caracteres (por qué NO es mecanizable)`;
    }
    return null;
  }
  const paths = v.split(',').map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) return 'enforcement vacío';
  for (const p of paths) {
    const file = p.split('#')[0].trim();
    if (!file) return `ruta vacía en \`${p}\``;
    if (/\s/.test(file)) return `\`${file}\` no parece una ruta (¿querías \`none — <razón>\`?)`;
    if (!exists(file)) return `la ruta \`${file}\` no existe en el repo`;
  }
  return null;
}

/** Devuelve los slugs (sin .md) referenciados en el índice como `](slug.md)`. */
export function indexedSlugs(indexText) {
  const out = new Set();
  for (const m of indexText.matchAll(/\]\(\.\.\/\.\.\/wiki\/([^)]+)\.md\)/g)) out.add(m[1]);
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function changedWikiFiles(mode, ref) {
  let list = '';
  if (mode === 'changed-since') {
    list = git(['diff', '--name-only', '--diff-filter=AM', `${ref}...HEAD`, '--', WIKI_DIR]);
  } else if (mode === 'changed') {
    list = [
      git(['diff', '--name-only', '--diff-filter=AM', 'HEAD', '--', WIKI_DIR]),
      git(['ls-files', '--others', '--exclude-standard', '--', WIKI_DIR]),
    ].join('\n');
  }
  return new Set(list.split('\n').map((s) => s.trim()).filter(Boolean));
}

export function lint({ files, changed, requireAll, read, exists, indexText }) {
  const errors = [];
  const indexed = indexedSlugs(indexText);
  for (const rel of files) {
    const slug = rel.split('/').pop().replace(/\.md$/, '');
    if (slug === 'README' || slug === 'INDEX') continue;
    const text = read(rel);
    const fm = parseFrontmatter(text);
    if (!fm) {
      errors.push(`${rel}: sin frontmatter (--- name/description/metadata.type ---)`);
      continue;
    }
    if (fm.name !== slug) errors.push(`${rel}: \`name: ${fm.name ?? ''}\` no coincide con el slug \`${slug}\``);
    if (!fm.description) errors.push(`${rel}: falta \`description\``);
    const meta = typeof fm.metadata === 'object' ? fm.metadata : {};
    const type = meta.type ?? fm.type;
    if (!['project', 'reference'].includes(type)) {
      errors.push(`${rel}: \`type\` debe ser project|reference (user/feedback van a ~/.claude), es \`${type ?? ''}\``);
    }
    if (!indexed.has(slug)) errors.push(`${rel}: sin línea en el índice ${INDEX_FILE}`);
    const mustEnforce = slug.startsWith(ENFORCED_PREFIX) && (requireAll || changed.has(rel));
    if (mustEnforce) {
      const why = validateEnforcement(meta.enforcement ?? fm.enforcement, exists);
      if (why) errors.push(`${rel}: ${why}`);
    }
  }
  return errors;
}

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`✗ ${msg}`);
      process.exitCode = 1;
    } else console.log(`✓ ${msg}`);
  };
  const fm = parseFrontmatter('---\nname: a-b\ndescription: d\nmetadata:\n  type: project\n  enforcement: x.ts\n---\nbody');
  assert(fm.name === 'a-b' && fm.metadata.type === 'project' && fm.metadata.enforcement === 'x.ts', 'parseFrontmatter anidado');
  assert(parseFrontmatter('no frontmatter') === null, 'sin frontmatter → null');
  const ex = (p) => p === 'a.ts' || p === 'b/c.test.ts';
  assert(validateEnforcement(undefined, ex) !== null, 'enforcement ausente falla');
  assert(validateEnforcement('a.ts', ex) === null, 'ruta existente pasa');
  assert(validateEnforcement('a.ts#L10, b/c.test.ts', ex) === null, 'varias rutas con ancla pasan');
  assert(validateEnforcement('nope.ts', ex) !== null, 'ruta inexistente falla');
  assert(validateEnforcement('none', ex) !== null, 'none sin razón falla');
  assert(validateEnforcement('none — la lección es de método, no de código', ex) === null, 'none con razón pasa');
  assert(validateEnforcement('vive en los tests', ex) !== null, 'prosa sin ruta falla');
  const idx = indexedSlugs('- [X](../../wiki/gotcha-uno.md) — g\n- [Y](../../wiki/harness-dos.md) — h');
  assert(idx.has('gotcha-uno') && idx.has('harness-dos') && idx.size === 2, 'indexedSlugs extrae slugs');
  const files = ['.claude/wiki/gotcha-uno.md', '.claude/wiki/harness-dos.md', '.claude/wiki/gotcha-tres.md'];
  const texts = {
    '.claude/wiki/gotcha-uno.md': '---\nname: gotcha-uno\ndescription: d\nmetadata:\n  type: project\n---\n',
    '.claude/wiki/harness-dos.md': '---\nname: harness-dos\ndescription: d\nmetadata:\n  type: project\n---\n',
    '.claude/wiki/gotcha-tres.md': '---\nname: gotcha-tres\ndescription: d\nmetadata:\n  type: project\n  enforcement: a.ts\n---\n',
  };
  const base = { files, read: (f) => texts[f], exists: ex, indexText: '- [a](../../wiki/gotcha-uno.md)\n- [b](../../wiki/harness-dos.md)\n- [c](../../wiki/gotcha-tres.md)' };
  assert(lint({ ...base, changed: new Set(), requireAll: false }).length === 0, 'preexistentes sin enforcement no fallan si no se tocan');
  const e1 = lint({ ...base, changed: new Set(['.claude/wiki/gotcha-uno.md']), requireAll: false });
  assert(e1.length === 1 && e1[0].includes('enforcement'), 'gotcha tocado sin enforcement falla');
  assert(lint({ ...base, changed: new Set(['.claude/wiki/harness-dos.md']), requireAll: false }).length === 0, 'harness-* tocado no exige enforcement');
  assert(lint({ ...base, changed: new Set(['.claude/wiki/gotcha-tres.md']), requireAll: false }).length === 0, 'gotcha tocado con enforcement válido pasa');
  assert(lint({ ...base, changed: new Set(), requireAll: true }).length === 1, '--all exige enforcement en todos los gotchas');
  const e2 = lint({ ...base, indexText: '', changed: new Set(), requireAll: false });
  assert(e2.length === 3 && e2.every((m) => m.includes('índice')), 'sin línea en el índice falla');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const requireAll = args.includes('--all');
  const sinceIdx = args.indexOf('--changed-since');
  const mode = sinceIdx >= 0 ? 'changed-since' : args.includes('--changed') ? 'changed' : 'none';
  const changed = mode === 'none' ? new Set() : changedWikiFiles(mode, args[sinceIdx + 1]);
  const files = readdirSync(join(ROOT, WIKI_DIR))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `${WIKI_DIR}/${f}`);
  const errors = lint({
    files,
    changed,
    requireAll,
    read: (f) => readFileSync(join(ROOT, f), 'utf8'),
    exists: (p) => existsSync(join(ROOT, p)),
    indexText: readFileSync(join(ROOT, INDEX_FILE), 'utf8'),
  });
  if (errors.length) {
    console.error(`wiki-lint: ${errors.length} problema(s)\n` + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`wiki-lint: OK (${files.length} fichas, ${changed.size} tocadas${requireAll ? ', enforcement exigido en todas' : ''})`);
}

main();
