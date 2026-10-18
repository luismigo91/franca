import { getIn, type EditResult } from '@/lib/editor/json-edit';

/** Un estado local de un campo (el texto que se está escribiendo, el modo elegido) y el valor del flujo del que salió. */
export interface Local<T> {
  data: T;
  /** `canonicalOf` del valor del flujo en el momento en que se guardó este estado. */
  basis: string;
}

/** El valor del flujo como texto comparable (`undefined` incluido). */
export function canonicalOf(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Un estado local solo vale mientras el valor del flujo sea el que lo originó. Si el valor cambia por otro camino («Editar como
 * JSON», quitar un elemento de una lista y que otro ocupe su sitio, descartar cambios), el estado viejo se ignora en vez de
 * volver a escribirse con la siguiente pulsación.
 *
 * @param local El estado guardado, o `null`.
 * @param value El valor del flujo ahora.
 * @returns Los datos locales si siguen valiendo, o `null`.
 */
export function validLocal<T>(local: Local<T> | null, value: unknown): T | null {
  return local !== null && local.basis === canonicalOf(value) ? local.data : null;
}

/**
 * Crea un estado local tras una edición: su base es el valor que el flujo tiene **después** de ella (si se aplicó) o el de antes
 * (si el campo la rechazó y no cambió nada).
 *
 * @param data Lo que se guarda.
 * @param result Resultado de `edit`.
 * @param pointer Ruta del campo.
 * @param before Valor del campo antes de la edición.
 */
export function localAfterEdit<T>(data: T, result: EditResult, pointer: string, before: unknown): Local<T> {
  return { data, basis: canonicalOf(result.ok ? getIn(result.flow, pointer) : before) };
}
