import { describe, expect, it } from 'vitest';
import { buildApiEnvironment, createRunToken, DEMO_VARIABLE_NAMES, demoHttpVariables, findConflicts } from '../../demo/demo-config.mjs';

describe('demoHttpVariables', () => {
  it('por defecto da los cuatro valores exactos de la spec', () => {
    expect(demoHttpVariables({ token: 'Bearer prueba-config' })).toEqual({
      FRANCA_HTTP_LOCAL_NAMES: 'crm.franca.test=127.0.0.1',
      FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:4010',
      FRANCA_HTTP_SECRET_ORIGINS: 'CRM_TOKEN=http://crm.franca.test:4010',
      FRANCA_SECRET_CRM_TOKEN: 'Bearer prueba-config',
    });
  });

  it('con otro puerto cambia solo el puerto, en el destino y en el origen', () => {
    const variables = demoHttpVariables({ token: 'Bearer t', crmPort: 5123 });
    expect(variables.FRANCA_HTTP_ALLOWED_DESTINATIONS).toBe('127.0.0.1:5123');
    expect(variables.FRANCA_HTTP_SECRET_ORIGINS).toBe('CRM_TOKEN=http://crm.franca.test:5123');
    expect(variables.FRANCA_HTTP_LOCAL_NAMES).toBe('crm.franca.test=127.0.0.1');
  });

  it('DEMO_VARIABLE_NAMES son esas cuatro, en ese orden', () => {
    expect([...DEMO_VARIABLE_NAMES]).toEqual(Object.keys(demoHttpVariables({ token: 'Bearer t' })));
  });
});

describe('createRunToken', () => {
  it('es Bearer más 43 caracteres base64url (256 bits) y distinto cada vez', () => {
    const first = createRunToken();
    const second = createRunToken();
    expect(first).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });
});

describe('findConflicts', () => {
  it.each([...DEMO_VARIABLE_NAMES])('%s definida, también vacía, es un conflicto', (name) => {
    expect(findConflicts({ [name]: 'x' })).toEqual([name]);
    expect(findConflicts({ [name]: '' })).toEqual([name]);
  });

  it('devuelve los nombres en el orden fijo y nunca valores', () => {
    const conflicts = findConflicts({ FRANCA_SECRET_CRM_TOKEN: 'Bearer no-mostrar-3', FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080' });
    expect(conflicts).toEqual(['FRANCA_HTTP_ALLOWED_DESTINATIONS', 'FRANCA_SECRET_CRM_TOKEN']);
  });

  it('una variable ausente o undefined no es un conflicto, ni la clave de Claude ni otras FRANCA_SECRET_*', () => {
    expect(findConflicts({ FRANCA_ANTHROPIC_API_KEY: 'x', FRANCA_SECRET_OTRO: 'y', PATH: '/bin' })).toEqual([]);
    expect(findConflicts({})).toEqual([]);
  });
});

describe('buildApiEnvironment', () => {
  const shell = { PATH: '/bin', DATABASE_URL: 'postgresql://x', FRANCA_ANTHROPIC_API_KEY: 'clave-no-usar', FRANCA_SECRET_OTRO: 'Bearer otro' };

  it('quita la clave de Claude, añade las cuatro variables y desactiva la telemetría de Next y turbo', () => {
    const built = buildApiEnvironment(shell, 'Bearer prueba-config');
    expect(Object.hasOwn(built, 'FRANCA_ANTHROPIC_API_KEY')).toBe(false);
    expect(built).toMatchObject({ ...demoHttpVariables({ token: 'Bearer prueba-config' }), NEXT_TELEMETRY_DISABLED: '1', TURBO_TELEMETRY_DISABLED: '1' });
    expect(built).toMatchObject({ PATH: '/bin', DATABASE_URL: 'postgresql://x', FRANCA_SECRET_OTRO: 'Bearer otro' });
  });

  it('no modifica su entrada', () => {
    const before = JSON.stringify(shell);
    buildApiEnvironment(shell, 'Bearer t');
    expect(JSON.stringify(shell)).toBe(before);
  });
});
