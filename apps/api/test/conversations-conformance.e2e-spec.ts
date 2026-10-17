import { HOST_CONFORMANCE_CASES } from '@franca/engine/conformance';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConversationsHarness, ResettableOutput, type ConformanceHarness } from './helpers/conversations-harness.js';
import { startConversationsContext, type ConversationsContext } from './helpers/conversations.js';

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
    const executed: string[] = [];
    for (const found of HOST_CONFORMANCE_CASES) {
      // Vaciar la base, la salida, la red y el reloj, y calentar el pool de Postgres, antes de cada caso: `una-continuacion` solo da
      // 200 ms para que las dos continuaciones lleguen a reclamar, y una conexión nueva podría comerse ese margen.
      await harness.reset();
      await harness.warmUp();
      expect(await found.run(harness), found.id).toEqual([]);
      executed.push(found.id);
    }
    // Un caso nuevo del motor entra solo; si alguno no se ejecutó, el test falla.
    expect(executed).toEqual(HOST_CONFORMANCE_CASES.map((candidate) => candidate.id));
    expect(executed).toHaveLength(HOST_CONFORMANCE_CASES.length);
  });
});
