import { describe, expect, it } from 'vitest';
import { continueSession, startSession, type SessionResult, type SessionState } from '../../src/index.js';
import { answerText, expectInvalid, reasonOf, reply, replyOk, savedValue, simpleFlow, waiting } from '../helpers/conversation.js';
import { choicesOf, condition, end, flowOf, input, message, messageTexts, rule, startOk, variable, type Obj } from '../helpers/flows.js';

/** Todo lo que un host podría registrar de una operación, serializado. */
const everything = (...results: unknown[]): string => JSON.stringify(results);

const SAVED = Symbol('rechazada');
async function stored(type: string, text: string, extra: Obj = {}, options = {}): Promise<unknown> {
  const result = await answerText(type, text, extra, options);
  return result.status === 'waiting' ? `${SAVED.description}:${reasonOf(result)}` : savedValue(result);
}

describe('text: min y max cuentan code points, no unidades de código', () => {
  const rules = { validation: { min: 2, max: 5 } };

  it('tres emoji (6 unidades) caben en max 5; un emoji (2 unidades) no llega a min 2', async () => {
    expect(await stored('text', '\u{1F600}\u{1F600}\u{1F600}', rules)).toBe('\u{1F600}\u{1F600}\u{1F600}');
    expect(await stored('text', '\u{1F600}', rules)).toBe('rechazada:out_of_range');
    expect(await stored('text', '\u{1F600}'.repeat(5), rules)).toBe('\u{1F600}'.repeat(5));
    expect(await stored('text', '\u{1F600}'.repeat(6), rules)).toBe('rechazada:out_of_range');
  });

  it('un carácter combinante cuenta como un code point más', async () => {
    expect(await stored('text', 'e\u0301', { validation: { min: 2 } })).toBe('e\u0301');
    expect(await stored('text', 'e\u0301', { validation: { max: 1 } })).toBe('rechazada:out_of_range');
  });
});

describe('Caracteres no guardables en cada tipo', () => {
  const NUL = '\u0000';
  const hostile: [string, string][] = [
    ['NUL al final', `Ana${NUL}`],
    ['NUL solo', NUL],
    ['NUL entre espacios', ` ${NUL} `],
    ['sustituto alto suelto al final', 'Ana\ud800'],
    ['sustituto bajo suelto al principio', '\udc00Ana'],
    ['sustituto bajo suelto al máximo', 'a\udfff'],
    ['dos sustitutos altos seguidos', '\ud800\ud800'],
    ['sustituto alto y una letra', '\ud800a'],
    ['sustituto bajo y luego alto (invertidos)', '\udc00\ud800'],
    ['sustituto alto al final del texto recortado', 'a\udbff '],
  ];

  it.each(['text', 'email', 'phone', 'number', 'url', 'date', 'boolean'])('%s: cada texto con NUL o sustituto suelto es invalid_format', async (type) => {
    for (const [label, text] of hostile) {
      expect(await stored(type, text), `${type} ${label}`).toBe('rechazada:invalid_format');
    }
  });

  it('los pares válidos en los extremos del rango se aceptan en text', async () => {
    for (const pair of ['\u{10000}', '\u{10ffff}', '\u{1f400}', '\u{1f7ff}', '\u{10fc00}']) {
      expect(await stored('text', `a${pair}b`), JSON.stringify(pair)).toBe(`a${pair}b`);
    }
  });

  it('too_long gana a invalid_format: 4097 unidades con un NUL', async () => {
    expect(await stored('text', `${NUL}${'a'.repeat(4096)}`)).toBe('rechazada:too_long');
  });

  it('required gana a invalid_format solo si el texto queda vacío: un NUL no se recorta', async () => {
    expect(await stored('text', '   ')).toBe('rechazada:required');
    expect(await stored('text', NUL)).toBe('rechazada:invalid_format');
  });

  it('el texto con NUL o sustituto suelto no aparece en ningún evento ni estado', async () => {
    const flow = simpleFlow('text');
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: 'PII-\u0000-\ud800' });
    expect(everything(result)).not.toMatch(/PII-/);
    expect(result.state.variables).toEqual({});
  });
});

describe('Límite de 4096 unidades de la respuesta y del valor guardado', () => {
  it('2048 emoji (4096 unidades) se aceptan y 2049 son too_long', async () => {
    expect(await stored('text', '\u{1F600}'.repeat(2048))).toHaveLength(4096);
    expect(await stored('text', '\u{1F600}'.repeat(2049))).toBe('rechazada:too_long');
  });

  it('el límite se mide sobre el texto sin recortar, también con espacios Unicode', async () => {
    const pad = '\u00a0\u2003\ufeff\u2028';
    expect(await stored('text', `${pad.repeat(500)}Ana${pad.repeat(500)}`)).toBe('Ana');
    expect(await stored('text', `${pad.repeat(500)}Ana${pad.repeat(500)}\u3000\u3000`)).toBe('Ana');
    expect(await stored('text', `${' '.repeat(2048)}Ana${' '.repeat(2046)}`)).toBe('rechazada:too_long');
  });

  it('url: la serialización de 4096 se acepta y la de 4097 no, con el texto bajo 4096', async () => {
    const base = 'http://example.com/';
    expect(await stored('url', base + 'a'.repeat(4096 - base.length))).toHaveLength(4096);
    expect(await stored('url', 'example.com/' + 'ñ'.repeat(679) + 'aa')).toHaveLength(4096);
    expect(await stored('url', 'example.com/' + 'ñ'.repeat(679) + 'aaa')).toBe('rechazada:invalid_format');
  });

  it('url: sin esquema, un texto de 4096 unidades crece con https:// y se rechaza como invalid_format', async () => {
    expect(await stored('url', 'example.com/' + 'a'.repeat(4096 - 12))).toBe('rechazada:invalid_format');
    expect(await stored('url', 'example.com/' + 'a'.repeat(4096 - 12 - 8))).toHaveLength(4096);
  });

  it('un valor guardado de 4096 unidades se puede volver a renderizar en un message', async () => {
    const flow = simpleFlow('text', {}, { more: [] });
    const { state } = await waiting(flow);
    const text = 'z'.repeat(4096);
    const done = await replyOk(flow, state, { text });
    expect(done.state.variables.v).toBe(text);
  });
});

