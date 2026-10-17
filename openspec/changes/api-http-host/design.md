# Design: salida http de producción de la API (`api-http-host`)

**Fecha**: 2026-10-17 · **Rama**: `feat/api-http-host` · Motivación y alcance en `proposal.md`; comportamiento en `specs/http-host/spec.md` (21 requisitos, 31 escenarios), `specs/conversations-api/spec.md` y `specs/flow-engine/spec.md`, que mandan sobre este documento. Antes de este diseño se corrigieron en la spec los huecos que destapó la auditoría (commit `4bd043d`, `spec(api): huecos de api-http-host…`). Las tres preguntas abiertas de la propuesta se aplican con su recomendación: `http://` solo hacia pares permitidos, los ejemplos locales del chat son de la feature 7, y una resolución mezclada se bloquea entera.

## Context

- **El motor ya fija el contrato** (`packages/engine/src/types.ts`): `HttpCapability = (request: HttpRequest) => Promise<HttpAttemptResult>`, un intento por llamada; el motor lee el resultado con `readAttemptResult` (`src/http/result.ts`: `status` entero de 200 a 599, `body` string; `network_error` con `requestSent` opcional), decide los reintentos (`src/http/retry.ts`), aplica el presupuesto de 10 llamadas externas por avance compartido con `llm` y nunca mide el tiempo ([[decision-http-un-intento-por-llamada]]). Las cabeceras reservadas al host (`host`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `te`, `trailer`, `expect`, `proxy-*`) ya las rechaza `checkHttpConfig`; la URL llega validada y serializada (`validateUrlText`: solo nombres de dominio, sin IPs, sin `localhost`).
- **La suite de conformidad** (`@franca/engine/conformance`): 21 casos, 17 de `http` y 4 de `llm`/sesiones. El arnés (`HostConformanceHarness`) pide servidores locales reales, un resolutor guionizado, una lista de permitidos por par, secretos por tenant, registro y reloj. `serve()` debe devolver una dirección **fuera** de `CONFORMANCE_INTERNAL_ADDRESSES` (que incluye `127.0.0.1` y `::1`).
- **La API hoy** (`apps/api/src/conversations/`): `buildEngineHost(llm)` devuelve `{ llm }` sin `http`; `ConversationsService.newAdvance` crea la capacidad `llm` de cada avance con `startedAtMs` del `CLOCK`; `createAdvanceLlm` comprueba primero el proveedor (configuración) y después el plazo `LLM_WINDOW_MS` (90 s). La configuración se lee del entorno en un `useFactory` del módulo y `main.ts` la valida antes de abrir el puerto (`ConfigError`, mensaje sin valores). La línea de arranque del proveedor la escribe `ConversationsModule.onApplicationBootstrap`. Los e2e sustituyen siempre `LLM_PROVIDERS` y abortan si no pueden (`test/helpers/conversations-app.ts`). La conformidad de la API ejecuta 4 casos por `id` y lanza en las capacidades `http` del arnés.

### Auditoría de la spec contra el código fusionado

| Lo que decía la spec | Lo que dice el código (medido) | Dónde se corrige |
|---|---|---|
| «Orden de un intento» no situaba el plazo de 90 s | `createAdvanceLlm` comprueba la configuración (proveedor) **antes** que el plazo. Sin orden, un secreto ausente pasado el plazo podía ser `timeout` (sigue por `onError`) o `missing_secret` (falla) | Spec (`4bd043d`): secretos → plazo → resolución; escenario «Secreto ausente fuera de plazo» |
| `Content-Length` solo «si hay body» | `node:http` con cabeceras en array añade `Transfer-Encoding: chunked` y `Connection: keep-alive` a un `POST` sin `Content-Length`; RFC 9110 recomienda `Content-Length: 0` en `POST`/`PUT`/`PATCH` sin contenido (medido en Node 22.23.3) | Spec (`4bd043d`): `Content-Length: 0` en `POST`, `PUT` y `PATCH` sin body; AND en «Cabeceras que recibe el servidor». D14 |
| Nada sobre status fuera de rango | `node:http` entrega `600` y `999` (medido); `readAttemptResult` los rechaza y el motor haría fallar la conversación con `http_host_error` | Spec (`4bd043d`): requisito «Respuestas que el motor no admite» → `network_error` con `requestSent: true` (también un cuerpo comprimido corrupto). D13 |
| Motivo del aviso `blocked` cuando se dan los dos | Sin precedencia: un `http://` con una dirección interna tenía dos motivos | Spec (`4bd043d`): gana `internal_destination`. D9 |
| `effectiveSpec` aplica los deltas | `apps/api/test/helpers/spec-text.ts` y `packages/engine/tests/helpers/spec-text.ts` (copias idénticas) solo aplican `ADDED`/`MODIFIED` por título y no distinguen secciones: con el `RENAMED` seguirían exigiendo «Nodos http deshabilitados», y un `REMOVED` se leería como un requisito sin escenarios | Diseño D23 (los dos helpers aprenden `RENAMED`/`REMOVED` y bloques por requisito, con test de paridad) |
| `CONFORMANCE_INTERNAL_ADDRESSES` con 32 direcciones | `packages/engine/tests/conformance.test.ts` cuenta 25 y lee la **primera** aparición del escenario en `text` (la de la spec vigente, no la del delta) | Diseño D22 (lee el bloque efectivo del requisito) |
| `serve()` en una dirección fuera de las internas | En macOS no hay `127.0.0.2` (`EADDRNOTAVAIL`, medido por el analista) y `443` exige privilegios | Diseño D3 y D18 (red del test con pares virtuales) |
| «el origen … que puede tener la `url` de un nodo `http`» | La regla vive en `validateUrlText` (`packages/engine/src/http/url.ts`), que **no** se exporta (`exports.test.ts` fija las claves públicas) | Diseño D11 (se consulta al motor público, sin reimplementar la regla) |
| `NODE_USE_ENV_PROXY` no desvía nada | En Node 22.23 desvía `http.globalAgent` **y** `fetch` (medido: `http.get` y `fetch` llegan al proxy) | Diseño D4 y D7 (sin agente ni `fetch`) |
| — | `http.request({ agent: false, createConnection })` **ignora** `createConnection` y conecta a `localhost:80` (medido); con `agent` sin definir sí lo usa | Diseño D4 y ficha nueva de la wiki |
| `NODE_TLS_REJECT_UNAUTHORIZED` no desactiva la verificación | `tls.connect` lee la variable en cada llamada, pero un `rejectUnauthorized: true` explícito gana (medido con un certificado no confiable) | Diseño D6 |

No hay contradicciones de producto pendientes: los cuatro huecos de conducta se cerraron en la spec antes de diseñar.

## Goals / Non-Goals

**Goals**
- Una capacidad `http` de producción que pase **todos** los `HOST_CONFORMANCE_CASES` y los 31 escenarios de `http-host`, conectada a las conversaciones con una cláusula en `buildEngineHost` y su llamada.
- Una costura de red que el test solo puede sustituir **después** de todas las comprobaciones, demostrada con tests y mutantes.
- Configuración por tres variables validadas al arrancar, sin valores en ninguna salida.

**Non-Goals** (los de la propuesta, más): Happy Eyeballs (RFC 8305) y tiempo de conexión por dirección; caché de DNS; límites de concurrencia del resolutor del sistema; HTTP/2 y ALPN distinto de `http/1.1`; reutilizar la salida http fuera de `apps/api`.

## Decisions

### D1. Dónde vive: módulo nuevo `apps/api/src/http-host/`

Un módulo Nest propio (`HttpHostModule`) con su núcleo en funciones sin Nest (`createHttpHost`), importado por `ConversationsModule`. El nombre sigue a la capacidad de la spec y no choca con `src/http/` (la frontera de entrada).

