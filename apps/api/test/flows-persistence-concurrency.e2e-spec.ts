import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { client, type ApiClient } from './helpers/client.js';
import { createTestPrisma, resetDatabase } from './helpers/database.js';
import { hola, leads } from './helpers/examples.js';
import { rawRequest } from './helpers/raw.js';

const MIB = 1_048_576;

describe('persistencia exacta y concurrencia real (e2e)', () => {
  let testApp: TestApp;
  let prisma: PrismaClient;
  let api: ApiClient;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = createTestPrisma();
    api = client(testApp.server);
  });

  afterAll(async () => {
    await testApp.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  /** El texto de la propiedad `flow` de una respuesta, tal como salió por el cable. */
  const flowText = (text: string): string => text.slice(text.indexOf('"flow":') + '"flow":'.length, text.lastIndexOf(',"warnings"'));
  const read = (path: string) => rawRequest(testApp.port, { path, headers: { host: 'localhost' } });

  /** Un flujo con `name` y el `default` de una variable `json` escritos como texto JSON, sin pasar por `JSON.stringify`. */
  const flowWith = (id: string, name: string, defaultText: string) =>
    `{"specVersion":"0.1","id":"${id}","name":${name},"variables":[{"name":"v","type":"json","default":${defaultText}}],"start":"fin","nodes":[{"id":"fin","type":"end"}]}`;

  describe('lo que se guarda es la forma JSON del cuerpo, al byte', () => {
    const CASES: [string, string, string][] = [
      ['NUL en el name', '"a\\u0000b"', 'null'],
      ['sustituto alto suelto en el name', '"a\\ud800b"', 'null'],
      ['sustituto bajo suelto en el name', '"a\\udc00b"', 'null'],
      ['par de sustitutos válido', '"a\\ud83d\\ude00b"', 'null'],
      ['separadores de línea y de párrafo', '"a\\u2028\\u2029b"', 'null'],
      ['name de 120 puntos de código fuera del plano básico', JSON.stringify('😀'.repeat(120)), 'null'],
      ['claves __proto__, constructor e índices en un default', '"n"', '{"__proto__":{"polluted":1},"constructor":2,"b":1,"2":2,"1":1,"a":0}'],
      ['claves repetidas en un default', '"n"', '{"a":1,"a":2,"b":3,"a":4}'],
      ['formas numéricas', '"n"', '[1e400,-1e400,1e20,1E2,0.1e-6,-0,0.0,1.0,123456789012345678901234567890,5e-324,1.7976931348623157e308,0e0]'],
      ['cadenas con escapes y controles', '"n"', '["\\u0000","\\ud800","\\u0001\\u001f","\\"\\\\\\/","😀","\\u00e9"]'],
      ['anidamiento de 997 niveles (el flujo llega a 1000)', '"n"', `${'['.repeat(996)}${']'.repeat(996)}`],
    ];

    it.each(CASES)('%s: el borrador, la versión y la base guardan el mismo texto', async (_name, name, defaultText) => {
      const id = 'persistencia';
      const text = flowWith(id, name, defaultText);
      const expected = JSON.stringify(JSON.parse(text));

      const created = await api.create(text).expect(201);
      expect(flowText(created.text)).toBe(expected);
      expect(flowText((await read(`/flows/${id}`)).text)).toBe(expected);
      const [stored] = await prisma.$queryRaw<{ draft: string; name_json: string }[]>`SELECT draft, name_json FROM flows WHERE id = ${id}`;
      expect(stored?.draft).toBe(expected);
      expect(stored?.name_json).toBe(JSON.stringify(JSON.parse(text).name));
      expect((await api.get(id).expect(200)).body.name).toBe(JSON.parse(text).name);

      const published = await api.publish(id).expect(201);
      expect(flowText(published.text)).toBe(expected);
      expect(flowText((await read(`/flows/${id}/versions/1`)).text)).toBe(expected);
      const [version] = await prisma.$queryRaw<{ definition: string }[]>`SELECT definition FROM flow_versions WHERE flow_id = ${id}`;
      expect(version?.definition).toBe(expected);

      // Guardar lo mismo no cambia nada, y publicar sin cambios devuelve la misma versión.
      const same = await api.update(id, text, '"1"').expect(200);
      expect([same.body.revision, same.body.unpublishedChanges]).toEqual([1, false]);
      expect((await api.publish(id).expect(200)).body.version).toBe(1);
    });

    it('el polvo de Object no llega al proceso: __proto__ en el cuerpo no contamina nada', async () => {
      await api.create(flowWith('polvo', '"n"', '{"__proto__":{"polluted":true}}')).expect(201);
      await api.validate('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}').expect(200);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      const res = await api.validate('{"__proto__":{"isAdmin":true},"specVersion":"0.1","id":"x","name":"x","start":"f","nodes":[{"id":"f","type":"end"}]}').expect(200);
      expect(res.body).toEqual({ valid: false, issues: [{ layer: 'shape', path: '', message: "propiedad no permitida '__proto__'" }], warnings: [] });
    });

    it('variables, cabeceras y claves del body con nombres de Object funcionan como cualquier otro nombre', async () => {
      const text = JSON.stringify({
        specVersion: '0.1',
        id: 'nombres',
        name: 'N',
        variables: ['__proto__', 'constructor', 'hasOwnProperty', 'toString'].map((name) => ({ name, type: 'string' })),
        start: 'h',
        nodes: [
          {
            id: 'h',
            type: 'http',
            request: { method: 'POST', url: 'https://x.example.com/a', headers: { constructor: 'x', toString: '{{toString}}' }, body: { constructor: '{{constructor}}', '{{hasOwnProperty}}': 1 } },
            next: 'f',
            onError: 'f',
          },
          { id: 'f', type: 'end' },
        ],
      }).replace('"constructor":"x"', '"__proto__":"{{__proto__}}","constructor":"x"');
      const res = await api.create(text).expect(201);
      expect(flowText(res.text)).toBe(JSON.stringify(JSON.parse(text)));
      expect(res.body.warnings).toEqual([]);
    });
  });

  describe('respuestas de un flujo de 1 MiB (la forma JSON crece ×4,4)', () => {
    it('crear, leer, actualizar sin cambios, publicar y leer la versión responden en segundos y con el mismo texto', async () => {
      const flow = leads();
      flow.variables.push({ name: 'j', type: 'json', default: '__NUMEROS__' });
      const [before, after] = JSON.stringify(flow).split('"__NUMEROS__"') as [string, string];
      const count = Math.floor((MIB - Buffer.byteLength(before) - Buffer.byteLength(after) - 1) / 5);
      const text = `${before}[${Array.from({ length: count }, () => '1e20').join(',')}]${after}`;
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MIB);

      const started = performance.now();
      const created = await api.create(text).expect(201);
      const expected = flowText(created.text);
      expect(Buffer.byteLength(expected)).toBeGreaterThan(4 * MIB);
      expect(Buffer.byteLength(created.text)).toBeLessThan(4.6 * MIB);

      const same = await api.update('captacion-leads', text, '"1"').expect(200);
      expect([same.body.revision, same.body.updatedAt]).toEqual([1, created.body.updatedAt]);
      const published = await api.publish('captacion-leads').expect(201);
      expect(flowText(published.text)).toBe(expected);
      expect(flowText((await read('/flows/captacion-leads/versions/1')).text)).toBe(expected);
      expect(flowText((await read('/flows/captacion-leads')).text)).toBe(expected);
      expect((await api.publish('captacion-leads').expect(200)).body.version).toBe(1);
      expect(performance.now() - started).toBeLessThan(15_000);

      // Los listados no leen borradores: siguen siendo pequeños.
      const list = await api.list().expect(200);
      expect(Buffer.byteLength(list.text)).toBeLessThan(2000);
      expect(Buffer.byteLength((await api.versions('captacion-leads').expect(200)).text)).toBeLessThan(2000);
    }, 60_000);
  });

  describe('concurrencia real, sin barreras de test', () => {
    const named = (name: string) => ({ ...hola(), name });

    it('veinte PUT con el mismo If-Match: gana uno, los demás 412, y el borrador es el del ganador', async () => {
      await api.create(hola()).expect(201);
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => api.update('hola', named(`w${index}`), '"1"')));
      const winners = responses.filter((res) => res.status === 200);
      expect(winners).toHaveLength(1);
      expect(responses.filter((res) => res.status === 412)).toHaveLength(19);
      for (const res of responses.filter((r) => r.status === 412)) expect(res.body.currentRevision).toBe(2);
      const final = (await api.get('hola').expect(200)).body;
      expect([final.revision, final.name]).toEqual([2, winners[0]!.body.name]);
    });

    it('veinte publicaciones a la vez crean una sola versión', async () => {
      await api.create(hola()).expect(201);
      const responses = await Promise.all(Array.from({ length: 20 }, () => api.publish('hola')));
      expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
      expect(responses.filter((res) => res.status === 200)).toHaveLength(19);
      expect(new Set(responses.map((res) => res.body.version))).toEqual(new Set([1]));
      expect((await api.versions('hola').expect(200)).body.total).toBe(1);
    });

    it('veinte altas del mismo id: una 201 y diecinueve 409 flow_already_exists', async () => {
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => api.create(named(`c${index}`))));
      expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
      for (const res of responses.filter((r) => r.status !== 201)) {
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('flow_already_exists');
      }
    });

    it('PUT y publicaciones entrelazados dejan versiones consecutivas, sin repetir contenido y con indicadores coherentes', async () => {
      await api.create(hola()).expect(201);
      for (let round = 0; round < 12; round++) {
        const operations = [];
        for (let k = 0; k < 4; k++) {
          operations.push(api.update('hola', named(`r${round}-${k}`), '*'));
          operations.push(api.publish('hola'));
        }
        for (const res of await Promise.all(operations)) expect([200, 201]).toContain(res.status);
      }
      const versions = (await api.versions('hola', '?limit=100').expect(200)).body;
      const numbers = versions.items.map((item: { version: number }) => item.version).sort((a: number, b: number) => a - b);
      expect(numbers).toEqual(Array.from({ length: versions.total }, (_, index) => index + 1));

      const rows = await prisma.flowVersion.findMany({ where: { flowId: 'hola' }, orderBy: { version: 'asc' } });
      for (let index = 1; index < rows.length; index++) expect(rows[index]!.definition, `versión ${index + 1}`).not.toBe(rows[index - 1]!.definition);

      const draft = (await api.get('hola').expect(200)).body;
      const [stored] = await prisma.$queryRaw<{ draft: string; latest_version: number; unpublished_changes: boolean }[]>`SELECT draft, latest_version, unpublished_changes FROM flows WHERE id = 'hola'`;
      expect(draft.latestVersion).toBe(rows.length);
      expect(stored?.latest_version).toBe(rows.length);
      expect(stored?.unpublished_changes).toBe(stored?.draft !== rows.at(-1)?.definition);
    }, 60_000);

    it('borrar, actualizar y publicar a la vez: nadie recibe un 500 y el borrado gana para siempre', async () => {
      await api.create(hola()).expect(201);
      const responses = await Promise.all([
        api.remove('hola'),
        api.update('hola', named('x'), '*'),
        api.publish('hola'),
        api.update('hola', named('y'), '*'),
        api.remove('hola'),
        api.publish('hola'),
      ]);
      for (const res of responses) expect([200, 201, 204, 404], JSON.stringify(res.body)).toContain(res.status);
      expect(responses.filter((res) => res.status === 204)).toHaveLength(1);
      await api.get('hola').expect(404);
      expect((await api.create(hola())).body.error).toBe('flow_id_reserved');
    });
  });
});
