import { MAX_RESPONSE_BODY_LENGTH } from '@franca/engine';
import { Readable } from 'node:stream';
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES, readResponseBody, type ResponseBodyHeaders, type ResponseBodyResult } from './response-body.js';

const MIB = 1_048_576;

/** Un stream en memoria con los trozos dados (cada uno, un `data`). */
const streamOf = (...chunks: Buffer[]): Readable => Readable.from(chunks, { objectMode: false });
const read = (chunks: Buffer[], headers: ResponseBodyHeaders = {}): Promise<ResponseBodyResult> => readResponseBody(streamOf(...chunks), headers);
const text = (value: string): ResponseBodyResult => ({ kind: 'text', text: value });
/** Parte un buffer en trozos de `size` bytes. */
const split = (buffer: Buffer, size: number): Buffer[] => Array.from({ length: Math.ceil(buffer.length / size) }, (_unused, index) => buffer.subarray(index * size, (index + 1) * size));

describe('MAX_RESPONSE_BYTES', () => {
  it('es el mismo número que el motor cuenta en unidades', () => {
    expect(MAX_RESPONSE_BYTES).toBe(MAX_RESPONSE_BODY_LENGTH);
  });
});

describe('readResponseBody: sin comprimir', () => {
  it('entrega el cuerpo como texto UTF-8, también repartido en trozos', async () => {
    expect(await read([Buffer.from('hola ñ ')], {})).toEqual(text('hola ñ '));
    const bytes = Buffer.from('€€€');
    expect(await read([bytes.subarray(0, 2), bytes.subarray(2, 5), bytes.subarray(5)])).toEqual(text('€€€'));
  });

  it('1 048 576 bytes justos pasan y 1 048 577 son too_large', async () => {
    const exact = await read(split(Buffer.alloc(MIB, 'a'), 65_536));
    expect(exact.kind).toBe('text');
    expect((exact as { text: string }).text).toHaveLength(MIB);
    expect(await read(split(Buffer.alloc(MIB + 1, 'a'), 65_536))).toEqual({ kind: 'too_large' });
  });

  it('un Content-Length mayor que el tope es too_large sin leer el cuerpo', async () => {
    const source = Readable.from([Buffer.from('x')]);
    expect(await readResponseBody(source, { contentLength: String(MIB + 1) })).toEqual({ kind: 'too_large' });
    expect(source.destroyed).toBe(true);
    expect(await read([Buffer.from('ok')], { contentLength: String(MIB) })).toEqual(text('ok'));
  });

  it('un cuerpo vacío es la cadena vacía', async () => {
    expect(await read([])).toEqual(text(''));
  });

  it('quita un BOM inicial y sustituye UTF-8 inválido', async () => {
    expect(await read([Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])])).toEqual(text('hi'));
    expect(await read([Buffer.from([0x68, 0xff, 0x69])])).toEqual(text('h�i'));
  });

  it('un corte a mitad de cuerpo es failed', async () => {
    const source = new Readable({ read() {} });
    const pending = readResponseBody(source, {});
    source.push(Buffer.from('par'));
    source.destroy(new Error('aborted'));
    expect(await pending).toEqual({ kind: 'failed' });
    const closed = new Readable({ read() {} });
    const pendingClose = readResponseBody(closed, {});
    closed.destroy();
    expect(await pendingClose).toEqual({ kind: 'failed' });
  });
});