Descartado:
- **Paquete `packages/http-host`**: hoy hay un solo consumidor; la configuración es de la instalación (variables, Nest, línea de arranque) y un paquete añade build, exports y otra superficie pública que revisar. El núcleo no importa Nest, así que extraerlo después es mover ficheros.
- **Dentro de `src/conversations/`**: es un componente de seguridad con superficie, tests y mutantes propios; mezclarlo agranda el diff de conversaciones y la revisión de las dos cosas.

### D2. Ficheros

**Nuevos** (`apps/api/src/http-host/`, cada uno con su `*.spec.ts` salvo `transport.ts`, que se prueba en e2e):

| Fichero | Qué tiene |
|---|---|
| `http-host.module.ts` | Tokens `HTTP_HOST_CONFIG`, `HTTP_NETWORK`, `HTTP_HOST`; proveedores (config con `useFactory` asíncrono desde `process.env`, `systemNetwork()`, `createHttpHost`); `onApplicationBootstrap` con la línea de arranque. Exporta `HTTP_HOST` |
| `http-host-config.ts` | `loadHttpHostConfig(env): Promise<HttpHostConfig>` (D11), `describeHttpHostConfig(config): string` (línea de arranque) |
| `secret-origin.ts` | `isNodeUrlOrigin(origin): Promise<boolean>`: la sonda contra el motor (D11) |
| `secrets.ts` | `SecretStore` y `createSecretStore(config.secrets)` |
| `addresses.ts` | Parser a bytes, forma canónica, IPv4 incrustada, `isGlobalUnicast`, `destinationKey(address, port)` (D8) |
| `special-purpose-addresses.ts` | Las dos tablas de IANA con su fecha (D8) |
| `destination-policy.ts` | `decideDestination(...)` (D9) |
| `network.ts` | Interfaces `Resolver`, `SocketOpener`, `HttpNetwork` y `systemNetwork()`: el **único** fichero que importa `node:dns` y llama a `net.connect` (D3, D10) |
| `request-headers.ts` | Cabeceras del cable (D14) |
| `response-body.ts` | Lectura con límite y descompresión (D13) |
| `transport.ts` | Conexión fijada, TLS, petición y respuesta (D4-D6, D13) |
| `attempt-budget.ts` | Milisegundos de un intento: `min(timeoutMs, deadlineMs − now())` (D12) |
| `notices.ts` | Las dos plantillas de aviso y `HttpNotices` (D16) |
| `http-host.ts` | `createHttpHost(deps): HttpHost` con `forAdvance(context)`: el orden de un intento y la clasificación del resultado (D15) |
| `static-guard.spec.ts` | Guarda estática de la costura (D3, D7) |

**Nuevos en tests** (`apps/api/test/`): `helpers/test-network.ts`, `helpers/test-servers.ts`, `helpers/test-pki.ts`, `helpers/http-flows.ts` (variantes de los flujos de los escenarios), los e2e `http-host-*.e2e-spec.ts` de D18-D20, `spec-text-parity.spec.ts`, `mutations.json`; y en `apps/api/`: `scripts/mutate.mjs`, `scripts/vitest-mutate.mjs`, `vitest.config.mutate.ts` (D21).

**Ficheros existentes que se tocan** (el principio es convivir sin retocar; cada uno es una decisión):

| Fichero | Cambio | Por qué es inevitable |
|---|---|---|
| `apps/api/src/conversations/engine-host.ts` | `buildEngineHost(llm, http)` → `{ llm, http }` | Es la cláusula de contacto prevista (FOLLOW-UP 5.1 de `api-conversations`) |
| `apps/api/src/conversations/engine-host.spec.ts` | Reescrito: el host lleva las dos capacidades y un `http` llega a la capacidad recibida | Su aserción («no tiene `http`») es justo lo que cambia la spec |
| `apps/api/src/conversations/conversations.service.ts` | Inyecta `HTTP_HOST`; `newAdvance(id, priorCostUsd)` devuelve `{ advance, host }` con un único `startedAtMs` para `llm` y `http`; dos llamadas a `buildEngineHost` | El plazo compartido de 90 s exige el mismo inicio para las dos capacidades, y el aviso necesita el `id` |
| `apps/api/src/conversations/conversations.module.ts` | `imports: [HttpHostModule]` | El consumidor importa al proveedor |
| `apps/api/src/conversations/conversation-timing.ts` | Solo el JSDoc de `LLM_WINDOW_MS`: el plazo vale también para `http` | Un comentario falso es peor que una línea de diff. El nombre no cambia (renombrarlo abriría `advance-llm.ts` y su spec) |
| `apps/api/src/main.ts` | `readConfig` pasa a `async` y espera `loadHttpHostConfig(process.env)` | «ninguna llega a escuchar»: la validación debe ocurrir antes de abrir el puerto, como `HOST` y el presupuesto |
| `apps/api/test/helpers/conversations-app.ts` | Sustituye **siempre** `HTTP_NETWORK` por una `TestNetwork` y `HTTP_HOST_CONFIG` por la de un entorno falso; aborta si no puede | Sin esto, un e2e con secretos saldría a Internet; es el mismo patrón que `LLM_PROVIDERS` |
| `apps/api/test/helpers/conversations-harness.ts` | Implementa `http`, `serve`, `resolve`, `blockedPort`, `refusing`, `connectionsTo`, `setSecret` | Hoy lanzan «fuera de esta feature» |
| `apps/api/test/helpers/spec-text.ts` | Copia de la versión nueva del motor (D23) | `RENAMED` |
| `apps/api/test/spec-coverage.spec.ts` | Entrada `http-host` (21 requisitos, 31 escenarios) | Cobertura de la capacidad nueva |
| `apps/api/test/conversations-conformance.e2e-spec.ts` | Recorre **todo** `HOST_CONFORMANCE_CASES` | «el test falla si algún caso no se ha ejecutado» |
| `apps/api/test/conversations-create.e2e-spec.ts`, `conversations-inputs.e2e-spec.ts`, `conversations-llm.e2e-spec.ts` | Los escenarios modificados (`unsupported_node` → `missing_secret`, ejemplos de punta a punta) y los nuevos de esos requisitos | Los escenarios viven en esos ficheros |
| `apps/api/package.json`, `apps/api/.gitignore` | Script `mutate`; `.mutate-backup/` | D21 |
| `packages/engine/src/conformance/cases.ts` | 7 direcciones más | Delta de `flow-engine` |
| `packages/engine/tests/conformance.test.ts` | 32 y lectura del bloque efectivo | D22 |
| `packages/engine/tests/helpers/spec-text.ts`, `packages/engine/tests/unit/spec-text.test.ts` | `RENAMED`/`REMOVED` y bloques, con sus tests | D23: sin esto D22 no puede leer la spec efectiva |
| `scripts/guard-mutate.mjs`, `packages/engine/tests/guard-mutate.test.ts` | El candado mira también `apps/*/.mutate-backup/`, con su caso | D21: el Stop hook no debe verificar un `src/` mutado de la API |
| `turbo.json`, `CLAUDE.md`, `.claude/rules/always/knowledge-wiki.md`, `.claude/rules/backend/architecture.md`, `.claude/wiki/*` | Variables, índice, una línea de arquitectura y fichas (D24) | Meta |

Nada más: el criterio de aceptación de la fase 4 (tasks 4.6) hace fallar la revisión si `git diff --stat main...HEAD` lista otro fichero existente. Sin cambios en `packages/spec`, `packages/llm-anthropic`, `apps/web`, Prisma ni las rutas.

### D3. La costura de red: solo el resolutor y la apertura del socket TCP

