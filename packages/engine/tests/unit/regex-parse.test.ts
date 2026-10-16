import { describe, expect, it } from 'vitest';
import { parseAssumingValid, parsePattern, PatternError, type RegexNode } from '../../src/regex/parse.js';

/** `assumeValid` salta la comprobación nativa: algunas construcciones las rechaza ya el V8 del host (Node 22). */
const reject = (pattern: string, assumeValid = false): PatternError => {
  try {
    (assumeValid ? parseAssumingValid : parsePattern)(pattern);
  } catch (error) {
    expect(error).toBeInstanceOf(PatternError);
    return error as PatternError;
  }
  throw new Error(`se esperaba rechazo de ${pattern}`);
};

const atom = (source: string): RegexNode => ({ type: 'atom', source });

describe('construcciones admitidas', () => {
  it.each<[string, string, RegexNode]>([
    ['literal', 'a', atom('a')],
    ['literal astral', '😀', atom('😀')],
    ['punto', '.', atom('.')],
    ['clase', '[a-c]', atom('[a-c]')],
    ['clase negada con ] escapado', '[^\\]x]', atom('[^\\]x]')],
    ['clase vacía', '[]', atom('[]')],
    ['\\d', '\\d', atom('\\d')],
    ['\\W', '\\W', atom('\\W')],
    ['\\p{L}', '\\p{L}', atom('\\p{L}')],
    ['\\P{Script=Greek}', '\\P{Script=Greek}', atom('\\P{Script=Greek}')],
    ['escape de sintaxis', '\\.', atom('\\.')],
    ['\\n', '\\n', atom('\\n')],
    ['\\xHH', '\\x41', atom('\\x41')],
    ['\\cX', '\\cJ', atom('\\cJ')],
    ['\\0', '\\0', atom('\\0')],
    ['\\uHHHH', '\\u0041', atom('\\u0041')],
    ['\\u{...}', '\\u{1F600}', atom('\\u{1F600}')],
    ['par de sustitutos escapado como un solo átomo', '\\uD83D\\uDE00', atom('\\uD83D\\uDE00')],
    ['^', '^', { type: 'assertion', kind: 'start' }],
    ['$', '$', { type: 'assertion', kind: 'end' }],
    ['\\b', '\\b', { type: 'assertion', kind: 'wordBoundary' }],
    ['\\B', '\\B', { type: 'assertion', kind: 'notWordBoundary' }],
    ['vacío', '', { type: 'empty' }],
    ['secuencia', 'ab', { type: 'sequence', items: [atom('a'), atom('b')] }],
    ['alternativa', 'a|b', { type: 'alternation', options: [atom('a'), atom('b')] }],
    ['alternativa con rama vacía', 'a|', { type: 'alternation', options: [atom('a'), { type: 'empty' }] }],
    ['grupo', '(a)', atom('a')],
    ['grupo sin captura', '(?:a)', atom('a')],
    ['grupo con nombre', '(?<prov>a)', atom('a')],
    ['*', 'a*', { type: 'repeat', node: atom('a'), min: 0, max: Infinity }],
    ['+', 'a+', { type: 'repeat', node: atom('a'), min: 1, max: Infinity }],
    ['?', 'a?', { type: 'repeat', node: atom('a'), min: 0, max: 1 }],
    ['{n}', 'a{3}', { type: 'repeat', node: atom('a'), min: 3, max: 3 }],
    ['{n,}', 'a{3,}', { type: 'repeat', node: atom('a'), min: 3, max: Infinity }],
    ['{n,m}', 'a{2,5}', { type: 'repeat', node: atom('a'), min: 2, max: 5 }],
    ['perezoso *?', 'a*?', { type: 'repeat', node: atom('a'), min: 0, max: Infinity }],
    ['perezoso {n,m}?', 'a{1,2}?', { type: 'repeat', node: atom('a'), min: 1, max: 2 }],
    ['aserción bajo cuantificador', '(?:\\b)*', { type: 'repeat', node: { type: 'assertion', kind: 'wordBoundary' }, min: 0, max: Infinity }],
    ['cuantificador sobre el par de sustitutos', '\\uD83D\\uDE00+', { type: 'repeat', node: atom('\\uD83D\\uDE00'), min: 1, max: Infinity }],
  ])('%s', (_name, pattern, ast) => {
    expect(parsePattern(pattern)).toEqual(ast);
  });

  it('nombres distintos son admitidos', () => {
    expect(() => parsePattern('(?<a>x)(?<b>y)')).not.toThrow();
    expect(() => parsePattern('(?<a>x)(?<\\u0062>y)')).not.toThrow();
  });
});

describe('construcciones rechazadas', () => {
  it.each([
    ['referencia numerada', '(a)\\1', 'referencias hacia atrás'],
    ['referencia \\9', '(a)(b)(c)(d)(e)(f)(g)(h)(i)\\9', 'referencias hacia atrás'],
    ['referencia con nombre', '(?<x>a)\\k<x>', 'referencias hacia atrás'],
    ['lookahead positivo', 'a(?=a)', 'lookahead'],
    ['lookahead negativo', 'a(?!a)', 'lookahead'],
    ['lookbehind positivo', '(?<=a)a', 'lookbehind'],
    ['lookbehind negativo', '(?<!a)a', 'lookbehind'],
  ])('%s', (_name, pattern, reason) => {
    const error = reject(pattern);
    expect(error.kind).toBe('unsupported');
    expect(error.message).toContain(reason);
  });

  // Estas las rechaza ya el motor nativo según la versión de V8; el parser las rechaza por su cuenta
  // para que el resultado no dependa de si una versión futura las admite.
  it.each([
    ['modificador en línea', '(?i:a)', 'modificadores'],
    ['modificador que quita flags', '(?-i:a)', 'modificadores'],
    ['nombres repetidos', '(?<x>a)|(?<x>b)', 'repetidos'],
    ['nombres repetidos con un escape', '(?<a>x)(?<\\u0061>y)', 'repetidos'],
    ['nombres repetidos con \\u{...}', '(?<a>x)(?<\\u{61}>y)', 'repetidos'],
    ['nombres repetidos con sustitutos', '(?<\\uD835\\uDC9C>x)(?<\\u{1D49C}>y)', 'repetidos'],
    ['nombres repetidos con carácter literal', '(?<𝒜>x)(?<\\u{1D49C}>y)', 'repetidos'],
  ])('%s (sin la comprobación nativa)', (_name, pattern, reason) => {
    const error = reject(pattern, true);
    expect(error.kind).toBe('unsupported');
    expect(error.message).toContain(reason);
  });

  it.each([
    ['modificador en línea', '(?i:a)'],
    ['nombres repetidos', '(?<x>a)|(?<x>b)'],
    ['nombres repetidos con un escape', '(?<a>x)(?<\\u0061>y)'],
  ])('%s se rechaza también con la comprobación nativa', (_name, pattern) => {
    expect(['invalid', 'unsupported']).toContain(reject(pattern).kind);
  });

  it.each(['(', ')', 'a)', '[', '*a', 'a{2,1}', '\\', '(?<x', '\\u{110000}', '{', 'a**'])(
    'sintaxis inválida %j',
    (pattern) => {
      expect(reject(pattern).kind).toBe('invalid');
    },
  );

  it('un \\1 sin grupo es inválido en modo Unicode (no una referencia)', () => {
    expect(reject('\\1').kind).toBe('invalid');
  });
});
