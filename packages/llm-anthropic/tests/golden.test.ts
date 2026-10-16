import { describe, expect, it } from 'vitest';
import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODELS } from '../src/index.js';
import { fakeApi, ok, slot, turnRequest, valueTypesOf } from './helpers/fake-api.js';

/**
 * Golden del cuerpo que llega a la API: congelan `system`, los mensajes, las dos marcas de caché,
 * `output_config` (con el esquema que genera el SDK) y lo que **no** se envía (`temperature`,
 * `cache_control` de nivel superior). Un cambio de forma del SDK al actualizarlo se ve aquí. Se regraban
 * con `pnpm --filter @franca/llm-anthropic test -u` y se revisa el diff; no se editan a mano.
 */
const cases: [string, Parameters<typeof turnRequest>[0], Parameters<typeof createAnthropicProvider>[0]?][] = [
  // El primer turno de faq-ia con Opus 5.5: API beta con fallback y effort low; la temperatura se ignora.
  [
    'opus-primer-turno-faq-ia',
    {
      nodeId: 'asistente',
      model: null,
      system: 'Respondes solo sobre precios, horarios y envíos del servicio. Si no sabes algo, dilo y no inventes.',
      goal: 'Resolver la duda del usuario. Cuando quede resuelta o pida hablar con una persona, termina.',
      slots: [
        { name: 'resuelto', type: 'boolean', description: 'true si el usuario confirma que su duda está resuelta', required: true, collected: false },
        { name: 'motivo', type: 'string', description: 'Resumen en una frase de lo que necesita', required: false, collected: false },
      ],
      history: [],
      temperature: 0.2,
      locale: 'es',
      turn: 1,
      maxTurns: 10,
    },
  ],
  // Un turno posterior con Haiku 5.5: API estable, historial, lo recogido y el estado en el último user.
  [
    'haiku-turno-posterior',
    {
      nodeId: 'asistente',
      model: 'claude-haiku-5-5',
      system: null,
      goal: 'Consigue el email del usuario.',
      slots: [slot('email', 'email', { description: 'Email de contacto' }), slot('nombre', 'string', { description: 'Nombre', required: false, collected: true })],
      history: [
        { role: 'assistant', text: '¿Cómo te llamas?' },
        { role: 'user', text: 'Ana' },
        { role: 'assistant', text: 'Encantada, Ana. ¿Cuál es tu email?' },
        { role: 'user', text: 'es ana@example.com' },
      ],
      locale: 'en-GB',
      turn: 3,
      maxTurns: 5,
    },
  ],
  // Slots json, number, boolean y con nombre de Object, con Sonnet 5.5 por la API beta.
  [
    'sonnet-slots-json-y-nombres-de-object',
    {
      nodeId: 'datos',
      model: 'claude-sonnet-5-5',
      system: 'Eres un asistente de pedidos.',
      goal: 'Recoge el pedido.',
      slots: [slot('datos', 'json'), slot('__proto__', 'string'), slot('constructor', 'string'), slot('cantidad', 'number'), slot('urgente', 'boolean', { required: false })],
      history: [],
      locale: 'es',
      turn: 1,
      maxTurns: 8,
    },
  ],
];

describe('golden del cuerpo enviado', () => {
  it.each(cases)('%s', async (name, request, options) => {
    const output = Object.fromEntries((request?.slots ?? turnRequest().slots).map((_, index) => [`s${index}`, null]));
    const api = fakeApi([ok({ text: 'Hola', slots: output, types: valueTypesOf(request?.slots ?? turnRequest().slots) })]);
    await createAnthropicProvider({ client: api.client(), ...options })(turnRequest(request));
    expect(api.calls).toHaveLength(1);
    const call = api.calls[0]!;
    const { pathname, search } = new URL(call.url);
    const snapshot = { path: `${pathname}${search}`, anthropicBeta: call.headers['anthropic-beta'] ?? null, body: call.body };
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(`./golden/${name}.json`);
  });

  it('la tabla por defecto envía effort low en los tres golden', () => {
    expect(Object.values(DEFAULT_ANTHROPIC_MODELS).map((model) => model.effort)).toEqual(['low', 'low', 'low']);
  });
});
