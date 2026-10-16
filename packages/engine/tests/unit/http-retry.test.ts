import { schema } from '@franca/spec';
import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BODY_LENGTH } from '../../src/constants.js';
import type { AttemptResult } from '../../src/http/result.js';
import { IDEMPOTENT, judgeAttempt } from '../../src/http/retry.js';
import type { HttpMethod } from '../../src/types.js';

const METHODS: HttpMethod[] = ['GET', 'PUT', 'DELETE', 'POST', 'PATCH'];
const response = (status: number, body = ''): AttemptResult => ({ kind: 'response', status, body });

type Row = [label: string, result: AttemptResult, idempotentRetry: boolean, anyMethodRetry: boolean, reason: string | null, status: number | null];

/** [resultado, ¿se reintenta en un método idempotente?, ¿en POST/PATCH?, motivo, status] */
const TABLE: Row[] = [
  ['200', response(200), false, false, null, 200],
  ['204', response(204), false, false, null, 204],
  ['299', response(299), false, false, null, 299],
  ['301', response(301), false, false, 'http_status', 301],
  ['400', response(400), false, false, 'http_status', 400],
  ['404', response(404), false, false, 'http_status', 404],
  ['408', response(408), true, true, 'http_status', 408],
  ['429', response(429), true, true, 'http_status', 429],
  ['500', response(500), true, false, 'http_status', 500],
  ['501', response(501), false, false, 'http_status', 501],
  ['502', response(502), true, false, 'http_status', 502],
  ['503', response(503), true, false, 'http_status', 503],
  ['504', response(504), true, false, 'http_status', 504],
  ['505', response(505), false, false, 'http_status', 505],
  ['599', response(599), false, false, 'http_status', 599],
  ['timeout', { kind: 'timeout' }, true, false, 'timeout', null],
  ['network_error sin enviar', { kind: 'network_error', requestSent: false }, true, true, 'network_error', null],
  ['network_error enviada', { kind: 'network_error', requestSent: true }, true, false, 'network_error', null],
  ['blocked', { kind: 'blocked' }, false, false, 'blocked', null],
  ['response_too_large', { kind: 'response_too_large' }, false, false, 'response_too_large', null],
  ['cuerpo de 1 MiB exacto con 200', response(200, 'a'.repeat(MAX_RESPONSE_BODY_LENGTH)), false, false, null, 200],
  ['cuerpo de 1 MiB + 1 con 200', response(200, 'a'.repeat(MAX_RESPONSE_BODY_LENGTH + 1)), false, false, 'response_too_large', 200],
  ['cuerpo de 1 MiB + 1 con 503', response(503, 'a'.repeat(MAX_RESPONSE_BODY_LENGTH + 1)), false, false, 'response_too_large', 503],
  ['cuerpo de 1 MiB + 1 con 404', response(404, 'a'.repeat(MAX_RESPONSE_BODY_LENGTH + 1)), false, false, 'response_too_large', 404],
];

describe('tabla método × resultado', () => {
  for (const [label, result, idempotentRetry, anyMethodRetry, reason, status] of TABLE) {
    for (const method of METHODS) {
      it(`${label} con ${method}`, () => {
        const verdict = judgeAttempt(result as Exclude<AttemptResult, { kind: 'missing_secret' }>, method);
        if (reason === null) {
          expect(verdict).toEqual({ ok: true, status, body: (result as { body: string }).body });
          return;
        }
        expect(verdict).toEqual({ ok: false, reason, status, retryable: IDEMPOTENT[method] ? idempotentRetry : anyMethodRetry });
      });
    }
  }
});

describe('IDEMPOTENT', () => {
  it('métodos de RFC 9110', () => {
    expect(IDEMPOTENT).toEqual({ GET: true, PUT: true, DELETE: true, POST: false, PATCH: false });
  });

  it('tiene exactamente los métodos del esquema', () => {
    const methods = (schema.$defs.httpNode.properties.request.properties.method as { enum: string[] }).enum;
    expect(Object.keys(IDEMPOTENT).sort()).toEqual([...methods].sort());
  });
});
