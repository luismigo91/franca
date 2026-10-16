import { describe, expect, it } from 'vitest';
import { PARSERS } from '../../src/input/parsers/index.js';
import { collectSlots, convertSlotValue, hasRequired, revalidateCollected, SLOT_INPUT_TYPES, slotSpecs, type SlotSpec } from '../../src/llm/slots.js';
import type { VariableType, VariableValue } from '../../src/types.js';

const TYPES: VariableType[] = ['string', 'email', 'phone', 'number', 'url', 'date', 'boolean', 'json'];

describe('SLOT_INPUT_TYPES', () => {
  it('asocia cada tipo de variable a su conversor de input (string como text) y json a sí mismo', () => {
    expect(SLOT_INPUT_TYPES).toEqual({
      string: 'text',
      email: 'email',
      phone: 'phone',
      number: 'number',
      url: 'url',
      date: 'date',
      boolean: 'boolean',
      json: 'json',
    });
  });

  it('todo conversor que no es json existe en PARSERS', () => {
    const parsers = TYPES.map((type) => SLOT_INPUT_TYPES[type]).filter((parser) => parser !== 'json');
    expect(parsers).toHaveLength(TYPES.length - 1);
    for (const parser of parsers) expect(PARSERS).toHaveProperty(parser);
  });
});

describe('slotSpecs', () => {
  const types = new Map<string, VariableType>([
    ['email', 'email'],
    ['n', 'number'],
    ['__proto__', 'boolean'],
    ['constructor', 'phone'],
  ]);

  it('una especificación por variable distinta, en el orden del nodo, con el tipo de la variable', () => {
    const node = {
      slots: [
        { variable: 'n', description: 'num' },
        { variable: 'email', description: 'mail', required: false },
      ],
    };
    expect(slotSpecs(node, types)).toEqual([
      { name: 'n', type: 'number', description: 'num', required: true },
      { name: 'email', type: 'email', description: 'mail', required: false },
    ]);
  });

  it('si dos slots nombran la misma variable cuenta el primero (descripción y required)', () => {
    const node = {
      slots: [
        { variable: 'email', description: 'a' },
        { variable: 'email', description: 'b', required: false },
      ],
    };
    expect(slotSpecs(node, types)).toEqual([{ name: 'email', type: 'email', description: 'a', required: true }]);
  });

  it('required es false solo si el slot lo dice', () => {
    const node = { slots: [{ variable: 'a', description: '', required: true }, { variable: 'b', description: '' }, { variable: 'c', description: '', required: false }] };
    expect(slotSpecs(node, new Map()).map((s) => s.required)).toEqual([true, true, false]);
  });

  it('un nodo sin slots no tiene especificaciones', () => {
    expect(slotSpecs({}, types)).toEqual([]);
    expect(slotSpecs({ slots: [] }, types)).toEqual([]);
  });

  it('una variable sin tipo conocido se trata como string', () => {
    expect(slotSpecs({ slots: [{ variable: 'zzz', description: '' }] }, types)[0]!.type).toBe('string');
  });

  it('los nombres __proto__ y constructor son nombres normales', () => {
    const specs = slotSpecs({ slots: [{ variable: '__proto__', description: 'p' }, { variable: 'constructor', description: 'c' }] }, types);
    expect(specs.map((s) => [s.name, s.type])).toEqual([
      ['__proto__', 'boolean'],
      ['constructor', 'phone'],
    ]);
  });
});

describe('convertSlotValue: conversiones válidas', () => {
  it.each<[VariableType, unknown, VariableValue]>([
    ['email', ' Ana@Example.COM ', 'Ana@example.com'],
    ['phone', '+34 600 12 34 56', '+34600123456'],
    ['phone', '(91) 123-45.67', '911234567'],
    ['number', '3,5', 3.5],
    ['number', '3.5', 3.5],
    ['number', '-12', -12],
    ['number', 1500, 1500],
    ['number', 0.1, 0.1],
    ['number', -0, 0],
    ['boolean', true, true],
    ['boolean', false, false],
    ['boolean', 'sí', true],
    ['boolean', 'No', false],
    ['boolean', 'true', true],
    ['url', 'example.com', 'https://example.com/'],
    ['url', 'http://Example.com/a', 'http://example.com/a'],
    ['date', '2026-10-16', '2026-10-16'],
    ['date', '2024-02-29', '2024-02-29'],
    ['string', '  precio del envío ', 'precio del envío'],
  ])('%s: %j → %j', (type, value, expected) => {
    const converted = convertSlotValue(type, value, 'es');
    expect(converted).toEqual(expected);
    // Object.is distingue -0 de 0: lo convertido nunca es -0.
    expect(Object.is(converted, expected)).toBe(true);
  });

  it('el idioma del flujo decide las palabras de boolean', () => {
    expect(convertSlotValue('boolean', 'sí', 'es')).toBe(true);
    expect(convertSlotValue('boolean', 'sí', 'en')).toBeUndefined();
    expect(convertSlotValue('boolean', 'yes', 'en')).toBe(true);
    expect(convertSlotValue('boolean', 'yes', 'es')).toBeUndefined();
  });
});

