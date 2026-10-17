import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { HTTP_NODE, leads } from './helpers/examples.js';
import { captureOutput } from './helpers/output.js';

describe('privacidad de los registros (e2e)', () => {
  let testApp: TestApp | undefined;
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
  });

  afterEach(async () => {
    await testApp?.close();
    testApp = undefined;
    await prisma.$disconnect();
  });

  it('Token pegado en un flujo', async () => {
    // La captura va antes de crear la app para incluir también la salida del arranque.
    const output = captureOutput();
    testApp = await createTestApp({ logger: output.logger });
    const api = client(testApp.server);

    const rejected = leads();
    rejected.nodes[HTTP_NODE].request.headers.Authorization = 'Bearer abc123';
    await api.create(rejected).expect(400);
    await api.create(leads()).expect(201);
    await api.get('captacion-leads').expect(200);
    await api.get('captacion-leads').set('Authorization', 'Bearer secreto-cliente').expect(200);
    await api.update('captacion-leads', rejected, '"1"').expect(400);
    await api.publish('captacion-leads').expect(201);

    const text = output.text();
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('secreto-cliente');
    // Ningún texto de nodo del flujo (mensajes, preguntas, etiquetas).
    for (const node of leads().nodes) {
      const texts = JSON.stringify(node).match(/"(?:text|label)":"([^"]+)"/g) ?? [];
      for (const found of texts) expect(text).not.toContain(found.replace(/^"[a-z]+":"/, '').replace(/"$/, ''));
    }
    expect(text).not.toContain('Alguien del equipo comercial');
    expect(text).not.toContain('Te hago tres preguntas');
    // El arranque sí deja rastro: el arnés está capturando de verdad.
    expect(output.lines().some((line) => line.includes('Nest application successfully started'))).toBe(true);
  });
});
