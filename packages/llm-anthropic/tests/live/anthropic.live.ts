import { createLlmCapability, startSession, type LlmCapability, type LlmTurnRequest } from '@franca/engine';
import { describe, expect, it } from 'vitest';
import { createAnthropicClient, createAnthropicProvider } from '../../src/index.js';
import { readStructuredOutput } from '../../src/output.js';
import { fixture } from '../helpers/fake-api.js';

/**
 * Test en vivo (opcional, fuera de `pnpm test` y de la CI): tres turnos reales contra la API de Anthropic.
 *
 *   FRANCA_LIVE_ANTHROPIC=1 pnpm --filter @franca/llm-anthropic test:live
 *
 * con la clave exportada en la shell (el SDK la lee; el repo nunca guarda su valor). Si existe `CI`, además
 * exige `FRANCA_LIVE_ANTHROPIC_CI=1`. Con la opción activada y sin credenciales falla con un mensaje claro: no
 * se salta en silencio. Coste: céntimos (un turno de Haiku y dos de Opus con un `system` de unos 6000 tokens).
 *
 * Verifica las costuras que no se pueden comprobar sin red: la salida estructurada por la API beta sin la
 * cabecera `structured-outputs-*`, `fallbacks`, `effort`, el coste y que la caché del historial funciona de
 * verdad (`cache_read_input_tokens > 0` en el segundo turno).
 */
const enabled = process.env.FRANCA_LIVE_ANTHROPIC === '1' && (process.env.CI === undefined || process.env.FRANCA_LIVE_ANTHROPIC_CI === '1');

/** Un `system` lo bastante largo para superar el mínimo cacheable de Opus (4096 tokens). */
const POLICY =
  'Eres el asistente de una tienda de bicicletas. Respondes solo sobre precios, horarios y envíos. El envío cuesta 3 euros en la península y es gratis a partir de 50 euros. La tienda abre de lunes a sábado, de 10:00 a 20:00. Si no sabes algo, lo dices y no inventas. ';
const LONG_SYSTEM = POLICY.repeat(110);

const request = (overrides: Partial<LlmTurnRequest> = {}): LlmTurnRequest => ({
  nodeId: 'asistente',
  provider: 'principal',
  model: null,
  system: LONG_SYSTEM,
  goal: 'Resolver la duda del usuario. Cuando quede resuelta, termina.',
  slots: [
    { name: 'resuelto', type: 'boolean', description: 'true si el usuario confirma que su duda está resuelta', required: true, collected: false },
    { name: 'motivo', type: 'string', description: 'Resumen en una frase de lo que necesita', required: false, collected: false },
  ],
  history: [],
  temperature: null,
  locale: 'es',
  turn: 1,
  maxTurns: 6,
  ...overrides,
});

/** Un `fetch` que guarda el cuerpo de cada respuesta real (para comprobar su forma y el uso de caché). */
function recordingFetch(bodies: Record<string, any>[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await fetch(input, init);
    if (response.ok) bodies.push((await response.clone().json()) as Record<string, any>);
    return response;
  }) as typeof fetch;
}