```ts
// network.ts
export interface ResolvedAddress { readonly address: string; readonly family: 4 | 6 }
export type Resolution = { kind: 'addresses'; addresses: readonly ResolvedAddress[] } | { kind: 'failed' };
export interface Resolver { resolve(hostname: string, signal: AbortSignal): Promise<Resolution> }
/** Abre una conexión TCP con una dirección IP literal ya validada. Devuelve el socket sin esperar a `connect`. */
export interface SocketOpener { open(target: { address: string; family: 4 | 6; port: number }): Socket }
export interface HttpNetwork {
  readonly resolver: Resolver;
  readonly opener: SocketOpener;
  /** Autoridades TLS que sustituyen a las de Node. `undefined` en producción: solo la red del test las trae. */
  readonly ca?: readonly string[];
}
export function systemNetwork(): HttpNetwork; // sin parámetros: no lee el entorno
```

Un único token `HTTP_NETWORK`. Todo lo demás es código de producción en cualquier ejecución: el orden, los secretos, el plazo, la clasificación, la política, el recorrido de direcciones, TLS y su verificación, el cliente HTTP, la lectura, la descompresión, los límites y los avisos. El test sustituye **lo que el sistema operativo resuelve y a qué socket real lleva un par `dirección:puerto`**, y nada por encima. TLS va siempre por `tls.connect` de producción sobre el socket que devuelve el abridor; el test solo decide en qué servidor real acaba ese socket y qué certificado presenta ese servidor.

Lo que lo demuestra (tasks 3.2):
- **Guarda estática** (`static-guard.spec.ts`, unit): en `src/http-host/` solo `network.ts` importa `node:dns`/`node:dns/promises` o llama a `net.connect`/`net.createConnection`/`tls.connect` sin `socket`; nadie usa `fetch`, `http.get`, `https.`, `Agent`, `globalAgent` ni `process.env` (salvo `http-host.module.ts`, que pasa `process.env` a `loadHttpHostConfig`); `transport.ts` no recibe `lookup`.
- **Canario de la costura** (e2e): con la red del test pero un abridor que rechaza todo, el escenario del CRM termina en `lead-sin-enviar` con `network_error` y el servidor real **no recibe ninguna conexión**; con un resolutor que no conoce nombres, el abridor no se llama. Si la producción saltara la costura, el canario daría respuesta.
- **Orden** (unit, con red falsa sin IO): con `missing_secret` el resolutor no se llama; con `blocked` el abridor no se llama; pasado el plazo, ninguno.
- **La red del test no filtra**: registra cada `open` **antes** de decidir y no sabe nada de la política; los mutantes de política mueren con ella (D21).
- **Los puertos virtuales nunca son los reales**: un par virtual usa un puerto en el que no escucha nada en `127.0.0.1` (o los de la spec: 80, 443, 8080, 8081, 8443), así que un código que conectara por su cuenta a `127.0.0.1:<puerto virtual>` no llegaría al servidor del test.

Descartado:
- **`127.0.0.2` y puertos privilegiados**: no existen o exigen permisos en macOS.
- **Sustituir `dns.lookup` o `net.connect` globales** (monkeypatch): cambia el proceso entero y no demuestra que la salida use la costura.
- **`lookup` fijado en `https.request`**: la política se aplicaría dentro del agente, que puede re-resolver o usar el proxy; y el `lookup` sustituido por el test estaría **por encima** del recorrido de direcciones.
- **`MockAgent` de undici o un cliente simulado**: sustituye el cliente entero; la suite pasaría sin probar nada.
- **Red de Docker**: privilegios y otra pieza en CI.

### D4. Cliente HTTP: `node:http.request` sobre un socket ya conectado y verificado

`http.request({ method, path, headers, setHost: false, createConnection: () => socket, insecureHTTPParser: false })` con `agent` **sin definir** (con `agent: false` Node crea un `Agent` e ignora `createConnection`; medido). `socket` es el TCP (o el `TLSSocket` ya verificado) que abrió `transport.ts`: el cliente no resuelve, no conecta, no tiene caché de sesiones TLS ni pool. Las cabeceras van como array de pares (orden y mayúsculas del flujo) con `Connection` y, cuando toca, `Content-Length` explícitas: sin ellas Node añade `Connection: keep-alive` y `Transfer-Encoding: chunked` (medido). `maxHeaderSize` por defecto (16 KiB).

Descartado:
- **`fetch`**: obedece `NODE_USE_ENV_PROXY` (medido) y no deja fijar la dirección.
- **undici** como dependencia: su `Client` admite un `connect` propio, pero es una dependencia nueva para lo que `node:http` ya da, con su propio pool, sus cabeceras por defecto y `EnvHttpProxyAgent`.
- **Cliente HTTP/1.1 propio**: un parser de respuestas (chunked, cabeceras, límites) es superficie de seguridad nueva sin necesidad.

**Sin dependencias nuevas** (ni de producción ni de test).

### D5. Conexión fijada a la dirección validada

- `systemNetwork().opener.open({ address, family, port })` → `net.connect({ host: address, port, family, autoSelectFamily: false, noDelay: true, lookup })` con un `lookup` que siempre falla: con una IP literal Node no lo llama, y si algún día lo llamara, falla en vez de resolver.
- Las direcciones se recorren en el orden de la resolución (ya canónicas y sin repetir, D8). Se pasa a la siguiente **solo** si la anterior falla antes de enviar un byte de la petición: error de TCP (`ECONNREFUSED`, `EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL`…) o de TLS. Agotadas todas → `network_error` con `requestSent: false`. No hay tiempo por dirección: lo acota el del intento (non-goal Happy Eyeballs).
- Una conexión por intento: se destruye al resolver el intento pase lo que pase; `Connection: close`; sin agente no hay ni pool ni sesiones TLS reanudadas entre conversaciones.
- Una IPv4 mapeada se conecta como su IPv4 (`family: 4`); una NAT64 (`64:ff9b::/96`) se conecta como la IPv6 (la traduce la pasarela).

### D6. TLS

`tls.connect({ socket, servername, rejectUnauthorized: true, checkServerIdentity: (_host, cert) => tls.checkServerIdentity(hostname, cert), minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'], ...(network.ca ? { ca: network.ca } : {}) })`, con `hostname` el de la URL (no la dirección) y `servername` igual a `hostname`. Tras `secureConnect` se exige además `socket.authorized === true`; si no, `network_error` con `requestSent: false`.

- `NODE_TLS_REJECT_UNAUTHORIZED=0`: el `rejectUnauthorized: true` explícito gana al valor por defecto que Node calcula en cada `tls.connect` (medido).
- `NODE_EXTRA_CA_CERTS` cuenta porque Node la añade a sus raíces cuando **no** se pasa `ca`; en producción `ca` es `undefined`.
- La autoridad del test solo entra por `HTTP_NETWORK` sustituido en código: ninguna variable ni configuración lee una CA (guarda estática y unit de `systemNetwork()` con todas las variables de TLS y proxy definidas).
- Un host que fuera una IP literal (inalcanzable desde el motor; solo por defensa) no lleva SNI y se verifica contra la IP.

### D7. Proxy del entorno

No hay agente ni `fetch`, así que `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` y `NODE_USE_ENV_PROXY` (en cualquier caja) no tienen por dónde entrar; la salida no lee ninguna. Lo prueban la guarda estática y el escenario «Proxy del entorno ignorado» en un proceso que **arranca** con esas variables (D19), porque `NODE_USE_ENV_PROXY` se lee al iniciar Node. La salida a Claude sigue con `fetch` y por tanto con el proxy del entorno: está fuera de esta capacidad ([[gotcha-sdk-anthropic-lee-el-entorno]]) y queda en Riesgos.

