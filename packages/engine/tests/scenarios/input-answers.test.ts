import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerText, reply, replyOk, savedValue, simpleFlow, waiting } from '../helpers/conversation.js';
import { choicesOf, end, flowOf, input, variable } from '../helpers/flows.js';

const leads = (): any => JSON.parse(readFileSync(new URL('../../../spec/examples/captacion-leads.json', import.meta.url), 'utf8'));

/** Respuesta a un input; devuelve el valor guardado o `'INVALID:<reason>'`. */
async function outcome(type: string, text: string, extra = {}, options = {}): Promise<unknown> {
  const result = await answerText(type, text, extra, options);
  if (result.status === 'waiting') return `INVALID:${result.events.find((e) => e.type === 'input' && e.reason)?.type === 'input' ? (result.events.find((e) => e.type === 'input') as any).reason : '?'}`;
  return savedValue(result);
}
const valid = (type: string, text: string, extra = {}, options = {}) => outcome(type, text, extra, options);

describe('Forma de la entrada del usuario', () => {
  const rejected = async (flow: unknown, state: unknown, input: unknown, label = 'entrada') => {
    const result = await reply(flow, state, input);
    expect(result, label).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(result).not.toHaveProperty('events');
    expect(result).not.toHaveProperty('state');
  };

  it('Formas incorrectas en un input de texto', async () => {
    const flow = simpleFlow('text');
    const { state } = await waiting(flow);
    const before = structuredClone(state);
    for (const bad of ['Ana', { text: 5 }, { text: 'Ana', extra: 1 }, { choice: 'a' }, {}, null, undefined]) {
      await rejected(flow, state, bad);
    }
    expect(await reply(flow, state, undefined)).toMatchObject({ code: 'invalid_input' });
    expect(state).toEqual(before);
  });

  it('Texto en un input de opciones', async () => {
    const flow = leads();
    const { state } = await sizeQuestion(flow);
    await rejected(flow, state, { text: '1 a 10' });
  });

  it('Ids desconocidos o repetidos', async () => {
    const flow = flowOf([input('p', 'v', 'choice', 'fin', { multiple: true, choices: choicesOf(['a', 'b']) }), end('fin')], {
      variables: [variable('v')],
    });
    const { state } = await waiting(flow);
    for (const bad of [{ choices: ['a', 'z'] }, { choices: ['a', 'a'] }, { choices: ['a', 1] }, { choices: 'a' }, { choice: 'a' }]) {
      await rejected(flow, state, bad);
    }
  });

  it('Id desconocido en selección única', async () => {
    const flow = leads();
    const { state } = await sizeQuestion(flow);
    await rejected(flow, state, { choice: 'enorme' });
  });

  it('Un rechazo no consume intento', async () => {
    const flow = simpleFlow('email');
    const { state } = await waiting(flow);
    await rejected(flow, state, { text: 5 });
    const second = await replyOk(flow, state, { text: 'no' });
    expect(second.events.find((e) => e.type === 'input')).toMatchObject({ attempt: 2 });
  });

  it('Entrada muy anidada', async () => {
    const flow = simpleFlow('text');
    const { state } = await waiting(flow);
    let x: unknown = 1;
    for (let i = 0; i < 100000; i++) x = [x];
    await rejected(flow, state, { text: x }, 'text anidado 100000 niveles');
  });
});

async function sizeQuestion(flow: unknown) {
  const { state } = await waiting(flow);
  const name = await replyOk(flow, state, { text: 'Ana' });
  const mail = await replyOk(flow, name.state, { text: 'ana@example.com' });
  expect(mail.state.nodeId).toBe('pedir-tamano');
  return mail;
}

