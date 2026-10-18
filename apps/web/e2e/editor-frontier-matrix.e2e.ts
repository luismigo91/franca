import { FLOWS } from '../tests/helpers/engine-events';
import { sendJson } from '../tests/helpers/fake-api';
import { finalStatusLine, headerOf, rawBytes, rawRequest } from './support/http';
import { expect, test } from './support/test';

// QA independiente de la frontera del editor (web-editor, 2026-10-18): matriz sobre las seis operaciones nuevas con peticiones
// en bruto (lo que haría otra herramienta de la máquina, no el navegador). Complementa `editor-frontier.e2e.ts`: métodos no
// permitidos, ids con trucos de ruta, `Host` y `Origin` duplicados, cuerpos que no son texto UTF-8 ni caben, `If-Match`
// malformado y errores de la API con marcas que no pueden salir.

const HOLA = JSON.stringify(FLOWS.hola);
const ORIGIN = 'http://localhost:3000';
const SECURITY = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };

/** Una petición en bruto con `Host` y `Origin` correctos, salvo lo que se cambie. */
const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
  rawRequest({ method, path, headers: { Host: 'localhost:3000', Origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { body }) });

function expectSecurityHeaders(headers: Record<string, string | string[] | undefined>, label: string): void {
  for (const [name, value] of Object.entries(SECURITY)) expect(headers[name], `${label}: ${name}`).toBe(value);
  expect(Object.keys(headers).filter((name) => name.startsWith('access-control-')), `${label}: CORS`).toEqual([]);
}

test('Métodos que el editor no admite en cada ruta: 405 sin llamar a la API', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const cases: [string, string][] = [
    ['PATCH', '/api/editor/flows/hola'],
    ['PUT', '/api/editor/flows'],
    ['DELETE', '/api/editor/flows'],
    ['POST', '/api/editor/flows/hola'],
    ['GET', '/api/editor/flows/hola/versions'],
    ['PUT', '/api/editor/flows/hola/versions'],
    ['DELETE', '/api/editor/flows/hola/versions'],
  ];
  for (const [method, path] of cases) {
    const response = await call(method, path, { 'If-Match': '"1"' });
    expect(response.status, `${method} ${path}`).toBe(405);
    expectSecurityHeaders(response.headers, `${method} ${path}`);
  }
  for (const path of ['/api/editor/flows/hola/versions/1', '/api/editor/flowsx', '/api/editor/flows/hola/versions/1/x']) {
    const response = await call('GET', path);
    expect(response.status, path).toBe(404);
    expect(JSON.parse(response.body), path).toEqual({ error: 'not_found' });
  }
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Ids de flujo con trucos de ruta: 404 flow_not_found en la frontera, con las cabeceras de seguridad y sin llamar a la API', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const ids = ['HOLA', '%2e%2e%2fconversations', '..%252fconversations', 'a%2Fb', 'hola%00', 'hola%0d%0aX-Evil:%201', 'hola;x=1', 'hola%20', '%C0%AE%C0%AE', '%', 'ho%6Cla%', '1hola', '_hola', 'a'.repeat(65)];
  for (const id of ids) {
    for (const [method, path] of [
      ['GET', `/api/editor/flows/${id}`],
      ['PUT', `/api/editor/flows/${id}`],
      ['DELETE', `/api/editor/flows/${id}`],
      ['POST', `/api/editor/flows/${id}/versions`],
    ] as const) {
      const response = await call(method, path, { 'If-Match': '"1"', 'Content-Type': 'application/json' }, method === 'PUT' ? HOLA : undefined);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(JSON.parse(response.body), `${method} ${path}`).toEqual({ error: 'flow_not_found' });
      expectSecurityHeaders(response.headers, `${method} ${path}`);
    }
  }
  expect(stack.fakeApi.requests).toEqual([]);
  // Un id válido codificado con porcentajes sí llega, ya decodificado (`%68ola` es `hola`).
  const decoded = await call('GET', '/api/editor/flows/%68ola');
  expect(decoded.status).toBe(200);
  expect(stack.fakeApi.requests.map((request) => request.path)).toEqual(['/flows/hola']);
});