describe('convertSlotValue: valores que no se pueden convertir', () => {
  it.each<[VariableType, unknown]>([
    ['email', 'ana@'],
    ['email', 'a@localhost'],
    ['number', '1.500'],
    ['number', 'abc'],
    ['number', '1234567890123456'],
    ['boolean', 'quizá'],
    ['date', '16/10/2026'],
    ['date', '2026-02-30'],
    ['string', 42],
    ['url', 'https://localhost'],
    ['url', 'https://127.0.0.1/'],
    ['phone', '123'],
    ['string', ''],
    ['string', '   '],
    ['email', ''],
    ['string', 'a\u0000b'],
    ['string', 'a\ud800'],
  ])('%s: %j no se recoge', (type, value) => {
    expect(convertSlotValue(type, value, 'es')).toBeUndefined();
  });

  it('los strings con U+0000 o sustitutos sueltos se rechazan en todos los tipos de texto', () => {
    for (const type of ['string', 'email', 'phone', 'number', 'url', 'date', 'boolean'] as const) {
      expect(convertSlotValue(type, '1\u0000', 'es'), type).toBeUndefined();
      expect(convertSlotValue(type, '1\ud800', 'es'), type).toBeUndefined();
    }
  });

  it('number no finito no vale en number', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) expect(convertSlotValue('number', bad, 'es')).toBeUndefined();
  });
});

describe('convertSlotValue: cada tipo contra cada forma JSON', () => {
  const SHAPES: [string, unknown][] = [
    ['string', 'texto'],
    ['number', 5],
    ['boolean', true],
    ['null', null],
    ['array', ['a']],
    ['object', { a: 1 }],
  ];
  /** Qué formas pueden recogerse en cada tipo (con un valor representativo válido). */
  const VALID: Record<VariableType, Record<string, unknown>> = {
    string: { string: 'texto' },
    email: { string: 'a@example.com' },
    phone: { string: '+34600123456' },
    number: { string: '5', number: 5 },
    url: { string: 'example.com' },
    date: { string: '2026-10-16' },
    boolean: { string: 'true', boolean: true },
    json: {},
  };

  for (const type of TYPES.filter((t) => t !== 'json')) {
    for (const [shape, example] of SHAPES) {
      const valid = VALID[type][shape];
      // Un `it` por rama: ninguna aserción depende de un `if`.
      if (valid === undefined) it(`${type} con ${shape}: no se recoge`, () => expect(convertSlotValue(type, example, 'es')).toBeUndefined());
      else it(`${type} con ${shape}: se recoge`, () => expect(convertSlotValue(type, valid, 'es')).not.toBeUndefined());
    }
  }

  it.each([
    ['string', 'texto'],
    ['number', 5],
    ['boolean', true],
    ['array', ['a', { b: 1 }]],
    ['object', { a: [1] }],
  ])('json con %s: se recoge tal cual', (_shape, value) => {
    expect(convertSlotValue('json', value, 'es')).toEqual(value);
  });

  it('json con null o ausente no se recoge', () => {
    expect(convertSlotValue('json', null, 'es')).toBeUndefined();
    expect(convertSlotValue('json', undefined, 'es')).toBeUndefined();
  });

  it.each(TYPES)('%s con null o ausente nunca cambia lo recogido', (type) => {
    expect(convertSlotValue(type, null, 'es')).toBeUndefined();
    expect(convertSlotValue(type, undefined, 'es')).toBeUndefined();
  });
});

describe('convertSlotValue: tipos JSON que no corresponden', () => {
  it.each<[VariableType, unknown]>([
    ['number', true],
    ['number', ['1']],
    ['boolean', 1],
    ['boolean', 0],
    ['string', ['a']],
    ['string', true],
    ['string', { a: 1 }],
    ['email', 5],
    ['date', 20261016],
    ['phone', 600123456],
  ])('%s con %j no se recoge', (type, value) => {
    expect(convertSlotValue(type, value, 'es')).toBeUndefined();
  });
});

