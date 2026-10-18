import type { ConversationResource, Page, TranscriptItem } from '@/lib/chat/api-types';
import { FLOWS } from '../../tests/helpers/engine-events';

type Json = Record<string, unknown>;

export type FlowName = keyof typeof FLOWS;

/** Lo que usan los E2E del recurso flujo de la API. */
export interface FlowRecord {
  id: string;
  name: string;
  revision: number;
  latestVersion: number | null;
  unpublishedChanges: boolean;
  flow: Json;
}

/**
 * Operaciones «directamente en la API» (D20): contra la API real, sin pasar por la simulada ni por la web. Solo para
 * preparar y comprobar el estado.
 */
export class Admin {
  constructor(private readonly base: string) {}

  /** Una petición cualquiera a la API real, con su estado y su cuerpo (para comprobar un 404 o un 412). */
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  }

  private async expect(method: string, path: string, status: number, body?: unknown, headers?: Record<string, string>): Promise<unknown> {
    const result = await this.call(method, path, body, headers);
    if (result.status !== status) throw new Error(`${method} ${path} → ${result.status} (se esperaba ${status}): ${JSON.stringify(result.body)}`);
    return result.body;
  }

  /** Crea y publica un flujo (de los conocidos por nombre, o un JSON propio). */
  async publish(flow: FlowName | Json): Promise<Json> {
    const definition = (typeof flow === 'string' ? FLOWS[flow] : flow) as Json;
    await this.expect('POST', '/flows', 201, definition);
    return (await this.expect('POST', `/flows/${definition.id as string}/versions`, 201, {})) as Json;
  }

  /** Crea un flujo sin publicarlo. */
  async createDraft(flow: FlowName | Json): Promise<void> {
    await this.expect('POST', '/flows', 201, typeof flow === 'string' ? FLOWS[flow] : flow);
  }

  /** Sustituye el borrador (sin publicar). */
  async updateDraft(flow: Json): Promise<void> {
    await this.expect('PUT', `/flows/${flow.id as string}`, 200, flow, { 'If-Match': '*' });
  }

  /** Publica el borrador actual de un flujo existente. */
  async publishDraft(flowId: string): Promise<void> {
    await this.expect('POST', `/flows/${flowId}/versions`, 201, {});
  }

  /** El recurso flujo de la API real (`GET /flows/:id`, 200). Un 404 se comprueba con `call`. */
  async flow(flowId: string): Promise<FlowRecord> {
    return (await this.expect('GET', `/flows/${flowId}`, 200)) as FlowRecord;
  }

  /** Las versiones publicadas de un flujo (`GET /flows/:id/versions?limit=100`). */
  async versions(flowId: string): Promise<Page<{ version: number; name: string }>> {
    return (await this.expect('GET', `/flows/${flowId}/versions?limit=100`, 200)) as Page<{ version: number; name: string }>;
  }

  async deleteFlow(flowId: string): Promise<void> {
    await this.expect('DELETE', `/flows/${flowId}`, 204);
  }

  async createConversation(flowId: string, contactId?: string): Promise<ConversationResource> {
    const body = (await this.expect('POST', '/conversations', 201, contactId === undefined ? { flowId } : { flowId, contactId })) as { conversation: ConversationResource };
    return body.conversation;
  }

  /** Responde con `If-Match` de la revisión actual. */
  async send(conversationId: string, input: unknown): Promise<ConversationResource> {
    const current = await this.conversation(conversationId);
    const body = (await this.expect('POST', `/conversations/${conversationId}/inputs`, 200, { input }, { 'If-Match': `"${current.revision}"` })) as { conversation: ConversationResource };
    return body.conversation;
  }

  async sendAll(conversationId: string, inputs: unknown[]): Promise<ConversationResource> {
    let last = await this.conversation(conversationId);
    for (const input of inputs) last = await this.send(conversationId, input);
    return last;
  }

  async conversation(conversationId: string): Promise<ConversationResource> {
    return (await this.expect('GET', `/conversations/${conversationId}`, 200)) as ConversationResource;
  }

  async transcript(conversationId: string): Promise<TranscriptItem[]> {
    const page = (await this.expect('GET', `/conversations/${conversationId}/transcript?limit=100`, 200)) as Page<TranscriptItem>;
    return page.items;
  }

  async listConversations(): Promise<Page<{ id: string; flowId: string }>> {
    return (await this.expect('GET', '/conversations?limit=100', 200)) as Page<{ id: string; flowId: string }>;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.expect('DELETE', `/conversations/${conversationId}`, 204);
  }
}

/** Las once respuestas con las que `preguntas` llega a `extras`: los siete textos, el plan y la pregunta de extras. */
export const PREGUNTAS_HASTA_PLAN: unknown[] = [
  { text: ' hola ' },
  { text: 'a@b.co' },
  { text: '+34 600 000 000' },
  { text: '5' },
  { text: 'https://example.com' },
  { text: '2026-10-17' },
  { text: 'sí' },
];

/** `captacion-leads` hasta `pedir-tamano`. */
export const CAPTACION_HASTA_TAMANO: unknown[] = [{ text: 'Ana' }, { text: 'ana@example.com' }];
