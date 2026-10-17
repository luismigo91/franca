import { CONFORMANCE_INTERNAL_ADDRESSES } from '@franca/engine/conformance';
import { describe, expect, it } from 'vitest';
import { canonicalIp, destinationKey, isGlobalUnicast, parseIp } from './addresses.js';
import { IPV4_SPECIAL_PURPOSE, IPV6_SPECIAL_PURPOSE, type SpecialPurposeEntry } from './special-purpose-addresses.js';

const global = (text: string): boolean => {
  const parsed = parseIp(text);
  if (parsed === null) throw new Error(`no es una dirección: ${text}`);
  return isGlobalUnicast(parsed);
};

/** Primer y último valor de un prefijo, escritos como texto de la misma familia. */
function edges(entry: SpecialPurposeEntry): [string, string] {
  const first = parseIp(entry.address)!;
  const last = Uint8Array.from(first.bytes);
  for (let bit = entry.length; bit < last.length * 8; bit++) last[bit >> 3]! |= 0x80 >> (bit & 7);
  const text = (bytes: Uint8Array): string =>
    first.family === 4
      ? Array.from(bytes).join('.')
      : Array.from({ length: 8 }, (_unused, index) => ((bytes[index * 2]! << 8) | bytes[index * 2 + 1]!).toString(16)).join(':');
  return [text(first.bytes), text(last)];
}

