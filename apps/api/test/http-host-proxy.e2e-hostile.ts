import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CRM_VARIABLES, startWorld, type HttpWorld } from './helpers/http-world.js';

// Lo ejecuta como proceso hijo `http-host-environment.e2e-spec.ts` con `NODE_USE_ENV_PROXY=1` y las variables de proxy
// apuntando a un servidor local que registra cada conexión: `NODE_USE_ENV_PROXY` se lee al arrancar Node (D19).
describe('salida http con el proxy del entorno (proceso hijo)', () => {
  let world: HttpWorld;

  beforeAll(async () => {
    world = await startWorld({ variables: CRM_VARIABLES });
  });
  afterAll(() => world.close());
  beforeEach(() => world.reset());

  it('Proxy del entorno ignorado', async () => {
    expect(process.env.NODE_USE_ENV_PROXY).toBe('1');
    expect(process.env.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const server = await world.crm();
    const id = await world.leadsReady();
    const body = await world.sendSize(id);
    expect(body.conversation).toMatchObject({ status: 'ended', outcome: 'lead-empresa' });
    expect(server.received()).toHaveLength(1);
  });
});
