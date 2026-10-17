import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as operations from '@/server/api/operations';
import { ADVANCE_TIMEOUT_MS, READ_TIMEOUT_MS } from '@/config/limits';
import { API_OPERATIONS } from '@/config/endpoints';
import { withFakeApi } from '../../../tests/helpers/api-env';
import { sendJson } from '../../../tests/helpers/fake-api';
import type { ConversationId, FlowId } from '@/server/ids';

const ID = '4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90' as ConversationId;
const fake = withFakeApi();

describe('operations', () => {
  it('exporta exactamente las ocho operaciones', () => {
    expect(Object.keys(operations).sort()).toEqual([
      'createConversation',
      'deleteConversation',
      'getConversation',
      'getFlowVersion',
      'getTranscriptPage',
      'listConversations',
      'listPublishedFlows',
      'sendConversationInput',
    ]);
    expect(Object.keys(API_OPERATIONS)).toHaveLength(8);
  });

  it('cada una arma su método, su ruta y su consulta exactos', async () => {
    fake.api.respond((_request, response) => sendJson(response, 200, {}));
    await operations.listPublishedFlows(0);
    await operations.getFlowVersion('hola' as FlowId, 3);
    await operations.listConversations(20);
    await operations.getConversation(ID);
    await operations.getTranscriptPage(ID, 100);
    await operations.createConversation('{"flowId":"hola"}');
    await operations.sendConversationInput(ID, '{"input":{"text":"a"}}', '"4"');
    await operations.deleteConversation(ID);
    expect(fake.api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /flows?published=true&limit=20&offset=0',
      'GET /flows/hola/versions/3',
      'GET /conversations?limit=20&offset=20',
      `GET /conversations/${ID}`,
      `GET /conversations/${ID}/transcript?limit=100&offset=100`,
      'POST /conversations',
      `POST /conversations/${ID}/inputs`,
      `DELETE /conversations/${ID}`,
    ]);
    expect(fake.api.requests[6]!.headers['if-match']).toBe('"4"');
    expect(fake.api.requests[5]!.headers['if-match']).toBeUndefined();
  });

  it('los plazos mínimos de la spec: 180 s en los avances y 15 s en el resto', () => {
    expect(ADVANCE_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    const source = readFileSync(new URL('./operations.ts', import.meta.url), 'utf8');
    expect(source.match(/ADVANCE_TIMEOUT_MS/g)).toHaveLength(3);
    expect(source.match(/READ_TIMEOUT_MS/g)).toHaveLength(7);
  });
});
