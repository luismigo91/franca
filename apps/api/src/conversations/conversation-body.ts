import { MAX_VERSION } from '../flows/flow-params.js';
import { ApiException } from '../http/api-error.js';
import { isContactId } from './conversation-params.js';

export interface CreateBody {
  flowId: string;
  /** `null`: la última versión publicada. */
  version: number | null;
  /** `null`: conversación anónima. */
  contactId: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Propiedad propia de un objeto de `JSON.parse`; una heredada no cuenta. */
function ownProperty(object: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(object, name) ? object[name] : undefined;
}

/**
 * Valida el cuerpo de `POST /conversations`: un objeto con `flowId` (texto), `version` (entero de 1 a 2147483647) y
 * `contactId` (patrón de contacto) opcionales; `null` equivale a omitido y las demás propiedades se ignoran. Es un
 * parser puro y no un `ValidationPipe`: ver `.claude/rules/backend/routes-and-errors.md`.
 *
 * @param body El valor que dio `JSON.parse`.
 * @returns El cuerpo validado.
 * @throws {ApiException} `invalid_request` si no es un objeto o algún campo no tiene su tipo.
 */
export function parseCreateBody(body: unknown): CreateBody {
  if (!isPlainObject(body)) throw new ApiException('invalid_request');
  const flowId = ownProperty(body, 'flowId');
  const version = ownProperty(body, 'version') ?? null;
  const contactId = ownProperty(body, 'contactId') ?? null;
  if (typeof flowId !== 'string') throw new ApiException('invalid_request');
  if (version !== null && !(typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= MAX_VERSION)) {
    throw new ApiException('invalid_request');
  }
  if (contactId !== null && !isContactId(contactId)) throw new ApiException('invalid_request');
  return { flowId, version, contactId };
}

/**
 * Valida el cuerpo de `POST /conversations/:id/inputs`: un objeto con la propiedad propia `input` (cualquier valor,
 * también `null`: el motor decide si tiene la forma). Todo lo demás se ignora, incluido un `state`.
 *
 * @param body El valor que dio `JSON.parse`.
 * @returns La entrada del usuario, sin tipar.
 * @throws {ApiException} `invalid_request` si no es un objeto con `input`.
 */
export function parseInputBody(body: unknown): { input: unknown } {
  if (!isPlainObject(body) || !Object.hasOwn(body, 'input')) throw new ApiException('invalid_request');
  return { input: body.input };
}