describe('Respuesta de texto obligatoria y acotada', () => {
  it('Espacios exteriores', async () => {
    expect(await valid('text', '  Ana Pérez \n')).toBe('Ana Pérez');
  });

  it('Respuesta vacía', async () => {
    expect(await valid('text', '')).toBe('INVALID:required');
    expect(await valid('text', '  \n ')).toBe('INVALID:required');
  });

  it('Justo en el límite de longitud', async () => {
    expect(await valid('text', 'a'.repeat(4096))).toBe('a'.repeat(4096));
    expect(await valid('text', 'a'.repeat(4097))).toBe('INVALID:too_long');
    expect(await valid('text', ` ${' '.repeat(2000)}Ana${' '.repeat(4097 - 2004)}`)).toBe('INVALID:too_long');
  });

  it('Respuesta enorme con un patrón costoso', async () => {
    const started = performance.now();
    expect(await valid('text', 'a'.repeat(1_000_000), { validation: { pattern: '^(a+)+$' } })).toBe('INVALID:too_long');
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('Conversión según inputType', () => {
  it('Texto con saltos de línea y marcado', async () => {
    expect(await valid('text', '<b>Hola</b>\nsegunda línea')).toBe('<b>Hola</b>\nsegunda línea');
  });

  it('El tipo de la variable no manda', async () => {
    expect(await valid('number', '30', {}, { variableExtra: { type: 'string' } })).toBe(30);
  });
});

describe('Caracteres que no se pueden guardar', () => {
  it('Nulo y sustitutos sueltos en un texto', async () => {
    for (const bad of ['Ana\u0000', 'Ana\ud800', '\udc00Ana']) expect(await valid('text', bad)).toBe('INVALID:invalid_format');
    expect(await valid('text', 'Ana 😀')).toBe('Ana 😀');
  });
});

describe('Tipo email', () => {
  it('Email válido normalizado', async () => {
    expect(await valid('email', ' Ana.Perez+lead@Example.COM ')).toBe('Ana.Perez+lead@example.com');
  });

  it('Emails inválidos', async () => {
    for (const bad of ['ana', 'ana@', 'ana@example', 'ana @example.com', 'a@b@example.com', 'ana@example.c', 'ana@example.123', 'ana@-example.com', 'añá@example.com', 'ana@exámple.com']) {
      expect(await valid('email', bad), bad).toBe('INVALID:invalid_format');
    }
  });

  it('Longitudes máximas', async () => {
    expect(await valid('email', `${'a'.repeat(64)}@example.com`)).toBe(`${'a'.repeat(64)}@example.com`);
    expect(await valid('email', `${'a'.repeat(65)}@example.com`)).toBe('INVALID:invalid_format');
  });
});

describe('Tipo phone', () => {
  it('Teléfonos normalizados', async () => {
    const cases: [string, string][] = [
      ['+34 600-12-34-56', '+34600123456'],
      ['(91) 123 45 67', '911234567'],
      ['0034 600.123.456', '0034600123456'],
      ['600\u00a0123\u00a0456', '600123456'],
    ];
    for (const [text, value] of cases) expect(await valid('phone', text), text).toBe(value);
  });

  it('Teléfonos inválidos', async () => {
    for (const bad of ['123456', '1234567890123456', '600 12 34 5a', '34+600123456', '++34600123456', '+']) {
      expect(await valid('phone', bad), bad).toBe('INVALID:invalid_format');
    }
  });
});

describe('Tipo number', () => {
  it('Números válidos', async () => {
    const cases: [string, number][] = [['42', 42], ['-3,5', -3.5], ['+0.25', 0.25], ['1234.567', 1234.567], ['0,500', 0.5], ['007', 7], ['-0', 0]];
    for (const [text, value] of cases) {
      const saved = await valid('number', text);
      expect(saved, text).toBe(value);
      expect(Object.is(saved, -0)).toBe(false);
    }
  });

  it('Separador de miles ambiguo', async () => {
    for (const bad of ['1.500', '1,500', '-2.000']) expect(await valid('number', bad), bad).toBe('INVALID:invalid_format');
  });

  it('Números inválidos', async () => {
    for (const bad of ['.5', '5.', '1 000', '1.000.000', '1e3', '0x10', '١٢', '9'.repeat(400)]) {
      expect(await valid('number', bad), bad.slice(0, 12)).toBe('INVALID:invalid_format');
    }
  });
});

describe('Números que no se pueden guardar exactamente', () => {
  it('Cifras significativas', async () => {
    expect(await valid('number', '123456789012345')).toBe(123456789012345);
    expect(await valid('number', '1234567890123456')).toBe('INVALID:invalid_format');
    expect(await valid('number', '0,00000000000000012345')).toBe(1.2345e-16);
    expect(await valid('number', `1${'0'.repeat(21)}`)).toBe(1e21);
  });

  it('Desbordamiento y subdesbordamiento', async () => {
    expect(await valid('number', `1${'0'.repeat(309)}`)).toBe('INVALID:invalid_format');
    expect(await valid('number', `0,${'0'.repeat(307)}1`)).toBe('INVALID:invalid_format');
    expect(await valid('number', `0,${'0'.repeat(306)}1`)).toBe(1e-307);
  });

  it('Ceros', async () => {
    for (const zero of ['0', '-0,0', '0000,0000']) expect(Object.is(await valid('number', zero), 0), zero).toBe(true);
  });
});

describe('Tipo url', () => {
  it('URLs válidas', async () => {
    const cases: [string, string][] = [
      ['example.com', 'https://example.com/'],
      ['HTTP://Example.com/a?b=1', 'http://example.com/a?b=1'],
      ['www.example.com/precios', 'https://www.example.com/precios'],
    ];
    for (const [text, value] of cases) expect(await valid('url', text), text).toBe(value);
  });

  it('URLs inválidas', async () => {
    for (const bad of ['ftp://example.com', 'javascript:alert(1)', 'mailto:ana@example.com', 'https://user:pass@example.com', 'https://localhost', 'http://', 'exa mple.com']) {
      expect(await valid('url', bad), bad).toBe('INVALID:invalid_format');
    }
  });
});

describe('Tipo url: esquema y consulta', () => {
  it('`://` dentro de la consulta', async () => {
    expect(await valid('url', 'example.com/?u=http://y.com')).toBe('https://example.com/?u=http://y.com');
    expect(await valid('url', 'example.com#a://b')).toBe('https://example.com/#a://b');
    expect(await valid('url', 'example.com:8080/a://b')).toBe('https://example.com:8080/a://b');
    expect(await valid('url', 'git+ssh://example.com')).toBe('INVALID:invalid_format');
  });
});

describe('Host de una url', () => {
  it('Direcciones IP y hosts sin dominio', async () => {
    for (const bad of ['12345', '1.5', '2130706433', '600123456', '192.168.1.1', 'https://[::1]', 'a.b', 'example.com.']) {
      expect(await valid('url', bad), bad).toBe('INVALID:invalid_format');
    }
  });

  it('Dominio internacional', async () => {
    expect(await valid('url', 'exámple.com')).toBe('https://xn--exmple-qta.com/');
  });
});

describe('Espacios y controles en una url', () => {
  it('Espacios y caracteres de control', async () => {
    for (const bad of ['example.com/precios y más', 'exa\tmple.com', 'example.com\n/precios', 'example.com/\u0000']) {
      expect(await valid('url', bad), JSON.stringify(bad)).toBe('INVALID:invalid_format');
    }
  });

  it('Caracteres invisibles y sustitutos sueltos', async () => {
    for (const bad of ['ex\u00adample.com', 'ex\u200bample.com', 'example.com/\ufeffa', 'example.com/\ud800']) {
      expect(await valid('url', bad), JSON.stringify(bad)).toBe('INVALID:invalid_format');
    }
  });
});

describe('Porcentaje en el host de una url', () => {
  it('Invisibles codificados en el host', async () => {
    for (const bad of ['exa%C2%ADmple.com', 'exa%E2%80%8Bmple.com', 'exa%EF%BB%BFmple.com', 'https://exa%C2%ADmple.com/', 'exa%41mple.com', '/exa%C2%ADmple.com', '//exa%C2%ADmple.com', 'https:///exa%C2%ADmple.com', 'https:////exa%C2%ADmple.com', 'https://\\exa%C2%ADmple.com']) {
      expect(await valid('url', bad), bad).toBe('INVALID:invalid_format');
    }
  });

  it('Porcentaje fuera del host', async () => {
    expect(await valid('url', 'example.com/a%20b?q=%C3%B1')).toBe('https://example.com/a%20b?q=%C3%B1');
    expect(await valid('url', 'https:///example.com/%41')).toBe('https://example.com/%41');
    expect(await valid('url', 'example.com\\a%41')).toBe('https://example.com/a%41');
  });
});

describe('Tamaño máximo del valor guardado', () => {
  it('URL que crece al serializarse', async () => {
    const ok = await valid('url', `example.com/${'ñ'.repeat(679)}`);
    expect(typeof ok === 'string' && ok.length).toBe(4094);
    expect(await valid('url', `example.com/${'ñ'.repeat(680)}`)).toBe('INVALID:invalid_format');
  });

  it('una url de 4094 unidades guardada se puede renderizar en un message', async () => {
    const web = `example.com/${'ñ'.repeat(679)}`;
    const flow = flowOf(
      [input('p', 'web', 'url', 'm'), { id: 'm', type: 'message', content: [{ kind: 'text', text: '{{web}}' }], next: 'fin' }, end('fin')],
      { variables: [variable('web')] },
    );
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: web });
    expect(result.status).toBe('ended');
    const text = (result.events[0] as any).content[0].text as string;
    expect(text).toHaveLength(4094);
  });
});

describe('Tipo date', () => {
  it('Fechas válidas', async () => {
    const flow = flowOf(
      [
        input('p', 'fecha', 'date', 'c'),
        { id: 'c', type: 'condition', rules: [{ when: { variable: 'fecha', op: 'lt', value: '2026-11-01' }, next: 'si' }], else: 'no' },
        end('si', { outcome: 'si' }),
        end('no', { outcome: 'no' }),
      ],
      { variables: [variable('fecha')] },
    );
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text: '2026-10-16' });
    expect(result.state.variables.fecha).toBe('2026-10-16');
    expect(result.state.outcome).toBe('si');
  });

  it('Bisiesto', async () => {
    expect(await valid('date', '2024-02-29')).toBe('2024-02-29');
    expect(await valid('date', '2026-02-29')).toBe('INVALID:invalid_format');
  });

  it('Fechas inválidas', async () => {
    for (const bad of ['2026-13-01', '2026-1-5', '16/10/2026', '2026-10-16T10:00', '20261016', '0000-01-01']) {
      expect(await valid('date', bad), bad).toBe('INVALID:invalid_format');
    }
  });
});

