import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiRequestError, seedDemo } from '../../demo/seed.mjs';

const copy = JSON.parse(readFileSync(new URL('../../demo/captacion-leads-local.json', import.meta.url), 'utf8'));

interface Call {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}
type Reply = { status: number; headers?: Record<string, string>; body?: unknown } | Error;

/** Un transporte guionizado: cada petición recibe la siguiente respuesta. */
function script(...replies: Reply[]) {
  const calls: Call[] = [];
  const request = async (call: Call & { target: unknown }): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
    calls.push({ method: call.method, path: call.path, headers: call.headers, body: call.body });
    const next = replies[calls.length - 1];
    if (next === undefined) throw new Error('petición no prevista');
    if (next instanceof Error) throw next;
    return { status: next.status, headers: next.headers ?? {}, body: typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {}) };
  };
  return { request, calls };
}

async function run(env: Record<string, string | undefined>, ...replies: Reply[]): Promise<{ ok: boolean; lines: string[]; text: string; calls: Call[] }> {
  const { request, calls } = script(...replies);
  const lines: string[] = [];
  const result = await seedDemo({ env, write: (line: string) => lines.push(line), request });
  return { ...result, lines, text: lines.join('\n'), calls };
}

const error = (status: number, code: string): Reply => ({ status, body: { message: 'texto', error: code } });
const readOk: Reply = { status: 200, headers: { etag: '"1"' }, body: { id: 'captacion-leads-local', revision: 1, flow: copy } };
const notFound = error(404, 'flow_not_found');
const created: Reply = { status: 201, headers: { etag: '"1"' }, body: { id: 'captacion-leads-local', revision: 1, flow: copy } };
const published = (status: number, version: number): Reply => ({ status, body: { flowId: 'captacion-leads-local', version, flow: copy } });

describe('seedDemo', () => {
  it('Dirección de la API no admitida en la semilla', async () => {
    for (const value of ['http://192.168.1.10:3001', '']) {
      const result = await run({ FRANCA_API_URL: value });
      expect(result.ok, value).toBe(false);
      expect(result.text, value).toContain('FRANCA_API_URL');
      expect(result.text, value).not.toContain('192.168.1.10');
      expect(result.calls, value).toEqual([]);
    }
  });

  it('crea y publica si no existe, con el borrador entero y el If-Match del ETag', async () => {
    const result = await run({}, notFound, created, published(201, 1));
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual(['[semilla] captacion-leads-local: creado y publicado (versión 1).']);
    expect(result.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /flows/captacion-leads-local', 'POST /flows', 'POST /flows/captacion-leads-local/versions']);
    expect(JSON.parse(result.calls[1]!.body!)).toEqual(copy);
    expect(result.calls[1]!.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(result.calls[2]!.headers).toEqual({ 'If-Match': '"1"' });
  });

  it('publica si el borrador es la copia y no hay versión, y dice que ya estaba si la API responde 200', async () => {
    const first = await run({}, readOk, published(201, 1));
    expect(first.lines).toEqual(['[semilla] captacion-leads-local: publicado (versión 1).']);
    const again = await run({}, readOk, published(200, 1));
    expect(again.ok).toBe(true);
    expect(again.lines).toEqual(['[semilla] captacion-leads-local: ya estaba publicado (versión 1).']);
    expect(again.calls).toHaveLength(2);
  });

  it('no toca un borrador que no es la copia', async () => {
    const result = await run({}, { status: 200, headers: { etag: '"2"' }, body: { flow: { ...copy, name: 'Mío' } } });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('captacion-leads-local: su borrador no es la copia de la demo y no se ha tocado');
    expect(result.calls).toHaveLength(1);
  });

  it('un id reservado se explica y no se reintenta', async () => {
    const result = await run({}, notFound, error(409, 'flow_id_reserved'));
    expect(result.ok).toBe(false);
    expect(result.text).toContain('está reservado por un borrado');
    expect(result.text).toContain('docker compose down -v');
  });

  it('si otro proceso lo creó entre medias, vuelve a leer una sola vez', async () => {
    const raced = await run({}, notFound, error(409, 'flow_already_exists'), readOk, published(201, 1));
    expect(raced.ok).toBe(true);
    const twice = await run({}, notFound, error(409, 'flow_already_exists'), notFound, error(409, 'flow_already_exists'));
    expect(twice.ok).toBe(false);
    expect(twice.text).toContain('respuesta inesperada de la API (HTTP 409, flow_already_exists)');
  });

  it('un 412 al publicar dice que el borrador cambió', async () => {
    const result = await run({}, readOk, error(412, 'revision_mismatch'));
    expect(result.ok).toBe(false);
    expect(result.text).toContain('el borrador ha cambiado mientras se sembraba y no se ha publicado');
  });

  it('un 500 a la primera lectura apunta a las migraciones', async () => {
    const result = await run({}, { status: 500, body: { message: 'error interno', error: 'internal_error' } });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('pnpm --filter @franca/api db:migrate');
    expect(result.calls).toHaveLength(1);
  });

  it('un 500 al repetir la lectura tras un 409 es inesperado, no «sin migraciones»', async () => {
    const result = await run({}, notFound, error(409, 'flow_already_exists'), error(500, 'internal_error'));
    expect(result.text).toContain('respuesta inesperada de la API (HTTP 500, internal_error)');
    expect(result.text).not.toContain('db:migrate');
  });

  it('un 503 database_unavailable corta la semilla con su motivo', async () => {
    const result = await run({}, error(503, 'database_unavailable'));
    expect(result.ok).toBe(false);
    expect(result.text).toContain('docker compose up -d');
  });

  it('sin conexión y con plazo agotado dicen a qué API se refieren', async () => {
    const unreachable = await run({ FRANCA_API_URL: 'http://localhost:3005' }, new ApiRequestError('unreachable'));
    expect(unreachable.text).toContain('No puedo conectar con la API de Franca en http://localhost:3005');
    const slow = await run({}, new ApiRequestError('timeout'));
    expect(slow.text).toContain('La API de Franca en http://127.0.0.1:3001 no ha respondido a tiempo.');
    expect(unreachable.ok || slow.ok).toBe(false);
  });

  it.each(['<script>', 'a'.repeat(65), 'Mayúscula', 'con espacio'])('el error «%s» del cuerpo no se imprime', async (code) => {
    const result = await run({}, error(418, code));
    expect(result.ok).toBe(false);
    expect(result.text).toContain('respuesta inesperada de la API (HTTP 418).');
    expect(result.text).not.toContain(code);
  });

  it('un cuerpo que no es JSON no mete texto en la salida', async () => {
    const result = await run({}, { status: 502, body: '<html>pasarela caída</html>' });
    expect(result.text).toBe('[semilla] captacion-leads-local: respuesta inesperada de la API (HTTP 502).');
  });

  it('si la publicación devuelve otro flujo, es inesperado', async () => {
    const result = await run({}, readOk, { status: 201, body: { version: 1, flow: { ...copy, name: 'Otro' } } });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('respuesta inesperada de la API (HTTP 201)');
  });
});