test('Host y Origin duplicados, mezclados o con otra grafía: 403 sin cuerpo y sin llamar a la API', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const put = (lines: string[]) => rawBytes(`PUT /api/editor/flows/hola HTTP/1.1\r\n${lines.join('\r\n')}\r\nConnection: close\r\nContent-Type: application/json\r\nIf-Match: "1"\r\nContent-Length: ${Buffer.byteLength(HOLA)}\r\n\r\n${HOLA}`);
  const cases: [string, string[]][] = [
    ['Origin ajeno y luego el propio', ['Host: localhost:3000', 'Origin: http://evil.example', `Origin: ${ORIGIN}`]],
    ['Origin propio y luego el ajeno', ['Host: localhost:3000', `Origin: ${ORIGIN}`, 'Origin: http://evil.example']],
    ['Host ajeno y luego el propio', ['Host: evil.example', 'Host: localhost:3000', `Origin: ${ORIGIN}`]],
    ['Host con lista', ['Host: localhost:3000, evil.example', `Origin: ${ORIGIN}`]],
    ['Origin con otra grafía del mismo host', ['Host: localhost:3000', 'Origin: HTTP://localhost:3000']],
    ['Origin con barra final', ['Host: localhost:3000', 'Origin: http://localhost:3000/']],
    ['Origin de 127.0.0.1 con Host localhost', ['Host: localhost:3000', 'Origin: http://127.0.0.1:3000']],
    ['X-Forwarded-Host ajeno no cambia el veredicto, pero tampoco lo salva', ['Host: evil.example', 'X-Forwarded-Host: localhost:3000', `Origin: ${ORIGIN}`]],
  ];
  for (const [label, lines] of cases) {
    const raw = await put(lines);
    expect(finalStatusLine(raw), label).toMatch(/^HTTP\/1\.1 403 /);
    // Sin cuerpo: o nada, o el terminador de un troceado vacío.
    expect(['', '0'], label).toContain((raw.split('\r\n\r\n')[1] ?? '').trim());
  }
  expect(stack.fakeApi.requests).toEqual([]);
});

test('OPTIONS y HEAD: sin Origin propio no hay preflight ni CORS', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  for (const origin of ['http://evil.example', 'null', undefined]) {
    const response = await rawRequest({
      method: 'OPTIONS',
      path: '/api/editor/flows/hola',
      headers: { Host: 'localhost:3000', ...(origin === undefined ? {} : { Origin: origin }), 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'if-match, content-type' },
    });
    expect(response.status, String(origin)).toBe(403);
    expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  }
  expect(stack.fakeApi.requests).toEqual([]);
});

