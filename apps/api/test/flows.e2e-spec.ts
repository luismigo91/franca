import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

const specDir = dirname(createRequire(import.meta.url).resolve('@franca/spec/flow.schema.json'));
const example = (name: string) => JSON.parse(readFileSync(join(specDir, name), 'utf8'));

describe('FlowsController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /flows/validate acepta un flujo válido', () => {
    return request(app.getHttpServer())
      .post('/flows/validate')
      .send(example('examples/captacion-leads.json'))
      .expect(200)
      .expect({ valid: true, issues: [] });
  });

  it('POST /flows/validate devuelve los problemas de un flujo roto', async () => {
    const flow = example('examples/captacion-leads.json');
    flow.nodes[0].color = 'rojo';
    const res = await request(app.getHttpServer()).post('/flows/validate').send(flow).expect(200);
    expect(res.body).toEqual({
      valid: false,
      issues: [{ layer: 'shape', path: '/nodes/0', nodeId: 'bienvenida', message: "propiedad no permitida 'color'" }],
    });
  });
});
