// Respuestas copiadas de la API real (Nest 12 + Express 5, medidas el 2026-10-18 con `curl -i` y `Connection: close`
// contra `POST/GET/PUT/DELETE /flows` y `POST /flows/:id/versions`): los dobles del editor tienen la forma que la API
// tiene de verdad, no la que su autor creía. `e2e/editor-api-shapes.e2e.ts` las compara con la API real (claves y orden).

function raw(status: string, headers: string[], body?: string): Buffer {
  const lines = [
    `HTTP/1.1 ${status}`,
    ...headers,
    ...(body === undefined ? [] : [`Content-Length: ${Buffer.byteLength(body)}`]),
    'Date: Sun, 18 Oct 2026 06:57:47 GMT',
    'Connection: close',
  ];
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body ?? ''}`, 'utf8');
}

const HOLA = '{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end"}]}';
const HOLA_2 = '{"specVersion":"0.1","id":"hola","name":"Hola 2","start":"fin","nodes":[{"id":"fin","type":"end"}]}';

/** `POST /flows` y `GET /flows/hola` (revisión 1, sin versiones). */
export const FLOW_BODY = `{"id":"hola","name":"Hola","revision":1,"latestVersion":null,"unpublishedChanges":true,"createdAt":"2026-10-18T06:57:40.698Z","updatedAt":"2026-10-18T06:57:40.698Z","flow":${HOLA},"warnings":[]}`;
/** `PUT /flows/hola` con `If-Match: "1"` y el nombre `Hola 2`. */
export const FLOW_UPDATED_BODY = `{"id":"hola","name":"Hola 2","revision":2,"latestVersion":null,"unpublishedChanges":true,"createdAt":"2026-10-18T06:57:40.698Z","updatedAt":"2026-10-18T06:57:47.415Z","flow":${HOLA_2},"warnings":[]}`;
/** `GET /flows?limit=20&offset=0`. */
export const LIST_BODY = '{"items":[{"id":"hola","name":"Hola","revision":1,"latestVersion":null,"unpublishedChanges":true,"createdAt":"2026-10-18T06:57:40.698Z","updatedAt":"2026-10-18T06:57:40.698Z"}],"total":1,"limit":20,"offset":0}';
/** `POST /flows/hola/versions` (201 la primera vez, 200 las siguientes). */
export const VERSION_BODY = `{"flowId":"hola","version":1,"name":"Hola 2","publishedAt":"2026-10-18T06:57:47.454Z","flow":${HOLA_2},"warnings":[]}`;
/** `412` de `PUT`, `POST …/versions` y `DELETE`. */
export const REVISION_MISMATCH_BODY = '{"message":"el borrador ha cambiado","error":"revision_mismatch","currentRevision":2}';
export const NOT_FOUND_BODY = '{"message":"flujo no encontrado","error":"flow_not_found"}';
export const RESERVED_BODY = '{"message":"ese id perteneció a un flujo borrado y no se puede reutilizar","error":"flow_id_reserved"}';
export const EXISTS_BODY = '{"message":"ya existe un flujo con ese id","error":"flow_already_exists"}';
export const INVALID_FLOW_BODY =
  '{"message":"el flujo no es válido","error":"invalid_flow","issues":[{"layer":"shape","path":"/name","message":"debe tener al menos 1 carácter(es)"},{"layer":"shape","path":"/nodes","message":"debe tener al menos 1 elemento(s)"}],"warnings":[]}';
export const LITERAL_CREDENTIAL_BODY =
  '{"message":"una cabecera de credenciales lleva el valor escrito en el flujo: usa una referencia a un secreto","error":"literal_credential","warnings":[{"code":"credential_header_literal","path":"/nodes/0/request/headers/Authorization","nodeId":"h","message":"la cabecera Authorization lleva el valor escrito en el flujo: las credenciales van como referencia a un secreto ({\\"secret\\": \\"NOMBRE\\"})"}]}';
export const PRECONDITION_REQUIRED_BODY = '{"message":"falta la cabecera If-Match con la revisión del borrador","error":"precondition_required"}';
export const PAYLOAD_TOO_LARGE_BODY = '{"message":"el cuerpo supera el tamaño máximo de 1 MiB","error":"payload_too_large"}';
export const INVALID_JSON_BODY = '{"message":"el cuerpo no es JSON válido","error":"invalid_json"}';

const JSON_TYPE = 'Content-Type: application/json; charset=utf-8';
const POWERED = 'X-Powered-By: Express';

export const RAW_FLOW_201 = raw('201 Created', [POWERED, 'Location: /flows/hola', 'ETag: "1"', JSON_TYPE], FLOW_BODY);
export const RAW_FLOW_200 = raw('200 OK', [POWERED, 'ETag: "1"', JSON_TYPE], FLOW_BODY);
export const RAW_LIST_200 = raw('200 OK', [POWERED, JSON_TYPE], LIST_BODY);
export const RAW_PUT_200 = raw('200 OK', [POWERED, 'ETag: "2"', JSON_TYPE], FLOW_UPDATED_BODY);
export const RAW_VERSION_201 = raw('201 Created', [POWERED, 'Location: /flows/hola/versions/1', JSON_TYPE], VERSION_BODY);
export const RAW_VERSION_200 = raw('200 OK', [POWERED, JSON_TYPE], VERSION_BODY);
/** `204 No Content` de `DELETE`: sin `Content-Length` ni cuerpo. */
export const RAW_DELETE_204 = raw('204 No Content', [POWERED]);
export const RAW_412 = raw('412 Precondition Failed', [POWERED, 'ETag: "2"', JSON_TYPE], REVISION_MISMATCH_BODY);
export const RAW_404 = raw('404 Not Found', [POWERED, JSON_TYPE], NOT_FOUND_BODY);
export const RAW_409_EXISTS = raw('409 Conflict', [POWERED, JSON_TYPE], EXISTS_BODY);
export const RAW_409_RESERVED = raw('409 Conflict', [POWERED, JSON_TYPE], RESERVED_BODY);
export const RAW_400_INVALID_FLOW = raw('400 Bad Request', [POWERED, JSON_TYPE], INVALID_FLOW_BODY);
export const RAW_400_LITERAL = raw('400 Bad Request', [POWERED, JSON_TYPE], LITERAL_CREDENTIAL_BODY);
export const RAW_428 = raw('428 Precondition Required', [POWERED, JSON_TYPE], PRECONDITION_REQUIRED_BODY);
export const RAW_413 = raw('413 Payload Too Large', [POWERED, JSON_TYPE], PAYLOAD_TOO_LARGE_BODY);
