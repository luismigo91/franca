import { describe, expect, it } from 'vitest';
import { flowOf, httpNode, variable } from '../helpers/flows.js';
import { always, expectScript, respond, scriptedHost } from '../helpers/http-host.js';
import { continueWith, expectFailure, httpEvents, httpFlow, leadsAtSize, outcomeOf, runOk, withValue } from '../helpers/http-flow.js';

/** Ejecuta un `http` con un host que responde 200 y devuelve el resultado y el host. */
async function execute(request: Record<string, unknown>, variables: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) {
  const host = always(respond(200));
  const result = await runOk(httpFlow(request, extra, { variables: [variable('v'), ...variables] }), host.host);
  return { result, host };
}

/** Ejecuta un `http` que no debe llegar al host y exige `onError` con ese motivo. */
async function expectNotBuilt(request: Record<string, unknown>, error: string, variables: Record<string, unknown>[] = []) {
  const { result, host } = await execute(request, variables);
  expectScript(host, 0);
  expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 0, status: null, error }]);
  expect(outcomeOf(result)).toBe('ko');
}

const rejectedConfig = async (request: Record<string, unknown>, extra: Record<string, unknown> = {}, variables: Record<string, unknown>[] = []) => {
  const { result, host } = await execute(request, variables, extra);
  expectFailure(result, 'invalid_http_config');
  expect(httpEvents(result)).toEqual([]);
  expectScript(host, 0);
};

describe('Cabeceras que no se pueden enviar', () => {
  it('Nombres que no son tokens', async () => {
    for (const name of ['X Bad', '', 'X-Ñ', 'X:Y']) await rejectedConfig({ headers: { [name]: 'v' } });
  });

  it('Nombres repetidos sin distinguir mayúsculas', async () => {
    await rejectedConfig({ headers: { 'Content-Type': 'application/json', 'content-type': 'text/plain' } });
  });

  it('Cabeceras reservadas al host', async () => {
    for (const name of ['Host', 'content-length', 'Transfer-Encoding', 'Connection', 'Keep-Alive', 'Upgrade', 'TE', 'Trailer', 'Expect', 'Proxy-Authorization']) {
      await rejectedConfig({ headers: { [name]: 'v' } });
    }
  });

  it('Número de cabeceras', async () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`X-H${i + 1}`, 'v']));
    const { result, host } = await execute({ headers: many(32) });
    expect(outcomeOf(result)).toBe('ok');
    expectScript(host, 1);
    expect(host.requests[0]!.headers).toHaveLength(32);
    await rejectedConfig({ headers: many(33) });
  });

  it('Cabeceras admitidas', async () => {
    const headers = { Accept: 'application/json', 'X-Request-Id': 'r-1', Authorization: { secret: 'CRM_TOKEN' }, Cookie: 'a=b' };
    const { host } = await execute({ headers });
    expectScript(host, 1);
    expect(host.requests[0]!.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'X-Request-Id', value: 'r-1' },
      { name: 'Authorization', secret: 'CRM_TOKEN' },
      { name: 'Cookie', value: 'a=b' },
    ]);
  });
});

describe('Body en GET y punteros mal escapados', () => {
  it('GET con body', async () => {
    await rejectedConfig({ method: 'GET', body: { a: 1 } });
    for (const request of [{ method: 'GET', body: null }, { method: 'DELETE', body: { a: 1 } }]) {
      const { result, host } = await execute(request);
      expect(outcomeOf(result)).toBe('ok');
      expectScript(host, 1);
    }
  });

  it('Punteros mal escapados', async () => {
    for (const pointer of ['/a~2', '/a~']) await rejectedConfig({}, { responseMap: [{ variable: 'v', pointer }] });
  });
});

