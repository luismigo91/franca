import net from 'node:net';

// Respuestas copiadas de la API real (Nest 12 + Express 5, medidas el 2026-10-17 con `curl -i` y `Connection: close`):
// los dobles de los tests tienen la forma que la API tiene de verdad, no la que su autor creía.

function raw(status: string, headers: string[], body?: string): Buffer {
  const lines = [
    `HTTP/1.1 ${status}`,
    ...headers,
    ...(body === undefined ? [] : [`Content-Length: ${Buffer.byteLength(body)}`]),
    'Date: Sat, 17 Oct 2026 12:52:07 GMT',
    'Connection: close',
  ];
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body ?? ''}`, 'utf8');
}

export const CREATED_BODY = '{"conversation":{"id":"b10f495b-7486-429c-8a32-525e4e06b4cc","flowId":"pregunta","version":1,"contactId":null,"status":"waiting","revision":1,"processing":false,"pendingInput":{"type":"input","nodeId":"p","inputType":"text","attempt":1,"reason":null},"outcome":null,"error":null,"costUsd":0,"costLimitReached":false,"createdAt":"2026-10-17T12:52:42.227Z","updatedAt":"2026-10-17T12:52:42.227Z","expiresAt":"2026-10-17T13:22:42.227Z"},"events":[{"type":"message","nodeId":"p","content":[{"kind":"text","text":"¿Nombre?"}],"typingDelayMs":600},{"type":"input","nodeId":"p","inputType":"text","attempt":1,"reason":null}]}';
export const ADVANCE_BODY = '{"conversation":{"id":"1f2676b4-4816-4104-8606-3b90c9a150fe","flowId":"pregunta","version":1,"contactId":null,"status":"ended","revision":2,"processing":false,"pendingInput":null,"outcome":"ok","error":null,"costUsd":0,"costLimitReached":false,"createdAt":"2026-10-17T12:52:07.558Z","updatedAt":"2026-10-17T12:52:07.610Z","expiresAt":null},"events":[{"type":"message","nodeId":"fin","content":[{"kind":"text","text":"Adiós, ."}],"typingDelayMs":600},{"type":"end","nodeId":"fin","outcome":"ok"}]}';
export const REVISION_MISMATCH_BODY = '{"message":"la conversación ha cambiado","error":"revision_mismatch","currentRevision":1}';
export const NOT_FOUND_BODY = '{"message":"conversación no encontrada","error":"conversation_not_found"}';
export const BUSY_BODY = '{"message":"la conversación está procesando otra entrada","error":"conversation_busy"}';

const JSON_TYPE = 'Content-Type: application/json; charset=utf-8';

/** `201 Created` de `POST /conversations`. */
export const RAW_201 = raw('201 Created', ['X-Powered-By: Express', 'Location: /conversations/b10f495b-7486-429c-8a32-525e4e06b4cc', 'ETag: "1"', JSON_TYPE], CREATED_BODY);
/** `200 OK` de `POST …/inputs`. */
export const RAW_200 = raw('200 OK', ['X-Powered-By: Express', 'ETag: "2"', JSON_TYPE], ADVANCE_BODY);
/** `204 No Content` de `DELETE`: sin `Content-Length`, sin `Transfer-Encoding` y sin cuerpo. */
export const RAW_204 = raw('204 No Content', ['X-Powered-By: Express']);
/** `412 Precondition Failed`. */
export const RAW_412 = raw('412 Precondition Failed', ['X-Powered-By: Express', 'ETag: "1"', JSON_TYPE], REVISION_MISMATCH_BODY);
/** `409 Conflict` `conversation_busy`. */
export const RAW_409 = raw('409 Conflict', ['X-Powered-By: Express', JSON_TYPE], BUSY_BODY);
/** `404 Not Found`. */
export const RAW_404 = raw('404 Not Found', ['X-Powered-By: Express', JSON_TYPE], NOT_FOUND_BODY);

/**
 * Un servidor TCP que contesta con los bytes exactos de la API real (una respuesta por conexión) y cierra, como hace
 * la API con `Connection: close`. Devuelve su puerto y cómo pararlo.
 */
export async function startRawApi(respond: (requestText: string) => Buffer): Promise<{ port: number; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      const headEnd = received.indexOf('\r\n\r\n');
      if (headEnd === -1) return;
      const length = /content-length: (\d+)/i.exec(received)?.[1];
      if (received.length - headEnd - 4 < Number(length ?? 0)) return;
      requests.push(received);
      socket.end(respond(received));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
