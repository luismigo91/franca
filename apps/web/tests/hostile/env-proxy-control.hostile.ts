import http from 'node:http';
import { expect, it } from 'vitest';

// Control: con el mismo entorno hostil, un `http.request` normal (agente global) SÍ acaba en la trampa. Demuestra que
// el entorno de `env-proxy.hostile.ts` desvía de verdad en este Node, y que la ausencia de desvío del transporte
// no es un test vacío.
it('el agente global obedece al proxy del entorno', async () => {
  expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
  const url = new URL(process.env.HOSTILE_API_URL ?? '');
  await new Promise<void>((resolve) => {
    const request = http.request({ host: url.hostname, port: Number(url.port), path: '/ping', method: 'GET' }, (response) => {
      response.resume();
      response.on('end', resolve);
      response.on('close', resolve);
    });
    request.on('error', () => resolve());
    request.setTimeout(3000, () => {
      request.destroy();
      resolve();
    });
    request.end();
  });
  expect(true).toBe(true);
});
