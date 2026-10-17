import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app.js';
import { HTTP_NODE, leads } from './helpers/examples.js';

describe('POST /flows/validate (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const validate = (body: unknown) => request(testApp.server).post('/flows/validate').send(body as object);

  it('Flujo válido', async () => {
    const res = await validate(leads()).expect(200);
    expect(res.body).toEqual({ valid: true, issues: [], warnings: [] });
  });

  it('Flujo roto', async () => {
    const flow = leads();
    flow.nodes[0].color = 'rojo';
    const res = await validate(flow).expect(200);
    expect(res.body).toEqual({
      valid: false,
      issues: [{ layer: 'shape', path: '/nodes/0', nodeId: 'bienvenida', message: "propiedad no permitida 'color'" }],
      warnings: [],
    });
  });

  it('Flujo válido con avisos', async () => {
    const flow = leads();
    flow.nodes[HTTP_NODE].request.url = 'https://crm.example.com{{segmento}}/api/leads';
    const res = await validate(flow).expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.issues).toEqual([]);
    expect(res.body.warnings).toEqual([
      expect.objectContaining({ code: 'url_template_in_origin', path: '/nodes/6/request/url', nodeId: 'enviar-crm' }),
    ]);
  });

  it('Flujo inválido de un mega', async () => {
    const flow = leads();
    // `{},` son 3 bytes: casi 1 MiB de nodos vacíos, dentro del límite del cuerpo.
    flow.nodes = [];
    const prefix = JSON.stringify(flow).replace('"nodes":[]}', '"nodes":[');
    const suffix = ']}';
    const count = Math.floor((1_048_576 - prefix.length - suffix.length) / 3);
    const body = `${prefix}${Array.from({ length: count }, () => '{}').join(',')}${suffix}`;
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(1_048_576);
    expect(Buffer.byteLength(body)).toBeGreaterThan(1_040_000);

    const started = performance.now();
    const res = await request(testApp.server).post('/flows/validate').set('Content-Type', 'application/json').send(body).expect(200);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(res.body.valid).toBe(false);
    expect(res.body.issues).toHaveLength(101);
    expect(res.body.issues[100]).toEqual({
      layer: 'shape',
      path: '',
      code: 'too_many_issues',
      message: 'hay más errores: solo se muestran los 100 primeros',
    });
  });
});
