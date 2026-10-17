import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * PKI del test, **en memoria**: dos autoridades (una que la salida http acepta solo en los tests y otra que no) y certificados
 * de hoja por nombre, firmados con `node:crypto` y un codificador DER mínimo. Ninguna clave ni certificado toca el disco ni
 * el repositorio: se generan al cargar el módulo.
 */

// ---- DER mínimo ----

const concat = (...parts: Buffer[]): Buffer => Buffer.concat(parts);

function der(tag: number, content: Buffer): Buffer {
  if (content.length < 0x80) return concat(Buffer.from([tag, content.length]), content);
  const length = Buffer.from(content.length.toString(16).padStart(content.length > 0xff ? 4 : 2, '0'), 'hex');
  return concat(Buffer.from([tag, 0x80 | length.length]), length, content);
}

const sequence = (...parts: Buffer[]): Buffer => der(0x30, concat(...parts));
const set = (...parts: Buffer[]): Buffer => der(0x31, concat(...parts));

function integer(value: Buffer): Buffer {
  let bytes = value;
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  return der(0x02, bytes[0]! & 0x80 ? concat(Buffer.from([0]), bytes) : bytes);
}

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let remaining = arc >> 7; remaining > 0; remaining >>= 7) groups.unshift((remaining & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

const utf8String = (text: string): Buffer => der(0x0c, Buffer.from(text, 'utf8'));
const utcTime = (text: string): Buffer => der(0x17, Buffer.from(text, 'ascii'));
const octetString = (content: Buffer): Buffer => der(0x04, content);
const boolean = (value: boolean): Buffer => der(0x01, Buffer.from([value ? 0xff : 0x00]));
const bitString = (content: Buffer, unusedBits = 0): Buffer => der(0x03, concat(Buffer.from([unusedBits]), content));

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const COMMON_NAME = '2.5.4.3';

const name = (commonName: string): Buffer => sequence(set(sequence(oid(COMMON_NAME), utf8String(commonName))));

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));
}

const basicConstraints = (isAuthority: boolean): Buffer => extension('2.5.29.19', true, sequence(...(isAuthority ? [boolean(true)] : [])));

/** `keyCertSign` y `cRLSign` (bits 5 y 6) para una autoridad; `digitalSignature` (bit 0) para una hoja. */
const keyUsage = (isAuthority: boolean): Buffer => extension('2.5.29.15', true, isAuthority ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7));

const subjectAltName = (hostname: string): Buffer => extension('2.5.29.17', false, sequence(der(0x82, Buffer.from(hostname, 'ascii'))));

const serverAuth = (): Buffer => extension('2.5.29.37', false, sequence(oid('1.3.6.1.5.5.7.3.1')));

function certificate(options: { subject: string; issuer: string; publicKey: KeyObject; signer: KeyObject; extensions: Buffer[] }): Buffer {
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(randomBytes(8)),
    sequence(oid(ECDSA_SHA256)),
    name(options.issuer),
    // Entre 2020 y 2049 (UTCTime llega a 2049): ningún escenario usa certificados caducados.
    sequence(utcTime('200101000000Z'), utcTime('491231235959Z')),
    name(options.subject),
    options.publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, sequence(...options.extensions)),
  );
  const signature = sign('sha256', tbs, options.signer);
  return sequence(tbs, sequence(oid(ECDSA_SHA256)), bitString(signature));
}

const pem = (label: string, body: Buffer): string => `-----BEGIN ${label}-----\n${body.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;

// ---- Autoridades y hojas ----

export interface TestLeaf {
  /** Clave privada de la hoja, en PEM. */
  readonly key: string;
  /** Certificado de la hoja, en PEM. */
  readonly certificate: string;
}

export interface TestAuthority {
  /** Certificado de la autoridad, en PEM: es lo que la red del test pone en `ca`. */
  readonly certificate: string;
  /** Certificado de hoja para `hostname`, firmado por esta autoridad (el mismo objeto en cada llamada). */
  issue(hostname: string): TestLeaf;
}

/**
 * Crea una autoridad nueva con una clave EC P-256.
 *
 * @param commonName Nombre de la autoridad.
 * @returns La autoridad.
 */
export function createAuthority(commonName: string): TestAuthority {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const authorityCertificate = certificate({
    subject: commonName,
    issuer: commonName,
    publicKey: pair.publicKey,
    signer: pair.privateKey,
    extensions: [basicConstraints(true), keyUsage(true)],
  });
  const leaves = new Map<string, TestLeaf>();
  return {
    certificate: pem('CERTIFICATE', authorityCertificate),
    issue(hostname) {
      const known = leaves.get(hostname);
      if (known) return known;
      const leafPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const leaf: TestLeaf = {
        key: leafPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        certificate: pem(
          'CERTIFICATE',
          certificate({
            subject: hostname,
            issuer: commonName,
            publicKey: leafPair.publicKey,
            signer: pair.privateKey,
            extensions: [basicConstraints(false), keyUsage(false), serverAuth(), subjectAltName(hostname)],
          }),
        ),
      };
      leaves.set(hostname, leaf);
      return leaf;
    },
  };
}

/** La autoridad que la salida http acepta solo en los tests (`HttpNetwork.ca`). */
export const trustedAuthority: TestAuthority = createAuthority('Franca Test CA');

/** Una autoridad que la salida http no acepta nunca. */
export const untrustedAuthority: TestAuthority = createAuthority('Franca Untrusted Test CA');
