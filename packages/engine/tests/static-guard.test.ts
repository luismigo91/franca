import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url);

function sourceFiles(dir: URL = SRC): { path: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) return sourceFiles(url);
    return entry.name.endsWith('.ts') ? [{ path: url.pathname.split('/src/')[1]!, code: stripComments(readFileSync(url, 'utf8')) }] : [];
  });
}

/** Quita comentarios de bloque y de línea (un `//` precedido por `:` es parte de una URL). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Tokens prohibidos en src/ (D10): reloj, aleatoriedad, entorno, red, disco, consola y temporizadores. */
const FORBIDDEN: [string, RegExp][] = [
  ['Date', /\bDate\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['performance', /\bperformance\b/],
  ['process', /\bprocess\b/],
  ['console', /\bconsole\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['setImmediate', /\bsetImmediate\b/],
  ['queueMicrotask', /\bqueueMicrotask\b/],
  ['fetch', /\bfetch\b/],
  ['crypto', /\bcrypto\b/],
  ['globalThis', /\bglobalThis\b/],
  ['import node:', /['"`]node:/],
  ['require', /\brequire\s*\(/],
  ['import()', /\bimport\s*\(/],
];

describe('guarda estática de src/', () => {
  const files = sourceFiles();

  it('hay código que revisar', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(FORBIDDEN)('ningún fichero usa %s', (name, token) => {
    const offenders = files.filter((f) => token.test(f.code)).map((f) => f.path);
    expect(offenders, `${name} en ${offenders.join(', ')}`).toEqual([]);
  });

  it('no hay estado de módulo mutable (let / var en el ámbito superior)', () => {
    const offenders = files.filter((f) => /^(let|var)\s/m.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('el patrón del autor no se ejecuta con el motor nativo: sin .exec/.match y .test solo sobre un code point', () => {
    const regexFiles = files.filter((f) => f.path.startsWith('regex/') || f.path === 'predicates.ts');
    for (const f of regexFiles) expect(f.code, f.path).not.toMatch(/\.(exec|match|matchAll)\(/);
    const tests = regexFiles.flatMap((f) => [...f.code.matchAll(/\.test\(([^)]*)\)/g)].map((m) => `${f.path}: ${m[1]}`));
    expect(tests.sort()).toEqual([
      'predicates.ts: text',
      'regex/match.ts: c',
      'regex/match.ts: chars[pos]!',
    ]);
  });

  it('new RegExp solo se construye para validar la sintaxis y para los átomos', () => {
    const builders = files.filter((f) => /new RegExp\(/.test(f.code)).map((f) => f.path).sort();
    expect(builders).toEqual(['regex/match.ts', 'regex/parse.ts']);
  });
});
