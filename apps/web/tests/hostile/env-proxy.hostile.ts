import { expect, it } from 'vitest';
import { parseApiUrl } from '@/server/config/api-url.mjs';
import { sendToApi } from '@/server/api/transport';

// Corre en un proceso hijo con `NODE_USE_ENV_PROXY=1` y las variables de proxy hacia una trampa (lo lanza
// `tests/api-transport-env-proxy.test.ts`). Node lee esas variables al arrancar, por eso no puede ser el mismo proceso.
it('el transporte envía a la API sin pasar por el proxy del entorno', async () => {
  expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
  const result = await sendToApi({ method: 'GET', path: '/ping', timeoutMs: 5000 }, parseApiUrl(process.env.HOSTILE_API_URL));
  expect(result).toMatchObject({ kind: 'response', status: 200 });
});