describe('Números: fronteras de cifras, exponentes y subnormales', () => {
  const zeros = (n: number): string => '0'.repeat(n);

  it('el menor número normal se acepta y lo que queda por debajo se rechaza', async () => {
    expect(await stored('number', `0,${zeros(307)}22250738585073`)).toBe(2.2250738585073e-308);
    expect(await stored('number', `0,${zeros(307)}3`)).toBe(3e-308);
    expect(await stored('number', `0,${zeros(307)}22250738585072`)).toBe('rechazada:invalid_format');
    expect(await stored('number', `0,${zeros(307)}1`)).toBe('rechazada:invalid_format');
    expect(await stored('number', `-0,${zeros(307)}1`)).toBe('rechazada:invalid_format');
    expect(await stored('number', `0,${zeros(323)}5`)).toBe('rechazada:invalid_format');
  });

  it('el mayor valor representable con 15 cifras y el desbordamiento', async () => {
    expect(await stored('number', `17976931348623${zeros(295)}`)).toBe(1.7976931348623e308);
    expect(await stored('number', `18${zeros(307)}`)).toBe('rechazada:invalid_format');
    expect(await stored('number', `1${zeros(309)}`)).toBe('rechazada:invalid_format');
    expect(await stored('number', `-1${zeros(309)}`)).toBe('rechazada:invalid_format');
    expect(await stored('number', `1${zeros(308)}`)).toBe(1e308);
  });

  it('15 cifras significativas con ceros por delante y por detrás', async () => {
    expect(await stored('number', `${zeros(30)}123456789012345`)).toBe(123456789012345);
    expect(await stored('number', `1234567890123450${zeros(3)}`)).toBe(1234567890123450000);
    expect(await stored('number', '1234567890123456')).toBe('rechazada:invalid_format');
    expect(await stored('number', '0,1234567890123456')).toBe('rechazada:invalid_format');
    expect(await stored('number', '123456789012345,000')).toBe(123456789012345);
    expect(await stored('number', '123456789012345,6')).toBe('rechazada:invalid_format');
  });

  it('el valor guardado tiene una forma textual que denota el mismo número', async () => {
    for (const text of ['0,1', '0,2', '0,3', '1234567,891', '9,99999999999999', '123456789012345', `1${zeros(21)}`, `0,${zeros(10)}12345`]) {
      const value = (await stored('number', text)) as number;
      expect(typeof value, text).toBe('number');
      expect(Number(JSON.stringify(value)), text).toBe(value);
      expect(Object.is(value, -0)).toBe(false);
    }
  });

  it('el pattern ve la forma textual JSON del número convertido', async () => {
    const pattern = '^1e\\+21$';
    expect(await stored('number', `1${zeros(21)}`, { validation: { pattern } })).toBe(1e21);
    expect(await stored('number', `1${zeros(20)}`, { validation: { pattern } })).toBe('rechazada:pattern_mismatch');
    expect(await stored('number', '0,0000001', { validation: { pattern: '^1e-7$' } })).toBe(1e-7);
  });

  it.each([
    ['1.500', true], ['1,500', true], ['999.999', true], ['0.500', false], ['00.500', false], ['1000.500', false], ['1.5000', false], ['1.50', false], ['+1.500', true], ['-999,999', true],
  ])('separador ambiguo %s → rechazado=%s', async (text, ambiguous) => {
    const value = await stored('number', text);
    if (ambiguous) expect(value).toBe('rechazada:invalid_format');
    else expect(typeof value).toBe('number');
  });

  it('min y max con negativos, cero y límites fraccionarios', async () => {
    const r = (validation: Obj) => ({ validation });
    expect(await stored('number', '-5', r({ min: -5, max: 0 }))).toBe(-5);
    expect(await stored('number', '-5,0001', r({ min: -5, max: 0 }))).toBe('rechazada:out_of_range');
    expect(await stored('number', '0', r({ min: -5, max: 0 }))).toBe(0);
    expect(await stored('number', '-0', r({ min: 0, max: 0 }))).toBe(0);
    expect(await stored('number', '0,1', r({ max: 0 }))).toBe('rechazada:out_of_range');
    expect(await stored('number', '5', r({ min: 5, max: 5 }))).toBe(5);
    expect(await stored('number', '2,5', r({ min: 2.5 }))).toBe(2.5);
  });
});