describe.skipIf(!enabled)('API real de Anthropic', () => {
  it('hay credenciales en el entorno (si no, el test en vivo falla, no se salta)', () => {
    expect(process.env.ANTHROPIC_API_KEY, 'exporta ANTHROPIC_API_KEY en la shell para ejecutar el test en vivo').toBeTruthy();
  });

  it('Haiku 5.5 por la API estable: un turno con salida estructurada', async () => {
    const bodies: Record<string, any>[] = [];
    const provider = createAnthropicProvider({ client: createAnthropicClient({ fetch: recordingFetch(bodies) }) });
    const result = await provider(request({ model: 'claude-haiku-5-5', system: null, history: [] }));
    expect(result.kind).toBe('turn');
    if (result.kind !== 'turn') return;
    expect(result.text.trim()).not.toBe('');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.costUsd).toBeLessThan(0.1);
    expect(bodies).toHaveLength(1);
    // La forma real pasa la misma lectura que los fixtures y trae las mismas claves.
    expect(readStructuredOutput(bodies[0]!.content, request().slots)).not.toBeNull();
    for (const key of Object.keys(fixture('message-end-turn'))) expect(bodies[0], key).toHaveProperty(key);
  });

  it('Opus 5.5 por la API beta con fallbacks: dos turnos seguidos, y el segundo lee la caché del historial', async () => {
    const bodies: Record<string, any>[] = [];
    const provider = createAnthropicProvider({ client: createAnthropicClient({ fetch: recordingFetch(bodies) }) });
    const first = await provider(request({ model: 'claude-opus-5-5' }));
    expect(first.kind).toBe('turn');
    if (first.kind !== 'turn') return;
    const second = await provider(
      request({
        model: 'claude-opus-5-5',
        history: [
          { role: 'assistant', text: first.text },
          { role: 'user', text: '¿Cuánto cuesta el envío a Madrid?' },
        ],
        turn: 2,
      }),
    );
    expect(second.kind).toBe('turn');
    if (second.kind !== 'turn') return;
    for (const result of [first, second]) {
      expect(result.text.trim()).not.toBe('');
      expect(result.costUsd).toBeGreaterThan(0);
      expect(result.costUsd).toBeLessThan(0.1);
    }
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.usage.cache_read_input_tokens, 'la caché del historial no se lee en el segundo turno').toBeGreaterThan(0);
  });

  it('un nodo con 17 slots (más de los 16 parámetros con tipo unión que admite la API) da un turn', async () => {
    const types = ['string', 'email', 'phone', 'number', 'url', 'date', 'boolean', 'json'] as const;
    const slots = Array.from({ length: 17 }, (_, i) => ({
      name: `dato${i}`,
      type: types[i % types.length]!,
      description: `Valor opcional número ${i} (déjalo sin valor si el usuario no lo ha dado)`,
      required: false,
      collected: false,
    }));
    const provider = createAnthropicProvider({ client: createAnthropicClient() });
    const result = await provider(request({ model: 'claude-haiku-5-5', system: null, slots }));
    // Con `[T, "null"]` por slot, 17 slots daban un 400 ("Schema is too complex") en cada turno.
    expect(result.kind).toBe('turn');
  });

  it('un turno largo cabe en max_tokens y en el tiempo del turno: se mide y se registra su duración', async () => {
    const provider = createAnthropicProvider({ client: createAnthropicClient() });
    const started = performance.now();
    const result = await provider(
      request({ model: 'claude-haiku-5-5', system: null, goal: 'Explica con detalle, en unos 3500 caracteres, cómo elegir una bicicleta. No termines hasta llegar a esa longitud.', slots: [] }),
    );
    const elapsedMs = Math.round(performance.now() - started);
    console.info(`[live] turno largo de Haiku 5.5: ${elapsedMs} ms, ${result.kind === 'turn' ? result.text.length : 0} caracteres, costUsd ${'costUsd' in result ? result.costUsd : 'n/a'}`);
    expect(result.kind).toBe('turn');
    expect(elapsedMs, 'un turno no debe rozar turnTimeoutMs (60000)').toBeLessThan(60000 / 2);
  });

  it('una sesión completa de faq-ia con el motor real y el proveedor de Claude', async () => {
    const provider: LlmCapability = createAnthropicProvider({ client: createAnthropicClient() });
    const flow = {
      specVersion: '0.1',
      id: 'en-vivo',
      name: 'En vivo',
      variables: [{ name: 'resuelto', type: 'boolean', default: false }],
      start: 'a',
      nodes: [
        { id: 'a', type: 'llm', provider: 'principal', model: 'claude-haiku-5-5', goal: 'Saluda y pregunta en qué puedes ayudar.', slots: [{ variable: 'resuelto', description: 'true si el usuario confirma que su duda está resuelta' }], maxTurns: 3, costCapUsd: 0.05, next: 'ok', onExhausted: 'ko' },
        { id: 'ok', type: 'end', outcome: 'ok' },
        { id: 'ko', type: 'end', outcome: 'ko' },
      ],
    };
    const result = await startSession({ flow }, { llm: createLlmCapability({ principal: provider }) });
    expect(result.ok && result.status).toBe('waiting');
  });
});
