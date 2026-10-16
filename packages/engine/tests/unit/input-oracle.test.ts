import { describe, expect, it } from 'vitest';
import { checkTextAnswer } from '../../src/input/answer.js';
import { PARSERS } from '../../src/input/parsers/index.js';
import type { VariableValue } from '../../src/types.js';

/**
 * Oráculos escritos desde la spec, sin reutilizar nada de `src/input/`: expresiones regulares nativas
 * (aquí el coste no importa, los textos son cortos) y `Date.UTC` para el calendario. Se comparan con los
 * conversores sobre textos hostiles generados con una semilla fija.
 */
const LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
const EMAIL = new RegExp(`^[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+@(${LABEL}(?:\\.${LABEL})+)$`);

function oracleDomain(domain: string): boolean {
  const labels = domain.split('.');
  const last = labels[labels.length - 1]!;
  return labels.length >= 2 && last.length >= 2 && !/^[0-9]+$/.test(last);
}

function oracleEmail(text: string): string | undefined {
  const m = EMAIL.exec(text);
  if (!m || text.length > 254 || !oracleDomain(m[1]!)) return undefined;
  const at = text.indexOf('@');
  return at > 64 ? undefined : `${text.slice(0, at)}@${m[1]!.toLowerCase()}`;
}

function oraclePhone(text: string): string | undefined {
  if (!/^\+?[0-9()\s.-]*$/.test(text)) return undefined;
  const digits = text.replace(/[^0-9]/g, '');
  return digits.length >= 7 && digits.length <= 15 ? (text.startsWith('+') ? '+' : '') + digits : undefined;
}

function oracleNumber(text: string): number | undefined {
  const m = /^([+-]?)([0-9]+)(?:[.,]([0-9]+))?$/.exec(text);
  if (!m) return undefined;
  const [, sign, int, dec = ''] = m as unknown as [string, string, string, string | undefined];
  if (dec.length === 3 && int.length <= 3 && !int.startsWith('0')) return undefined;
  const significant = (int + dec).replace(/^0+/, '').replace(/0+$/, '');
  if (significant === '') return 0;
  if (significant.length > 15) return undefined;
  const value = Number(`${sign === '-' ? '-' : ''}${int}.${dec || '0'}`);
  return Number.isFinite(value) && Math.abs(value) >= 2 ** -1022 ? value : undefined;
}

function oracleDate(text: string): string | undefined {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return undefined;
  const probe = new Date(0);
  probe.setUTCFullYear(y, mo - 1, d); // setUTCFullYear no remapea los años 0-99
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? text : undefined;
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1103515245) + 12345) >>> 0;
    return a / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(rand: Rand, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const repeat = (rand: Rand, min: number, max: number, make: () => string): string =>
  Array.from({ length: min + Math.floor(rand() * (max - min + 1)) }, make).join('');

/** Con probabilidad 0,5 altera el texto: inserta, borra o sustituye un carácter hostil. */
function mutate(rand: Rand, text: string, hostile: readonly string[]): string {
  if (rand() < 0.5) return text;
  const at = Math.floor(rand() * (text.length + 1));
  const c = pick(rand, hostile);
  const kind = Math.floor(rand() * 3);
  return kind === 0 ? text.slice(0, at) + c + text.slice(at) : kind === 1 ? text.slice(0, at) + text.slice(at + 1) : text.slice(0, at) + c + text.slice(at + 1);
}

function generator(seed: number, build: (rand: Rand) => string): () => string {
  const rand = prng(seed);
  return () => build(rand);
}

const LOCAL = ['a', 'Z', '9', '.', '-', '_', '+', '!', '#', "'", '%', '`', '~', '{'];
const HOSTILE = ['@', ' ', 'ñ', '"', '(', ',', '\u0000', '\u00a0', '\u200b', '\u0663', '\uff41', '[', '\\', ':', ';', '<', '/', '\n', '-', '.', '1', 'x', '+'];
const LABELS = ['example', 'EXAMPLE', 'a', 'b9', '9', 'x-y', '-x', 'x-', 'co', 'COM', 'c', '12', '1a', 'xn--abc'];

const buildEmail = (rand: Rand): string => {
  const local = rand() < 0.04 ? 'l'.repeat(63 + Math.floor(rand() * 4)) : repeat(rand, 1, 6, () => pick(rand, LOCAL));
  const domain = repeat(rand, 0, 0, () => '') + Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(rand, LABELS)).join('.');
  const long = rand() < 0.03 ? `.${'d'.repeat(63)}.${'e'.repeat(63)}.${'f'.repeat(60 + Math.floor(rand() * 8))}.co` : '';
  return mutate(rand, `${local}@${domain}${long}`, HOSTILE);
};

const buildPhone = (rand: Rand): string => {
  const digits = Array.from({ length: 4 + Math.floor(rand() * 14) }, () => String(Math.floor(rand() * 10)));
  const seps = [' ', '-', '.', '(', ')', '\u00a0', '\t', ' ', ''];
  const body = digits.map((d) => (rand() < 0.25 ? pick(rand, seps) + d : d)).join('');
  return mutate(rand, (rand() < 0.4 ? '+' : '') + body, ['+', 'x', '\u0663', '/', '_', '\u2003', '\u200b', '\u0000', '\uff11', '#', '*']);
};

