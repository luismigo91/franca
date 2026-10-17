import { describe, expect, it } from 'vitest';
import { isLocalHost } from '@/server/config/local-host.cjs';

describe('isLocalHost', () => {
  it('se importa como lo hace frontier.ts y es una función', () => {
    expect(typeof isLocalHost).toBe('function');
  });

  it.each(['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:3000', '[::1]', '[::1]:3000', 'LOCALHOST:3000', 'LocalHost', '127.0.0.1:1', 'localhost:65535'])(
    'admite %j',
    (host) => {
      expect(isLocalHost(host)).toBe(true);
    },
  );

  it.each([
    'localhost.evil.example',
    'localhost.evil.example:3000',
    '127.0.0.1.nip.io',
    '127.0.0.1.nip.io:3000',
    'localhost.',
    'localhost.:3000',
    'evil.example',
    'evil.example:3000',
    '',
    'localhost:',
    'localhost:123456',
    'localhost:abc',
    'localhost:3000:3000',
    '[::1',
    '[::2]:3000',
    '[::1]x',
    '0.0.0.0',
    ' localhost',
    'localhost ',
    'user@localhost',
    'localhost/',
  ])('rechaza %j', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });

  it('rechaza un Host ausente', () => {
    expect(isLocalHost(null)).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
  });
});
