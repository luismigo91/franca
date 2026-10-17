import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { createTestPrisma } from './helpers/database.js';
import { resetConversations } from './helpers/conversations.js';
import { faq } from './helpers/examples.js';
import { startApi, type RunningApi } from './helpers/process.js';
import { rawRequest } from './helpers/raw.js';

const PRELOAD = pathToFileURL(
  new URL('./helpers/fetch-capture.mjs', import.meta.url).pathname,
).href;
const FRANCA_KEY = 'qa6-franca-key-0001'; // gitleaks:allow
const SENTINELS = [
  'qa6-sdk-key-0002',
  'qa6-sdk-token-0003',
  'qa6-header-key-0004',
  'qa6-header-auth-0005',
]; // gitleaks:allow
const ALLOWED_HEADERS = [
  'accept',
  'anthropic-beta',
  'anthropic-version',
  'content-type',
  'x-api-key',
];
const PII = 'Marta Qa6 Pérez';

interface Captured {
  url: string;
  method: string;
  names: string[];
  keyOk: boolean;
  leaked: string[];
}

const captured = (output: string): Captured[] =>
  output
    .split('\n')
    .filter((line) => line.startsWith('QA6-FETCH '))
    .map((line) => JSON.parse(line.slice('QA6-FETCH '.length)) as Captured);

describe('QA: proceso real con claves del SDK en la shell y una clave de Franca', () => {
  const running: RunningApi[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((api) => api.stop()));
  });

  it('la petición a Anthropic solo lleva la clave de Franca y el registro no contiene claves, URL de la base ni entradas', async () => {
    const prisma = createTestPrisma();
    try {
      await resetConversations(prisma);
      const databaseUrl = inject('databaseUrl');
      const api = startApi({
        DATABASE_URL: databaseUrl,
        PORT: '0',
        NODE_OPTIONS: `--import ${PRELOAD}`,
        QA6_SENTINELS: SENTINELS.join('|'),
        FRANCA_ANTHROPIC_API_KEY: FRANCA_KEY,
        ANTHROPIC_API_KEY: SENTINELS[0]!,
        ANTHROPIC_AUTH_TOKEN: SENTINELS[1]!,
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
        ANTHROPIC_CUSTOM_HEADERS: `x-api-key: ${SENTINELS[2]}\nauthorization: Bearer ${SENTINELS[3]}`,
      });
      running.push(api);
      const address = await api.whenListening();
      expect(address).toBeDefined();
      const json = { 'content-type': 'application/json' };
      const call = (method: string, path: string, body?: string) =>
        rawRequest(address!.port, {
          method,
          path,
          headers: body === undefined ? {} : json,
          body,
        });
      expect((await call('POST', '/flows', JSON.stringify(faq()))).status).toBe(
        201,
      );
      expect((await call('POST', '/flows/faq-ia/versions')).status).toBe(201);

      const created = await call(
        'POST',
        '/conversations',
        JSON.stringify({ flowId: 'faq-ia', contactId: 'qa6-c' }),
      );
      expect(created.status).toBe(201);
      // El turno de la creación llegó a la puerta de salida y el 400 simulado lo convierte en un fallo del nodo.
      const sent = captured(api.output());
      expect(sent.length).toBeGreaterThan(0);
      for (const request of sent) {
        expect(request.url).toMatch(
          /^https:\/\/api\.anthropic\.com\/v1\/messages(\?beta=true)?$/,
        );
        expect(request.method).toBe('POST');
        expect(request.keyOk).toBe(true);
        expect(request.leaked).toEqual([]);
        expect(
          request.names.filter((name) => !ALLOWED_HEADERS.includes(name)),
        ).toEqual([]);
      }

      // Errores de todas las clases con datos personales en juego.
      const id = created.json.conversation.id as string;
      await call(
        'POST',
        `/conversations/${id}/inputs`,
        JSON.stringify({ input: { text: PII } }),
      );
      await call('POST', `/conversations/${id}/inputs`, '{"input": ');
      await call(
        'POST',
        '/conversations',
        JSON.stringify({ flowId: 'no-existe' }),
      );
      await call('DELETE', '/contacts/qa6-c');
      await call('DELETE', `/conversations/${id}`);
      await api.stop();

      const output = api
        .output()
        .split('\n')
        .filter((line) => !line.startsWith('QA6-FETCH '))
        .join('\n');
      for (const secret of [
        FRANCA_KEY,
        ...SENTINELS,
        databaseUrl,
        PII,
        'Marta',
      ])
        expect(output, secret).not.toContain(secret);
      expect(output).toContain('proveedor llm principal: Claude');
    } finally {
      await prisma.$disconnect();
    }
  });
});
