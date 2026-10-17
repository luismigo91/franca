import { ApiException } from '../http/api-error.js';

/** UUID en minúsculas con la forma de los que genera la API (cualquier versión pasa; la base lo tipa como `uuid`). */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Identificador opaco del contacto: sin `@`, puntos ni espacios, porque aparece en rutas y registros. */
const CONTACT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Indica si un valor es un `contactId` válido.
 *
 * @param value Lo recibido (de un cuerpo o de una ruta).
 * @returns `true` si es un texto que cumple `^[A-Za-z0-9_-]{1,64}$`.
 */
export function isContactId(value: unknown): value is string {
  return typeof value === 'string' && CONTACT_ID.test(value);
}

/**
 * Valida el `:conversationId` de una ruta antes de que llegue a la base: un texto que no es UUID nunca produce `22P02`.
 *
 * @param value Segmento de la ruta, ya decodificado.
 * @returns El mismo `id`.
 * @throws {ApiException} `conversation_not_found` si no es un UUID en minúsculas: ninguna conversación puede tener ese `id`.
 */
export function parseConversationId(value: string): string {
  if (!CONVERSATION_ID.test(value)) throw new ApiException('conversation_not_found');
  return value;
}

/**
 * Valida el `:contactId` de `DELETE /contacts/:contactId`.
 *
 * @param value Segmento de la ruta, ya decodificado.
 * @returns El mismo `contactId`.
 * @throws {ApiException} `invalid_request` si no cumple el patrón.
 */
export function parseContactId(value: string): string {
  if (!isContactId(value)) throw new ApiException('invalid_request');
  return value;
}
