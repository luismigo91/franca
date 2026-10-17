/**
 * Avisos del validador: cosas que no impiden ejecutar ni guardar un flujo pero que conviene que alguien vea.
 * El validador informa; quien lo usa decide (la API rechaza la credencial escrita, el editor la marca).
 */
import { byPath } from './issues.js';
import { hasMarker } from './template.js';
import type { Flow } from './types.js';

/** Códigos de aviso, lista cerrada. `too_many_warnings` solo lo añade `capWarnings`, nunca `validateFlow`. */
export const FLOW_WARNING_CODES = [
  'url_template_in_origin',
  'credential_header_not_secret',
  'credential_header_literal',
  'too_many_warnings',
] as const;

export type FlowWarningCode = (typeof FLOW_WARNING_CODES)[number];

export interface FlowWarning {
  code: FlowWarningCode;
  /** JSON Pointer (RFC 6901) del campo exacto. */
  path: string;
  /** Nodo afectado, si el aviso es de un nodo. */
  nodeId?: string;
  message: string;
}

/** Avisos máximos que devuelve `capWarnings`. */
export const MAX_FLOW_WARNINGS = 100;

/** Cabeceras que llevan credenciales, en minúsculas. */
const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);

const URL_ORIGIN_MESSAGE =
  'el origen de la url (esquema, host o puerto) depende de una variable: un valor puede cambiar el destino de la petición';
const SECRET_HINT = 'las credenciales van como referencia a un secreto ({"secret": "NOMBRE"})';

/**
 * Avisos de un flujo cuya forma es correcta, ordenados por `path` (índices en orden numérico).
 * Cada regla emite como mucho un aviso por campo.
 *
 * @param flow Flujo con la forma validada.
 * @returns Todos los avisos, sin recortar.
 */
export function flowWarnings(flow: Flow): FlowWarning[] {
  const warnings: FlowWarning[] = [];
  flow.nodes.forEach((node, index) => {
    if (node.type !== 'http') return;
    const base = `/nodes/${index}/request`;
    if (hasMarker(writtenOrigin(node.request.url))) {
      warnings.push({ code: 'url_template_in_origin', path: `${base}/url`, nodeId: node.id, message: URL_ORIGIN_MESSAGE });
    }
    for (const [name, value] of Object.entries(node.request.headers ?? {})) {
      if (typeof value !== 'string' || !CREDENTIAL_HEADERS.has(name.toLowerCase())) continue;
      const path = `${base}/headers/${escapePointer(name)}`;
      if (hasMarker(value)) {
        const message = `la cabecera ${name} se construye con variables: ${SECRET_HINT}`;
        warnings.push({ code: 'credential_header_not_secret', path, nodeId: node.id, message });
      } else {
        const message = `la cabecera ${name} lleva el valor escrito en el flujo: ${SECRET_HINT}`;
        warnings.push({ code: 'credential_header_literal', path, nodeId: node.id, message });
      }
    }
  });
  return warnings.sort(byPath);
}

/**
 * El origen escrito de una `url`: su texto hasta el primer `/`, `?`, `#` o `\` posterior al primer `://`, o hasta
 * el primero de esos caracteres (o el final) si no hay `://`. Sin expresiones regulares: coste lineal.
 */
function writtenOrigin(url: string): string {
  const scheme = url.indexOf('://');
  const from = scheme === -1 ? 0 : scheme + 3;
  for (let i = from; i < url.length; i++) {
    const char = url[i];
    if (char === '/' || char === '?' || char === '#' || char === '\\') return url.slice(0, i);
  }
  return url;
}

/** Escapa un segmento de JSON Pointer (RFC 6901). */
function escapePointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * Recorta una lista de avisos para mostrarla: los `MAX_FLOW_WARNINGS` primeros y, si había más, el aviso final
 * `too_many_warnings`. Las decisiones se toman con la lista completa; esto es solo para mostrar.
 *
 * @param warnings Avisos completos.
 * @returns La misma lista si cabe; si no, los 100 primeros y el aviso final.
 */
export function capWarnings(warnings: FlowWarning[]): FlowWarning[] {
  if (warnings.length <= MAX_FLOW_WARNINGS) return warnings;
  return [
    ...warnings.slice(0, MAX_FLOW_WARNINGS),
    { code: 'too_many_warnings', path: '', message: 'hay más avisos: solo se muestran los 100 primeros' },
  ];
}
