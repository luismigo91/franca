import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FlowsRepository } from '../src/flows/flows.repository.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { Barrier, BarrierFlowsRepository } from './helpers/barrier.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { leads } from './helpers/examples.js';

describe('concurrencia (e2e)', () => {
  let testApp: TestApp;
  let prisma: PrismaClient;
  let api: ApiClient;

  beforeAll(async () => {
    testApp = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(FlowsRepository).useFactory({
          factory: (service: PrismaService) => new BarrierFlowsRepository(service, new Barrier(2)),
          inject: [PrismaService],
        }),
    });
    prisma = createTestPrisma();
    api = client(testApp.server);
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('Dos pestañas guardan a la vez', async () => {
    await api.create(leads()).expect(201);
    const a = leads();
    a.name = 'A';
    const b = leads();
    b.name = 'B';
    const [first, second] = await Promise.all([api.update('captacion-leads', a, '"1"'), api.update('captacion-leads', b, '"1"')]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 412]);
    const winner = first.status === 200 ? first : second;
    const loser = first.status === 200 ? second : first;
    expect(winner.body.revision).toBe(2);
    expect(loser.body).toEqual({ message: expect.any(String), error: 'revision_mismatch', currentRevision: 2 });
    const stored = (await api.get('captacion-leads').expect(200)).body;
    expect(stored.revision).toBe(2);
    expect(stored.name).toBe(winner.body.name);
    expect(stored.flow).toEqual(winner.body.flow);
  });

  it('Dos publicaciones a la vez', async () => {
    await api.create(leads()).expect(201);
    const [first, second] = await Promise.all([api.publish('captacion-leads'), api.publish('captacion-leads')]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 201]);
    expect(first.body.version).toBe(1);
    expect(second.body.version).toBe(1);
    expect((await api.versions('captacion-leads').expect(200)).body.total).toBe(1);
  });
});
