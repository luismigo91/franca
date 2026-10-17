import { createBrotliDecompress, createGunzip, createInflate, createInflateRaw } from 'node:zlib';
import type { Readable, Transform } from 'node:stream';

/** Tope de la respuesta: 1 MiB de bytes ya descomprimidos (el motor cuenta 1 048 576 unidades UTF-16: nunca menos). */
export const MAX_RESPONSE_BYTES = 1_048_576;

export type ResponseBodyResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'too_large' }
  /** La respuesta se cortó, o su cuerpo comprimido no se puede descomprimir. */
  | { readonly kind: 'failed' };

export interface ResponseBodyHeaders {
  readonly contentEncoding?: string | undefined;
  readonly contentLength?: string | undefined;
}

type Encoding = 'gzip' | 'deflate' | 'br';

/** Solo `gzip`/`x-gzip`, `deflate` y `br` exactos (sin espacios ni mayúsculas); una lista u otra codificación se entrega tal cual. */
function parseEncoding(header: string | undefined): Encoding | null {
  switch (header?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return 'gzip';
    case 'deflate':
      return 'deflate';
    case 'br':
      return 'br';
    default:
      return null;
  }
}

/** `deflate` en la práctica llega con cabecera zlib (RFC 1950) o crudo (RFC 1951); la cabecera zlib es `CM` 8 y un múltiplo de 31. */
function hasZlibHeader(first: number, second: number): boolean {
  return (first & 0x0f) === 8 && ((first << 8) | second) % 31 === 0;
}

function createDecompressor(encoding: Encoding, head: Buffer): Transform {
  if (encoding === 'gzip') return createGunzip();
  if (encoding === 'br') return createBrotliDecompress();
  return hasZlibHeader(head[0]!, head[1] ?? 0) ? createInflate() : createInflateRaw();
}

const declaredLength = (header: string | undefined): number => (header !== undefined && /^[0-9]+$/.test(header.trim()) ? Number(header.trim()) : Number.NaN);

/**
 * Lee el cuerpo de una respuesta con los límites del host, sin dejar nunca una promesa rechazada.
 * - `gzip`, `deflate` y `br` se descomprimen en streaming y el tope se aplica a los bytes **descomprimidos**: una bomba
 *   se corta en cuanto supera `MAX_RESPONSE_BYTES`, destruyendo el descompresor y la respuesta. Otra codificación, una
 *   lista o ninguna entrega los bytes recibidos, con el tope sobre ellos y, con `Content-Length` mayor, sin leer nada.
 * - Cero bytes recibidos dan `''` sin pasar por el descompresor (un 204 con `Content-Encoding: gzip` es válido).
 * - Un corte a mitad de cuerpo o una descompresión que falla dan `failed`.
 * - El texto es UTF-8: las secuencias inválidas se sustituyen y un BOM inicial se quita, como `fetch().text()`.
 *
 * @param source La respuesta, como stream de bytes.
 * @param headers `Content-Encoding` y `Content-Length` de la respuesta.
 * @returns El texto, `too_large` o `failed`.
 */
export function readResponseBody(source: Readable, headers: ResponseBodyHeaders): Promise<ResponseBodyResult> {
  const encoding = parseEncoding(headers.contentEncoding);
  return new Promise<ResponseBodyResult>((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let produced = 0;
    let head: Buffer[] = [];
    let decompressor: Transform | null = null;
    let sourceEnded = false;
    let settled = false;

    const finish = (result: ResponseBodyResult): void => {
      if (settled) return;
      settled = true;
      source.removeListener('data', onData);
      if (result.kind !== 'text') {
        decompressor?.destroy();
        source.destroy();
      }
      resolve(result);
    };
    const accept = (chunk: Buffer): void => {
      produced += chunk.length;
      if (produced > MAX_RESPONSE_BYTES) finish({ kind: 'too_large' });
      else chunks.push(chunk);
    };
    const text = (): ResponseBodyResult => ({ kind: 'text', text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)) });

    /** Crea el descompresor con los primeros bytes (dos, para `deflate`) y le entrega lo acumulado. */
    const startDecompressor = (first: Buffer): void => {
      const stream = createDecompressor(encoding!, first);
      decompressor = stream;
      stream.on('data', accept);
      stream.on('error', () => finish({ kind: 'failed' }));
      stream.on('end', () => finish(text()));
      stream.on('drain', () => source.resume());
      stream.write(first);
    };

    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (encoding === null) {
        if (received > MAX_RESPONSE_BYTES) return finish({ kind: 'too_large' });
        chunks.push(chunk);
        return;
      }
      if (decompressor === null) {
        head.push(chunk);
        const joined = Buffer.concat(head);
        if (encoding === 'deflate' && joined.length < 2) return;
        head = [];
        startDecompressor(joined);
        return;
      }
      if (!decompressor.write(chunk)) source.pause();
    };

    source.on('data', onData);
    source.on('error', () => finish({ kind: 'failed' }));
    source.on('end', () => {
      sourceEnded = true;
      if (received === 0) return finish(text());
      if (encoding === null) return finish(text());
      if (decompressor === null) startDecompressor(Buffer.concat(head));
      decompressor!.end();
    });
    source.on('close', () => {
      if (!sourceEnded) finish({ kind: 'failed' });
    });

    // Con identity (o desconocida) un Content-Length mayor que el tope no necesita leerse.
    if (encoding === null && declaredLength(headers.contentLength) > MAX_RESPONSE_BYTES) finish({ kind: 'too_large' });
  });
}