describe('parseIp', () => {
  it('lee IPv4 e IPv6 en cualquier forma escrita', () => {
    expect(parseIp('1.2.3.4')).toMatchObject({ family: 4, zone: null });
    expect(Array.from(parseIp('1.2.3.4')!.bytes)).toEqual([1, 2, 3, 4]);
    const loopback = Array.from(parseIp('::1')!.bytes);
    expect(loopback).toEqual([...Array(15).fill(0), 1]);
    for (const text of ['0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '0::1', '::0.0.0.1']) {
      expect(Array.from(parseIp(text)!.bytes), text).toEqual(loopback);
    }
    expect(Array.from(parseIp('::ffff:7f00:1')!.bytes)).toEqual(Array.from(parseIp('::ffff:127.0.0.1')!.bytes));
    expect(Array.from(parseIp('1:2:3:4:5:6:7::')!.bytes)).toEqual([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 0]);
    expect(Array.from(parseIp('64:ff9b::1.2.3.4')!.bytes).slice(12)).toEqual([1, 2, 3, 4]);
  });

  it('una zona marca la dirección y se conserva', () => {
    expect(parseIp('fe80::1%en0')).toMatchObject({ family: 6, zone: 'en0' });
  });

  it('falla cerrado: lo que no es una dirección bien escrita da null', () => {
    const bad: unknown[] = [null, undefined, 0, {}, ['1.2.3.4'], '', ' 1.2.3.4', '1.2.3.4 ', '1.2.3', '1.2.3.256', '01.2.3.4', '010.0.0.1', '127.1', '0x7f.0.0.1', 'localhost', '[::1]', '::g', '1:2:3:4:5:6:7:8:9', '1::2::3', '::1%', '1.2.3.4%en0'];
    for (const value of bad) expect(parseIp(value), JSON.stringify(value)).toBeNull();
  });
});

describe('canonicalIp', () => {
  const canon = (text: string): string => canonicalIp(parseIp(text)!);

  it('una IPv6 mapeada es su IPv4, escrita como se escriba', () => {
    for (const text of ['::ffff:7f00:1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:0001', '0000:0000:0000:0000:0000:FFFF:7F00:0001']) expect(canon(text), text).toBe('127.0.0.1');
  });

  it('IPv6 en RFC 5952: minúsculas, sin ceros a la izquierda y la racha más larga comprimida', () => {
    expect(canon('0:0:0:0:0:0:0:1')).toBe('::1');
    expect(canon('0000:0000:0000:0000:0000:0000:0000:0001')).toBe('::1');
    expect(canon('0:0:0:0:0:0:0:0')).toBe('::');
    expect(canon('2001:DB8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
    expect(canon('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1');
    expect(canon('1:0:3:4:5:6:7:8')).toBe('1:0:3:4:5:6:7:8');
    expect(canon('1:0:0:4:5:6:7:8')).toBe('1::4:5:6:7:8');
    expect(canon('64:ff9b::1.2.3.4')).toBe('64:ff9b::102:304');
    expect(canon('fe80::1%en0')).toBe('fe80::1%en0');
  });

  it('IPv4 en decimal con puntos', () => {
    expect(canon('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('destinationKey', () => {
  it('compara direcciones, no texto: la misma dirección escrita de formas distintas da la misma clave', () => {
    expect(destinationKey('::ffff:7f00:1', 8080)).toBe('127.0.0.1|8080');
    expect(destinationKey('127.0.0.1', 8080)).toBe('127.0.0.1|8080');
    expect(destinationKey('0:0:0:0:0:0:0:1', 8443)).toBe(destinationKey('::1', 8443));
    expect(destinationKey('::1', 8443)).toBe('::1|8443');
  });

  it('el puerto cuenta y lo que no es una dirección no tiene clave', () => {
    expect(destinationKey('127.0.0.1', 8080)).not.toBe(destinationKey('127.0.0.1', 8081));
    expect(destinationKey('crm.example.com', 80)).toBeNull();
    expect(destinationKey(undefined, 80)).toBeNull();
  });
});

describe('isGlobalUnicast: registros de IANA', () => {
  describe('IPv4: una fila por entrada de la tabla', () => {
    it.each(IPV4_SPECIAL_PURPOSE.map((entry) => [`${entry.address}/${entry.length} ${entry.name}`, entry] as const))('%s', (_label, entry) => {
      const [first, last] = edges(entry);
      // multicast aparte: la tabla no lo trae
      expect(global(first), `primero ${first}`).toBe(entry.globallyReachable === true);
      expect(global(last), `último ${last}`).toBe(entry.globallyReachable === true);
    });
  });

  describe('IPv6: una fila por entrada de la tabla', () => {
    it.each(IPV6_SPECIAL_PURPOSE.map((entry) => [`${entry.address}/${entry.length} ${entry.name}`, entry] as const))('%s', (_label, entry) => {
      const [first, last] = edges(entry);
      // 64:ff9b::/96 se juzga por la IPv4 que incrusta (0.0.0.0 y 255.255.255.255: no globales).
      const expected = entry.address === '64:ff9b::' ? false : entry.globallyReachable === true;
      expect(global(first), `primero ${first}`).toBe(expected);
      expect(global(last), `último ${last}`).toBe(expected);
    });
  });

  it('IPv4 fuera de los bloques especiales es global', () => {
    for (const text of ['1.2.3.4', '1.2.3.5', '8.8.8.8', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0', '126.255.255.255', '128.0.0.0', '172.15.255.255', '172.32.0.0', '192.0.1.0', '192.88.98.255', '192.88.100.0', '192.167.255.255', '192.169.0.0', '198.17.255.255', '198.20.0.0', '198.51.99.255', '198.51.101.0', '203.0.112.255', '203.0.114.0', '223.255.255.255']) {
      expect(global(text), text).toBe(true);
    }
  });

  it('IPv4 multicast no es global y fuera de él, sí', () => {
    for (const text of ['224.0.0.0', '224.0.0.1', '239.255.255.250', '239.255.255.255']) expect(global(text), text).toBe(false);
    expect(global('223.255.255.255')).toBe(true);
    expect(global('240.0.0.0')).toBe(false);
  });

  it('IPv4: las entradas globales dentro de 192.0.0.0/24 lo son y sus vecinas no', () => {
    expect(global('192.0.0.9')).toBe(true);
    expect(global('192.0.0.10')).toBe(true);
    expect(global('192.0.0.8')).toBe(false);
    expect(global('192.0.0.11')).toBe(false);
    expect(global('192.0.0.170')).toBe(false);
    expect(global('192.0.0.171')).toBe(false);
    expect(global('192.31.196.1')).toBe(true);
    expect(global('192.52.193.1')).toBe(true);
    expect(global('192.175.48.1')).toBe(true);
  });

  it('6a44 (192.88.99.2) y el bloque deprecado de 6to4 no son globales', () => {
    expect(global('192.88.99.2')).toBe(false);
    expect(global('192.88.99.1')).toBe(false);
  });

  it('IPv6 global típica lo es', () => {
    for (const text of ['2001:4860:4860::8888', '2606:4700::1111', '2a00:1450:4001::1', '2001:200::1', '2001:db9::1', '2001:1::1', '2001:1::2', '2001:1::3', '2001:3::1', '2001:4:112::1', '2001:20::1', '2001:30::1', '2620:4f:8000::1', '3ffe::1', '3ffe:ffff::1', '2001:db7:ffff::1']) {
      expect(global(text), text).toBe(true);
    }
  });

  it('IPv6 de los bloques no globales y fuera de 2000::/3', () => {
    for (const text of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::7', '100::1', '100:0:0:1::1', '2001:2::1', '2001:1::4', '2001:10::1', '3fff::1', '3fff:fff:ffff::1', '4000::1', '5f00::1', 'e000::1', '1fff::1']) {
      expect(global(text), text).toBe(false);
    }
  });

  it('mapeadas y NAT64 se juzgan por la IPv4 que incrustan', () => {
    expect(global('::ffff:1.2.3.4')).toBe(true);
    expect(global('::ffff:0102:0304')).toBe(true);
    expect(global('64:ff9b::1.2.3.4')).toBe(true);
    expect(global('64:ff9b::102:304')).toBe(true);
    expect(global('::ffff:192.168.1.1')).toBe(false);
    expect(global('::ffff:127.0.0.1')).toBe(false);
    expect(global('::ffff:169.254.169.254')).toBe(false);
    expect(global('64:ff9b::a00:5')).toBe(false);
    expect(global('64:ff9b::a9fe:a9fe')).toBe(false);
    expect(global('64:ff9b::7f00:1')).toBe(false);
    expect(global('64:ff9b::c000:9')).toBe(true);
  });

  it('IPv4-compatible, NAT64 local, 6to4 y Teredo nunca son globales', () => {
    for (const text of ['::127.0.0.1', '::1.2.3.4', '::102:304', '64:ff9b:1::a9fe:a9fe', '64:ff9b:1::102:304', '2002:7f00:1::1', '2002:102:304::1', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2']) {
      expect(global(text), text).toBe(false);
    }
  });

  it('una dirección con zona no es global', () => {
    expect(global('fe80::1%en0')).toBe(false);
    expect(global('2606:4700::1111%en0')).toBe(false);
  });

  it('las 32 direcciones de CONFORMANCE_INTERNAL_ADDRESSES del motor son no globales', () => {
    expect(CONFORMANCE_INTERNAL_ADDRESSES).toHaveLength(32);
    for (const text of CONFORMANCE_INTERNAL_ADDRESSES) expect(global(text), text).toBe(false);
  });

  it('las direcciones públicas virtuales del test (P, P1, P2 y la NAT64 de P) son globales', () => {
    for (const text of ['1.2.3.4', '1.2.3.5', '1.2.3.6', '64:ff9b::102:304']) expect(global(text), text).toBe(true);
    // TEST-NET-2, de donde el arnés saca las direcciones de sus servidores permitidos, no lo es
    expect(global('198.51.100.1')).toBe(false);
  });
});
