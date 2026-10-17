---
name: gotcha-node-http-createconnection-y-proxy
description: Trampas de node:http al enviar una petición sobre un socket ya conectado (agent false ignora createConnection, keep-alive y chunked por defecto, 101 sin response, status 600) y de las variables de TLS y de proxy del entorno
metadata:
  type: project
  enforcement: apps/api/src/http-host/static-guard.spec.ts
---

# `node:http` sobre un socket propio: lo que muerde (medido en Node 22.23.3)

La salida http de la API ([[decision-salida-http-politica]]) conecta ella misma con la dirección validada y le pasa el socket a `http.request` con `createConnection`. Así el cliente no resuelve, no conecta y no tiene *pool*. Lo que se descubrió al hacerlo:

- **`agent: false` ignora `createConnection`** y conecta a `localhost:80`. Con `agent` sin definir sí lo usa. Por eso `transport.ts` no pasa `agent` y la guarda estática prohíbe cualquier `agent:`.
- **Cabeceras:** con las cabeceras como array y sin `Content-Length`, Node añade `Connection: keep-alive` y, en un `POST`, `Transfer-Encoding: chunked`. La API manda `Connection: close` y `Content-Length` explícitos (y `Content-Length: 0` en `POST`/`PUT`/`PATCH` sin body, como recomienda RFC 9110).
- **Un `101 Switching Protocols` emite `close` sin `response` ni `error`**: sin tratarlo, el intento acaba en `timeout`. `transport.ts` convierte un `close` antes de `response` en `network_error` con `requestSent: true` en cuanto ocurre.
- **`node:http` entrega status `600` o `999`**; el lector del motor (`readAttemptResult`) los rechaza y la conversación fallaría con `http_host_error`. Fuera de 200-599 es `network_error` con `requestSent: true`.
- **`NODE_USE_ENV_PROXY` desvía `http.globalAgent` y `fetch`.** Sin agente ni `fetch`, la salida no tiene por dónde entrar al proxy; `HTTP_PROXY`, `HTTPS_PROXY` y `ALL_PROXY` no se leen. Se lee al **arrancar** Node, por eso el escenario «Proxy del entorno ignorado» corre en un proceso hijo (`apps/api/test/http-host-proxy.e2e-hostile.ts`). La salida a Claude sí usa `fetch` y obedece el proxy ([[gotcha-sdk-anthropic-lee-el-entorno]]).
- **TLS:** `tls.connect` lee `NODE_TLS_REJECT_UNAUTHORIZED` en cada llamada, pero un `rejectUnauthorized: true` **explícito** gana. El valor va siempre explícito (`peerVerification()`), derivado de la misma constante que la comprobación de `authorized` (`VERIFY_PEER`); un objeto vacío dejaría el valor por defecto de Node, que también rechaza, y el mutante `acceptBadTls` no aceptaría nada. `NODE_EXTRA_CA_CERTS` sí cuenta (Node la añade a sus raíces cuando no se pasa `ca`).

Enforcement: `static-guard.spec.ts` (sin `fetch`, agentes ni variables de TLS o proxy), el test del `101` y «Status fuera de rango» de `http-host-requests.e2e-spec.ts`, y el proceso hijo del proxy en `http-host-environment.e2e-spec.ts`.