### D8. Clasificación de direcciones: una sola fuente de verdad

`addresses.ts` (puro, sin `node:net` salvo `isIP` para la sintaxis):
- `parseIp(text)` → `{ family, bytes: Uint8Array(4|16), scoped }` o `null`. IPv6 en cualquier forma escrita (`::`, ceros, IPv4 incrustada en texto); una zona (`%en0`) marca `scoped` y nunca es global.
- `canonicalIp(parsed)`: IPv4 en decimal con puntos; mapeada (`::ffff:0:0/96`) → su IPv4; IPv6 en RFC 5952 (minúsculas, la racha de ceros más larga comprimida). Es la forma que ven la política, la lista de permitidos, el abridor y `connectionsTo`.
- `isGlobalUnicast(parsed)`:
  - IPv4: no multicast (`224.0.0.0/4`) y (fuera de la tabla IPv4 de IANA **o** dentro de alguna entrada con «Globally Reachable» `True`).
  - IPv6: mapeada y NAT64 `64:ff9b::/96` → se juzga la IPv4 incrustada; `::/96` (compatible), `64:ff9b:1::/48`, `2002::/16` (6to4) y `2001::/32` (Teredo) → nunca; si no, en `2000::/3` y (fuera de la tabla IPv6 **o** en una entrada `True`).
- `destinationKey(address, port)` = `<canónica>|<puerto>`: la lista de permitidos se compara por clave, nunca por texto escrito.

`special-purpose-addresses.ts` guarda las dos tablas como datos (prefijo, longitud, `globallyReachable: true | false | null`; `null` es «N/A» y cuenta como no global), con la fecha de los registros consultados en un comentario. Instantánea de partida, que el desarrollador contrasta con los CSV de IANA (`iana-ipv4-special-registry`, `iana-ipv6-special-registry`) al implementar y anota la fecha; una diferencia de conducta con un escenario se lleva a la spec:

- IPv4, no globales: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24` (con `192.0.0.0/29`, `192.0.0.8/32`, `192.0.0.170/32`, `192.0.0.171/32`), `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `240.0.0.0/4`, `255.255.255.255/32`. Globales dentro del registro: `192.0.0.9/32`, `192.0.0.10/32`, `192.31.196.0/24`, `192.52.193.0/24`, `192.175.48.0/24`.
- IPv6, no globales: `::1/128`, `::/128`, `::ffff:0:0/96`, `64:ff9b:1::/48`, `100::/64`, `100:0:0:1::/64`, `2001::/23`, `2001::/32` (N/A), `2001:2::/48`, `2001:10::/28`, `2001:db8::/32`, `2002::/16` (N/A), `3fff::/20`, `5f00::/16`, `fc00::/7`, `fe80::/10`. Globales dentro del registro: `64:ff9b::/96` (se juzga la IPv4), `2001:1::1/128`, `2001:1::2/128`, `2001:1::3/128`, `2001:3::/32`, `2001:4:112::/48`, `2001:20::/28`, `2001:30::/28`, `2620:4f:8000::/48`.

Unit: una fila de test por entrada de las tablas (el primer y el último valor del prefijo y uno fuera), las formas escritas de la spec, todas las de `CONFORMANCE_INTERNAL_ADDRESSES` (las 32 son no globales: paridad con el motor) y las de los escenarios de IPv4/IPv6.

Descartado: `net.BlockList` (no expresa «entrada `True` dentro de una `False`» ni juzga la IPv4 de una NAT64), una dependencia como `ipaddr.js`, y expresiones regulares sobre texto (las formas escritas son justo el ataque).

### D9. Política de destinos

`decideDestination({ addresses, port, secure, allowed })`, con las direcciones canónicas y sin repetir:
1. Si alguna no es de un par permitido **y** no es unicast global → `blocked` `internal_destination`.
2. Si no, si es `http://` y alguna no es de un par permitido → `blocked` `insecure_transport`.
3. Si no → `connect` con todas, en el orden de la resolución.

Así, `internal_destination` gana a `insecure_transport` (spec), una resolución mezclada se bloquea entera y nunca se elige qué dirección «vale». `allowed` es `{ has(key) }`: en producción, el conjunto de claves de `FRANCA_HTTP_ALLOWED_DESTINATIONS`; en el arnés, un conjunto mutable al que `serve()` y `refusing()` añaden su par.

### D10. Resolución

`systemNetwork().resolver` = `dns.promises.lookup(hostname, { all: true, order: 'verbatim' })` (getaddrinfo: el mismo resolutor que el resto del sistema, con `/etc/hosts`), en carrera con la señal del intento; lanzar o una lista vacía → `{ kind: 'failed' }` (`network_error` con `requestSent: false`). `lookup` no se puede cancelar: al vencer el intento se abandona su promesa (con su `catch`) y el hilo del pool de libuv termina cuando el sistema responda (Riesgos). Un `hostname` entre corchetes (IP literal, solo por defensa) se resuelve a sí mismo sin consultar.

Descartado: `dns.Resolver` (c-ares) con `timeout` y `cancel()`: no lee `/etc/hosts`, que es la vía natural para que quien opera (o el chat de la feature 7) haga resolver un nombre a un servidor local de la lista de permitidos.

### D11. Secretos y configuración

```ts
export interface HttpHostConfig {
  /** Nombre → valor completo de la cabecera y orígenes exactos. Nunca se imprime el valor. */
  readonly secrets: ReadonlyMap<string, { readonly value: string; readonly origins: ReadonlySet<string> }>;
  /** Nombres de variables `FRANCA_SECRET_*` sin origen (solo para la línea de arranque). */
  readonly ignoredSecretVariables: readonly string[];
  /** Pares permitidos, en el orden escrito: forma canónica (`127.0.0.1:8080`, `[::1]:8443`) y clave. */
  readonly allowedDestinations: readonly { readonly display: string; readonly key: string }[];
}
```

`loadHttpHostConfig(env)`, en este orden, cada fallo con `ConfigError` cuyo mensaje nombra la variable (y la posición de la entrada) y nunca un valor:
1. `FRANCA_HTTP_SECRET_ORIGINS` ausente o `""` → sin secretos. Si no, se parte por `,`; cada entrada no vacía es `NOMBRE=origen` con `NOMBRE` de `^[A-Z][A-Z0-9_]{0,63}$` y un origen que cumple **las dos**: `new URL(origen).origin === origen` (serialización exacta: sin `/`, ruta, usuario, puerto por defecto ni mayúsculas) e `isNodeUrlOrigin(origen)`. Repetir la misma entrada es inocuo.
2. `isNodeUrlOrigin` no reimplementa la regla del motor: ejecuta con `startSession` de `@franca/engine` un flujo sonda `GET ${origen}/` (un `http` y un `end`) con un host cuyo `http` guarda la petición y devuelve `blocked`, y acepta solo si el motor llamó al host con exactamente `${origen}/`. Así `ftp:`, IPs, `localhost`, `*.localhost` o hosts que no son dominio se rechazan con la regla real de «Destino y longitud de la URL», sin exportar nada nuevo del motor.
3. Por cada nombre de los orígenes, `FRANCA_SECRET_<NOMBRE>` debe existir y tener de 1 a 8192 caracteres de `[\x21-\x7E \t]` sin espacio ni tabulador en los extremos.
4. Las variables `FRANCA_SECRET_*` cuyo nombre no está en los orígenes se ignoran; a la línea de arranque van solo las que cumplen `^FRANCA_SECRET_[A-Z0-9_]{1,64}$` (un nombre de variable raro no se imprime: se cuenta).
5. `FRANCA_HTTP_ALLOWED_DESTINATIONS` ausente o `""` → ninguno. Si no, cada entrada es `a.b.c.d:puerto` (cuatro decimales de 0 a 255 sin ceros a la izquierda) o `[ipv6]:puerto` (`net.isIPv6`, sin zona), con puerto de 1 a 65535 sin ceros a la izquierda; se guarda canónica (una mapeada como su IPv4).