describe('Petición entregada al host', () => {
  it('Petición mínima', async () => {
    const { host } = await execute({ method: 'GET', url: 'https://api.example.com' });
    expect(host.requests[0]).toEqual({
      nodeId: 'h',
      method: 'GET',
      url: 'https://api.example.com/',
      headers: [],
      body: null,
      timeoutMs: 10000,
      attempt: 1,
      containsPii: false,
    });
  });

  it('Petición del ejemplo de captación de leads', async () => {
    const { flow, state } = await leadsAtSize();
    const host = always(respond(201));
    const result = await continueWith(flow, state, { choice: 'grande' }, host.host);
    expect(result.ok).toBe(true);
    expect(host.requests[0]).toEqual({
      nodeId: 'enviar-crm',
      method: 'POST',
      url: 'https://crm.example.com/api/leads',
      headers: [
        { name: 'Authorization', secret: 'CRM_TOKEN' },
        { name: 'Content-Type', value: 'application/json' },
      ],
      body: '{"name":"Ana","email":"ana@example.com","companySize":"51+","segment":"empresa"}',
      timeoutMs: 8000,
      attempt: 1,
      containsPii: true,
    });
  });

  it('El host no altera los intentos siguientes', async () => {
    const mutate = (request: { url: string; headers: unknown[] }) => {
      request.url = 'https://evil.example/';
      request.headers.length = 0;
      return respond(503);
    };
    const host = scriptedHost([mutate as never, respond(200)]);
    const flow = httpFlow({ headers: { 'X-A': '1' } }, { retries: 1 });
    const before = structuredClone(flow);
    const result = await runOk(flow, host.host);
    expect(outcomeOf(result)).toBe('ok');
    expect(host.requests[1]).toMatchObject({ url: 'https://api.example.com/', headers: [{ name: 'X-A', value: '1' }], attempt: 2 });
    expect(flow).toEqual(before);
  });

  it('cada intento recibe objetos distintos', async () => {
    const seen: unknown[] = [];
    const record = (request: unknown) => (seen.push(request), respond(503));
    const host = scriptedHost([record as never, record as never, respond(200)]);
    await runOk(httpFlow({ headers: { 'X-A': '1' } }, { retries: 2 }), host.host);
    expect(new Set(seen).size).toBe(2);
    expect((seen[0] as { headers: unknown }).headers).not.toBe((seen[1] as { headers: unknown }).headers);
  });
});

describe('Cabeceras de la petición', () => {
  it('Secreto por nombre y plantilla', async () => {
    const { host } = await execute({ headers: { Authorization: { secret: 'CRM_TOKEN' }, 'X-Lead': 'lead {{nombre}}' } }, [withValue('nombre', 'Ana')]);
    expect(host.requests[0]!.headers).toEqual([
      { name: 'Authorization', secret: 'CRM_TOKEN' },
      { name: 'X-Lead', value: 'lead Ana' },
    ]);
  });

  it('Content-Type por defecto', async () => {
    const first = await execute({ method: 'POST', body: { a: 1 } });
    const second = await execute({ method: 'POST', body: { a: 1 }, headers: { 'content-type': 'text/plain' } });
    expect(first.host.requests[0]!.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }]);
    expect(second.host.requests[0]!.headers).toEqual([{ name: 'content-type', value: 'text/plain' }]);
  });

  it('Sin body no se añade Content-Type', async () => {
    const { host } = await execute({ method: 'POST', body: null });
    expect(host.requests[0]).toMatchObject({ headers: [], body: null });
  });
});

describe('Cuerpo de la petición', () => {
  it('Plantillas en los strings, claves literales', async () => {
    const body = { nombre: '{{nombre}}', edad: '{{n}}', fijo: 3, ok: true, nada: null, tags: ['{{nombre}}'], '{{nombre}}': 'k' };
    const { host } = await execute({ method: 'POST', body }, [withValue('nombre', 'Ana'), withValue('n', 3)]);
    expect(host.requests[0]!.body).toBe('{"nombre":"Ana","edad":"3","fijo":3,"ok":true,"nada":null,"tags":["Ana"],"{{nombre}}":"k"}');
  });

  it('Body que es un string', async () => {
    const { host } = await execute({ method: 'POST', body: 'hola {{nombre}}' }, [withValue('nombre', 'Ana')]);
    expect(host.requests[0]!.body).toBe('"hola Ana"');
  });
});

describe('Orden de cabeceras y claves del body', () => {
  it('Orden de las claves', async () => {
    const body = JSON.parse('{"b": 1, "2": 2, "a": {"z": 0, "1": 1}}');
    const { host } = await execute({ method: 'POST', body });
    expect(host.requests[0]!.body).toBe('{"2":2,"b":1,"a":{"1":1,"z":0}}');
  });

  it('Claves con nombre de Object', async () => {
    const body = JSON.parse('{"__proto__": "{{nombre}}", "constructor": 1}');
    const { host } = await execute({ method: 'POST', body }, [withValue('nombre', 'Ana')]);
    expect(host.requests[0]!.body).toBe('{"__proto__":"Ana","constructor":1}');
  });

  it('las cabeceras siguen el mismo orden de la forma JSON', async () => {
    const headers = JSON.parse('{"X-A": "1", "2": "2", "b": "b"}');
    const { host } = await execute({ headers });
    expect(host.requests[0]!.headers.map((h) => h.name)).toEqual(['2', 'X-A', 'b']);
  });
});