describe('convertSlotValue: strings demasiado largos', () => {
  it('4096 caracteres en un string valen y 4097 no', () => {
    expect(convertSlotValue('string', 'a'.repeat(4096), 'es')).toBe('a'.repeat(4096));
    expect(convertSlotValue('string', 'a'.repeat(4097), 'es')).toBeUndefined();
  });

  it('la longitud se mide sin recortar: 4096 caracteres con un espacio de más no valen', () => {
    expect(convertSlotValue('string', ` ${'a'.repeat(4096)}`, 'es')).toBeUndefined();
  });
});

describe('collectSlots', () => {
  const specs: SlotSpec[] = [
    { name: 'email', type: 'email', description: '', required: true },
    { name: 'n', type: 'number', description: '', required: false },
    { name: '__proto__', type: 'string', description: '', required: false },
  ];

  it('convierte y devuelve solo los válidos, en el orden del nodo', () => {
    const values = new Map<string, unknown>([
      ['n', '3,5'],
      ['email', 'A@b.co'],
    ]);
    expect([...collectSlots(values, specs, 'es')]).toEqual([
      ['email', 'A@b.co'],
      ['n', 3.5],
    ]);
  });

  it('un valor inválido no entra, ni null ni ausente', () => {
    const values = new Map<string, unknown>([
      ['email', 'ana@'],
      ['n', null],
    ]);
    expect(collectSlots(values, specs, 'es').size).toBe(0);
  });

  it('solo mira los slots declarados: un nombre ajeno en values se ignora', () => {
    const values = new Map<string, unknown>([['otro', 'x']]);
    expect(collectSlots(values, specs, 'es').size).toBe(0);
  });

  it('un slot __proto__ es una entrada normal', () => {
    const collected = collectSlots(new Map([['__proto__', 'p']]), specs, 'es');
    expect(collected.get('__proto__')).toBe('p');
  });
});

describe('revalidateCollected', () => {
  const specs: SlotSpec[] = [
    { name: 'email', type: 'email', description: '', required: true },
    { name: 'n', type: 'number', description: '', required: false },
    { name: 'datos', type: 'json', description: '', required: false },
  ];

  it('conserva lo que sigue siendo válido y descarta lo que ya no es slot', () => {
    const kept = revalidateCollected({ email: 'a@b.co', n: 3.5, viejo: 'x', datos: { a: [1] } }, specs, 'es');
    expect([...kept]).toEqual([
      ['email', 'a@b.co'],
      ['n', 3.5],
      ['datos', { a: [1] }],
    ]);
  });

  it('vuelve a convertir con el tipo actual: un number guardado en un slot ahora string se descarta', () => {
    const retyped: SlotSpec[] = [{ name: 'n', type: 'string', description: '', required: false }];
    expect(revalidateCollected({ n: 3.5 }, retyped, 'es').size).toBe(0);
  });

  it('un string guardado que ahora debe ser number se vuelve a convertir', () => {
    const retyped: SlotSpec[] = [{ name: 'n', type: 'number', description: '', required: false }];
    expect(revalidateCollected({ n: '3,5' }, retyped, 'es').get('n')).toBe(3.5);
  });

  it('un valor json guardado pasa por la misma copia (uno que no cabe se descarta)', () => {
    const big = { a: 'x'.repeat(5000) };
    expect(revalidateCollected({ datos: big }, specs, 'es').has('datos')).toBe(false);
  });

  it('sin slots no queda nada', () => {
    expect(revalidateCollected({ email: 'a@b.co' }, [], 'es').size).toBe(0);
  });

  it('no usa propiedades heredadas ni __proto__', () => {
    const slot: SlotSpec[] = [{ name: 'constructor', type: 'string', description: '', required: false }];
    expect(revalidateCollected({}, slot, 'es').size).toBe(0);
    const proto: SlotSpec[] = [{ name: '__proto__', type: 'string', description: '', required: false }];
    const own = JSON.parse('{"__proto__": "p"}') as Record<string, VariableValue>;
    expect(revalidateCollected(own, proto, 'es').get('__proto__')).toBe('p');
  });
});

describe('hasRequired', () => {
  const specs: SlotSpec[] = [
    { name: 'a', type: 'string', description: '', required: true },
    { name: 'b', type: 'string', description: '', required: false },
  ];
  it('exige todos los obligatorios', () => {
    expect(hasRequired(specs, new Map())).toBe(false);
    expect(hasRequired(specs, new Map([['b', 'x']]))).toBe(false);
    expect(hasRequired(specs, new Map([['a', 'x']]))).toBe(true);
  });
  it('sin slots, o sin obligatorios, siempre vale', () => {
    expect(hasRequired([], new Map())).toBe(true);
    expect(hasRequired([specs[1]!], new Map())).toBe(true);
  });
});
