/**
 * Los registros de direcciones de propósito especial de IANA (RFC 6890 y sus actualizaciones), como datos.
 *
 * Instantánea contrastada el 2026-10-17 con los CSV oficiales:
 * - https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv
 * - https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv
 *
 * Cada fila guarda el valor de la columna «Globally Reachable»: `true`, `false` o `null` para `N/A` y para las
 * entradas deprecadas sin valor, que cuentan como no globales. Las filas que IANA agrupa en una celda
 * (`192.0.0.170/32, 192.0.0.171/32`) van separadas. Actualizar la tabla cuando cambien los registros (RFC 9602, 9637 y
 * 9780 son de 2024-2025) es un cambio de conducta: va primero a la spec de `http-host`.
 */
export interface SpecialPurposeEntry {
  /** Dirección base del bloque. */
  readonly address: string;
  /** Longitud del prefijo en bits. */
  readonly length: number;
  readonly globallyReachable: boolean | null;
  /** Nombre del registro (solo documentación). */
  readonly name: string;
}

const row = (address: string, length: number, globallyReachable: boolean | null, name: string): SpecialPurposeEntry => ({ address, length, globallyReachable, name });

/** Registro IPv4 (`iana-ipv4-special-registry`). `255.255.255.255/32` y `240.0.0.0/4` están además fuera de unicast. */
export const IPV4_SPECIAL_PURPOSE: readonly SpecialPurposeEntry[] = [
  row('0.0.0.0', 8, false, 'This network'),
  row('0.0.0.0', 32, false, 'This host on this network'),
  row('10.0.0.0', 8, false, 'Private-Use'),
  row('100.64.0.0', 10, false, 'Shared Address Space'),
  row('127.0.0.0', 8, false, 'Loopback'),
  row('169.254.0.0', 16, false, 'Link Local'),
  row('172.16.0.0', 12, false, 'Private-Use'),
  row('192.0.0.0', 24, false, 'IETF Protocol Assignments'),
  row('192.0.0.0', 29, false, 'IPv4 Service Continuity Prefix'),
  row('192.0.0.8', 32, false, 'IPv4 dummy address'),
  row('192.0.0.9', 32, true, 'Port Control Protocol Anycast'),
  row('192.0.0.10', 32, true, 'Traversal Using Relays around NAT Anycast'),
  row('192.0.0.170', 32, false, 'NAT64/DNS64 Discovery'),
  row('192.0.0.171', 32, false, 'NAT64/DNS64 Discovery'),
  row('192.0.2.0', 24, false, 'Documentation (TEST-NET-1)'),
  row('192.31.196.0', 24, true, 'AS112-v4'),
  row('192.52.193.0', 24, true, 'AMT'),
  row('192.88.99.0', 24, null, 'Deprecated (6to4 Relay Anycast)'),
  // 6a44: IANA lo marca no global; se trata como no global también si el registro cambiara.
  row('192.88.99.2', 32, false, '6a44-relay anycast address'),
  row('192.168.0.0', 16, false, 'Private-Use'),
  row('192.175.48.0', 24, true, 'Direct Delegation AS112 Service'),
  row('198.18.0.0', 15, false, 'Benchmarking'),
  row('198.51.100.0', 24, false, 'Documentation (TEST-NET-2)'),
  row('203.0.113.0', 24, false, 'Documentation (TEST-NET-3)'),
  row('240.0.0.0', 4, false, 'Reserved'),
  row('255.255.255.255', 32, false, 'Limited Broadcast'),
];

/**
 * Registro IPv6 (`iana-ipv6-special-registry`). `64:ff9b::/96` figura como global, pero se juzga por la IPv4
 * que incrusta (`addresses.ts`); los prefijos NAT64 propios de un operador (RFC 6052) no se pueden detectar.
 */
export const IPV6_SPECIAL_PURPOSE: readonly SpecialPurposeEntry[] = [
  row('::1', 128, false, 'Loopback Address'),
  row('::', 128, false, 'Unspecified Address'),
  row('::ffff:0:0', 96, false, 'IPv4-mapped Address'),
  row('64:ff9b::', 96, true, 'IPv4-IPv6 Translat.'),
  row('64:ff9b:1::', 48, false, 'IPv4-IPv6 Translat. (local-use)'),
  row('100::', 64, false, 'Discard-Only Address Block'),
  row('100:0:0:1::', 64, false, 'Dummy IPv6 Prefix'),
  row('2001::', 23, false, 'IETF Protocol Assignments'),
  row('2001::', 32, null, 'TEREDO'),
  row('2001:1::1', 128, true, 'Port Control Protocol Anycast'),
  row('2001:1::2', 128, true, 'Traversal Using Relays around NAT Anycast'),
  row('2001:1::3', 128, true, 'DNS-SD Service Registration Protocol Anycast'),
  row('2001:2::', 48, false, 'Benchmarking'),
  row('2001:3::', 32, true, 'AMT'),
  row('2001:4:112::', 48, true, 'AS112-v6'),
  row('2001:10::', 28, null, 'Deprecated (previously ORCHID)'),
  row('2001:20::', 28, true, 'ORCHIDv2'),
  row('2001:30::', 28, true, 'Drone Remote ID Protocol Entity Tags (DETs) Prefix'),
  row('2001:db8::', 32, false, 'Documentation'),
  row('2002::', 16, null, '6to4'),
  row('2620:4f:8000::', 48, true, 'Direct Delegation AS112 Service'),
  row('3fff::', 20, false, 'Documentation'),
  row('5f00::', 16, false, 'Segment Routing (SRv6) SIDs'),
  row('fc00::', 7, false, 'Unique-Local'),
  row('fe80::', 10, false, 'Link-Local Unicast'),
];