describe('Valores insertados en la URL', () => {
  it('Un valor no cambia la ruta ni la consulta', async () => {
    const { host } = await execute({ url: 'https://api.example.com/users/{{id}}?q={{q}}' }, [withValue('id', '../admin'), withValue('q', 'a b&c=d#e')]);
    expect(host.requests[0]!.url).toBe('https://api.example.com/users/..%2Fadmin?q=a%20b%26c%3Dd%23e');
  });

  it('Texto no ASCII, números y objetos', async () => {
    const url = 'https://api.example.com/buscar?nombre={{nombre}}&n={{n}}&d={{d}}&x={{x}}';
    const { host } = await execute({ url }, [withValue('nombre', 'José'), withValue('n', 1500.5), withValue('d', { a: 1 }), variable('x')]);
    expect(host.requests[0]!.url).toBe('https://api.example.com/buscar?nombre=Jos%C3%A9&n=1500.5&d=%7B%22a%22%3A1%7D&x=');
  });

  it('Una variable no puede añadir los caracteres / ? # @ :', async () => {
    await expectNotBuilt({ url: '{{base}}/x' }, 'invalid_url', [withValue('base', 'https://api.example.com')]);
    await expectNotBuilt({ url: 'https://{{sub}}.example.com/' }, 'invalid_url', [withValue('sub', 'evil.com/')]);
  });

  it('Esquema con plantilla', async () => {
    const ok = await execute({ url: 'http{{s}}://api.example.com/' }, [withValue('s', 's')]);
    expect(ok.host.requests[0]!.url).toBe('https://api.example.com/');
    await expectNotBuilt({ url: 'http{{s}}://api.example.com/' }, 'invalid_url', [withValue('s', 'x')]);
  });

  it('Etiquetas del host que el autor deja abiertas', async () => {
    for (const [sub, url] of [['api', 'https://api.example.com/'], ['api.eu', 'https://api.eu.example.com/']]) {
      const { host } = await execute({ url: 'https://{{sub}}.example.com/' }, [withValue('sub', sub)]);
      expect(host.requests[0]!.url).toBe(url);
    }
  });

  it('Sustituto suelto en un valor', async () => {
    const flow = httpFlow({ url: 'https://api.example.com/?ref={{ref}}' }, {}, { variables: [variable('ref', { scope: 'contact' })] });
    const host = always(respond(200));
    const result = await runOk(flow, host.host, { ref: 'a\ud800' });
    expectScript(host, 0);
    expect(httpEvents(result)).toEqual([{ type: 'http', nodeId: 'h', attempts: 0, status: null, error: 'invalid_url' }]);
    expect(outcomeOf(result)).toBe('ko');
  });
});

describe('URL de la petición', () => {
  it('Esquemas y formas no permitidos', async () => {
    const urls = [
      'ftp://api.example.com/',
      'api.example.com/x',
      'https://user:pass@api.example.com/',
      'https://api.example.com/a#b',
      'https://api.example.com/a\\b',
      'https://api.example.com/a b',
      'https://api.example.com/a\u200bb',
      'https://exa%41mple.com/',
      'https://api%2eexample.com/',
    ];
    for (const url of urls) await expectNotBuilt({ url }, 'invalid_url');
  });

  it('Sustituto suelto en el texto de la URL', async () => {
    await expectNotBuilt({ url: 'https://api.example.com/a\ud800' }, 'invalid_url');
  });

  it('Segmentos de punto', async () => {
    const urls = [
      'https://api.example.com/users/../admin',
      'https://api.example.com/users/%2E%2e/admin',
      'https://api.example.com/users/.%2E/admin',
      'https://api.example.com/users/%2e./admin',
      'https://api.example.com/users/%2e/x',
      'https://api.example.com/users/./x',
    ];
    for (const url of urls) await expectNotBuilt({ url }, 'invalid_url');
    await expectNotBuilt({ url: 'https://api.example.com/users/{{id}}' }, 'invalid_url', [withValue('id', '..')]);
  });

  it('Segmentos que no son de punto', async () => {
    for (const url of ['https://api.example.com/u/..a', 'https://api.example.com/u/...', 'https://api.example.com/u/%252e%252e']) {
      const { host } = await execute({ url });
      expect(host.requests[0]!.url).toBe(url);
    }
  });
});

