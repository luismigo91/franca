import { describe, expect, it } from 'vitest';
import { createAllowedDestinations, decideDestination, type AllowedDestinations, type ResolvedEntry } from './destination-policy.js';

const v4 = (address: string): ResolvedEntry => ({ address, family: 4 });
const v6 = (address: string): ResolvedEntry => ({ address, family: 6 });
const NONE: AllowedDestinations = createAllowedDestinations([]);
const only = (...keys: string[]): AllowedDestinations => createAllowedDestinations(keys.map((key) => ({ key })));

const decide = (entries: ResolvedEntry[], { port = 443, secure = true, allowed = NONE }: { port?: number; secure?: boolean; allowed?: AllowedDestinations } = {}) =>
  decideDestination({ entries, port, secure, allowed });

describe('decideDestination', () => {
  it('una pública con https conecta, con la dirección canónica y su familia', () => {
    expect(decide([v4('1.2.3.4')])).toEqual({ kind: 'connect', targets: [{ address: '1.2.3.4', family: 4 }] });
    expect(decide([v6('64:ff9b::0102:0304')])).toEqual({ kind: 'connect', targets: [{ address: '64:ff9b::102:304', family: 6 }] });
  });

  it('una interna se bloquea con internal_destination, también https', () => {
    for (const entry of [v4('10.0.0.5'), v4('169.254.169.254'), v6('::1'), v6('fe80::1'), v6('::ffff:192.168.1.1'), v6('64:ff9b::a9fe:a9fe')]) {
      expect(decide([entry]), String(entry.address)).toEqual({ kind: 'blocked', reason: 'internal_destination' });
    }
  });

  it('resolución mezclada: se bloquea entera en los dos órdenes', () => {
    expect(decide([v4('1.2.3.4'), v4('10.0.0.5')])).toEqual({ kind: 'blocked', reason: 'internal_destination' });
    expect(decide([v4('10.0.0.5'), v4('1.2.3.4')])).toEqual({ kind: 'blocked', reason: 'internal_destination' });
  });

  it('un par permitido deja pasar una dirección interna; solo ese par, no la dirección con otro puerto', () => {
    const allowed = only('127.0.0.1|8080');
    expect(decide([v4('127.0.0.1')], { port: 8080, secure: false, allowed })).toEqual({ kind: 'connect', targets: [{ address: '127.0.0.1', family: 4 }] });
    expect(decide([v4('127.0.0.1')], { port: 8081, secure: false, allowed })).toEqual({ kind: 'blocked', reason: 'internal_destination' });
    expect(decide([v4('127.0.0.2')], { port: 8080, secure: false, allowed })).toEqual({ kind: 'blocked', reason: 'internal_destination' });
  });

  it('http hacia una pública no permitida: insecure_transport; hacia un par permitido, conecta', () => {
    expect(decide([v4('1.2.3.4')], { port: 80, secure: false })).toEqual({ kind: 'blocked', reason: 'insecure_transport' });
    expect(decide([v4('1.2.3.4')], { port: 80, secure: false, allowed: only('1.2.3.4|80') })).toEqual({ kind: 'connect', targets: [{ address: '1.2.3.4', family: 4 }] });
    expect(decide([v4('1.2.3.4')], { port: 80, secure: false, allowed: only('1.2.3.4|81') })).toEqual({ kind: 'blocked', reason: 'insecure_transport' });
  });

  it('http con una dirección interna y otra pública: gana internal_destination', () => {
    expect(decide([v4('10.0.0.5'), v4('1.2.3.4')], { port: 80, secure: false })).toEqual({ kind: 'blocked', reason: 'internal_destination' });
    expect(decide([v4('10.0.0.5')], { port: 80, secure: false })).toEqual({ kind: 'blocked', reason: 'internal_destination' });
  });

  it('http con una permitida y otra pública sin permitir: insecure_transport (todas deben ser pares permitidos)', () => {
    expect(decide([v4('127.0.0.1'), v4('1.2.3.4')], { port: 8080, secure: false, allowed: only('127.0.0.1|8080') })).toEqual({ kind: 'blocked', reason: 'insecure_transport' });
  });

  it('una IPv6 mapeada se compara como su IPv4 contra la lista de permitidos', () => {
    const allowed = only('127.0.0.1|8080');
    expect(decide([v6('::ffff:7f00:1')], { port: 8080, secure: false, allowed })).toEqual({ kind: 'connect', targets: [{ address: '127.0.0.1', family: 4 }] });
    expect(decide([v6('::ffff:127.0.0.1')], { port: 8080, secure: false, allowed })).toEqual({ kind: 'connect', targets: [{ address: '127.0.0.1', family: 4 }] });
  });

  it('una IPv6 permitida vale escrita de cualquier forma', () => {
    const allowed = only('::1|8443');
    for (const text of ['::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001']) {
      expect(decide([v6(text)], { port: 8443, secure: false, allowed }), text).toEqual({ kind: 'connect', targets: [{ address: '::1', family: 6 }] });
    }
  });

  it('sin repetidos tras canonizar, conservando el orden', () => {
    const allowed = only('127.0.0.1|8080', '::1|8080');
    const decision = decide([v6('::ffff:7f00:1'), v4('127.0.0.1'), v6('0:0:0:0:0:0:0:1'), v6('::1')], { port: 8080, secure: false, allowed });
    expect(decision).toEqual({
      kind: 'connect',
      targets: [
        { address: '127.0.0.1', family: 4 },
        { address: '::1', family: 6 },
      ],
    });
  });

  it('el orden de la resolución se conserva', () => {
    const decision = decide([v4('1.2.3.5'), v4('1.2.3.4'), v6('2606:4700::1111')]);
    expect(decision).toEqual({
      kind: 'connect',
      targets: [
        { address: '1.2.3.5', family: 4 },
        { address: '1.2.3.4', family: 4 },
        { address: '2606:4700::1111', family: 6 },
      ],
    });
  });

  it('falla cerrado: una entrada que no es una dirección bloquea entera la resolución, esté donde esté', () => {
    const bad: ResolvedEntry[] = [{ address: 'crm.example.com', family: 4 }, { address: undefined, family: 4 }, { address: 42, family: 4 }, { address: '1.2.3.4', family: 6 }, { address: '::1', family: 4 }, { address: '1.2.3.4', family: undefined }, { address: '01.2.3.4', family: 4 }];
    for (const entry of bad) {
      expect(decide([entry]), JSON.stringify(entry)).toEqual({ kind: 'blocked', reason: 'internal_destination' });
      expect(decide([v4('1.2.3.4'), entry]), JSON.stringify(entry)).toEqual({ kind: 'blocked', reason: 'internal_destination' });
      expect(decide([entry, v4('1.2.3.4')]), JSON.stringify(entry)).toEqual({ kind: 'blocked', reason: 'internal_destination' });
    }
  });

  it('una entrada no analizable no se salta aunque el par exista en la lista de permitidos', () => {
    expect(decide([{ address: '127.0.0.1 ', family: 4 }], { port: 8080, secure: false, allowed: only('127.0.0.1|8080') })).toEqual({ kind: 'blocked', reason: 'internal_destination' });
  });

  it('una dirección con zona nunca es permitida por un par sin zona', () => {
    expect(decide([v6('fe80::1%en0')], { port: 8080, secure: false, allowed: only('fe80::1|8080') })).toEqual({ kind: 'blocked', reason: 'internal_destination' });
  });

  it('una resolución vacía no tiene a qué conectar: connect sin destinos (lo trata http-host)', () => {
    expect(decide([])).toEqual({ kind: 'connect', targets: [] });
  });
});

describe('createAllowedDestinations', () => {
  it('compara claves exactas', () => {
    const allowed = createAllowedDestinations([{ key: '127.0.0.1|8080' }]);
    expect(allowed.has('127.0.0.1|8080')).toBe(true);
    expect(allowed.has('127.0.0.1|8081')).toBe(false);
    expect(allowed.has('127.0.0.1')).toBe(false);
  });
});