test('Cuerpos de un flujo que no se pueden reenviar: ninguno llega a la API', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const post = (path: string, body: string) => rawBytes(`POST ${path} HTTP/1.1\r\nHost: localhost:3000\r\nOrigin: ${ORIGIN}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body, 'latin1')}\r\n\r\n${body}`);
  const bodyOf = (raw: string) => raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/^[0-9a-f]+\r\n/, '').replace(/\r\n0\r\n\r\n$/, '');
  const cases: [string, string, string][] = [
    ['byte 0xFF suelto', '{"a":"ÿ"}', 'invalid_json'],
    ['BOM', `ï»¿${HOLA}`, 'invalid_json'],
    ['lista', '[]', 'invalid_request'],
    ['null', 'null', 'invalid_request'],
    ['número', '5', 'invalid_request'],
    ['vacío', '', 'invalid_json'],
    ['JSON truncado', HOLA.slice(0, -3), 'invalid_json'],
  ];
  for (const [label, body, error] of cases) {
    const raw = await post('/api/editor/flows', body);
    expect(finalStatusLine(raw), label).toMatch(/^HTTP\/1\.1 400 /);
    expect(JSON.parse(bodyOf(raw)), label).toEqual({ error });
  }
  // `Content-Length` por encima del tope, con el cuerpo entero (5 MB y 11 MB, más que los 10 MB que `proxy.ts` guarda): 413 y no un
  // truncado en silencio reenviado a la API.
  for (const size of [5_000_000, 11_000_000]) {
    const text = `{"a":"${'x'.repeat(size)}"}`;
    const raw = await rawBytes(`POST /api/editor/flows HTTP/1.1\r\nHost: localhost:3000\r\nOrigin: ${ORIGIN}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${text.length}\r\n\r\n${text}`, { waitMs: 6000 });
    expect(finalStatusLine(raw), `${size} bytes`).toMatch(/^HTTP\/1\.1 413 /);
  }
  // Sin `Content-Length` (troceado) y con 1,18 MiB: 413 al pasar el tope, no un truncado en silencio.
  const chunk = 'x'.repeat(65_536);
  const chunks = [`{"a":"`, ...Array.from({ length: 18 }, () => chunk), '"}'];
  const chunked = chunks.map((part) => `${part.length.toString(16)}\r\n${part}\r\n`).join('') + '0\r\n\r\n';
  const big = await rawBytes(`POST /api/editor/flows HTTP/1.1\r\nHost: localhost:3000\r\nOrigin: ${ORIGIN}\r\nConnection: close\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n${chunked}`, { waitMs: 4000 });
  expect(finalStatusLine(big)).toMatch(/^HTTP\/1\.1 413 /);
  // Con 1 MiB exacto de texto sí se reenvía (la API real lo rechazará por inválido: ahí se ve que llegó).
  expect(stack.fakeApi.requests.filter((request) => request.method === 'POST')).toEqual([]);
});

test('If-Match: lo mal formado es 400 y ausente 428 sin llamar a la API; lo bien formado llega y la API decide', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  stack.fakeApi.reset();
  const bad = ['1', '"1"x', 'W/"1"', '*', '""', '"-1"', '"1.0"', '"12345678901"', '"1", "2"', '"1"\t,', 'abc'];
  for (const [method, path, body] of [
    ['PUT', '/api/editor/flows/hola', HOLA],
    ['POST', '/api/editor/flows/hola/versions', undefined],
    ['DELETE', '/api/editor/flows/hola', undefined],
  ] as const) {
    const absent = await call(method, path, { 'Content-Type': 'application/json' }, body);
    expect([absent.status, JSON.parse(absent.body)], `${method} sin If-Match`).toEqual([428, { error: 'precondition_required' }]);
    for (const value of bad) {
      const response = await call(method, path, { 'If-Match': value, 'Content-Type': 'application/json' }, body);
      expect([response.status, JSON.parse(response.body)], `${method} If-Match ${JSON.stringify(value)}`).toEqual([400, { error: 'invalid_request' }]);
    }
  }
  expect(stack.fakeApi.requests).toEqual([]);
  // Bien formados: el diez cifras más grande, cero y ceros a la izquierda llegan y la API real responde 4xx (nunca 5xx).
  for (const value of ['"9999999999"', '"0"', '"01"']) {
    for (const [method, path, body] of [
      ['PUT', '/api/editor/flows/hola', HOLA],
      ['POST', '/api/editor/flows/hola/versions', undefined],
      ['DELETE', '/api/editor/flows/hola', undefined],
    ] as const) {
      const response = await call(method, path, { 'If-Match': value, 'Content-Type': 'application/json' }, body);
      expect(response.status, `${method} If-Match ${value}`).toBeLessThan(500);
      expect(response.status, `${method} If-Match ${value}`).toBeGreaterThanOrEqual(400);
    }
  }
  expect((await admin.flow('hola')).revision).toBe(1);
});