`createSecretStore(secrets).lookup(name, origin)` → `{ kind: 'found', value }` | `{ kind: 'not_configured' }` | `{ kind: 'origin_not_allowed' }`, con `origin = new URL(request.url).origin` comparado como texto exacto. El almacén es un objeto por host: el arnés crea uno por tenant; la API, uno para la instalación.

Línea de arranque (una, `Logger('HttpHost').log`), p. ej.: `salida http: secretos CRM_TOKEN (https://crm.example.com, https://crm.example.com:8443); variables ignoradas: FRANCA_SECRET_SOPORTE_TOKEN; destinos permitidos: 127.0.0.1:8080, [::1]:8443`, con `ninguno`/`ninguna` en los vacíos. Los orígenes y los pares no son secretos; los valores nunca salen.

Descartado: un fichero JSON de secretos (acabaría commiteado en un repo público y las guardas solo protegen ficheros de entorno), `FRANCA_SECRET_X_ORIGIN` (ambiguo con un secreto llamado `X_ORIGIN`), exportar `validateUrlText` del motor (abre la superficie pública del motor en un PR de seguridad) y copiar la regla del dominio (dos fuentes de verdad).

### D12. Tiempo: el intento y el plazo del avance

- `forAdvance({ conversationId, deadlineMs, now })`: `deadlineMs` lo calcula conversaciones (`startedAtMs + LLM_WINDOW_MS`) y `now` es su `CLOCK`. La salida http no sabe cuánto dura un avance: el consumidor decide.
- Cada intento, tras los secretos: `budget = attemptBudget(timeoutMs, deadlineMs - now())` = `min(timeoutMs, restante)`. Si `budget <= 0` → `timeout` sin resolver ni conectar. Si no, un `AbortController` con un temporizador **real** de `budget` ms que corta resolución, conexión, TLS, envío y lectura: tope total, no de inactividad. El temporizador arranca con el primer paso.
- Con el reloj manual de los e2e, «hace avanzar el reloj 89,5 s» deja 500 ms reales de intento; con 91 s, ninguno.
- Sin espera entre intentos (spec).

### D13. Respuesta: status, tamaño y descompresión

- Status fuera de 200-599 → `network_error` con `requestSent: true`.
- `Content-Encoding` (sin espacios, sin distinguir mayúsculas) exactamente `gzip`/`x-gzip`, `deflate` o `br` → `createGunzip`/`createInflate`/`createBrotliDecompress` en streaming; se cuentan los bytes **de salida** y en cuanto superan 1 048 576 se destruyen el descompresor y el socket y el intento es `response_too_large`. `identity` o ausente → se cuentan los de red. Otra codificación o una lista (`gzip, br`) → se entregan los bytes recibidos, con el límite sobre ellos.
- Sin tope aparte de bytes de red en las codificaciones que se descomprimen: la memoria la acota el streaming y la CPU el tiempo del intento; un tope de red rechazaría respuestas que la spec obliga a entregar.
- Cuerpo vacío → `''` sin pasar por el descompresor (204, 304 o `Content-Length: 0` con `Content-Encoding`). Descompresión que falla o corte a mitad de cuerpo → `network_error` con `requestSent: true`. Con `identity` y un `Content-Length` mayor que el límite, `response_too_large` sin leer.
- Texto: `new TextDecoder('utf-8')` (sustituye secuencias inválidas y quita un BOM inicial, como `fetch().text()`). 1 MiB de bytes nunca supera 1 MiB de unidades UTF-16, el límite del motor.
- `MAX_RESPONSE_BYTES = 1_048_576` propio, con un test de paridad contra `MAX_RESPONSE_BODY_LENGTH` de `@franca/engine` (unidades distintas, mismo número).

### D14. Cabeceras en el cable

En este orden: `Host` (`url.host`: con puerto solo si no es el de por defecto), las del nodo en su orden y con su nombre (los secretos se resuelven aquí, después de toda la política: el valor solo existe en la petición que sale), `Accept-Encoding: gzip, deflate, br` y `User-Agent: Franca` si el nodo no las define (sin distinguir mayúsculas), `Content-Length` con los bytes UTF-8 del body (o `0` en `POST`/`PUT`/`PATCH` sin body) y `Connection: close`. Nada de cookies (no hay tarro: cada intento es independiente), credenciales ni cabeceras del entorno. La ruta es `pathname + search`.

### D15. Un intento y su resultado

```ts
export interface AdvanceContext { readonly conversationId: string; readonly deadlineMs: number; now(): number }
export interface HttpHost { forAdvance(context: AdvanceContext): HttpCapability }
export interface HttpHostDeps { secrets: SecretStore; allowed: { has(key: string): boolean }; network: HttpNetwork; notices: HttpNotices }
export function createHttpHost(deps: HttpHostDeps): HttpHost;
```

Orden de un intento (spec «Orden de un intento»): URL (`new URL`; inválida o sin `http:`/`https:` → `network_error` `requestSent: false`, defensa inalcanzable desde el motor) → secretos (`missing_secret` + aviso) → plazo (`timeout`) → resolución (`network_error` `false` o `timeout`) → política (`blocked` + aviso) → conexión y TLS por direcciones (`network_error` `false`) → envío y lectura (`response`, `response_too_large`, `timeout`, `network_error` `true`).

La promesa nunca se rechaza: un `try/catch` sin variable envuelve el intento entero y una excepción inesperada da `network_error` con `requestSent: true` (spec). Cada socket, petición y descompresor lleva su `on('error')` antes de usarse, y el temporizador se limpia en todos los caminos: ningún error queda sin atender después de resolver. Un aborto por plazo gana a cualquier error que provoque el propio aborto (`timeout`, no `network_error`). Cada resultado es un objeto nuevo con solo los campos del contrato.

### D16. Registros y avisos

`HttpNotices` (producción: `Logger('HttpHost').warn`) con dos plantillas fijas, sin URL, origen, nombre de host, direcciones, cabeceras ni cuerpos:
- `conversación <id>: missing_secret en el nodo <nodeId>, secreto <NOMBRE> (not_configured|origin_not_allowed)`
- `conversación <id>: blocked en el nodo <nodeId> (internal_destination|insecure_transport)`

Se escriben al resolver el intento (no después de aplicar el avance): `blocked` no se reintenta y `missing_secret` termina la conversación, así que hay uno por visita al nodo. Nada más de una llamada se registra, tenga o no `containsPii` (mutantes `logUrl`, `logOrigin`). La línea de arranque es la única otra salida (D11).

### D17. Integración con las conversaciones

- `buildEngineHost(llm: LlmCapability, http: HttpCapability): EngineHost` → `{ llm, http }`.
- `ConversationsService` inyecta `@Inject(HTTP_HOST) http: HttpHost`. `newAdvance(id, priorCostUsd)` toma **un** `startedAtMs` del reloj y devuelve `{ advance: createAdvanceLlm({... startedAtMs }), host: buildEngineHost(advance.capability, this.http.forAdvance({ conversationId: id, deadlineMs: startedAtMs + LLM_WINDOW_MS, now })) }`. `create` y `runEngine` usan `host`; `Run.advance` no cambia.
- El evento `http` se guarda y se devuelve tal cual (ya lo hace «Contenido de la transcripción»); `missing_secret` ya es un `SESSION_ERROR_CODES` del motor y `error_code` es `text`: sin migración.

