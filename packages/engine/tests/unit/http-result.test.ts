import { describe, expect, it } from 'vitest';
import { HTTP_RESULT_KINDS, readAttemptResult } from '../../src/http/result.js';

describe('formas válidas', () => {
  it.each([
    [{ kind: 'response', status: 200, body: '' }, { kind: 'response', status: 200, body: '' }],
    [{ kind: 'response', status: 599, body: '{}' }, { kind: 'response', status: 599, body: '{}' }],
    [{ kind: 'response', status: 204, body: '' }, { kind: 'response', status: 204, body: '' }],
    [{ kind: 'timeout' }, { kind: 'timeout' }],
    [{ kind: 'network_error' }, { kind: 'network_error', requestSent: true }],
    [{ kind: 'network_error', requestSent: true }, { kind: 'network_error', requestSent: true }],
    [{ kind: 'network_error', requestSent: false }, { kind: 'network_error', requestSent: false }],
    [{ kind: 'network_error', requestSent: undefined }, { kind: 'network_error', requestSent: true }],
    [{ kind: 'blocked' }, { kind: 'blocked' }],
    [{ kind: 'response_too_large' }, { kind: 'response_too_large' }],
    [{ kind: 'missing_secret' }, { kind: 'missing_secret' }],
  ])('%j', (raw, expected) => {
    expect(readAttemptResult(raw)).toEqual(expected);
  });

  it('las propiedades adicionales se ignoran y no se copian', () => {
    const read = readAttemptResult({ kind: 'response', status: 200, body: '{}', headers: { 'set-cookie': 's=1' }, extra: 1 });
    expect(read).toEqual({ kind: 'response', status: 200, body: '{}' });
    expect(Object.keys(read!)).toEqual(['kind', 'status', 'body']);
  });
});

describe('Resultados mal formados', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'response'],
    ['número', 200],
    ['array', [{ kind: 'timeout' }]],
    ['función', () => ({ kind: 'timeout' })],
    ['kind desconocido', { kind: 'otro' }],
    ['sin kind', {}],
    ['kind no string', { kind: 5 }],
    ['kind con mayúsculas', { kind: 'Timeout' }],
    ['status 199', { kind: 'response', status: 199, body: '' }],
    ['status 600', { kind: 'response', status: 600, body: '' }],
    ['status 200.5', { kind: 'response', status: 200.5, body: '' }],
    ['status NaN', { kind: 'response', status: NaN, body: '' }],
    ['status Infinity', { kind: 'response', status: Infinity, body: '' }],
    ['status string', { kind: 'response', status: '200', body: '' }],
    ['sin status', { kind: 'response', body: '' }],
    ['body número', { kind: 'response', status: 200, body: 5 }],
    ['sin body', { kind: 'response', status: 200 }],
    ['body null', { kind: 'response', status: 200, body: null }],
    ['body String objeto', { kind: 'response', status: 200, body: new String('x') }],
    ['requestSent string', { kind: 'network_error', requestSent: 'no' }],
    ['requestSent null', { kind: 'network_error', requestSent: null }],
    ['requestSent 0', { kind: 'network_error', requestSent: 0 }],
  ])('%s → null', (_name, raw) => {
    expect(readAttemptResult(raw)).toBeNull();
  });

  it('un getter que lanza en kind, status, body o requestSent → null', () => {
    const boom = () => {
      throw new Error('boom');
    };
    expect(readAttemptResult({ get kind() { return boom(); } })).toBeNull();
    expect(readAttemptResult({ kind: 'response', get status() { return boom(); }, body: '' })).toBeNull();
    expect(readAttemptResult({ kind: 'response', status: 200, get body() { return boom(); } })).toBeNull();
    expect(readAttemptResult({ kind: 'network_error', get requestSent() { return boom(); } })).toBeNull();
  });

  it('un getter de una propiedad que no se lee no se toca', () => {
    let reads = 0;
    const raw = {
      kind: 'timeout',
      get status() {
        reads++;
        return 1;
      },
      get body() {
        reads++;
        return '';
      },
    };
    expect(readAttemptResult(raw)).toEqual({ kind: 'timeout' });
    expect(reads).toBe(0);
  });
});

describe('prototipos', () => {
  it('prototipo null y de clase se aceptan: la forma la dan las propiedades', () => {
    expect(readAttemptResult(Object.assign(Object.create(null), { kind: 'blocked' }))).toEqual({ kind: 'blocked' });
    class Result {
      kind = 'response';
      status = 201;
      body = 'x';
    }
    expect(readAttemptResult(new Result())).toEqual({ kind: 'response', status: 201, body: 'x' });
    class Inherited {
      get kind() {
        return 'timeout';
      }
    }
    expect(readAttemptResult(new Inherited())).toEqual({ kind: 'timeout' });
  });
});

describe('lecturas', () => {
  function recording(target: Record<string, unknown>) {
    const reads: string[] = [];
    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        reads.push(String(key));
        return Reflect.get(t, key, receiver);
      },
    });
    return { proxy, reads };
  }

  // Se llama directamente a readAttemptResult: a través de la promesa del host el runtime lee además `then`.
  it.each([
    ['response', { kind: 'response', status: 200, body: 'x', headers: {}, extra: 1 }, ['kind', 'status', 'body']],
    ['timeout', { kind: 'timeout', status: 200, body: 'x' }, ['kind']],
    ['network_error', { kind: 'network_error', requestSent: false, body: 'x' }, ['kind', 'requestSent']],
    ['blocked', { kind: 'blocked', status: 200 }, ['kind']],
    ['response_too_large', { kind: 'response_too_large', body: 'x' }, ['kind']],
    ['missing_secret', { kind: 'missing_secret', body: 'x' }, ['kind']],
  ])('%s: solo kind y los campos de ese kind, una vez cada uno', (_name, target, expected) => {
    const { proxy, reads } = recording(target);
    expect(readAttemptResult(proxy)).not.toBeNull();
    expect(reads).toEqual(expected);
  });

  it('un resultado fuera de contrato tampoco lee más de lo necesario', () => {
    const { proxy, reads } = recording({ kind: 'otro', status: 200, body: '' });
    expect(readAttemptResult(proxy)).toBeNull();
    expect(reads).toEqual(['kind']);
  });
});

describe('HTTP_RESULT_KINDS', () => {
  it('lista exactamente los kind del contrato', () => {
    expect([...HTTP_RESULT_KINDS].sort()).toEqual(['blocked', 'missing_secret', 'network_error', 'response', 'response_too_large', 'timeout']);
  });
});