test('Errores de la API con marcas: solo salen {error} (y currentRevision en un 412), nunca el mensaje, las incidencias ni las cabeceras', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  const MARK = 'MARCA-QUE-NO-PUEDE-SALIR';
  const statuses = [400, 401, 403, 404, 409, 412, 413, 415, 422, 429, 500, 502, 503];
  for (const status of statuses) {
    stack.fakeApi.respond((_request, response) =>
      sendJson(
        response,
        status,
        { message: MARK, error: 'codigo_de_la_api', currentRevision: 7, issues: [{ message: MARK }], warnings: [{ message: MARK }], stack: MARK, details: { MARK } },
        { 'X-Leak': MARK, 'Set-Cookie': `sid=${MARK}`, 'WWW-Authenticate': `Bearer realm="${MARK}"`, Location: `/${MARK}`, 'X-Powered-By': MARK, Server: MARK },
      ),
    );
    for (const [method, path, body] of [
      ['PUT', '/api/editor/flows/hola', HOLA],
      ['POST', '/api/editor/flows', HOLA],
      ['POST', '/api/editor/flows/hola/versions', undefined],
      ['DELETE', '/api/editor/flows/hola', undefined],
      ['GET', '/api/editor/flows/hola', undefined],
      ['GET', '/api/editor/flows', undefined],
    ] as const) {
      const response = await call(method, path, { 'If-Match': '"1"', 'Content-Type': 'application/json' }, body);
      const label = `${method} ${path} ← ${status}`;
      expect(response.status, label).toBe(status);
      expect(response.body, label).not.toContain(MARK);
      expect(JSON.stringify(response.headers), label).not.toContain(MARK);
      expect(Object.keys(response.headers), label).not.toContain('set-cookie');
      expect(Object.keys(response.headers), label).not.toContain('www-authenticate');
      expect(Object.keys(response.headers), label).not.toContain('location');
      expect(Object.keys(response.headers), label).not.toContain('x-powered-by');
      expect(response.headers.server, label).toBeUndefined();
      const parsed = response.body === '' ? {} : (JSON.parse(response.body) as Record<string, unknown>);
      expect(Object.keys(parsed).every((key) => key === 'error' || (key === 'currentRevision' && status === 412)), `${label}: ${response.body}`).toBe(true);
      expectSecurityHeaders(response.headers, label);
    }
  }
});

test('La API responde con basura, vacío o más grande de lo razonable: 502 sin romper la web', async ({ admin, stack }) => {
  await admin.createDraft('hola');
  const cases: [string, (response: import('node:http').ServerResponse) => void][] = [
    ['HTML en un 200', (response) => response.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>MARCA</html>')],
    ['200 vacío', (response) => response.writeHead(200).end()],
    ['200 con una lista', (response) => response.writeHead(200, { 'Content-Type': 'application/json' }).end('[]')],
    ['301', (response) => response.writeHead(301, { Location: 'http://evil.example/' }).end()],
    ['204 donde no toca', (response) => response.writeHead(204).end()],
    ['100 MiB', (response) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(`{"a":"${'x'.repeat(100 * 1024 * 1024)}"}`)],
  ];
  for (const [label, answer] of cases) {
    stack.fakeApi.respond((_request, response) => answer(response));
    const response = await call('GET', '/api/editor/flows/hola');
    expect(response.status, label).toBeGreaterThanOrEqual(400);
    expect(response.status, label).toBeLessThan(600);
    expect(response.body, label).not.toContain('MARCA');
    expect(response.headers.location, label).toBeUndefined();
    expect(response.body.length, label).toBeLessThan(200);
  }
  // Y la web sigue viva.
  stack.fakeApi.respond(null);
  stack.fakeApi.forwardTo(Number(new URL(stack.realApiUrl).port));
  expect(headerOf(await rawBytes('GET /flujos HTTP/1.1\r\nHost: localhost:3000\r\nConnection: close\r\n\r\n'), 'content-type')).toContain('text/html');
});