const buildNumber = (rand: Rand): string => {
  const digit = () => String(Math.floor(rand() * 10));
  const lead = rand() < 0.3 ? '0'.repeat(1 + Math.floor(rand() * 3)) : '';
  const int = lead + repeat(rand, rand() < 0.2 ? 0 : 1, rand() < 0.2 ? 18 : 5, digit);
  const dec = rand() < 0.6 ? pick(rand, ['.', ',']) + repeat(rand, 0, rand() < 0.2 ? 18 : 4, digit) : '';
  const zeros = rand() < 0.05 ? '0'.repeat(300 + Math.floor(rand() * 20)) : '';
  const tail = rand() < 0.05 ? zeros + '1' : '';
  const text = (pick(rand, ['', '', '', '+', '-']) as string) + int + (dec || '') + (dec ? tail : '');
  return mutate(rand, text, ['e', ' ', '\u0663', '_', '.', ',', '+', '-', 'x', '\uff10']);
};

const buildDate = (rand: Rand): string => {
  const years = ['2024', '2023', '1900', '2000', '2100', '0000', '0001', '0099', '0100', '9999', '2026'];
  const months = ['01', '02', '04', '12', '13', '00', '1', '10'];
  const days = ['28', '29', '30', '31', '32', '00', '01', '5'];
  return mutate(rand, `${pick(rand, years)}-${pick(rand, months)}-${pick(rand, days)}`, ['/', ' ', 'T', '\u0663', '-', '+', '0', '9', '\u2212']);
};

const compare = (
  name: keyof typeof PARSERS,
  oracle: (text: string) => VariableValue | undefined,
  build: (rand: Rand) => string,
  seed: number,
  cases = 30000,
): void => {
  const next = generator(seed, build);
  let accepted = 0;
  for (let i = 0; i < cases; i++) {
    const text = next();
    const expected = oracle(text);
    expect(PARSERS[name](text, 'es'), `${name} ${JSON.stringify(text)}`).toStrictEqual(expected);
    if (expected !== undefined) accepted++;
  }
  expect(accepted / cases, 'el generador no es vacuo').toBeGreaterThan(0.1);
  expect(1 - accepted / cases, 'el generador no es trivial').toBeGreaterThan(0.1);
};

describe('conversores contra un oráculo independiente', () => {
  it('email', () => compare('email', oracleEmail, buildEmail, 11));
  it('phone', () => compare('phone', oraclePhone, buildPhone, 12));
  it('number', () => compare('number', oracleNumber, buildNumber, 13));
  it('date', () => compare('date', oracleDate, buildDate, 14));
});

describe('idempotencia: un valor guardado es un fixpoint de su conversor', () => {
  const idempotent = (name: 'email' | 'phone' | 'url' | 'date', build: (rand: Rand) => string, seed: number): void => {
    const next = generator(seed, build);
    let accepted = 0;
    for (let i = 0; i < 30000; i++) {
      const text = next();
      const value = PARSERS[name](text, 'es');
      if (value === undefined) continue;
      accepted++;
      expect(PARSERS[name](value as string, 'es'), `${name} ${JSON.stringify(text)} → ${JSON.stringify(value)}`).toBe(value);
    }
    expect(accepted).toBeGreaterThan(500);
  };

  it('email', () => idempotent('email', buildEmail, 21));
  it('phone', () => idempotent('phone', buildPhone, 22));
  it('date', () => idempotent('date', buildDate, 23));
  it('url', () =>
    idempotent(
      'url',
      (rand) => {
        const parts = ['example.com', 'Example.COM', 'http://', 'https://', '//', '/', 'a', 'ñ', 'é', '?', '#', '=', '&', ':', '80', '8080', '%', '41', '.', '-', 'xn--', '\u3002', '\uff45', '\u2460', '@', '\\', '[', ']', '\u00df', '1', '0x'];
        return (rand() < 0.5 ? pick(rand, ['', 'http://', 'https://', 'HTTP://', '//']) : '') + pick(rand, ['example.com', 'www.Example.org', 'a.b.cc', 'exámple.com', '1.2.3.4', 'x.io']) + repeat(rand, 0, 5, () => pick(rand, parts));
      },
      24,
    ));
});

describe('el valor guardado nunca supera 4096 unidades ni contiene caracteres no guardables', () => {
  it('sobre textos de cualquier tipo con alfabeto hostil', () => {
    const pool = ['a', '1', '.', '@', ':', '/', '\u0000', '\ud800', '\udc00', '\u{1f600}', 'ñ', ' ', '-', '+', 'example.com', 'x'.repeat(400)];
    const next = generator(31, (rand) => repeat(rand, 1, 8, () => pick(rand, pool)));
    const types = ['text', 'email', 'phone', 'number', 'url', 'date', 'boolean'] as const;
    for (let i = 0; i < 20000; i++) {
      const raw = next().repeat(1 + (i % 7));
      for (const type of types) {
        const result = checkTextAnswer(raw, type, 'es', { program: null });
        if (!result.ok) continue;
        const text = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
        expect(text.length).toBeLessThanOrEqual(4096);
        expect(() => encodeURIComponent(text), `${type} ${JSON.stringify(raw)}`).not.toThrow(); // lanza con un sustituto suelto
        expect(text).not.toContain('\u0000');
      }
    }
  });
});
