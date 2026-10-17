import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  canonicalIp,
  destinationKey,
  isGlobalUnicast,
  parseIp,
} from './addresses.js';
import {
  createAllowedDestinations,
  decideDestination,
} from './destination-policy.js';

/**
 * QA adversarial de la clasificación de direcciones. El oráculo se escribió aparte de `addresses.ts` y de la tabla de
 * `special-purpose-addresses.ts`: aritmética con BigInt y la lista de rangos NO globales de RFC 6890 / IANA escrita a mano
 * (formulación inversa a la del código: aquí se enumera lo bloqueado y las excepciones «Globally Reachable»).
 */

type Range = readonly [start: bigint, end: bigint];

const v4 = (a: number, b: number, c: number, d: number): bigint =>
  (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d);
const v4range = (base: bigint, bits: number): Range => [
  base,
  base + (1n << BigInt(32 - bits)) - 1n,
];
const v6 = (groups: readonly number[]): bigint =>
  groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);
const v6range = (groups: readonly number[], bits: number): Range => {
  const padded = [...groups, ...Array<number>(8 - groups.length).fill(0)];
  const base = v6(padded);
  return [base, base + (1n << BigInt(128 - bits)) - 1n];
};
const inside = (value: bigint, ranges: readonly Range[]): boolean =>
  ranges.some(([start, end]) => value >= start && value <= end);

const V4_NOT_GLOBAL: readonly Range[] = [
  v4range(v4(0, 0, 0, 0), 8),
  v4range(v4(10, 0, 0, 0), 8),
  v4range(v4(100, 64, 0, 0), 10),
  v4range(v4(127, 0, 0, 0), 8),
  v4range(v4(169, 254, 0, 0), 16),
  v4range(v4(172, 16, 0, 0), 12),
  v4range(v4(192, 0, 0, 0), 24),
  v4range(v4(192, 0, 2, 0), 24),
  v4range(v4(192, 88, 99, 0), 24),
  v4range(v4(192, 168, 0, 0), 16),
  v4range(v4(198, 18, 0, 0), 15),
  v4range(v4(198, 51, 100, 0), 24),
  v4range(v4(203, 0, 113, 0), 24),
  v4range(v4(224, 0, 0, 0), 4),
  v4range(v4(240, 0, 0, 0), 4),
];
/** Excepciones «Globally Reachable» dentro de lo anterior. */
const V4_REACHABLE_EXCEPTIONS: readonly Range[] = [
  [v4(192, 0, 0, 9), v4(192, 0, 0, 9)],
  [v4(192, 0, 0, 10), v4(192, 0, 0, 10)],
];
const oracleV4 = (value: bigint): boolean =>
  inside(value, V4_REACHABLE_EXCEPTIONS) || !inside(value, V4_NOT_GLOBAL);

const V6_NOT_GLOBAL_INSIDE_2000: readonly Range[] = [
  v6range([0x2001], 23),
  v6range([0x2001, 0xdb8], 32),
  v6range([0x2002], 16),
  v6range([0x3fff], 20),
];
const V6_REACHABLE_EXCEPTIONS: readonly Range[] = [
  [v6([0x2001, 1, 0, 0, 0, 0, 0, 1]), v6([0x2001, 1, 0, 0, 0, 0, 0, 3])],
  v6range([0x2001, 3], 32),
  v6range([0x2001, 4, 0x112], 48),
  v6range([0x2001, 0x20], 28),
  v6range([0x2001, 0x30], 28),
  v6range([0x2620, 0x4f, 0x8000], 48),
];
const MAPPED = v6range([0, 0, 0, 0, 0, 0xffff], 96);
const NAT64 = v6range([0x64, 0xff9b], 96);
const oracleV6 = (value: bigint): boolean => {
  if (inside(value, [MAPPED, NAT64])) return oracleV4(value & 0xffffffffn);
  if (!inside(value, [v6range([0x2000], 3)])) return false;
  return (
    inside(value, V6_REACHABLE_EXCEPTIONS) ||
    !inside(value, V6_NOT_GLOBAL_INSIDE_2000)
  );
};

