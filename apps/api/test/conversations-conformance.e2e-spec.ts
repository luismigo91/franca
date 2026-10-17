import { HOST_CONFORMANCE_CASES } from '@franca/engine/conformance';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsHarness, ResettableOutput, type ConformanceHarness } from './helpers/conversations-harness.js';
import { startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

/** Los casos de `HOST_CONFORMANCE_CASES` que cubre el host de conversaciones; los de `http` son de la feature 6b. */
const CASE_IDS = ['registros-llm', 'custodia-estado', 'una-continuacion', 'reclamacion-caducada'] as const;

describe('conformidad del host de conversaciones (e2e)', () => {
  const output = new ResettableOutput();
  let ctx: ConversationsContext;
  let harness: ConformanceHarness;

  beforeAll(async () => {
    output.install();
    ctx = await startConversationsContext({ logger: output.logger });
    harness = createConversationsHarness(ctx, output);
  });

  afterAll(async () => {
    // La petición que nunca termina de `reclamacion-caducada` se aborta antes de cerrar la app.
    harness.dispose();
    ctx.testApp.server.closeAllConnections();
    await ctx.reset();
    await ctx.close();
    output.uninstall();
  });

  it('Suite de conformidad', async () => {
    const cases = CASE_IDS.map((id) => ({ id, found: HOST_CONFORMANCE_CASES.find((candidate) => candidate.id === id) }));
    expect(cases.filter((candidate) => candidate.found === undefined).map((candidate) => candidate.id), 'casos que ya no existen en @franca/engine/conformance').toEqual([]);
    for (const { id, found } of cases) {
      // Vaciar la base, la salida y el reloj, y calentar el pool de Postgres, antes de cada caso: `una-continuacion` solo da
      // 200 ms para que las dos continuaciones lleguen a reclamar, y una conexión nueva podría comerse ese margen.
      await harness.reset();
      await harness.warmUp();
      expect(await found!.run(harness), id).toEqual([]);
    }
  });
});