### D18. Red del test, servidores y arnés de conformidad

- **`TestNetwork`** (`test/helpers/test-network.ts`), implementa `HttpNetwork`:
  - Resolutor guionizado: `resolve(name, answers[][])` (rondas sucesivas, la última se repite), `hang(name)` (nunca responde), `resolutions(name)` (cuántas veces se pidió); un nombre desconocido es `failed`.
  - Abridor: registra `{address, port}` en `connections()` y **después** decide: un par registrado → `net.connect` a `127.0.0.1:<puerto real>` de su servidor; cualquier otro → `net.connect` a un puerto local cerrado (rechazo real del sistema). Nunca mapea `127.0.0.1:<puerto real>` de un servidor.
  - `ca`: la autoridad de confianza del test.
- **`test-servers.ts`**: servidores reales en `127.0.0.1:0` (`http`/`https`) con los comportamientos de `ServerBehaviour` del motor más los de los escenarios (secuencia de respuestas, leer y cerrar sin responder, status 600, gzip corrupto, eco de cabeceras); registran conexiones y peticiones recibidas (método, ruta, cabeceras en minúsculas, cuerpo).
- **`test-pki.ts`**: una autoridad confiable y otra no, y certificados de hoja por nombre (EC P-256, SAN `dNSName`, `basicConstraints`, `keyUsage`), firmados en memoria con `node:crypto` y un codificador DER mínimo; caducados a demanda. Ninguna clave ni certificado toca el disco ni el repo. Validado en un prototipo con Node 22.23.3: con la autoridad, `authorized`; sin ella, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; otro nombre, `ERR_TLS_CERT_ALTNAME_INVALID`.
- **Direcciones**: el arnés asigna a cada `serve()`/`refusing()` una dirección virtual de `198.51.100.0/24` (TEST-NET-2: no es global y no está en `CONFORMANCE_INTERNAL_ADDRESSES`, así que solo pasa por la lista de permitidos, como pide el contrato) y un puerto virtual cerrado; los escenarios usan `P` = `1.2.3.4`, `P1` = `1.2.3.5`, `P2` = `1.2.3.6` (globales) y los pares que nombran.
- **Arnés de conformidad** (`conversations-harness.ts`): `http(tenant = 'default')` → `createHttpHost` con la `TestNetwork` compartida, la lista mutable, el almacén del tenant y `HttpNotices` del `Logger` de Nest capturado; `forAdvance({ conversationId: 'conformancia', deadlineMs: now + 90 000, now })`. `serve` levanta servidor y par; `resolve` delega; `blockedPort` es un puerto cerrado fuera de la lista; `connectionsTo` lee la red; `setSecret` escribe en el almacén del tenant; `reset` vacía todo (red, servidores, lista, almacenes, base, salida, reloj). `conversations-conformance.e2e-spec.ts` recorre `HOST_CONFORMANCE_CASES` entero (con `reset` y calentamiento antes de cada caso) y comprueba que el número de casos ejecutados es su longitud.

### D19. Escenarios con el entorno hostil en un proceso hijo