const toV4Text = (value: bigint): string =>
  [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join('.');
const groupsOf = (value: bigint): number[] =>
  Array.from({ length: 8 }, (_unused, index) =>
    Number((value >> BigInt(112 - index * 16)) & 0xffffn),
  );

/** Todas las formas de escribir una IPv6 que `isIP` admite, para comprobar que todas dan los mismos 16 bytes. */
function v6Spellings(value: bigint): string[] {
  const g = groupsOf(value);
  const hex = g.map((group) => group.toString(16));
  const spellings = [
    hex.join(':'),
    hex
      .map((group) => group.padStart(4, '0'))
      .join(':')
      .toUpperCase(),
  ];
  for (let start = 0; start < 8; start++) {
    for (let end = start + 1; end <= 8; end++) {
      if (g.slice(start, end).some((group) => group !== 0)) break;
      spellings.push(
        `${hex.slice(0, start).join(':')}::${hex.slice(end).join(':')}`,
      );
    }
  }
  // Cola IPv4 incrustada: en la forma completa y comprimiendo la racha de ceros anterior.
  const tail = toV4Text(value & 0xffffffffn);
  const headHex = hex.slice(0, 6);
  spellings.push(`${headHex.join(':')}:${tail}`);
  for (let start = 0; start < 6; start++) {
    for (let end = start + 1; end <= 6; end++) {
      if (g.slice(start, end).some((group) => group !== 0)) break;
      spellings.push(
        `${headHex.slice(0, start).join(':')}::${headHex.slice(end).join(':')}${end < 6 ? ':' : ''}${tail}`,
      );
    }
  }
  return spellings;
}

/** PRNG determinista (mulberry32). */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const classify = (text: string): boolean => {
  const parsed = parseIp(text);
  if (parsed === null)
    throw new Error(`parseIp rechazó una dirección válida: ${text}`);
  return isGlobalUnicast(parsed);
};

// Decenas de miles de direcciones por test: medio segundo en local, más de 7 s en el runner de la CI con turbo
// corriendo a la vez los tests de todos los paquetes. El límite de 5 s por defecto daba falsos rojos.
const HEAVY = { timeout: 30_000 };

describe('QA clasificación: IPv4 frente a un oráculo independiente', HEAVY, () => {
  it('los bordes de cada rango (primero, último, anterior y siguiente) y 60 000 direcciones al azar coinciden con el oráculo', () => {
    const points = new Set<bigint>();
    for (const [start, end] of [...V4_NOT_GLOBAL, ...V4_REACHABLE_EXCEPTIONS]) {
      for (const point of [
        start - 1n,
        start,
        start + 1n,
        end - 1n,
        end,
        end + 1n,
      ])
        if (point >= 0n && point <= 0xffffffffn) points.add(point);
    }
    const next = rng(1);
    for (let i = 0; i < 60_000; i++)
      points.add(BigInt(Math.floor(next() * 4294967296)));
    const mismatches: string[] = [];
    for (const point of points) {
      const text = toV4Text(point);
      if (classify(text) !== oracleV4(point))
        mismatches.push(
          `${text}: código ${classify(text)} oráculo ${oracleV4(point)}`,
        );
    }
    expect(mismatches).toEqual([]);
    expect(points.size).toBeGreaterThan(60_000);
  });

  it.each([
    ['broadcast', '255.255.255.255', false],
    ['this host', '0.0.0.0', false],
    ['metadatos de la nube', '169.254.169.254', false],
    ['CGNAT inicio', '100.64.0.0', false],
    ['CGNAT fin', '100.127.255.255', false],
    ['justo antes del CGNAT', '100.63.255.255', true],
    ['justo después del CGNAT', '100.128.0.0', true],
    ['benchmarking inicio', '198.18.0.0', false],
    ['benchmarking fin', '198.19.255.255', false],
    ['justo después del benchmarking', '198.20.0.0', true],
    ['172.15.255.255 (fuera de 172.16/12)', '172.15.255.255', true],
    ['172.32.0.0 (fuera de 172.16/12)', '172.32.0.0', true],
    ['IETF 192.0.0.0', '192.0.0.0', false],
    ['IETF 192.0.0.255', '192.0.0.255', false],
    ['PCP anycast (global por IANA)', '192.0.0.9', true],
    ['TURN anycast (global por IANA)', '192.0.0.10', true],
    ['multicast 224.0.0.0', '224.0.0.0', false],
    ['multicast 239.255.255.255', '239.255.255.255', false],
    [
      'primer global tras el multicast sin él: 223.255.255.255',
      '223.255.255.255',
      true,
    ],
    ['reservado 240.0.0.0', '240.0.0.0', false],
    ['6to4 relay desuso', '192.88.99.1', false],
  ])('%s (%s) → global=%s', (_label, address, expected) => {
    expect(classify(address)).toBe(expected);
  });
});

describe('QA clasificación: IPv6 frente a un oráculo independiente', HEAVY, () => {
  it('bordes de cada rango y 60 000 direcciones al azar (también incrustando IPv4 en mapeadas y NAT64) coinciden con el oráculo', () => {
    const points = new Set<bigint>();
    const ranges: Range[] = [
      ...V6_NOT_GLOBAL_INSIDE_2000,
      ...V6_REACHABLE_EXCEPTIONS,
      MAPPED,
      NAT64,
      v6range([0x2000], 3),
      v6range([0x64, 0xff9b, 1], 48),
      v6range([0x2001], 32),
      v6range([0xfc00], 7),
      v6range([0xfe80], 10),
    ];
    for (const [start, end] of ranges)
      for (const point of [
        start - 1n,
        start,
        start + 1n,
        end - 1n,
        end,
        end + 1n,
      ])
        if (point >= 0n && point < 1n << 128n) points.add(point);
    const next = rng(2);
    const random128 = (): bigint => {
      let value = 0n;
      for (let i = 0; i < 8; i++)
        value = (value << 16n) | BigInt(Math.floor(next() * 65536));
      return value;
    };
    for (let i = 0; i < 20_000; i++) points.add(random128());
    // Prefijos conocidos con el resto al azar, para que las 60 000 caigan donde hay frontera.
    const prefixes: [number[], number][] = [
      [[0x2001], 16],
      [[0x2001, 0], 32],
      [[0x2001, 1], 32],
      [[0x2001, 0x20], 28],
      [[0x2001, 0xdb8], 32],
      [[0x2002], 16],
      [[0x3fff], 16],
      [[0x2620, 0x4f, 0x8000], 48],
      [[0x2606, 0x4700], 32],
      [[0x64, 0xff9b, 0, 0, 0, 0], 96],
      [[0, 0, 0, 0, 0, 0xffff], 96],
      [[0x64, 0xff9b, 1], 48],
      [[0], 96],
    ];
    for (let i = 0; i < 40_000; i++) {
      const [groups, bits] = prefixes[i % prefixes.length]!;
      const [start] = v6range(groups, bits);
      const mask = (1n << BigInt(128 - bits)) - 1n;
      points.add(start | (random128() & mask));
    }
    const mismatches: string[] = [];
    for (const point of points) {
      const text = groupsOf(point)
        .map((group) => group.toString(16))
        .join(':');
      if (classify(text) !== oracleV6(point))
        mismatches.push(
          `${text}: código ${classify(text)} oráculo ${oracleV6(point)}`,
        );
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(points.size).toBeGreaterThan(50_000);
  });

  it('todas las formas de escribir una dirección dan los mismos bytes y la misma clasificación (7 000 direcciones, todas las compresiones y la cola IPv4)', () => {
    const next = rng(3);
    let checked = 0;
    const failures: string[] = [];
    for (let i = 0; i < 7_000; i++) {
      // Con muchos ceros, para que haya rachas que comprimir.
      let value = 0n;
      for (let g = 0; g < 8; g++)
        value =
          (value << 16n) |
          (next() < 0.5 ? 0n : BigInt(Math.floor(next() * 65536)));
      if (i % 5 === 0) value = (value & ~0xffffffffn) | (value & 0xffffffffn); // sin cambios: variedad de colas
      const reference = groupsOf(value);
      for (const text of v6Spellings(value)) {
        if (isIP(text) !== 6) continue;
        checked++;
        const parsed = parseIp(text);
        const bytes =
          parsed === null
            ? null
            : Array.from(
                { length: 8 },
                (_unused, index) =>
                  (parsed.bytes[index * 2]! << 8) |
                  parsed.bytes[index * 2 + 1]!,
              );
        if (bytes === null || bytes.join(',') !== reference.join(','))
          failures.push(
            `${text} → ${bytes?.map((b) => b.toString(16)).join(':') ?? 'null'} esperado ${reference.map((b) => b.toString(16)).join(':')}`,
          );
        else if (isGlobalUnicast(parsed!) !== oracleV6(value))
          failures.push(`${text} clasifica distinto`);
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(30_000);
  });

  it('una IPv6 con zona nunca es global, tampoco si incrusta una IPv4 pública ni si es una global', () => {
    for (const text of [
      '2606:4700::1111%en0',
      '::ffff:1.2.3.4%en0',
      '64:ff9b::1.2.3.4%1',
      'fe80::1%lo0',
    ])
      expect(classify(text), text).toBe(false);
  });

  it.each([
    ['compatible con IPv4 pública (::a.b.c.d)', '::1.2.3.4'],
    ['compatible en hex', '::102:304'],
    ['IPv4-traducida (::ffff:0:a.b.c.d)', '::ffff:0:1.2.3.4'],
    ['NAT64 local con IPv4 pública', '64:ff9b:1::1.2.3.4'],
    ['NAT64 local, fin del /48', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff'],
    ['6to4 con IPv4 pública', '2002:102:304::1'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['Teredo, justo en 2001::/32', '2001::'],
    ['documentación', '2001:db8:ffff::1'],
    ['documentación nueva 3fff::/20', '3fff:fff:ffff::1'],
    ['benchmarking IPv6', '2001:2::1'],
    ['IETF 2001:0100::/24 (dentro del /23)', '2001:100::1'],
    ['ORCHID deprecado', '2001:10::1'],
    ['ULA', 'fd00:ec2::254'],
    ['ULA fc00', 'fc00::1'],
    ['link-local', 'fe80::1'],
    ['multicast', 'ff02::1'],
    ['loopback', '::1'],
    ['no especificada', '::'],
    ['descarte 100::/64', '100::1'],
    ['SRv6', '5f00::1'],
    ['mapeada con IPv4 privada', '::ffff:10.0.0.1'],
    ['mapeada con metadatos', '::ffff:a9fe:a9fe'],
    ['NAT64 con loopback', '64:ff9b::7f00:1'],
    ['NAT64 con broadcast', '64:ff9b::ffff:ffff'],
    ['NAT64 con CGNAT', '64:ff9b::6440:1'],
    ['NAT64 con 0.0.0.0', '64:ff9b::'],
  ])('%s (%s) está bloqueada', (_label, address) => {
    expect(classify(address)).toBe(false);
  });

  it.each([
    ['Cloudflare', '2606:4700:4700::1111'],
    ['Google', '2001:4860:4860::8888'],
    ['PCP anycast', '2001:1::1'],
    ['AS112', '2001:4:112::1'],
    ['AMT', '2001:3::1'],
    ['mapeada pública', '::ffff:1.2.3.4'],
    ['NAT64 pública', '64:ff9b::1.2.3.4'],
    ['NAT64 con PCP anycast v4', '64:ff9b::c000:9'],
    ['2001:200:: (fuera del /23)', '2001:200::1'],
    ['2a00::', '2a00:1450::1'],
  ])('%s (%s) es global', (_label, address) => {
    expect(classify(address)).toBe(true);
  });
});

describe('QA política de destinos: resoluciones hostiles', HEAVY, () => {
  const none = createAllowedDestinations([]);
  const decide = (
    entries: readonly { address: unknown; family: unknown }[],
    options: { port?: number; secure?: boolean; allowed?: string[] } = {},
  ) =>
    decideDestination({
      entries,
      port: options.port ?? 443,
      secure: options.secure ?? true,
      allowed: createAllowedDestinations(
        (options.allowed ?? []).map((key) => ({ key })),
      ),
    });
  const blocked = (reason: string) => ({ kind: 'blocked', reason });

  it('una resolución mezclada se bloquea entera, en cualquier orden y repetida', () => {
    const pub = { address: '1.2.3.4', family: 4 };
    for (const internal of [
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '::1',
      'fe80::1',
      '::ffff:10.0.0.5',
      '64:ff9b::7f00:1',
      '0.0.0.0',
    ]) {
      const bad = { address: internal, family: internal.includes(':') ? 6 : 4 };
      expect(decide([pub, bad]), internal).toEqual(
        blocked('internal_destination'),
      );
      expect(decide([bad, pub]), internal).toEqual(
        blocked('internal_destination'),
      );
      expect(decide([pub, pub, bad, pub]), internal).toEqual(
        blocked('internal_destination'),
      );
    }
  });

  it('entradas que no son direcciones, de familia equivocada o de tipo raro fallan cerrado', () => {
    const garbage: { address: unknown; family: unknown }[] = [
      { address: '1.2.3.4', family: 6 },
      { address: '1.2.3.4', family: '4' },
      { address: '1.2.3.4', family: undefined },
      { address: '2606:4700::1111', family: 4 },
      { address: '::ffff:1.2.3.4', family: 4 },
      { address: 'example.com', family: 4 },
      { address: '', family: 4 },
      { address: ' 1.2.3.4', family: 4 },
      { address: '1.2.3.4\n', family: 4 },
      { address: '1.2.3.4/32', family: 4 },
      { address: '1.2.3.04', family: 4 },
      { address: '0x01020304', family: 4 },
      { address: '16909060', family: 4 },
      { address: 16909060, family: 4 },
      { address: null, family: 4 },
      { address: { toString: () => '1.2.3.4' }, family: 4 },
      { address: ['1.2.3.4'], family: 4 },
    ];
    for (const entry of garbage)
      expect(decide([entry]), JSON.stringify(entry)).toEqual(
        blocked('internal_destination'),
      );
  });

  it('una entrada basura entre direcciones públicas bloquea toda la resolución', () => {
    expect(
      decide([
        { address: '1.2.3.4', family: 4 },
        { address: 'x', family: 4 },
        { address: '1.2.3.5', family: 4 },
      ]),
    ).toEqual(blocked('internal_destination'));
  });

  it('internal_destination gana a insecure_transport y http público sin permiso es insecure_transport', () => {
    expect(
      decide([{ address: '10.0.0.1', family: 4 }], { secure: false }),
    ).toEqual(blocked('internal_destination'));
    expect(
      decide(
        [
          { address: '1.2.3.4', family: 4 },
          { address: '10.0.0.1', family: 4 },
        ],
        { secure: false },
      ),
    ).toEqual(blocked('internal_destination'));
    expect(
      decide([{ address: '1.2.3.4', family: 4 }], { secure: false }),
    ).toEqual(blocked('insecure_transport'));
    expect(
      decide([{ address: '2606:4700::1111', family: 6 }], { secure: false }),
    ).toEqual(blocked('insecure_transport'));
  });

  it('un par permitido solo vale para su dirección Y su puerto: el resto de la resolución sigue mandando', () => {
    const key = destinationKey('127.0.0.1', 8080)!;
    const local = { address: '127.0.0.1', family: 4 };
    expect(
      decide([local], { port: 8080, secure: false, allowed: [key] }),
    ).toEqual({
      kind: 'connect',
      targets: [{ address: '127.0.0.1', family: 4 }],
    });
    expect(
      decide([local], { port: 8081, secure: false, allowed: [key] }),
    ).toEqual(blocked('internal_destination'));
    expect(
      decide([local], { port: 80, secure: false, allowed: [key] }),
    ).toEqual(blocked('internal_destination'));
    // Permitido 127.0.0.1:8080 no abre 127.0.0.2:8080 ni 10.0.0.1:8080
    for (const other of ['127.0.0.2', '10.0.0.1', '0.0.0.0']) {
      expect(
        decide([local, { address: other, family: 4 }], {
          port: 8080,
          secure: false,
          allowed: [key],
        }),
        other,
      ).toEqual(blocked('internal_destination'));
    }
    // Un par permitido no abre una resolución mezclada con una pública por http: la pública no es un par permitido.
    expect(
      decide([local, { address: '1.2.3.4', family: 4 }], {
        port: 8080,
        secure: false,
        allowed: [key],
      }),
    ).toEqual(blocked('insecure_transport'));
    // https a un par permitido también conecta.
    expect(
      decide([local], { port: 8080, secure: true, allowed: [key] }).kind,
    ).toBe('connect');
  });

  it('un par permitido en IPv6 se compara como dirección, no como texto, incluida la mapeada', () => {
    const allowed = [
      destinationKey('::1', 8443)!,
      destinationKey('::ffff:10.0.0.5', 80)!,
    ];
    for (const spelling of ['0:0:0:0:0:0:0:1', '0000::0001', '::0.0.0.1']) {
      expect(
        decide([{ address: spelling, family: 6 }], {
          port: 8443,
          secure: false,
          allowed,
        }).kind,
        spelling,
      ).toBe('connect');
    }
    expect(
      decide([{ address: '10.0.0.5', family: 4 }], {
        port: 80,
        secure: false,
        allowed,
      }).kind,
    ).toBe('connect');
    expect(
      decide([{ address: '::ffff:a00:5', family: 6 }], {
        port: 80,
        secure: false,
        allowed,
      }).kind,
    ).toBe('connect');
    // la mapeada permitida no autoriza otra dirección con otro puerto
    expect(
      decide([{ address: '10.0.0.5', family: 4 }], {
        port: 81,
        secure: false,
        allowed,
      }),
    ).toEqual(blocked('internal_destination'));
  });

  it('una dirección con zona solo se conecta si el par permitido la nombra con esa zona', () => {
    const zoned = { address: 'fe80::1%en0', family: 6 };
    expect(decide([zoned], { port: 80, secure: false })).toEqual(
      blocked('internal_destination'),
    );
    expect(
      decide([zoned], {
        port: 80,
        secure: false,
        allowed: [destinationKey('fe80::1', 80)!],
      }),
    ).toEqual(blocked('internal_destination'));
  });

  it('las direcciones repetidas o equivalentes se conectan una sola vez, en el orden de la resolución, y canónicas', () => {
    const decision = decide([
      { address: '::ffff:1.2.3.4', family: 6 },
      { address: '1.2.3.4', family: 4 },
      { address: '2606:4700:4700:0:0:0:0:1111', family: 6 },
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '1.2.3.5', family: 4 },
    ]);
    expect(decision).toEqual({
      kind: 'connect',
      targets: [
        { address: '1.2.3.4', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '1.2.3.5', family: 4 },
      ],
    });
  });

  it('la lista vacía de permitidos no deja pasar nada que no sea global y un conjunto vacío de entradas conecta con cero objetivos', () => {
    expect(
      decide([{ address: '127.0.0.1', family: 4 }], {
        port: 80,
        secure: false,
      }),
    ).toEqual(blocked('internal_destination'));
    expect(none.has('127.0.0.1|80')).toBe(false);
    expect(decide([])).toEqual({ kind: 'connect', targets: [] });
  });

  it('canonicalIp es idempotente y estable al reanalizar (30 000 direcciones)', () => {
    const next = rng(4);
    for (let i = 0; i < 30_000; i++) {
      let value = 0n;
      for (let g = 0; g < 8; g++)
        value =
          (value << 16n) |
          (next() < 0.5 ? 0n : BigInt(Math.floor(next() * 65536)));
      const once = canonicalIp(
        parseIp(
          groupsOf(value)
            .map((g) => g.toString(16))
            .join(':'),
        )!,
      );
      const twice = canonicalIp(parseIp(once)!);
      if (once !== twice) throw new Error(`no idempotente: ${once} → ${twice}`);
    }
  });
});
