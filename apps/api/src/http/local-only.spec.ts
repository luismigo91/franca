import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ApiException } from './api-error.js';
import { isLocalHost, localOnly } from './local-only.js';

describe('isLocalHost', () => {
  it.each(['localhost:3001', 'LOCALHOST:3001', 'localhost', '127.0.0.1', '127.0.0.1:3001', '[::1]:3001', '[::1]', '[::1]:80'])(
    'admite %s',
    (host) => {
      expect(isLocalHost(host)).toBe(true);
    },
  );

  it.each([
    'evil.example:3001',
    'localhost.evil.example',
    'localhost.',
    '127.0.0.1.nip.io',
    '0.0.0.0:3001',
    '[::ffff:127.0.0.1]',
    '[::1]evil',
    '127.0.0.2',
    'localhost:',
    'localhost:abc',
    'localhost:123456',
    'localhost:80:80',
    'xlocalhost',
    '::1',
    '',
    undefined,
  ])('rechaza %j', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });
});

describe('localOnly', () => {
  const run = (headers: Record<string, string | undefined>): unknown => {
    let received: unknown;
    localOnly({ headers } as unknown as Request, undefined as never, (error?: unknown) => {
      received = error;
    });
    return received;
  };

  it('deja pasar un Host local sin Origin', () => {
    expect(run({ host: '127.0.0.1:3001' })).toBeUndefined();
  });

  it('rechaza un Host ajeno con forbidden_host', () => {
    expect(run({ host: 'evil.example:3001' })).toMatchObject({ code: 'forbidden_host' });
    expect(run({})).toMatchObject({ code: 'forbidden_host' });
  });

  it.each(['https://evil.example', 'http://localhost:3000', 'null', ''])('rechaza Origin %j con forbidden_origin', (origin) => {
    const error = run({ host: 'localhost:3001', origin });
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({ code: 'forbidden_origin' });
  });

  it('comprueba el Host antes que el Origin', () => {
    expect(run({ host: 'evil.example', origin: 'https://evil.example' })).toMatchObject({ code: 'forbidden_host' });
  });
});
