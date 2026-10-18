import type { ChatErrorCode } from '@/lib/chat/copy';
import { GATE_COPY } from '@/lib/editor/save-gate';

/** Dónde ocurrió el error en el editor: cada contexto tiene sus textos y su genérico (tabla de errores del contrato). */
export type EditorErrorContext = 'create' | 'open' | 'save' | 'publish' | 'delete';

const CONNECTION = 'No se puede conectar con la API de Franca.';
const DATABASE = 'La base de datos de Franca no está disponible.';
const INVALID_FLOW = 'La API de Franca considera que el flujo no es válido.';
const LITERAL_CREDENTIAL = 'La API de Franca no guarda credenciales escritas: usa un secreto.';
const TOO_LARGE = GATE_COPY.tooLarge;
const GONE = 'El flujo se ha borrado fuera del editor. Usa «Ver JSON» para copiar lo que has editado.';
const CHANGED_OUTSIDE = 'El flujo ha cambiado fuera del editor.';

type Overrides = Partial<Record<ChatErrorCode, string>>;

const CONNECTION_CODES: Overrides = { network_error: CONNECTION, api_unreachable: CONNECTION, database_unavailable: DATABASE };

const ERROR_COPY: Record<EditorErrorContext, { generic: string; known: Overrides }> = {
  create: {
    generic: 'No se ha podido crear el flujo.',
    known: {
      ...CONNECTION_CODES,
      invalid_flow: INVALID_FLOW,
      literal_credential: LITERAL_CREDENTIAL,
      payload_too_large: TOO_LARGE,
      flow_already_exists: 'Ya existe un flujo con ese identificador.',
      flow_id_reserved: 'Ese identificador perteneció a un flujo borrado y no se puede reutilizar.',
    },
  },
  open: { generic: 'No se ha podido cargar el flujo.', known: CONNECTION_CODES },
  save: {
    generic: 'No se ha podido guardar el flujo.',
    known: { ...CONNECTION_CODES, invalid_flow: INVALID_FLOW, literal_credential: LITERAL_CREDENTIAL, payload_too_large: TOO_LARGE, flow_not_found: GONE },
  },
  publish: {
    generic: 'No se ha podido publicar el flujo.',
    known: { ...CONNECTION_CODES, invalid_flow: INVALID_FLOW, literal_credential: LITERAL_CREDENTIAL, flow_not_found: GONE, revision_mismatch: CHANGED_OUTSIDE },
  },
  delete: {
    generic: 'No se ha podido borrar el flujo.',
    known: { ...CONNECTION_CODES, revision_mismatch: CHANGED_OUTSIDE },
  },
};

export const EDITOR_COPY = {
  conflict: 'El flujo ha cambiado en otra pestaña o fuera del editor.',
  changedOutside: CHANGED_OUTSIDE,
  gone: GONE,
  unconfirmed: 'No consta que se hayan guardado los cambios. Siguen en el editor.',
  unconfirmedDatabase: 'La base de datos de Franca no está disponible: no consta que se hayan guardado los cambios.',
  saved: (revision: number) => `Guardado. Revisión ${revision}.`,
  published: (version: number) => `Publicada la versión ${version}.`,
  alreadyPublished: (version: number) => `La versión ${version} ya tiene este borrador.`,
  copied: 'Copiado.',
  selfJump: 'Un nodo no puede saltar a sí mismo.',
} as const;

/**
 * Texto en español de un error en un contexto del editor. Un código sin texto propio, o `unknown`, da el genérico del
 * contexto. Decide por `code`, nunca por el `message` de la API (que no llega al navegador).
 *
 * @param context Dónde ocurrió.
 * @param code Código del error.
 */
export function editorErrorCopy(context: EditorErrorContext, code: ChatErrorCode): string {
  const { generic, known } = ERROR_COPY[context];
  return Object.hasOwn(known, code) ? (known[code] ?? generic) : generic;
}

/** Los códigos con texto propio de un contexto, para comprobar la tabla en los tests. */
export function editorKnownCodes(context: EditorErrorContext): string[] {
  return Object.keys(ERROR_COPY[context].known);
}