describe('Tipo boolean', () => {
  const flowWith = (locale?: string) => simpleFlow('boolean', {}, { flowExtra: locale ? { locale } : undefined });
  const boolean = async (text: string, locale?: string) => {
    const flow = flowWith(locale);
    const { state } = await waiting(flow);
    const result = await replyOk(flow, state, { text });
    return result.status === 'waiting' ? `INVALID:${(result.events[1] as any).reason}` : result.state.variables.v;
  };

  it('Español', async () => {
    const cases: [string, boolean][] = [['Sí', true], ['SI', true], ['si', true], ['true', true], ['No', false], ['FALSE', false]];
    for (const [text, value] of cases) expect(await boolean(text, 'es'), text).toBe(value);
  });

  it('Palabras no admitidas', async () => {
    for (const bad of ['vale', 's', 'yes', '1']) expect(await boolean(bad, 'es'), bad).toBe('INVALID:invalid_format');
  });

  it('Inglés con región', async () => {
    expect(await boolean('Yes', 'en-GB')).toBe(true);
    expect(await boolean('y', 'en-GB')).toBe(true);
    expect(await boolean('N', 'en-GB')).toBe(false);
    expect(await boolean('sí', 'en-GB')).toBe('INVALID:invalid_format');
  });

  it('Otros idiomas y flujo sin locale', async () => {
    expect(await boolean('oui', 'fr')).toBe('INVALID:invalid_format');
    expect(await boolean('true', 'fr')).toBe(true);
    expect(await boolean('si')).toBe(true);
  });

  it('Acento combinado', async () => {
    expect(await boolean('si\u0301', 'es')).toBe(true);
  });
});