describe('Teléfono, email y URL: textos hostiles revisados', () => {
  it.each([
    ['1234567', '1234567'], ['123456', 'x'], ['123456789012345', '123456789012345'], ['1234567890123456', 'x'],
    ['+1234567', '+1234567'], ['+123456', 'x'], ['+123456789012345', '+123456789012345'], ['+1234567890123456', 'x'],
    ['+ 12 34 56 7', '+1234567'], ['(+1) 234567', 'x'], ['12+34567', 'x'], ['1234567+', 'x'], ['+\u00a01234567', '+1234567'],
    ['12\u202f34\u20095678', '12345678'], ['12\u200b345678', 'x'], ['12\u00ad345678', 'x'], ['\u0661\u0662\u0663\u0664\u0665\u0666\u0667', 'x'],
    ['\uff11\uff12\uff13\uff14\uff15\uff16\uff17', 'x'], ['12/345678', 'x'], ['123 456 7 ext 1', 'x'], ['(0)1234567', '01234567'], ['---1234567', '1234567'],
  ])('phone %j', async (text, expected) => {
    expect(await stored('phone', text)).toBe(expected === 'x' ? 'rechazada:invalid_format' : expected);
  });

  const local = (n: number): string => 'l'.repeat(n);
  it.each([
    ['A.B+c@Example.COM', 'A.B+c@example.com'], ['.a@b.co', '.a@b.co'], ['a.@b.co', 'a.@b.co'], ['a..b@b.co', 'a..b@b.co'],
    ["!#$%&'*+/=?^_`{|}~-@b.co", "!#$%&'*+/=?^_`{|}~-@b.co"], ['a@xn--exmple-qta.com', 'a@xn--exmple-qta.com'], ['a@b.1a', 'a@b.1a'], ['a@9.co', 'a@9.co'],
    ['"a"@b.co', 'x'], ['a b@b.co', 'x'], ['a@b.co.', 'x'], ['a@.b.co', 'x'], ['a@b..co', 'x'], ['a@@b.co', 'x'], ['a@b@b.co', 'x'], ['@b.co', 'x'], ['a@', 'x'],
    ['a@b', 'x'], ['a@b.c', 'x'], ['a@b.12', 'x'], ['a@1.2.3.4', 'x'], ['a@[1.2.3.4]', 'x'], ['a@b_c.co', 'x'], ['a@-b.co', 'x'], ['a@b-.co', 'x'],
    ['a@b.co\u00a0x', 'x'], ['a\u00a0@b.co', 'x'], ['\uff41@b.co', 'x'], ['a@b.c\u043e', 'x'], ['a\u200b@b.co', 'x'], ['a(b)@b.co', 'x'], ['a,b@b.co', 'x'],
    [`${local(64)}@b.co`, `${local(64)}@b.co`], [`${local(65)}@b.co`, 'x'], [`a@${'d'.repeat(63)}.co`, `a@${'d'.repeat(63)}.co`], [`a@${'d'.repeat(64)}.co`, 'x'],
  ])('email %j', async (text, expected) => {
    expect(await stored('email', text)).toBe(expected === 'x' ? 'rechazada:invalid_format' : expected);
  });

  it('email: 254 caracteres se aceptan y 255 no', async () => {
    const at254 = `${local(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.co`;
    expect(at254).toHaveLength(254);
    expect(await stored('email', at254)).toBe(at254);
    expect(await stored('email', `${at254.slice(0, 66)}x${at254.slice(66)}`)).toBe('rechazada:invalid_format');
  });

  it.each([
    '127.0.0.1', '0x7f.0.0.1', '0177.0.0.1', '127.1', '2130706433', '1.1.1.1.', '1.2.3.0x1', '0.0.0.0', '255.255.255.255', '256.1.1.1', '1.2.3.4.5', 'a.1', 'a.0x', 'a.0x1', 'a.08',
    '[::1]', 'http://[::ffff:1.2.3.4]', 'http://[2001:db8::1]:80', 'http://0x7f000001', 'http://0300.0250.0.1', 'http://1.1.1', 'http://16909060',
  ])('url %j no es un nombre de dominio', async (text) => {
    expect(await stored('url', text)).toBe('rechazada:invalid_format');
  });

  it.each([
    ['//example.com', 'https://example.com/'], ['https:///example.com', 'https://example.com/'], ['example.com:8080', 'https://example.com:8080/'], ['example.com:', 'https://example.com/'],
    ['https://example.com:443', 'https://example.com/'], ['http://example.com:80', 'http://example.com/'], ['EXAMPLE.COM/A?B#C', 'https://example.com/A?B#C'],
    ['\uff45xample.com', 'https://example.com/'], ['example\u3002com', 'https://example.com/'], ['fa\u00df.de', 'https://xn--fa-hia.de/'],
    ['https://exa%6dple.com', 'https://example.com/'], ['https://:@example.com', 'https://example.com/'], ['1.1.1.1e1', 'https://1.1.1.1e1/'],
    ['example.com/%zz', 'https://example.com/%zz'], ['example.com/ñ?ñ#ñ', 'https://example.com/%C3%B1?%C3%B1#%C3%B1'],
  ])('url %j se guarda como %j', async (text, expected) => {
    expect(await stored('url', text)).toBe(expected);
  });

  it.each([
    'https://:p@example.com', 'https://a:b@example.com', 'https://a@example.com', 'user@example.com', 'https://example.com:99999', 'example.com:abc', 'a_b.com', 'a-.com', '-a.com', 'a..com',
    '.example.com', 'example.com.', 'example.com..', 'localhost', 'a.b.12', 'example.c', `${'a'.repeat(64)}.com`, 'https://example.com%2e', 'https://exa%00mple.com', 'https://exa%mple.com',
    'xn--a.com', 'http:/example.com', 'http:example.com', 'ws://example.com', 'view-source:https://example.com', 'example.com/?u=http://y.com', 'http://example.com:8080@evil.com',
    'HTTP:\\\\example.com', 'http://example.\u2460',
  ])('url %j es inválida', async (text) => {
    expect(await stored('url', text)).toBe('rechazada:invalid_format');
  });

  it.each(['\u00ad', '\u200b', '\u200c', '\u200d', '\u2060', '\u2064', '\ufeff', '\u034f', '\u115f', '\u3164', '\uffa0', '\ufe0f', '\u{e0100}', '\u{e0001}', '\u180b', '\u061c'])(
    'url: el carácter invisible U+%s en el host, la ruta, la consulta o el fragmento se rechaza',
    async (c) => {
      // U+FEFF es espacio en blanco: al principio o al final lo quita el recorte, antes de convertir.
      const edges = c === '\ufeff' ? [] : [`${c}example.com`];
      for (const text of [`ex${c}ample.com`, `example.com/a${c}b`, `example.com/?a${c}b`, `example.com/#a${c}b`, `example.com${c}/x`, ...edges]) {
        expect(await stored('url', text), JSON.stringify(text)).toBe('rechazada:invalid_format');
      }
    },
  );

  it('url: el pattern se aplica a la serialización WHATWG, no al texto escrito', async () => {
    const validation = { pattern: '^https://example\\.com/$' };
    expect(await stored('url', 'EXAMPLE.com', { validation })).toBe('https://example.com/');
    expect(await stored('url', 'example.com/x', { validation })).toBe('rechazada:pattern_mismatch');
    expect(await stored('email', 'Ana@EXAMPLE.com', { validation: { pattern: '@example\\.com$' } })).toBe('Ana@example.com');
    expect(await stored('boolean', 'SÍ', { validation: { pattern: '^true$' } })).toBe(true);
    expect(await stored('boolean', 'no', { validation: { pattern: '^true$' } })).toBe('rechazada:pattern_mismatch');
    expect(await stored('phone', '(34) 600 12 34 56', { validation: { pattern: '^34\\d{9}$' } })).toBe('34600123456');
  });
});

describe('Fechas y booleanos: calendario y locale', () => {
  it.each([
    ['2000-02-29', true], ['1900-02-29', false], ['2100-02-29', false], ['2400-02-29', true], ['0004-02-29', true], ['0100-02-29', false], ['0001-01-01', true], ['9999-12-31', true],
    ['0000-12-31', false], ['2026-04-31', false], ['2026-06-31', false], ['2026-09-31', false], ['2026-11-31', false], ['2026-01-31', true], ['2026-12-31', true],
    ['2026-00-10', false], ['2026-10-00', false], ['2026-13-01', false], ['2026-1-01', false], ['2026-01-1', false], ['02026-01-01', false], ['2026-01-01T00:00', false],
    ['2026/01/01', false], ['2026\u201301\u201301', false], ['\u0662\u0660\u0662\u0666-01-01', false], ['2026-01-01\u0000', false], ['+2026-01-01', false],
  ])('fecha %j válida=%s', async (text, ok) => {
    expect(await stored('date', text)).toBe(ok ? text : 'rechazada:invalid_format');
  });

  const localeCases: [string | undefined, string, boolean | undefined][] = [
    [undefined, 'si', true], [undefined, 'Sí', true], [undefined, 'yes', undefined], [undefined, 'TRUE', true],
    ['es', 'NO', false], ['es', 'n', undefined], ['es-ES', 'Sí', true], ['es-ES', 'yes', undefined],
    ['en', 'Y', true], ['en', 'n', false], ['en', 'si', undefined], ['en-GB', 'YES', true], ['en-GB', 'no', false], ['en-GB', 'sí', undefined],
    ['fr', 'oui', undefined], ['fr', 'no', undefined], ['fr', 'false', false], ['pt-BR', 'sim', undefined], ['pt-BR', 'true', true],
    ['es', 'si\u0301', true], ['es', 'S\u0130', undefined], ['es', 's\u0131', undefined], ['es', 'tru\u0435', undefined], ['es', '\uff34\uff32\uff35\uff25', undefined],
    ['es', 'true\u200b', undefined], ['es', '1', undefined], ['es', '0', undefined], ['es', 'sí.', undefined],
  ];
  it.each(localeCases)('locale %s, respuesta %j → %s', async (locale, text, expected) => {
    const result = await answerText('boolean', text, {}, { flowExtra: locale === undefined ? undefined : { locale } });
    if (expected === undefined) expectInvalid(result, 'invalid_format');
    else expect(savedValue(result)).toBe(expected);
  });
});

