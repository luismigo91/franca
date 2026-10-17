import { describe, expect, it } from 'vitest';
import { CLAIM_TTL_MS, expiresAtOf, hasExpired, isClaimActive, LLM_WINDOW_MS } from './conversation-timing.js';

const T = new Date('2026-10-17T10:00:00.000Z');
const minutes = (value: number) => new Date(T.getTime() + value * 60_000);

describe('expiresAtOf', () => {
  it('sin settings, 1440 minutos', () => {
    expect(expiresAtOf(T, {})).toEqual(minutes(1440));
  });

  it('usa sessionTimeoutMinutes', () => {
    expect(expiresAtOf(T, { settings: { sessionTimeoutMinutes: 30 } })).toEqual(minutes(30));
  });

  it('settings sin sessionTimeoutMinutes, 1440', () => {
    expect(expiresAtOf(T, { settings: { typingDelayMs: 100 } })).toEqual(minutes(1440));
  });

  it('1e300 se acota a 525600 minutos', () => {
    expect(expiresAtOf(T, { settings: { sessionTimeoutMinutes: 1e300 } })).toEqual(minutes(525_600));
  });

  it('525601 se acota y 525600 pasa', () => {
    expect(expiresAtOf(T, { settings: { sessionTimeoutMinutes: 525_601 } })).toEqual(minutes(525_600));
    expect(expiresAtOf(T, { settings: { sessionTimeoutMinutes: 525_600 } })).toEqual(minutes(525_600));
  });
});

describe('isClaimActive', () => {
  const claimedAt = T;
  it('activa a 299 999 ms y caducada a 300 000 ms', () => {
    expect(CLAIM_TTL_MS).toBe(300_000);
    expect(isClaimActive('t', claimedAt, new Date(T.getTime() + 299_999))).toBe(true);
    expect(isClaimActive('t', claimedAt, new Date(T.getTime() + 300_000))).toBe(false);
  });

  it('sin testigo o sin instante no hay reclamación', () => {
    expect(isClaimActive(null, claimedAt, T)).toBe(false);
    expect(isClaimActive('t', null, T)).toBe(false);
  });
});

describe('hasExpired', () => {
  it('caduca en el instante exacto (>=)', () => {
    expect(hasExpired(minutes(30), new Date(minutes(30).getTime() - 1))).toBe(false);
    expect(hasExpired(minutes(30), minutes(30))).toBe(true);
  });

  it('sin expiresAt nunca caduca', () => {
    expect(hasExpired(null, minutes(1e9))).toBe(false);
  });
});

describe('constantes', () => {
  it('la ventana de turnos llm es de 90 segundos', () => {
    expect(LLM_WINDOW_MS).toBe(90_000);
  });
});
