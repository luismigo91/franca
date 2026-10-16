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

/**
 * Un literal de expresión regular: una barra que empieza una expresión (tras `(`, `,`, `=`, `:`, `[`,
 * `!`, `&`, `|`, `?`, `{`, `}`, `;` o `return`) y cierra en la misma línea. Una división va tras un
 * identificador, un número o `)`, así que no coincide.
 */
const REGEX_LITERAL = /(?:^|[(,=:[!&|?{};]|\breturn\b)\s*\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/m;

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
  ['Intl', /\bIntl\b/],
  ['toLocale…', /\btoLocale\w*/],
  ['localeCompare', /\blocaleCompare\b/],
];

describe('detector de literales de regex', () => {
  it.each(['const r = /a+/;', 'x.replace(/a/g, "")', 'if (/\\d/.test(c)) {}', 'return /[a/]/u;', 'f(a, /x/)', 'const r = /\\//;'])('detecta %j', (code) => {
    expect(code).toMatch(REGEX_LITERAL);
  });
  it.each(['const half = a / b;', 'const q = (a + 1) / 2 / c;', 'x = n / 2;', 'const url = "https://x.com/a/b";', 'y = [1, 2].length / 4;'])(
    'no confunde %j con una regex',
    (code) => expect(code).not.toMatch(REGEX_LITERAL),
  );
});

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
      'regex/match.ts: codePoint',
    ]);
  });

  it('src/input/ no ejecuta expresiones regulares sobre el texto del usuario', () => {
    const inputFiles = files.filter((f) => f.path.startsWith('input/'));
    expect(inputFiles.length).toBeGreaterThanOrEqual(12);
    for (const f of inputFiles) {
      expect(f.code, `${f.path}: RegExp`).not.toMatch(/\bRegExp\b/);
      expect(f.code, `${f.path}: exec/match/search`).not.toMatch(/\.(exec|match|matchAll|search)\(/);
      if (f.path !== 'input/parsers/chars.ts') expect(f.code, `${f.path}: regex literal`).not.toMatch(REGEX_LITERAL);
    }
    const tests = inputFiles.flatMap((f) => [...f.code.matchAll(/\.test\(([^)]*)\)/g)].map((m) => `${f.path}: ${m[1]}`));
    expect(tests).toEqual(['input/parsers/chars.ts: codePoint']);
  });

  it('src/http/ aplica las mismas reglas que src/input/: filtros de URL, cabeceras y punteros son bucles', () => {
    const httpFiles = files.filter((f) => f.path.startsWith('http/'));
    expect(httpFiles.length).toBeGreaterThanOrEqual(7);
    for (const f of httpFiles) {
      expect(f.code, `${f.path}: RegExp`).not.toMatch(/\bRegExp\b/);
      expect(f.code, `${f.path}: exec/match/search`).not.toMatch(/\.(exec|match|matchAll|search)\(/);
      expect(f.code, `${f.path}: regex literal`).not.toMatch(REGEX_LITERAL);
      expect(f.code, `${f.path}: .test(`).not.toMatch(/\.test\(/);
    }
  });

  it('src/llm/ aplica las reglas de src/input/: nada de regex sobre lo que escribe el usuario o devuelve el modelo', () => {
    const llmFiles = files.filter((f) => f.path.startsWith('llm/'));
    expect(llmFiles.map((f) => f.path).sort()).toEqual([
      'llm/capability.ts',
      'llm/conversation.ts',
      'llm/json-copy.ts',
      'llm/providers.ts',
      'llm/request.ts',
      'llm/result.ts',
      'llm/slots.ts',
      'llm/text.ts',
    ]);
    for (const f of llmFiles) {
      expect(f.code, `${f.path}: RegExp`).not.toMatch(/\bRegExp\b/);
      expect(f.code, `${f.path}: exec/match/search`).not.toMatch(/\.(exec|match|matchAll|search)\(/);
      expect(f.code, `${f.path}: regex literal`).not.toMatch(REGEX_LITERAL);
      expect(f.code, `${f.path}: .test(`).not.toMatch(/\.test\(/);
    }
  });

  it('el catch de src/llm/capability.ts no tiene variable: lo que lanza el host no se mira', () => {
    const capability = files.find((f) => f.path === 'llm/capability.ts');
    expect(capability, 'existe llm/capability.ts').toBeDefined();
    const catches = [...capability!.code.matchAll(/\bcatch\b\s*(\(?)/g)];
    expect(catches.length).toBeGreaterThanOrEqual(2);
    for (const found of catches) expect(found[1], 'catch con variable').toBe('');
  });

  it('src/conformance/ está cubierto por la guarda: sin reloj ni IO (usa harness.now y harness.sleep)', () => {
    const conformanceFiles = files.filter((f) => f.path.startsWith('conformance/'));
    expect(conformanceFiles.map((f) => f.path).sort()).toEqual(['conformance/call.ts', 'conformance/cases.ts', 'conformance/index.ts', 'conformance/types.ts']);
    for (const f of conformanceFiles) {
      expect(f.code, `${f.path}: reloj o temporizador`).not.toMatch(/\b(Date|performance|setTimeout|setInterval|setImmediate)\b/);
      expect(f.code, `${f.path}: IO`).not.toMatch(/\b(fetch|XMLHttpRequest|require)\b|['"`]node:/);
    }
  });

  it('el catch de src/http/capability.ts no tiene variable: lo que lanza el host no se mira', () => {
    const capability = files.find((f) => f.path === 'http/capability.ts');
    expect(capability, 'existe http/capability.ts').toBeDefined();
    const catches = [...capability!.code.matchAll(/\bcatch\b\s*(\(?)/g)];
    expect(catches.length).toBeGreaterThanOrEqual(2);
    for (const found of catches) expect(found[1], 'catch con variable').toBe('');
  });

  it('new RegExp solo se construye para validar la sintaxis y para los átomos', () => {
    const builders = files.filter((f) => /new RegExp\(/.test(f.code)).map((f) => f.path).sort();
    expect(builders).toEqual(['regex/match.ts', 'regex/parse.ts']);
  });
});
