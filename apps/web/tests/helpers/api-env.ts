import { afterAll, afterEach, beforeAll } from 'vitest';
import { startFakeApi, type FakeApi } from './fake-api';

/**
 * Arranca una API simulada para el fichero de test y apunta `FRANCA_API_URL` a ella. Se registra con los ganchos de
 * Vitest; devuelve un objeto cuyo `api` está disponible dentro de los tests.
 */
export function withFakeApi(): { readonly api: FakeApi } {
  const holder: { api: FakeApi | null } = { api: null };
  const previous = process.env.FRANCA_API_URL;
  beforeAll(async () => {
    holder.api = await startFakeApi();
    process.env.FRANCA_API_URL = holder.api.url;
  });
  afterEach(() => holder.api?.reset());
  afterAll(async () => {
    await holder.api?.close();
    if (previous === undefined) delete process.env.FRANCA_API_URL;
    else process.env.FRANCA_API_URL = previous;
  });
  return {
    get api() {
      if (!holder.api) throw new Error('la API simulada aún no ha arrancado');
      return holder.api;
    },
  };
}
