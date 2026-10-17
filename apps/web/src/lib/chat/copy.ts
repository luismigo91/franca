import type { InvalidAnswerReason } from '@franca/engine';
import type { ApiErrorCode } from '@/config/api-error-codes';
import type { WebErrorCode } from '@/config/web-error-codes';
import type { ConversationStatus } from '@/lib/chat/api-types';

/** Códigos que maneja el chat: los de la API, los de la web, el del navegador y `unknown` (cualquier otro o sin cuerpo). */
export type ChatErrorCode = ApiErrorCode | WebErrorCode | 'network_error' | 'unknown';

/** Dónde ocurrió el error: cada contexto tiene sus textos y su genérico (tabla «Errores» del contrato). */
export type ErrorContext = 'list' | 'start' | 'open' | 'send' | 'remove';

/** Aviso por cada motivo de respuesta inválida del motor. El tipo obliga a cubrir los cinco. */
export const REASON_COPY: Record<InvalidAnswerReason, string> = {
  too_long: 'La respuesta es demasiado larga.',
  required: 'La respuesta está vacía.',
  invalid_format: 'La respuesta no tiene el formato esperado.',
  out_of_range: 'La respuesta está fuera de lo permitido.',
  pattern_mismatch: 'La respuesta no sigue el formato que pide el flujo.',
};

export const GENERIC_REASON_COPY = 'La respuesta no es válida.';

/** Aviso en español de un motivo; uno genérico para el que no se conoce. */
export function reasonCopy(reason: string): string {
  return Object.prototype.hasOwnProperty.call(REASON_COPY, reason) ? REASON_COPY[reason as InvalidAnswerReason] : GENERIC_REASON_COPY;
}

const CONNECTION = 'No se puede conectar con la API de Franca.';
const DATABASE = 'La base de datos de Franca no está disponible.';
const VERSION_INVALID = 'La versión publicada ya no es válida: publica una versión nueva.';

type Overrides = Partial<Record<ChatErrorCode, string>>;

const ERROR_COPY: Record<ErrorContext, { generic: string; known: Overrides }> = {
  list: {
    generic: 'No se han podido cargar los datos.',
    known: { network_error: CONNECTION, api_unreachable: CONNECTION, database_unavailable: DATABASE },
  },
  start: {
    generic: 'No se ha podido iniciar la conversación.',
    known: {
      flow_not_found: 'Ese flujo ya no existe.',
      flow_not_published: 'Este flujo no tiene ninguna versión publicada.',
      flow_version_invalid: VERSION_INVALID,
      database_unavailable: DATABASE,
      network_error: CONNECTION,
      api_unreachable: CONNECTION,
      invalid_request: 'El identificador de contacto no es válido: usa solo letras, números, - y _.',
    },
  },
  open: {
    generic: 'No se ha podido cargar la conversación.',
    known: { network_error: CONNECTION, api_unreachable: CONNECTION, database_unavailable: DATABASE },
  },
  send: {
    generic: 'No se ha podido enviar la respuesta.',
    known: {
      invalid_input: 'La respuesta no tiene la forma que espera la pregunta.',
      revision_mismatch: 'La conversación ha avanzado en otra pestaña.',
      conversation_busy: 'La conversación está procesando otra respuesta.',
      conversation_not_found: 'Esta conversación ya no existe.',
      payload_too_large: 'La respuesta es demasiado larga para enviarla.',
      flow_version_invalid: VERSION_INVALID,
      database_unavailable: DATABASE,
    },
  },
  remove: {
    generic: 'No se ha podido borrar la conversación.',
    known: { network_error: CONNECTION, api_unreachable: CONNECTION },
  },
};

/**
 * Texto en español de un error en un contexto. Un código sin texto propio, o `unknown`, da el genérico del contexto.
 * Decide por `code`, nunca por el `message` de la API.
 */
export function errorCopy(context: ErrorContext, code: ChatErrorCode): string {
  const { generic, known } = ERROR_COPY[context];
  return Object.prototype.hasOwnProperty.call(known, code) ? (known[code] ?? generic) : generic;
}

/** Los contextos con texto propio, para comprobar la tabla en los tests. */
export function knownCodes(context: ErrorContext): string[] {
  return Object.keys(ERROR_COPY[context].known);
}

export const STATUS_COPY: Record<ConversationStatus, string> = {
  waiting: 'En espera',
  ended: 'Terminada',
  failed: 'Fallida',
  expired: 'Caducada',
};

export const COPY = {
  appTitle: 'Chat de prueba',
  brand: 'Franca',
  pageDescription: 'Prueba tus flujos de Franca como lo haría una persona usuaria.',
  flowsHeading: 'Flujos publicados',
  conversationsHeading: 'Conversaciones recientes',
  loadingFlows: 'Cargando flujos…',
  loadingConversations: 'Cargando conversaciones…',
  noFlows: 'Todavía no hay flujos publicados. Publica uno con la API de Franca y vuelve.',
  noConversations: 'Aún no se ha probado ningún flujo.',
  retry: 'Reintentar',
  more: 'Ver más',
  moreFlows: 'Ver más flujos',
  moreConversations: 'Ver más conversaciones',
  videoName: 'Vídeo',
  audioName: 'Audio',
  try: 'Probar',
  starting: 'Iniciando…',
  unpublishedChanges: 'Cambios sin publicar',
  contactLabel: 'Identificador de contacto',
  contactHint: 'Opcional. No uses un dato personal: solo letras, números, - y _.',
  conversationLoading: 'Cargando conversación…',
  conversationNotFound: 'Conversación no encontrada',
  loadErrorTitle: 'No se ha podido abrir la conversación',
  conversationNotFoundBody: 'Esta conversación no existe o se ha borrado.',
  backHome: 'Volver al inicio',
  restart: 'Empezar de nuevo',
  remove: 'Borrar conversación',
  removeTitle: '¿Borrar la conversación?',
  removeBody: 'El borrado es definitivo y no borra los datos guardados del contacto.',
  removeConfirm: 'Borrar',
  removeCancel: 'Cancelar',
  conversationLog: 'Conversación',
  typing: 'Escribiendo…',
  send: 'Enviar',
  answerLabel: 'Tu respuesta',
  emptyAnswer: '(vacía)',
  emptyAnswerName: 'Respuesta vacía',
  unsupportedQuestion: 'Esta pregunta no se puede responder desde el chat de prueba.',
  endEnded: 'Conversación terminada',
  endFailed: 'La conversación no ha podido continuar',
  endExpired: 'La conversación ha caducado por inactividad',
  outcome: 'Resultado',
  detailsHeading: 'Detalles de la prueba',
  activityHeading: 'Actividad técnica',
  noActivity: 'Sin actividad técnica',
  mediaUnavailable: 'Contenido no disponible',
  embedTitle: 'Contenido incrustado',
  reload: 'Volver a cargar',
  retrySend: 'Reintentar',
  otherTab: 'La conversación ha avanzado en otra pestaña.',
  busy: 'La conversación está procesando otra respuesta.',
  lostNotSent: 'No se ha podido enviar la respuesta.',
  gone: 'Esta conversación ya no existe.',
  goneLink: 'Volver al inicio',
  errorBoundaryTitle: 'Algo ha fallado en el chat de prueba',
  notFoundTitle: 'Página no encontrada',
  notFoundBody: 'La página que buscas no existe.',
  yes: 'Sí',
  no: 'No',
} as const;
