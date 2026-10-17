import flowSchema from '@franca/spec/flow.schema.json';

/** UUID en minúsculas con la forma de los que genera la API: la regla de `conversation-params.ts`. */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** El patrón de `id` del esquema de `@franca/spec`, sin copiarlo (como `flow-params.ts`). */
const FLOW_ID = new RegExp(flowSchema.$defs.id.pattern);
const VERSION = /^[1-9][0-9]{0,9}$/;
const OFFSET = /^[0-9]{1,10}$/;
const MAX_INT = 2_147_483_647;

declare const conversationIdBrand: unique symbol;
declare const flowIdBrand: unique symbol;

/** Id de conversación ya validado: lo único que puede formar la ruta de una operación. */
export type ConversationId = string & { readonly [conversationIdBrand]: true };
/** Id de flujo ya validado. */
export type FlowId = string & { readonly [flowIdBrand]: true };

/** Indica si un valor es un UUID en minúsculas (el `id` de una conversación). */
export function isConversationId(value: unknown): value is ConversationId {
  return typeof value === 'string' && CONVERSATION_ID.test(value);
}

/** Indica si un valor cumple el patrón de `id` de un flujo. */
export function isFlowId(value: unknown): value is FlowId {
  return typeof value === 'string' && FLOW_ID.test(value);
}

/** Lee un entero decimal sin signo ni ceros a la izquierda de 1 a 2147483647, o `null`. */
export function parseVersion(value: unknown): number | null {
  if (typeof value !== 'string' || !VERSION.test(value)) return null;
  const parsed = Number(value);
  return parsed <= MAX_INT ? parsed : null;
}

/** Lee un `offset` (entero decimal de hasta 10 cifras, ≤ 2147483647), o `null`. Sin valor, 0. */
export function parseOffset(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return 0;
  if (!OFFSET.test(value)) return null;
  const parsed = Number(value);
  return parsed <= MAX_INT ? parsed : null;
}