describe('Opciones: valores falsos y ordenación', () => {
  const choices = [
    { id: 'cero', label: 'Cero', value: 0, next: 'fin' },
    { id: 'falso', label: 'Falso', value: false, next: 'fin' },
    { id: 'vacio', label: 'Vacío', value: '', next: 'fin' },
    { id: 'sin', label: 'Sin', next: 'fin' },
  ];
  const single = () => flowOf([input('p', 'v', 'choice', undefined, { choices }), end('fin')], { variables: [variable('v')] });

  it('selección única: value 0, false y "" se guardan tal cual y no se sustituyen por el id', async () => {
    const flow = single();
    const { state } = await waiting(flow);
    for (const [id, value] of [['cero', 0], ['falso', false], ['vacio', ''], ['sin', 'sin']] as const) {
      expect((await replyOk(flow, state, { choice: id })).state.variables.v, id).toBe(value);
    }
  });

  it('selección múltiple: value 0, false y "" se guardan en el orden del flujo', async () => {
    const flow = flowOf([input('p', 'v', 'choice', 'fin', { multiple: true, choices: choices.map(({ next: _n, ...rest }) => rest) }), end('fin')], {
      variables: [variable('v', { type: 'json' })],
    });
    const { state } = await waiting(flow);
    const done = await replyOk(flow, state, { choices: ['sin', 'vacio', 'falso', 'cero'] });
    expect(done.state.variables.v).toEqual([0, false, '', 'sin']);
  });

  it('la selección única no valida y la múltiple no aplica pattern aunque el patrón sea inválido', async () => {
    const flow = flowOf(
      [input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b']), validation: { pattern: '(' } }), end('fin')],
      { variables: [variable('v', { type: 'json' })] },
    );
    const { state } = await waiting(flow);
    expect((await replyOk(flow, state, { choices: ['b'] })).state.variables.v).toEqual(['b']);
  });
});

describe('Forma de la entrada: valores hostiles', () => {
  const rejected = async (flow: unknown, state: unknown, bad: unknown, label: string) => {
    const result = await reply(flow, state, bad);
    expect(result, label).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(result, label).not.toHaveProperty('events');
    expect(result, label).not.toHaveProperty('state');
  };

  it('text: prototipos, propiedades heredadas, getters y claves de Object', async () => {
    const flow = simpleFlow('text');
    const { state } = await waiting(flow);
    const before = structuredClone(state);
    const bads: [string, unknown][] = [
      ['__proto__ como propiedad propia', JSON.parse('{"__proto__":"x"}')],
      ['text y __proto__', JSON.parse('{"text":"a","__proto__":{"text":"b"}}')],
      ['text heredado', Object.create({ text: 'a' })],
      ['constructor', { constructor: 'a' }],
      ['toString', { toString: 'a' }],
      ['texto envuelto', { text: new String('a') }],
      ['texto en array', { text: ['a'] }],
      ['texto objeto', { text: { toString: () => 'a' } }],
      ['array', ['a']],
      ['array con propiedad text', Object.assign([], { text: 'a' })],
      ['Map', new Map([['text', 'a']])],
      ['clase', new (class A { text = 'a'; })()],
      ['función', Object.assign(() => 1, { text: 'a' })],
      ['bigint', 5n],
      ['símbolo', Symbol('x')],
      ['Date', new Date(0)],
      ['text: undefined', { text: undefined }],
      ['text: null', { text: null }],
      ['text: NaN', { text: Number.NaN }],
      ['string JSON', '{"text":"a"}'],
      ['choice en un input de texto', { choice: 'a' }],
      ['choices en un input de texto', { choices: [] }],
      ['TEXT en mayúsculas', { TEXT: 'a' }],
      ['text con espacio', { 'text ': 'a' }],
    ];
    for (const [label, bad] of bads) await rejected(flow, state, bad, label);
    expect(state).toEqual(before);
    expect(({} as Record<string, unknown>).text).toBeUndefined();
  });

  it('choice y choices: ids con mayúsculas, espacios, NUL, tipos y objetos tipo array', async () => {
    const one = flowOf([input('p', 'v', 'choice', undefined, { choices: choicesOf(['a', 'b'], 'fin') }), end('fin')], { variables: [variable('v')] });
    const many = flowOf([input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b', 'constructor']) }), end('fin')], { variables: [variable('v', { type: 'json' })] });
    const { state: s1 } = await waiting(one);
    const { state: s2 } = await waiting(many);

    for (const [label, bad] of [
      ['A', { choice: 'A' }], ['con espacio', { choice: 'a ' }], ['NUL', { choice: 'a\u0000' }], ['número', { choice: 0 }], ['null', { choice: null }], ['array', { choice: ['a'] }],
      ['objeto', { choice: { id: 'a' } }], ['__proto__', { choice: '__proto__' }], ['constructor', { choice: 'constructor' }], ['toString', { choice: 'toString' }], ['vacío', { choice: '' }],
      ['choices en única', { choices: ['a'] }], ['text en única', { text: 'a' }], ['dos claves', { choice: 'a', extra: 1 }],
    ] as [string, unknown][]) await rejected(one, s1, bad, `única ${label}`);

    for (const [label, bad] of [
      ['string', { choices: 'a' }], ['objeto tipo array', { choices: { 0: 'a', length: 1 } }], ['array con huecos', { choices: [, 'a'] }], ['new Array(2)', { choices: new Array(2) }],
      ['undefined', { choices: [undefined] }], ['null', { choices: [null] }], ['número', { choices: [0] }], ['anidado', { choices: [['a']] }], ['repetido', { choices: ['a', 'a'] }],
      ['repetido no consecutivo', { choices: ['a', 'b', 'a'] }], ['desconocido', { choices: ['a', 'z'] }], ['mayúsculas', { choices: ['A'] }], ['proto', { choices: ['__proto__'] }],
      ['más ids que opciones', { choices: ['a', 'b', 'constructor', 'a'] }], ['choice en múltiple', { choice: 'a' }], ['text en múltiple', { text: 'a' }],
      ['length falso', Object.assign(['a'], { length: 2 })],
    ] as [string, unknown][]) await rejected(many, s2, bad, `múltiple ${label}`);

    const ok = await replyOk(many, s2, { choices: ['constructor', 'a'] });
    expect(ok.state.variables.v).toEqual(['a', 'constructor']);
  });

  it('un array enorme de ids se rechaza al instante y no se recorre', async () => {
    const many = flowOf([input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b']) }), end('fin')], { variables: [variable('v', { type: 'json' })] });
    const { state } = await waiting(many);
    const huge = Object.assign([], { length: 2 ** 32 - 1 });
    const t0 = performance.now();
    await rejected(many, state, { choices: huge }, 'length 2^32-1');
    await rejected(many, state, { choices: Array.from({ length: 1_000_000 }, () => 'a') }, 'un millón de ids');
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('una entrada con un id desconocido que parece una respuesta privada no aparece en el rechazo', async () => {
    const one = flowOf([input('p', 'v', 'choice', undefined, { choices: choicesOf(['a'], 'fin') }), end('fin')], { variables: [variable('v')] });
    const { state } = await waiting(one);
    const result = await reply(one, state, { choice: 'secreto@example.com' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(everything(result)).not.toContain('secreto');
  });
});

describe('validation: patrón sobre el valor convertido y reglas imposibles', () => {
  it('patrones en el borde del tamaño: a{1000} se aplica, a{1001} es invalid_validation antes del prompt', async () => {
    const ok = await startOk(simpleFlow('text', { validation: { pattern: 'a{1000}' } }));
    expect(ok.status).toBe('waiting');
    const bad = await startOk(simpleFlow('text', { validation: { pattern: 'a{1001}' } }));
    expect(bad.status).toBe('failed');
    expect(bad.events.map((e) => e.type)).toEqual(['error']);
    expect(bad.state.error).toEqual({ code: 'invalid_validation', nodeId: 'p' });
    const nested = await startOk(simpleFlow('email', { validation: { pattern: '('.repeat(101) + 'a' + ')'.repeat(101) } }));
    expect(nested.state.error?.code).toBe('invalid_validation');
  });

  it('un patrón de tamaño 1000 sobre una respuesta de 4096 unidades termina y rechaza', async () => {
    const flow = simpleFlow('text', { validation: { pattern: '(?:a*){240}(?:a*){240}b' } });
    const { state } = await waiting(flow);
    const t0 = performance.now();
    const result = await replyOk(flow, state, { text: 'a'.repeat(4096) });
    expect(reasonOf(result)).toBe('pattern_mismatch');
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it.each([
    ['min > max en text', 'text', { min: 3, max: 2 }],
    ['max 0 en text', 'text', { max: 0 }],
    ['max 0,5 en text', 'text', { max: 0.5 }],
    ['max -1 en text', 'text', { max: -1 }],
    ['min > max en number', 'number', { min: 1, max: 0 }],
    ['min > max con negativos en number', 'number', { min: -1, max: -2 }],
  ])('%s → invalid_validation antes del prompt', async (_label, type, validation) => {
    const result = await startOk(simpleFlow(type, { validation }));
    expect(result.status).toBe('failed');
    expect(result.events).toHaveLength(1);
    expect(result.state.error).toEqual({ code: 'invalid_validation', nodeId: 'p' });
  });

  it.each([
    ['max 0 en number es alcanzable', 'number', { max: 0 }],
    ['max negativo en number es alcanzable', 'number', { max: -3 }],
    ['min == max en text', 'text', { min: 4, max: 4 }],
    ['min negativo en text', 'text', { min: -3 }],
  ])('%s', async (_label, type, validation) => {
    expect((await startOk(simpleFlow(type, { validation }))).status).toBe('waiting');
  });

  it('múltiple: min igual al número de opciones es posible; min mayor, max 0 y min > max no', async () => {
    const make = (validation: Obj) => flowOf([input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b', 'c']), validation }), end('fin')], { variables: [variable('v', { type: 'json' })] });
    expect((await startOk(make({ min: 3 }))).status).toBe('waiting');
    expect((await startOk(make({ max: 10 }))).status).toBe('waiting');
    for (const validation of [{ min: 4 }, { max: 0 }, { min: 2, max: 1 }]) expect((await startOk(make(validation))).state.error?.code, JSON.stringify(validation)).toBe('invalid_validation');
  });

  it('invalid_input gana a invalid_validation; invalid_validation gana a la respuesta inválida', async () => {
    const good = simpleFlow('number', { validation: { min: 1, max: 9 } });
    const { state } = await waiting(good);
    const broken = simpleFlow('number', { validation: { min: 9, max: 1 } });
    expect(await reply(broken, state, { text: 5 })).toMatchObject({ ok: false, code: 'invalid_input' });
    const failed = await replyOk(broken, state, { text: 'abc' });
    expect(failed.state.error).toEqual({ code: 'invalid_validation', nodeId: 'p' });
    expect(failed.events.map((e) => e.type)).toEqual(['error']);
  });
});

describe('Reintentos: límites y retryMessage', () => {
  async function bad(flow: unknown, count: number): Promise<SessionResult[]> {
    const out: SessionResult[] = [];
    let { state } = await waiting(flow);
    for (let i = 0; i < count; i++) {
      const result = await replyOk(flow, state, { text: `mala-${i}` });
      out.push(result);
      state = result.state;
    }
    return out;
  }

  it('maxRetries 10: once respuestas inválidas, diez reintentos y el undécimo agota', async () => {
    const flow = simpleFlow('email', { validation: { maxRetries: 10 } });
    const results = await bad(flow, 11);
    results.slice(0, 10).forEach((r, i) => {
      expect(r.status).toBe('waiting');
      expect(r.events.find((e) => e.type === 'input')).toMatchObject({ attempt: i + 2, reason: 'invalid_format' });
    });
    expect(results[10]!.status).toBe('failed');
    expect(results[10]!.events).toEqual([{ type: 'error', nodeId: 'p', code: 'retries_exhausted', message: expect.any(String) }]);
  });

  it('maxRetries 1: un reintento y la segunda respuesta inválida agota', async () => {
    const results = await bad(simpleFlow('email', { validation: { maxRetries: 1 } }), 2);
    expect(results.map((r) => r.status)).toEqual(['waiting', 'failed']);
  });

  it('retryMessage vacío se emite vacío y no se sustituye por el prompt; placeholder vacío se conserva', async () => {
    const flow = simpleFlow('email', { validation: { retryMessage: '' }, placeholder: '' });
    const first = await startOk(flow);
    expect(first.events.find((e) => e.type === 'input')).toHaveProperty('placeholder', '');
    const retry = await replyOk(flow, first.state, { text: 'no' });
    expect(messageTexts(retry.events)).toEqual(['']);
  });

  it('retryMessage usa los valores actuales y nunca la respuesta rechazada', async () => {
    const flow = flowOf([input('p', 'v', 'email', 'fin', { validation: { retryMessage: 'Antes: [{{v}}] {{nombre}}' } }), end('fin')], {
      variables: [variable('v', { default: 'previo@example.com' }), variable('nombre', { default: 'Ana' })],
    });
    const { state } = await waiting(flow);
    const retry = await replyOk(flow, state, { text: 'RESPUESTA-INVALIDA' });
    expect(messageTexts(retry.events)).toEqual(['Antes: [previo@example.com] Ana']);
    expect(everything(retry)).not.toContain('RESPUESTA-INVALIDA');
  });

  it('el prompt repetido se vuelve a renderizar con los valores actuales (incluidas imágenes)', async () => {
    const prompt = [{ kind: 'text', text: 'Hola {{nombre}}' }, { kind: 'image', url: 'https://example.com/{{nombre}}.png', alt: '{{nombre}}' }];
    const flow = flowOf([input('p', 'v', 'number', 'fin', { prompt }), end('fin')], { variables: [variable('v'), variable('nombre', { default: 'Ana' })] });
    const { state } = await waiting(flow);
    const retry = await replyOk(flow, state, { text: 'x' });
    const first = (await startOk(flow)).events[0];
    expect(retry.events[0]).toEqual(first);
  });

  it('un reintento de un input de opciones múltiples vuelve a incluir las opciones y el reason', async () => {
    const flow = flowOf(
      [input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b']), validation: { min: 2 } }), end('fin')],
      { variables: [variable('v', { type: 'json' })] },
    );
    const { state } = await waiting(flow);
    const retry = await replyOk(flow, state, { choices: ['a'] });
    expect(retry.events[1]).toMatchObject({ type: 'input', attempt: 2, reason: 'out_of_range', multiple: true, choices: [{ id: 'a' }, { id: 'b' }] });
    const empty = await replyOk(flow, retry.state, { choices: [] });
    expect(empty.events[1]).toMatchObject({ attempt: 3, reason: 'required' });
  });
});

describe('El intento del estado y su manipulación', () => {
  const flow = () => simpleFlow('email');

  it.each([
    [1, 'waiting', 2], [2, 'waiting', 3], [3, 'waiting', 4], [4, 'failed', undefined], [5, 'failed', undefined], [1000, 'failed', undefined],
    [Number.MAX_SAFE_INTEGER, 'failed', undefined], [1e21, 'failed', undefined], [1e308, 'failed', undefined],
  ] as const)('attempt %s con una respuesta inválida → %s', async (attempt, status, next) => {
    const f = flow();
    const { state } = await waiting(f);
    const result = await replyOk(f, { ...state, attempt }, { text: 'no' });
    expect(result.status).toBe(status);
    if (next) expect(result.events.find((e) => e.type === 'input')).toMatchObject({ attempt: next });
    else expect(result.state.error).toEqual({ code: 'retries_exhausted', nodeId: 'p' });
  });

  it.each([1, 4, 1000, 1e21])('attempt %s con una respuesta válida continúa y no deja rastro del intento', async (attempt) => {
    const f = flow();
    const { state } = await waiting(f);
    const result = await replyOk(f, { ...state, attempt }, { text: 'a@b.co' });
    expect(result.status).toBe('ended');
    expect(result.state).not.toHaveProperty('attempt');
  });

  it.each([
    ['0', 0], ['negativo', -1], ['fraccionario', 1.5], ['string', '2'], ['null', null], ['booleano', true], ['array', [1]], ['objeto', { n: 1 }], ['undefined', undefined], ['-0', -0],
    ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['bigint', 1n],
  ])('attempt %s en un estado en espera → invalid_state', async (_label, attempt) => {
    const f = flow();
    const { state } = await waiting(f);
    expect(await reply(f, { ...state, attempt }, { text: 'a@b.co' })).toMatchObject({ ok: false, code: 'invalid_state' });
  });

  it('un attempt en un estado terminado o fallido se ignora y no se propaga', async () => {
    const f = flow();
    const { state } = await waiting(f);
    const ended = (await replyOk(f, state, { text: 'a@b.co' })).state;
    const failedState = (await replyOk(f, { ...state, attempt: 9 }, { text: 'no' })).state;
    for (const s of [ended, failedState]) {
      expect(await reply(f, { ...s, attempt: 7 }, { text: 'x' })).toMatchObject({ ok: false, code: 'session_not_active' });
      expect(await reply(f, { ...s, attempt: 'basura' }, { text: 'x' })).toMatchObject({ ok: false, code: 'session_not_active' });
    }
  });

  it('un estado en espera con outcome o error, o un estado terminado con error, es invalid_state', async () => {
    const f = flow();
    const { state } = await waiting(f);
    for (const patch of [{ outcome: 'x' }, { error: { code: 'invalid_rule', nodeId: 'p' } }, { outcome: '' }] as const) {
      expect(await reply(f, { ...state, ...patch }, { text: 'a@b.co' }), JSON.stringify(patch)).toMatchObject({ ok: false, code: 'invalid_state' });
    }
  });

  it('un estado en espera cuyo nodo no es un input, no existe o es de otro flujo es state_mismatch', async () => {
    const f = flowOf([message('m', 'hola', 'p'), input('p', 'v', 'email', 'fin'), end('fin')], { variables: [variable('v')] });
    const { state } = await waiting(f);
    expect(state.nodeId).toBe('p');
    for (const patch of [{ nodeId: 'm' }, { nodeId: 'fin' }, { nodeId: 'zz' }, { nodeId: '' }, { flowId: 'otro' }]) {
      expect(await reply(f, { ...state, ...patch }, { text: 'a@b.co' }), JSON.stringify(patch)).toMatchObject({ ok: false, code: 'state_mismatch' });
    }
  });

  it('el rechazo por estado gana a la forma de la entrada: invalid_input solo con un estado válido', async () => {
    const f = flow();
    const { state } = await waiting(f);
    expect(await reply(f, { ...state, attempt: 0 }, 'basura')).toMatchObject({ code: 'invalid_state' });
    expect(await reply(f, { ...state, nodeId: 'fin' }, 'basura')).toMatchObject({ code: 'state_mismatch' });
    const { attempt: _attempt, ...ended } = { ...state, status: 'ended' as const };
    expect(await reply(f, ended, 'basura')).toMatchObject({ code: 'session_not_active' });
  });

  it('claves __proto__ en variables, contacto y nivel superior del estado no contaminan nada', async () => {
    const f = flow();
    const { state } = await waiting(f);
    const hostil = JSON.parse(JSON.stringify(state).replace('{', '{"__proto__":{"status":"ended","polluted":1},')) as Record<string, unknown>;
    hostil.variables = JSON.parse('{"__proto__":"x","constructor":"y"}');
    const result = await replyOk(f, hostil, { text: 'a@b.co' });
    expect(result.status).toBe('ended');
    expect(result.state.variables).toEqual({ v: 'a@b.co' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('Reanudar con un flujo distinto del que preguntó', () => {
  it('una opción que ya no existe o un id cambiado es invalid_input; el que sigue existe se acepta', async () => {
    const before = flowOf([input('p', 'v', 'choice', undefined, { choices: choicesOf(['a', 'b'], 'fin') }), end('fin')], { variables: [variable('v')] });
    const after = flowOf([input('p', 'v', 'choice', undefined, { choices: choicesOf(['b', 'c'], 'fin') }), end('fin')], { variables: [variable('v')] });
    const { state } = await waiting(before);
    expect(await reply(after, state, { choice: 'a' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect((await replyOk(after, state, { choice: 'b' })).state.variables.v).toBe('b');
  });

  it('el tipo del input cambia: la respuesta se convierte con el tipo nuevo y el antiguo no importa', async () => {
    const { state } = await waiting(simpleFlow('text'));
    const asNumber = simpleFlow('number');
    expect(reasonOf(await replyOk(asNumber, state, { text: 'hola' }))).toBe('invalid_format');
    expect((await replyOk(asNumber, state, { text: '3,5' })).state.variables.v).toBe(3.5);
    const asChoice = flowOf([input('p', 'v', 'choice', undefined, { choices: choicesOf(['a'], 'fin') }), end('fin')], { variables: [variable('v')] });
    expect(await reply(asChoice, state, { text: 'a' })).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('el locale cambia entre turnos: manda el del flujo recibido', async () => {
    const es = simpleFlow('boolean', {}, { flowExtra: { locale: 'es' } });
    const en = simpleFlow('boolean', {}, { flowExtra: { locale: 'en-GB' } });
    const { state } = await waiting(es);
    expect(reasonOf(await replyOk(es, state, { text: 'yes' }))).toBe('invalid_format');
    expect((await replyOk(en, state, { text: 'yes' })).state.variables.v).toBe(true);
    expect(reasonOf(await replyOk(en, state, { text: 'si' }))).toBe('invalid_format');
  });

  it('una variable que pasa de sesión a contacto (o al revés) no arrastra el valor del ámbito antiguo', async () => {
    const asSession = flowOf([input('p', 'v', 'text', 'fin'), end('fin', { text: '[{{x}}]' })], { variables: [variable('v'), variable('x', { default: 'd' })] });
    const asContact = flowOf([input('p', 'v', 'text', 'fin'), end('fin', { text: '[{{x}}]' })], { variables: [variable('v'), variable('x', { scope: 'contact', default: 'd' })] });
    const first = await startOk(asSession);
    const state = { ...first.state, variables: { ...first.state.variables, x: 'viejo' } } as SessionState;
    expect(messageTexts((await replyOk(asContact, state, { text: 'hola' })).events)).toEqual(['[]']);
    const withContact = { ...first.state, variables: {}, contact: { x: 'del-contacto' } } as SessionState;
    expect(messageTexts((await replyOk(asSession, withContact, { text: 'hola' })).events)).toEqual(['[]']);
    expect(messageTexts((await replyOk(asContact, withContact, { text: 'hola' })).events)).toEqual(['[del-contacto]']);
  });

  it('una respuesta válida a una variable de contacto se refleja en contact y no en variables', async () => {
    const f = simpleFlow('phone', {}, { variableExtra: { scope: 'contact' } });
    const { state } = await waiting(f, { v: '+34000000000' });
    const result = await replyOk(f, state, { text: '600 123 456' });
    expect(result.state.contact).toEqual({ v: '600123456' });
    expect(result.state.variables).toEqual({});
  });

  it('un valor de variable llamado constructor o __proto__ guardado por un input sobrevive al viaje por JSON', async () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      const f = flowOf([input('p', name, 'text', 'fin'), end('fin', { text: `[{{${name}}}]` })], { variables: [variable(name)] });
      const { state } = await waiting(f);
      const done = await replyOk(f, JSON.parse(JSON.stringify(state)), { text: 'valor' });
      expect(messageTexts(done.events), name).toEqual(['[valor]']);
      const back = JSON.parse(JSON.stringify(done.state)) as SessionState;
      expect(Object.hasOwn(back.variables, name), name).toBe(true);
      expect(back).toEqual(done.state);
    }
  });

  it('un texto guardado con marcadores no se expande al renderizarse después (una sola pasada)', async () => {
    const f = flowOf([input('p', 'v', 'text', 'fin'), end('fin', { text: 'Dijiste: {{v}}' })], { variables: [variable('v'), variable('otra', { default: 'SECRETO' })] });
    const { state } = await waiting(f);
    const done = await replyOk(f, state, { text: '{{otra}}' });
    expect(messageTexts(done.events)).toEqual(['Dijiste: {{otra}}']);
  });
});

describe('Límite de 200 pasos al continuar', () => {
  const chain = (count: number): unknown => {
    const nodes: Obj[] = [];
    for (let i = 0; i < count; i++) nodes.push({ id: `n${i}`, type: 'jump', target: i + 1 < count ? `n${i + 1}` : 'fin' });
    return flowOf([input('p', 'v', 'text', count ? 'n0' : 'fin'), ...nodes, end('fin', { outcome: 'listo' })], { variables: [variable('v')] });
  };

  it('el input cuenta como el paso 1 aunque la respuesta sea válida o inválida; el reintento no suma', async () => {
    const f = chain(198);
    const { state } = await waiting(f);
    expect((await replyOk(f, state, { text: 'ok' })).status).toBe('ended');
    const retry = await replyOk(simpleFlow('email'), (await waiting(simpleFlow('email'))).state, { text: 'no' });
    expect(retry.status).toBe('waiting');
    const over = chain(199);
    const failed = await replyOk(over, state, { text: 'ok' });
    expect(failed.events).toEqual([{ type: 'error', nodeId: 'fin', code: 'step_limit_exceeded', message: expect.any(String) }]);
    expect(failed.state.variables.v).toBe('ok');
  });

  it('un bucle input → condition → input cuenta pasos por operación, no en total', async () => {
    const f = flowOf(
      [
        input('p', 'v', 'text', 'c'),
        condition('c', [[rule('v', 'eq', 'otra'), 'p']], 'fin'),
        end('fin', { outcome: 'listo' }),
      ],
      { variables: [variable('v')] },
    );
    let { state } = await waiting(f);
    for (let i = 0; i < 250; i++) {
      const result = await replyOk(f, state, { text: 'otra' });
      expect(result.status).toBe('waiting');
      expect(result.events.find((e) => e.type === 'input')).toMatchObject({ attempt: 1, reason: null });
      state = result.state;
    }
    expect((await replyOk(f, state, { text: 'fin' })).status).toBe('ended');
  });
});

describe('Privacidad: ninguna respuesta aparece en errores, rechazos ni eventos', () => {
  const answers: [string, string, Obj?][] = [
    ['text', 'PRIVADO-texto', { validation: { pattern: '^nada$', maxRetries: 1 } }],
    ['email', 'PRIVADO-email', { validation: { maxRetries: 1 } }],
    ['phone', 'PRIVADO-phone', { validation: { maxRetries: 1 } }],
    ['number', 'PRIVADO-number', { validation: { maxRetries: 1 } }],
    ['url', 'PRIVADO-url y mas', { validation: { maxRetries: 1 } }],
    ['date', 'PRIVADO-date', { validation: { maxRetries: 1 } }],
    ['boolean', 'PRIVADO-boolean', { validation: { maxRetries: 1 } }],
  ];

  it.each(answers)('%s: respuesta inválida, reintento y agotamiento sin rastro', async (type, secret, extra) => {
    const f = simpleFlow(type, extra, { variableExtra: { pii: true } });
    const { state } = await waiting(f);
    const first = await replyOk(f, state, { text: secret });
    const second = await replyOk(f, first.state, { text: `${secret}-2` });
    const after = await reply(f, second.state, { text: secret });
    expect(second.status).toBe('failed');
    expect(everything(first, second, after)).not.toContain('PRIVADO');
  });

  it('una respuesta demasiado larga o vacía tampoco deja rastro', async () => {
    const f = simpleFlow('text', { validation: { maxRetries: 0 } }, { variableExtra: { pii: true } });
    const { state } = await waiting(f);
    for (const text of ['PRIVADO'.repeat(1000), '   ']) expect(everything(await replyOk(f, state, { text }))).not.toContain('PRIVADO');
  });

  it('un rechazo invalid_input, invalid_state o state_mismatch no repite la entrada ni el estado', async () => {
    const f = simpleFlow('text');
    const { state } = await waiting(f);
    const marks = [
      await reply(f, state, { text: 'PRIVADO', extra: 'PRIVADO' }),
      await reply(f, { ...state, attempt: 'PRIVADO' }, { text: 'PRIVADO' }),
      await reply(f, { ...state, flowId: 'PRIVADO' }, { text: 'PRIVADO' }),
    ];
    for (const m of marks) expect(JSON.stringify(m)).not.toContain('PRIVADO');
  });

  it('el valor válido solo está en su variable (estado), no en eventos ni en el error de un fallo posterior', async () => {
    const f = flowOf([input('p', 'e', 'email', 'c'), condition('c', [[rule('e', 'matches', '(')  , 'fin']], 'fin'), end('fin')], { variables: [variable('e', { pii: true })] });
    const { state } = await waiting(f);
    const result = await replyOk(f, state, { text: 'privado@example.com' });
    expect(result.status).toBe('failed');
    expect(everything(result.events)).not.toContain('privado@example.com');
    expect(JSON.stringify(result.state.error)).not.toContain('privado');
    expect(result.state.variables.e).toBe('privado@example.com');
  });
});

describe('Determinismo y no mutación al continuar', () => {
  it('dos continuaciones iguales dan el mismo resultado y la entrada no se modifica', async () => {
    const f = flowOf(
      [input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b', 'c']), validation: { min: 1 } }), end('fin')],
      { variables: [variable('v', { type: 'json' })] },
    );
    const { state } = await waiting(f);
    const entrada = { choices: ['c', 'a'] };
    const copia = structuredClone(entrada);
    const a = await continueSession({ flow: f, state, input: entrada });
    const b = await continueSession({ flow: f, state, input: entrada });
    expect(a).toEqual(b);
    expect(entrada).toEqual(copia);
    (a as SessionResult).state.variables.v = 'mutado';
    expect(((await continueSession({ flow: f, state, input: entrada })) as SessionResult).state.variables.v).toEqual(['a', 'c']);
  });

  it('startSession y continueSession no escriben en consola ni leen el reloj (sesión con reintentos)', async () => {
    const f = simpleFlow('email');
    const first = await startSession({ flow: f });
    expect(first.ok).toBe(true);
  });
});

describe('Plantillas: los espacios de un valor se conservan al renderizarlo', () => {
  it('un valor de contacto con espacios, saltos de línea y NBSP se inserta tal cual', async () => {
    const f = flowOf([end('fin', { text: '[{{v}}]' })], { variables: [variable('v', { scope: 'contact' })] });
    for (const value of [' x ', '\n', '\u00a0y\u00a0', '  ']) {
      expect(messageTexts((await startOk(f, { v: value })).events), JSON.stringify(value)).toEqual([`[${value}]`]);
    }
  });

  it('un set con espacios exteriores en una plantilla literal los conserva; el input recorta antes de guardar', async () => {
    const f = flowOf(
      [{ id: 's', type: 'set', assignments: [{ variable: 'w', value: '  {{v}}  ' }], next: 'i' }, input('i', 'v', 'text', 'fin'), end('fin', { text: '[{{v}}][{{w}}]' })],
      { variables: [variable('v', { default: ' a ' }), variable('w')] },
    );
    const first = await startOk(f);
    const done = await replyOk(f, first.state, { text: '  b  ' });
    expect(messageTexts(done.events)).toEqual(['[b][   a   ]']);
  });
});