describe('readResponseBody: comprimido', () => {
  const body = Buffer.from('{"id":"L-1","nota":"ñandú"}');

  it.each([
    ['gzip', gzipSync(body)],
    ['x-gzip', gzipSync(body)],
    ['GZIP', gzipSync(body)],
    [' gzip ', gzipSync(body)],
    ['deflate', deflateSync(body)],
    ['deflate', deflateRawSync(body)],
    ['br', brotliCompressSync(body)],
  ])('%s se descomprime', async (encoding, compressed) => {
    expect(await read([compressed], { contentEncoding: encoding })).toEqual(text(body.toString('utf8')));
    expect(await read(split(compressed, 3), { contentEncoding: encoding })).toEqual(text(body.toString('utf8')));
  });

  it('deflate con la cabecera zlib partida en dos trozos de un byte también se reconoce', async () => {
    const compressed = deflateSync(body);
    expect(await read([compressed.subarray(0, 1), compressed.subarray(1)], { contentEncoding: 'deflate' })).toEqual(text(body.toString('utf8')));
    const raw = deflateRawSync(body);
    expect(await read([raw.subarray(0, 1), raw.subarray(1)], { contentEncoding: 'deflate' })).toEqual(text(body.toString('utf8')));
  });

  it('deflate crudo cuyos dos primeros bytes parecen una cabecera zlib por el módulo 31 pero no tienen CM 8 se lee como crudo', async () => {
    // Bloque almacenado (RFC 1951): 0x01, LEN = 23, NLEN = ~23. 0x0117 es múltiplo de 31 pero su CM es 1.
    const data = Buffer.from('veintitres bytes de texto'.slice(0, 23));
    const raw = Buffer.concat([Buffer.from([0x01, 0x17, 0x00, 0xe8, 0xff]), data]);
    expect(((raw[0]! << 8) | raw[1]!) % 31).toBe(0);
    expect(await read([raw], { contentEncoding: 'deflate' })).toEqual(text(data.toString('utf8')));
  });

  it.each([
    ['gzip', (data: Buffer) => gzipSync(data, { level: 9 })],
    ['deflate', (data: Buffer) => deflateSync(data, { level: 9 })],
    ['deflate (crudo)', (data: Buffer) => deflateRawSync(data, { level: 9 })],
    ['br', (data: Buffer) => brotliCompressSync(data)],
  ])('una bomba finita de 2 MiB con %s es too_large', async (label, compress) => {
    const bomb = compress(Buffer.alloc(2 * MIB, 'a'));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(await read(split(bomb, 1024), { contentEncoding: label.startsWith('deflate') ? 'deflate' : label })).toEqual({ kind: 'too_large' });
  });

  it('1 048 576 bytes descomprimidos justos pasan; 1 048 577 son too_large', async () => {
    const exact = await read([gzipSync(Buffer.alloc(MIB, 'a'))], { contentEncoding: 'gzip' });
    expect(exact.kind).toBe('text');
    expect((exact as { text: string }).text).toHaveLength(MIB);
    expect(await read([gzipSync(Buffer.alloc(MIB + 1, 'a'))], { contentEncoding: 'gzip' })).toEqual({ kind: 'too_large' });
  });

  it('el tope cuenta los bytes descomprimidos, no los de red', async () => {
    const compressed = gzipSync(Buffer.alloc(MIB, 'a'));
    expect(compressed.length).toBeLessThan(10_000);
    expect((await read([compressed], { contentEncoding: 'gzip' })).kind).toBe('text');
  });

  it('una codificación desconocida o una lista se entrega tal cual, con el tope sobre los bytes recibidos', async () => {
    const compressed = gzipSync(body);
    const asBytes = new TextDecoder('utf-8').decode(compressed);
    expect(await read([compressed], { contentEncoding: 'gzip, br' })).toEqual(text(asBytes));
    expect(await read([compressed], { contentEncoding: 'x-franca-test' })).toEqual(text(asBytes));
    expect(await read([compressed], { contentEncoding: 'identity' })).toEqual(text(asBytes));
    expect(await read(split(Buffer.alloc(MIB + 1, 'a'), 65_536), { contentEncoding: 'x-franca-test' })).toEqual({ kind: 'too_large' });
  });

  it('cero bytes recibidos con Content-Encoding son la cadena vacía, sin descompresor', async () => {
    for (const encoding of ['gzip', 'deflate', 'br']) expect(await read([], { contentEncoding: encoding }), encoding).toEqual(text(''));
  });

  it('un cuerpo que no es gzip, o truncado, es failed', async () => {
    expect(await read([Buffer.from('esto no es gzip')], { contentEncoding: 'gzip' })).toEqual({ kind: 'failed' });
    expect(await read([Buffer.from('esto no es brotli')], { contentEncoding: 'br' })).toEqual({ kind: 'failed' });
    expect(await read([Buffer.from('x')], { contentEncoding: 'deflate' })).toEqual({ kind: 'failed' });
    const truncated = gzipSync(Buffer.alloc(10_000, 'a')).subarray(0, 20);
    expect(await read([truncated], { contentEncoding: 'gzip' })).toEqual({ kind: 'failed' });
  });

  it('un corte de la respuesta a mitad de un cuerpo comprimido es failed', async () => {
    const source = new Readable({ read() {} });
    const pending = readResponseBody(source, { contentEncoding: 'gzip' });
    source.push(gzipSync(body).subarray(0, 12));
    source.destroy(new Error('aborted'));
    expect(await pending).toEqual({ kind: 'failed' });
  });

  it('too_large destruye la respuesta', async () => {
    const source = streamOf(...split(gzipSync(Buffer.alloc(2 * MIB, 'a')), 512));
    expect(await readResponseBody(source, { contentEncoding: 'gzip' })).toEqual({ kind: 'too_large' });
    expect(source.destroyed).toBe(true);
  });

  it('un BOM y UTF-8 inválido tras descomprimir se tratan igual', async () => {
    expect(await read([gzipSync(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0xff]))], { contentEncoding: 'gzip' })).toEqual(text('h�'));
  });
});