describe('Destino y longitud de la URL', () => {
  it('URLs válidas y su serialización', async () => {
    const cases: [string, string][] = [
      ['HTTPS://API.Example.com:8443/v1/leads?x=1', 'https://api.example.com:8443/v1/leads?x=1'],
      ['https://exámple.com/a', 'https://xn--exmple-qta.com/a'],
      ['https://api.example.com/búsqueda', 'https://api.example.com/b%C3%BAsqueda'],
      ['https://api.example.com/u?x=../a', 'https://api.example.com/u?x=../a'],
    ];
    for (const [url, href] of cases) {
      const { host } = await execute({ url });
      expect(host.requests[0]!.url, url).toBe(href);
    }
  });

  it('Destinos internos', async () => {
    const urls = [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://１２７．０．０．１/',
      'http://[::1]/',
      'http://localhost:8080/',
      'http://api.localhost/',
      'http://169.254.169.254/latest/meta-data',
      'http://intranet/',
    ];
    for (const url of urls) await expectNotBuilt({ url }, 'invalid_url');
  });

  it('Longitud máxima de la URL', async () => {
    const base = 'https://api.example.com/';
    const ok = await execute({ url: base + 'a'.repeat(8168) });
    expect(ok.host.requests).toHaveLength(1);
    await expectNotBuilt({ url: base + 'a'.repeat(8169) }, 'invalid_url');
  });

  it('Longitud antes de serializar', async () => {
    const base = 'https://api.example.com:443/';
    const ok = await execute({ url: base + 'a'.repeat(8164) });
    expect(ok.host.requests[0]!.url).toBe('https://api.example.com/' + 'a'.repeat(8164));
    expect(ok.host.requests[0]!.url).toHaveLength(8188);
    await expectNotBuilt({ url: base + 'a'.repeat(8165) }, 'invalid_url');
  });

  it('Valor que crece al codificarse', async () => {
    const request = { url: 'https://api.example.com/?q={{w}}' };
    const first = await execute(request, [withValue('w', '中'.repeat(907))]);
    expect(first.host.requests[0]!.url).toHaveLength(8190);
    await expectNotBuilt(request, 'invalid_url', [withValue('w', '中'.repeat(908))]);
  });
});

describe('Valores de cabecera', () => {
  it('Salto de línea insertado', async () => {
    await expectNotBuilt({ headers: { 'X-Nombre': '{{w}}' } }, 'invalid_header_value', [withValue('w', 'Ana\r\nX-Admin: 1')]);
  });

  it('Caracteres no ASCII y valores admitidos', async () => {
    await expectNotBuilt({ headers: { 'X-Nombre': 'José' } }, 'invalid_header_value');
    const empty = await execute({ headers: { 'X-Vacia': '' } });
    expect(empty.host.requests[0]!.headers).toEqual([{ name: 'X-Vacia', value: '' }]);
    const bearer = await execute({ headers: { Authorization: 'Bearer {{t}}' } }, [withValue('t', 'abc.def-123')]);
    expect(bearer.host.requests[0]!.headers).toEqual([{ name: 'Authorization', value: 'Bearer abc.def-123' }]);
  });
});

describe('Tamaño máximo del body', () => {
  it('Body por encima y por debajo del límite', async () => {
    const a = withValue('a', 'a'.repeat(16000));
    const four = await execute({ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}'] }, [a]);
    expect(four.host.requests[0]!.body).toHaveLength(64013);
    await expectNotBuilt({ method: 'POST', body: ['{{a}}', '{{a}}', '{{a}}', '{{a}}', '{{a}}'] }, 'body_too_large', [a]);
  });
});

describe('Petición que no se puede construir', () => {
  it('Se sigue por onError', async () => {
    const flow = httpFlow({ url: 'http://localhost/' });
    const host = always(respond(200));
    const result = await runOk(flow, host.host);
    expect(result.events).toEqual([
      { type: 'http', nodeId: 'h', attempts: 0, status: null, error: 'invalid_url' },
      { type: 'end', nodeId: 'ko', outcome: 'ko' },
    ]);
  });

  it('La URL se comprueba antes que las cabeceras', async () => {
    await expectNotBuilt({ url: 'http://localhost/', headers: { 'X-Nombre': 'José' } }, 'invalid_url');
  });

  it('no modifica variables', async () => {
    const flow = httpFlow({ url: 'http://localhost/' }, { responseMap: [{ variable: 'v', pointer: '/x' }] }, { variables: [withValue('v', 'previo')] });
    const result = await runOk(flow, always(respond(200)).host);
    expect(result.state.variables.v).toBe('previo');
  });
});

describe('Tamaño máximo de los textos de un http', () => {
  const big = withValue('a', 'a'.repeat(16384));

  it('String del body demasiado largo', async () => {
    const host = always(respond(200));
    const flow = flowOf(
      [{ id: 'm', type: 'message', content: [{ kind: 'text', text: 'antes' }], next: 'h' }, httpNode('h', { method: 'POST', body: { t: '{{a}}!' } }, { next: 'fin', onError: 'fin' }), { id: 'fin', type: 'end' }],
      { variables: [big] },
    );
    const result = await runOk(flow, host.host);
    expect(result.events.map((e) => e.type)).toEqual(['message', 'error']);
    expect(result.events[1]).toMatchObject({ code: 'value_too_large', nodeId: 'h' });
    expectScript(host, 0);
  });

  it('Justo en el límite y URL larga', async () => {
    const header = await execute({ headers: { 'X-A': '{{a}}' } }, [big]);
    expect(header.host.requests).toHaveLength(1);
    await expectNotBuilt({ url: 'https://api.example.com/?q={{a}}' }, 'invalid_url', [big]);
  });
});