`NODE_USE_ENV_PROXY` se lee al arrancar Node, así que «Proxy del entorno ignorado» y «Verificación de TLS desactivada en el entorno» corren en un proceso que **nace** con esas variables. `test/http-host-environment.e2e-spec.ts` (con esos dos `it`) arranca un servidor que cuenta conexiones (el «proxy») y lanza `vitest run --config vitest.config.e2e.ts test/http-host-hostile-env.e2e-spec.ts` con `FRANCA_E2E_HOSTILE_ENV=1`, `NODE_USE_ENV_PROXY=1`, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` (y en minúsculas) hacia ese servidor, `NODE_TLS_REJECT_UNAUTHORIZED=0` y `NO_PROXY=127.0.0.1,::1,localhost` (solo para que el cliente del test llegue a la API; el destino de la salida es `crm.example.com`, no exento, así que un código que usara el proxy lo usaría). El hijo (con `describe.runIf(FRANCA_E2E_HOSTILE_ENV === '1')`, saltado en la ejecución normal) crea su propia base con el `globalSetup` de siempre, ejecuta los dos escenarios con la red del test y escribe su informe JSON; el padre exige salida 0, los dos tests en verde y **0 conexiones** en el proxy.

### D20. e2e de la API, proceso real y escenarios

- `createConversationsTestApp({ http?: { env?: Record<string, string>; network?: TestNetwork } })`: siempre sustituye `HTTP_NETWORK` (por defecto una red vacía: ningún nombre resuelve y toda conexión se rechaza) y `HTTP_HOST_CONFIG` por `await loadHttpHostConfig(env ?? {})` (el lector real); tras compilar, aborta si la red no es una `TestNetwork`. Así ningún e2e sale a Internet aunque configure secretos.
- Proceso real (`startApi`, `dist/main.js`): «Orígenes de secretos no admitidos», «Valores de secreto no admitidos», «Destinos permitidos no admitidos» y «Salida de arranque de la salida http». Ninguno llega a un nodo `http`.
- El resto de escenarios, en proceso con la red del test y la salida capturada, repartidos por tema (tabla de tasks 3.x).

### D21. Mutantes: entradas declarativas ejecutadas por el script del motor

Los mutantes son entradas de `apps/api/test/mutations.json` (`id`, `file`, `find`, `replace`, `tests`) con el formato de `packages/engine/tests/mutations.json`, y se ejecutan con el script del motor como hace `@franca/llm-anthropic`: `pnpm --filter @franca/api mutate [--only id,id]` → `apps/api/scripts/mutate.mjs` fija `MUTATE_ROOT`, `MUTATE_MUTATIONS` y `MUTATE_VITEST` (`scripts/vitest-mutate.mjs`, que ejecuta Vitest con `vitest.config.mutate.ts`: unit y e2e juntos, con el `globalSetup` de Postgres) e importa `packages/engine/scripts/mutate.mjs`. El candado `scripts/guard-mutate.mjs` mira también `apps/*/.mutate-backup/`.

Descartado: **mutantes como flags en `src/`** (`createHttpHost({ mutant })`): serían interruptores que desactivan la política anti-SSRF dentro del código de producción; y **mutación a mano** (la propuesta): no es repetible ni deja constancia de qué test mata cada uno.

| Mutante | Cambio | Lo mata |
|---|---|---|
| `followRedirects` | Repite la petición con `Location` en un 3xx | `redireccion` |
| `reResolveOnConnect` | Vuelve a resolver antes de cada dirección | `cambio-de-resolucion`, «Dos intentos, dos conexiones» (4 resoluciones) |
| `allowAnyAddressOnResolution` | Solo comprueba la primera dirección | `resolucion-mezclada`, «Resolución con una dirección interna» |
| `allowAddressAnyPort` | Clave de permitidos sin puerto | «Destino local permitido» |
| `noSizeCap` | Sin límite de bytes | `cuerpo-sin-fin` |
| `unboundedDecompression` | Cuenta antes de descomprimir | `bomba-descompresion`, `cuerpo-comprimido-sin-fin` |
| `networkBytesCapOnly` | Límite solo sobre los bytes de red | `bomba-descompresion` |
| `firstAnswerOnly` | Solo la primera dirección de la resolución | «Primera dirección que rechaza la conexión» |
| `idleTimeoutOnly` | `socket.setTimeout` en vez de tope total | `servidor-muy-lento` |
| `ignoreTimeout` | Sin temporizador | `servidor-no-responde`, «Resolución que no termina» |
| `secretsAnyOrigin` | No compara el origen | `secreto-origen-no-autorizado`, «Secreto autorizado para otro origen» |
| `secretsAnyTenant` | Almacén a nivel de módulo compartido por todos los hosts | `secreto-otro-tenant` |
| `logUrl` | Registra la URL en cada intento | `registros-pii`, «Llamada http fuera del registro» |
| `rejectOnRefused` | Propaga el error de conexión | `conexion-rechazada` |
| `keepCookies` | Guarda `Set-Cookie` por origen y lo reenvía | `cookies`, «Cabeceras que recibe el servidor» |
| `acceptBadTls` | `rejectUnauthorized: false` | `tls-invalido`, «Certificado de otro nombre» |
| `plainHttpToPublic` | Quita la regla de `insecure_transport` | «http sin TLS hacia una dirección pública» |
| `filterMixedResolution` | Filtra las internas en vez de bloquear | «Resolución con una dirección interna» |
| `noAddressFallback` | No pasa a la siguiente dirección | «Primera dirección que rechaza la conexión» |
| `mappedAsText` | Clave de permitidos con el texto resuelto | «Dirección permitida escrita de otra forma» |
| `nat64Global` | `64:ff9b::/96` siempre global | «Rangos IPv6 que no son globales», `destinos-internos` |
| `resolveBeforeSecrets` | Resuelve antes de mirar los secretos | «Secreto ausente sin resolver el nombre» |
| `windowBeforeSecrets` | Plazo antes que secretos | «Secreto ausente fuera de plazo» |
| `reuseConnections` | Reutiliza el socket del intento anterior al mismo par | «Dos intentos, dos conexiones» |
| `useEnvProxy` | Petición con `http.globalAgent`/`https.globalAgent` | «Proxy del entorno ignorado», guarda estática |
| `honorTlsRejectEnv` | Sin `rejectUnauthorized` explícito | «Verificación de TLS desactivada en el entorno» |
| `tlsAgainstAddress` | `servername` y verificación contra la dirección | «Petición que recibe el CRM» |
| `noIdentityCheck` | `checkServerIdentity` que no comprueba | «Certificado de otro nombre» |
| `noAdvanceWindow` | Sin plazo del avance | «Llamada http fuera de plazo» |
| `windowNotCapping` | El plazo solo se mira al empezar | «Intento http recortado por el plazo» |
| `logOrigin` | Registra el origen | «Llamada http fuera del registro» |
| `envHeaders` | Añade una cabecera tomada del entorno | «Cabeceras que recibe el servidor» |
| `statusPassthrough` | Entrega el status tal cual | «Status fuera de rango» |
| `noZeroContentLength` | Sin `Content-Length: 0` | «Cabeceras que recibe el servidor» |
| `insecureFirst` | `insecure_transport` antes que `internal_destination` | unit de `destination-policy` |

Un mutante que sobreviva añade el test que falta (y su fila).

### D22. Motor: 7 direcciones y su test

`CONFORMANCE_INTERNAL_ADDRESSES` añade, tras `::ffff:10.0.0.5` y antes de las tres escritas de otra forma, `::ffff:169.254.169.254`, `64:ff9b::a9fe:a9fe`, `64:ff9b::7f00:1`, `::127.0.0.1`, `64:ff9b:1::a9fe:a9fe`, `2002:7f00:1::1` y `2001::1` (32). `conformance.test.ts` toma la línea `GIVEN` del bloque efectivo de «Host de producción: destinos de red» (`effectiveSpec('flow-engine').blocks`) y cuenta 32. El número de casos (21) no cambia; ni tipos, ni contrato, ni `src/` fuera de `cases.ts`.

### D23. `effectiveSpec` aprende `RENAMED` y `REMOVED`

En `packages/engine/tests/helpers/spec-text.ts` (y una copia idéntica en `apps/api/test/helpers/spec-text.ts`):
- El parser lee por secciones (`## Requirements`, `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`).
- Por delta, en el orden de OpenSpec: `RENAMED` (pares `- FROM:`/`- TO:` con `` `### Requirement: …` ``, conservando la posición), `REMOVED`, `MODIFIED` (sustituye escenarios y texto) y `ADDED`.
- Devuelve, además de `requirements` y `text`, `blocks: Map<título, texto del requisito>`.
- Tests nuevos en `packages/engine/tests/unit/spec-text.test.ts` (renombrado que conserva la posición, renombrado y modificado en el mismo delta, eliminado, sección `REMOVED` que no crea requisitos). `apps/api/test/spec-text-parity.spec.ts` exige que la copia de la API sea byte a byte la del motor. La de `packages/llm-anthropic` no cambia (FOLLOW-UP).

### D24. Meta

- `turbo.json` (`@franca/api#dev`): `passThroughEnv` suma `FRANCA_SECRET_*`, `FRANCA_HTTP_SECRET_ORIGINS` y `FRANCA_HTTP_ALLOWED_DESTINATIONS` ([[gotcha-turbo-filtra-variables-de-entorno]]); `test:e2e` no cambia (los e2e configuran la salida en código).
- `CLAUDE.md`: los tres nombres en «Variables de entorno».
- Wiki, cada ficha con `enforcement`:
  - `decision-http-deshabilitado-en-conversaciones` se retira y su línea del índice se sustituye por `decision-salida-http-politica` (secretos por variables y origen exacto, resolución mezclada bloqueada, `http://` solo hacia permitidos, nada registrado; por qué cada uno).
  - `harness-red-del-test-http` (macOS sin `127.0.0.2`, pares virtuales, puertos virtuales cerrados, la costura después de las comprobaciones y el canario).
  - `gotcha-node-http-createconnection-y-proxy` (`agent: false` ignora `createConnection`; cabeceras en array y `keep-alive`/`chunked`; `NODE_USE_ENV_PROXY` desvía `globalAgent` y `fetch`; status 600/999; `rejectUnauthorized` explícito gana; medido en 22.23.3).
  - `harness-stop-hook-y-mutate` anota `apps/api`.
- `.claude/rules/backend/architecture.md`: una línea sobre `src/http-host/` y su costura.

## Contrato

No hay rutas nuevas ni cambios de forma en las existentes: los recursos y los eventos de las conversaciones son los de `conversations-api` (el evento `http` es el del motor: `{type, nodeId, attempts, status, error}`). El contrato de esta feature es:

1. **Capacidad del motor** (`HttpCapability`): cada intento resuelve uno de `{kind: "response", status, body}` (200-599, cuerpo UTF-8 de 1 MiB como mucho), `{kind: "timeout"}`, `{kind: "network_error", requestSent}`, `{kind: "blocked"}`, `{kind: "response_too_large"}` o `{kind: "missing_secret"}`, y nunca rechaza. Lo comprueban `readAttemptResult` (vía `call` de la conformidad) y los eventos `toEqual` de los e2e.
2. **Variables de entorno** (D11):

   | Variable | Forma | Ausente / vacía | No válida |
   |---|---|---|---|
   | `FRANCA_HTTP_SECRET_ORIGINS` | `NOMBRE=origen[,NOMBRE=origen…]` | Sin secretos | No arranca; mensaje con el nombre de la variable y la posición |
   | `FRANCA_SECRET_<NOMBRE>` | 1-8192 de `[\x21-\x7E \t]`, sin blancos en los extremos | Si su nombre está en los orígenes, no arranca | No arranca; mensaje con el nombre, nunca el valor |
   | `FRANCA_HTTP_ALLOWED_DESTINATIONS` | `a.b.c.d:p` o `[ipv6]:p`, separados por comas | Ninguno | No arranca; mensaje con el nombre y la posición |

   Ejemplo válido (valores de prueba): `FRANCA_SECRET_CRM_TOKEN="Bearer prueba-crm-1"`, `FRANCA_HTTP_SECRET_ORIGINS="CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com:8443"`, `FRANCA_HTTP_ALLOWED_DESTINATIONS="127.0.0.1:8080,[::1]:8443"`.
3. **Salida de operación**: la línea de arranque y los dos avisos de D16, con estas palabras fijas (`missing_secret`, `not_configured`, `origin_not_allowed`, `blocked`, `internal_destination`, `insecure_transport`), que el operador puede buscar.
4. **Interno** (D3, D15): `HttpNetwork`, `HttpHost.forAdvance(AdvanceContext)`, tokens `HTTP_NETWORK`, `HTTP_HOST_CONFIG`, `HTTP_HOST`.

### Checklist de coherencia

- [x] Cada campo del resultado lo lee el motor (`readAttemptResult`); nada más sale de la salida http.
- [x] Cada error de la salida (`missing_secret`, `blocked`, `timeout`, `network_error`, `response_too_large`) tiene su rama en el motor (falla la sesión, `onError` o reintento), y el chat (feature 7) ya recibe `missing_secret` como `error.code` de una conversación `failed`.
- [x] Nombres idénticos: `secretRef` y `NOMBRE` usan `^[A-Z][A-Z0-9_]{0,63}$`; el límite de 1 MiB tiene test de paridad con el motor; la copia de `spec-text.ts`, test de paridad byte a byte.
- [x] Permisos: la instalación es el único tenant; el arnés aísla tenants con almacenes distintos (`secreto-otro-tenant`).
- [x] Convive sin retocar: los ficheros existentes son los de la tabla de D2, cada uno con su porqué; 4.6 lo comprueba.
- [x] MVP: cada fichero nuevo mapea a un requisito de `http-host`, al delta de `conversations-api`/`flow-engine` o a la frontera de seguridad (costura, guarda estática, mutantes). Sin dependencias, servicios, cachés ni tablas nuevas.

## Plan de verificación por capas

- **Unit (aplica; `pnpm check`, sin Postgres ni red)**: `addresses` y las tablas (una fila por entrada, formas escritas, paridad con las 32 del motor), `destination-policy` (incluida la precedencia), `http-host-config` (cada valor de los escenarios de arranque, más vacíos, repetidos y nombres raros; ningún mensaje contiene el valor), `secret-origin` (sonda con los orígenes del escenario), `secrets`, `request-headers`, `attempt-budget`, `response-body` con streams en memoria (`zlib` real: bomba de 2 MiB, 1 MiB justo, sin fin, codificación desconocida, corrupto, vacío con `Content-Encoding`), `http-host` con una red falsa sin IO (orden, avisos, nunca rechaza, aborto que gana), `systemNetwork()` sin `ca` y sin leer el entorno, guarda estática, paridades, `effectiveSpec` y la conformidad del motor (32). Cada test negativo se valida rompiendo su fixture.
- **Golden/contractual (aplica, ligero)**: los resultados pasan por `readAttemptResult` en la conformidad y los eventos de los escenarios se comparan con `toEqual`. Sin baselines.
- **Conformidad (aplica, crítico; e2e)**: los 21 `HOST_CONFORMANCE_CASES` contra la API y Postgres reales, con servidores locales reales, en Linux (CI) y macOS (local); falla si se ejecutan menos casos que los del catálogo.
- **Integración HTTP (aplica; e2e)**: un `it` por escenario de `http-host` y de los requisitos modificados de `conversations-api`; proceso real para el arranque; proceso hijo para el entorno hostil; canario y orden de la costura.
- **Mutación (aplica)**: los 35 de D21 con `pnpm --filter @franca/api mutate`; ninguno sobrevive.
- **Manual (aplica)**: `curl` contra `node apps/api/dist/main.js` con un servidor local `http` en un par de `FRANCA_HTTP_ALLOWED_DESTINATIONS` (tasks 4.2).
- **E2E opción-al-menos-una-vez (no aplica)**: no hay UI.
- **Smoke de ruta (no aplica)**: no hay rutas nuevas.
- **Paridad front↔back (no aplica)**: nada se espeja en la web.

## Plan de Ejecución

Detalle, ficheros y criterios en `tasks.md`. Resumen: **1. Backend Core** (`popi:backend-developer`): piezas puras de `src/http-host/` con sus unit, cambios del motor y `effectiveSpec`. **2. Backend API/integración** (`popi:backend-developer`): `network.ts`, `transport.ts`, `http-host.ts`, módulo, `main.ts`, conversaciones, meta. **3. Tests backend** (`popi:backend-developer`): red y PKI del test, e2e por escenario, conformidad completa, proceso real e hijo, mutantes. **4. Verificación** (`popi:qa-tester`, modo backend): de cero, mutantes, `curl`, adversarial de costuras y alcance. Sin frontend.

**Recomendación de ejecución**: `apply normal`, por fases y con gate. Es un componente de seguridad con un espacio de comportamiento acotado y ya enumerado (31 escenarios, 21 casos, 35 mutantes); un bucle aislado (`popi:loop`) aportaría poco y la costura de la red pide revisión humana en cada fase. La elección es del usuario.

## Risks / Trade-offs

- **La costura de la red** es la pieza que puede vaciar la suite: si el test sustituyera algo por encima del socket, todo pasaría sin probar nada. Mitigación: D3 (un solo token, guarda estática, canario, orden, puertos virtuales cerrados) y mutantes con la red del test.
- **Tiempos**: los casos de 500 ms y el recorte por plazo dependen de la carga; tolerancia de 250 ms del arnés actual. Si la CI se queda corta, se sube la tolerancia (es del entorno), nunca el tiempo del caso.
- **Resolutor del sistema**: `lookup` no se cancela; muchas resoluciones colgadas ocupan los 4 hilos de libuv (también los de `zlib` y `crypto`) hasta que el sistema responda. Aceptable con una sola instalación local; los límites globales de salida son non-goal.
- **Una dirección que no responde** (SYN descartado) consume el `timeoutMs` entero antes de probar la siguiente (sin Happy Eyeballs).
- **Proceso hijo de D19**: arranca un Vitest con su propio `globalSetup` (otra base) bajo `NODE_USE_ENV_PROXY`; si Prisma o Vitest leyeran el proxy para algo local, el hijo fallaría (no pasaría en falso). Se valida en la fase 3.
- **Tablas de IANA**: cambian (RFC 9602, 9637 y 9780 son de 2024-2025). La fecha queda en el fichero; actualizarlas es un cambio de conducta (spec).
- **La salida a Claude** usa `fetch` y obedece el proxy del entorno: fuera de esta capacidad ([[gotcha-sdk-anthropic-lee-el-entorno]]).
- **Secretos en el entorno**: legibles por cualquier proceso del mismo usuario; válido solo mientras la API escuche en loopback.
- **Un servidor que devuelve el secreto** en un campo que asigna `responseMap` lo deja en el estado: es el contrato con ese servidor.
- **`http://` bloqueado hacia Internet** sorprenderá a quien pruebe un webhook sin TLS: lo verá como `blocked` con `insecure_transport`.

## Migration Plan

Sin migración de datos. Tras el despliegue, una instalación sin las variables nuevas ve `missing_secret` en `enviar-crm` y `crear-ticket` (antes `unsupported_node`) y la línea de arranque «secretos: ninguno». Para volver atrás basta revertir el PR: la base no cambia.

## Open Questions

Ninguna de producto. Para la aprobación humana:
- [ ] D11: validar el origen con una sonda al motor público (`startSession`) en vez de exportar `validateUrlText`.
- [ ] D21: arnés de mutación declarativo para `apps/api` (reutiliza el script del motor y amplía el candado) en vez de mutación a mano.
- [ ] D19: un proceso hijo de Vitest para los dos escenarios de entorno hostil.
