# Design: chat web de prueba (`web-chat`)

**Fecha**: 2026-10-17 · **Rama**: `feat/web-chat` · Motivación y alcance en `proposal.md`. El comportamiento está en `specs/web-chat/spec.md` (41 requisitos y 63 escenarios), que manda sobre este documento. Antes de este diseño se añadió a la spec un requisito: «Sin marcos de otras páginas» (commit `e88c5ed`, `spec(web): …`, ver D24). Está **pendiente de aprobación humana**. Si se rechaza, se revierte ese commit y se quita D24, y nada más del diseño depende de él.

## Context

- **`apps/web` hoy** es el esqueleto de create-next-app: `layout.tsx` con `next/font/google` (Geist) y el título «Create Next App», `page.tsx` de plantilla, `next.config.ts` con `cacheComponents: true` y `partialPrefetching: true`, sin tests, sin dependencias del monorepo, y `dev` como `next dev --port 3000` (escucha en `0.0.0.0`).
- **La frontera de la API** (`apps/api/src/http/local-only.ts`): exige un `Host` local (`localhost`, `127.0.0.1` o `[::1]`, con puerto opcional) y rechaza **cualquier** `Origin`, también `null` o vacío. No tiene CORS ni autenticación, y escucha solo en loopback. Los errores son `{message, error, ...extra}` con `error` de `API_ERROR_CODES` (26 códigos, `apps/api/src/http/api-error.ts`).
- **Conversaciones** (`apps/api/src/conversations/`): `POST /conversations` → 201 `{conversation, events}`. `POST /conversations/:id/inputs` → 200 `{conversation, events}`, con `If-Match` **opcional** y comparación textual de `"<n>"` (`flows/if-match.ts`). El 412 lleva `{message, error: "revision_mismatch", currentRevision}` y `ETag`. El recurso tiene las 15 claves de `ConversationResource`, y `pendingInput` es el último `input` del avance (`null` si no espera o caducó). La transcripción guarda la entrada del usuario tal como llegó y después cada evento tal cual (`advance-write.ts`). El cuerpo de las dos rutas `POST` está limitado a 64 KiB (`http/body-limits.ts`).
- **Flujos** (`apps/api/src/flows/`): `GET /flows?published=true&limit&offset` ordena por `updatedAt` desc e `id` asc. `GET /flows/:flowId/versions/:version` responde `flow_not_found` si el flujo está borrado (`flows.service.ts`, `getVersion` → `findActive`).
- **Motor** (`@franca/engine`): `EngineEvent` = `message` (`content: RenderedContentItem[]`, `typingDelayMs`) | `input` (`inputType`, `attempt`, `reason`, `placeholder?`; `choice` con `multiple` y `choices[{id,label,imageUrl?}]`) | `http` | `llm` | `end` | `error` (`code`, `nodeId` y **`message`**). Exporta `INVALID_ANSWER_REASONS`, `SESSION_ERROR_CODES`, `HTTP_ERROR_REASONS` y `LLM_EXIT_REASONS`. Los eventos reales de `captacion-leads` se midieron con `packages/engine/dist`: la creación da `message` `bienvenida`, `message` `pedir-nombre` y el `input` de texto, cada `message` con `typingDelayMs: 600`, y el reintento de `pedir-email` da solo el `retryMessage` y el `input` con `attempt: 2` y `reason: "invalid_format"`.

### Auditoría de la spec contra el código fusionado

| Lo que decía la spec / se suponía | Lo que dice el código (medido) | Dónde se resuelve |
|---|---|---|
| «Cache-Control: no-store» en las páginas | Next fija `s-maxage=31536000` en un *shell* prerenderizado y `private, no-cache, no-store, max-age=0, must-revalidate` en uno dinámico. `sendRenderResult` (`next/dist/server/send-payload.js`) **no** sobrescribe un `Cache-Control` ya fijado | D7: lo fija `proxy.ts` antes de renderizar. El test comprueba la directiva `no-store` |
| La web «no arranca» con un `FRANCA_API_URL` inválido | `next dev` y `next start` llaman a `server.listen` y cargan `next.config` **dentro** del *callback* de escucha (`next/dist/server/lib/start-server.js`): un error en la configuración llega después de escuchar | D5: `scripts/check-env.mjs` se ejecuta **antes** de `next` en `dev` y `start` |
| «`next dev` escucha en `0.0.0.0`» | Confirmado: `-H/--hostname`, por defecto `0.0.0.0` (`docs/01-app/03-api-reference/06-cli/next.md`) | D6 |
| El `fetch` del servidor obedece `NODE_USE_ENV_PROXY` | En Node 22.23 desvía `fetch` **y** `http.globalAgent`. `agent: false` ignora `createConnection` ([[gotcha-node-http-createconnection-y-proxy]]) | D4: `node:http` con `createConnection` propio, sin agente ni `fetch` |
| Un `GET` de un *route handler* se lee en cada petición | Con Cache Components, un `GET` que no toca datos de la petición se **prerenderiza** en el *build* (`docs/01-app/01-getting-started/15-route-handlers.md`, «With Cache Components»). Un `node:http` propio no es un «network request» que Next detecte | D7: `await connection()` al empezar cada manejador, con guarda estática |
| `params` de `/conversaciones/[conversationId]` | Sin `generateStaticParams` son datos de la petición y deben ir dentro de `<Suspense>` (`docs/.../dynamic-routes.md`, «With Cache Components») | D1 |
| Al volver a `/` se lee la API | Con Cache Components, Next **oculta** las rutas visitadas con `<Activity>` y conserva su estado y su DOM (hasta 3 rutas, `docs/01-app/02-guides/preserving-ui-state.md`). Los efectos se limpian al ocultar y se recrean al mostrar | D7 y D10: cada pantalla vuelve a leer al mostrarse y reinicia su estado al ocultarse |
| Las respuestas del navegador «tal cual» en los siete tipos de texto | `<input type="email">` y `type="url"` aplican el *value sanitization algorithm* de HTML (quitan los saltos de línea y los blancos de los extremos), y `type="number"` o `type="date"` impiden escribir `muchos` o `16/10/2026` | D15: `type="text"` con `inputMode` |
| `embed`, imágenes y opciones con `imageUrl` | `next/image` con URLs remotas haría que el **servidor de la web** pidiera la URL (`/_next/image` con `remotePatterns`), un SSRF desde la frontera | D13: `<img>` nativo y sin `next/image` |
| Sin `Referer` hacia terceros | `<video>` y `<audio>` no tienen atributo `referrerpolicy`. Solo `<img>` e `<iframe>` lo tienen | D13: política del documento (cabecera y `<meta>`) más el atributo donde existe |
| Server Actions como frontera | Comparan `Origin` con `Host` (o `X-Forwarded-Host`) y dejan pasar una petición sin `Origin` (`docs/01-app/02-guides/data-security.md`) | D2: no hay ninguna (guarda estática), y `proxy.ts` exige `Origin` en todo método que no sea `GET` ni `HEAD` |
| El cuerpo llega entero a la ruta | Con `proxy.ts`, Next guarda en memoria el cuerpo de la petición hasta 10 MB y **trunca** el resto en silencio (`proxyClientMaxBodySize.md`) | D8: la web lee como mucho 1 MiB y responde 413 por encima, así que nunca reenvía un cuerpo truncado |
| La web no llama a Internet | `layout.tsx` usa `next/font/google`, que descarga las fuentes en cada `next build` | D25: fuente del sistema |
| `If-Match` en cada respuesta | En la API es opcional: sin él aplica la entrada sin comprobar | D8: la web lo **exige** al navegador (428 `precondition_required` si falta) |
| Errores al empezar | `create` también puede dar `version_not_found` o `conversation_not_found` (el contacto se borró durante la creación) | Mensaje genérico, como pide la spec («uno genérico para cualquier otro código») |
| Una web ajena no puede usar el chat | Con `Host` y `Origin`, un `iframe` de otra web con el chat dentro manda peticiones con el `Origin` propio (clickjacking) | Delta `e88c5ed` y D24 |

No queda ninguna contradicción de producto. El único hueco de conducta va en el delta de arriba.

## Goals / Non-Goals

**Goals**
- Los 63 escenarios de `web-chat` con un test con su título exacto (D22), sin tocar `apps/api` ni `packages/*`.
- Una frontera local que se pueda auditar en cuatro ficheros: `src/proxy.ts`, `src/server/frontier.ts`, `src/server/api/operations.ts` y `src/server/api/transport.ts`. Cada defensa con un test en `pnpm check` que mata su mutante (D23).
- Que la web conviva con lo existente: fuera de `apps/web` solo cambian `turbo.json`, el *script* `test:e2e` de la raíz, el *lockfile*, la CI, `CLAUDE.md`, las reglas y la wiki (tabla de ficheros y criterio del *diff*).

**Non-Goals** (los de la propuesta, más):
- Una CSP completa con *nonces* (solo `frame-ancestors`).
- Otros navegadores además de Chromium en los E2E.
- Tests de componentes con DOM simulado (jsdom).
- `next dev` en los E2E (corren contra `next build` + `next start`, salvo el escenario de escucha).
- Internacionalización de la interfaz.

## Decisions

### D1. Arquitectura: páginas sin datos, pantallas cliente y rutas propias del servidor de la web

Las dos páginas son Server Components que **no leen datos**. Pintan una pantalla cliente que pide todo a las rutas del servidor de la web (`/api/*`, D3), y esas rutas llaman a la API.

- `src/app/page.tsx` pinta `<HomeScreen/>` (cliente).
- `src/app/conversaciones/[conversationId]/page.tsx` mete en `<Suspense fallback={<ConversationLoading/>}>` un Server Component que hace `await params`. Si el id no es un UUID en minúsculas (`isConversationId`, D3), pinta `<ConversationNotFound/>` sin llamar a nada. Si lo es, pinta `<ConversationScreen key={id} conversationId={id}/>` (cliente).

¿Por qué? La conversación es estado vivo del cliente (ritmo, envío, releer) y las listas tienen «Ver más», «Reintentar» y volver a leer al mostrarse. Con todo en el cliente hay **un solo camino de lectura**, el mismo que usan releer tras un 412 y «Volver a cargar». Además, ninguna respuesta HTML ni ninguna carga RSC lleva datos de la instalación, así que ni el prerender de Cache Components ni la caché del router del cliente ni `<Activity>` pueden servir datos viejos.

Descartado:
- **Leer en Server Components** (RSC hacia la API): duplica el camino de lectura (servidor al cargar, cliente al releer), mete conversaciones en la carga RSC que `<Activity>` y el router conservan, y exige *error boundaries* y `router.refresh()` para «Reintentar».
- **Server Actions** como llamadas: la spec las excluye como frontera (comparan con `Host`, ver auditoría), y su `POST` a la ruta de la página complica la regla de `Origin`.
- **`rewrites` de `next.config` hacia la API**: es un proxy genérico que reenvía las cabeceras del navegador, `Origin` incluido. Viola «Operaciones del chat en la API» y «Peticiones de la web a la API».
- **Servidor propio (`server.js`)**: más superficie y se pierde `next start`.

### D2. Frontera en `src/proxy.ts`

`src/proxy.ts` (la convención de Next 16, que antes se llamaba *middleware*, en `src/` junto a `app/`) exporta `proxy(request)`, **sin `matcher`**, así que corre en toda petición, también la de un estático. Delega en `checkFrontier` de `src/server/frontier.ts`, una función pura sin imports de Next:

1. **Host** (todas las peticiones): `isLocalHost(request.headers.get('host'))` con la regla de la API: nombre exacto `localhost`, `127.0.0.1` o `[::1]`, sin distinguir mayúsculas, con puerto opcional `:[0-9]{1,5}`. Si no, `403` sin cuerpo.
2. **Origin** (todo método que no sea `GET` ni `HEAD`): `origin === 'http://' + host.toLowerCase()`. Si falta, es `null`, es otro esquema o es otro host o puerto, `403` sin cuerpo. Se compara con el `Host` **ya validado como local**: en un DNS rebinding el `Host` es el del atacante y ya falló en el paso 1. Esta es la diferencia con la comprobación de Server Actions.
3. **Ruta de conversación**: si `pathname` empieza por `/api/conversations/`, su segundo segmento (decodificado con `decodeURIComponent`, y un error de decodificación cuenta como inválido) debe ser un UUID en minúsculas. Si no, `404 {"error":"conversation_not_found"}`. Es una defensa por si Next resuelve una ruta con `%2F` de otra manera. La ruta (D3) vuelve a validar.
4. **Cabeceras de respuesta** (también en los 403 y 404 de la frontera): `Cache-Control: no-store` (salvo en `/_next/static/`, cuyos ficheros llevan *hash* y no tienen datos), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'` y `X-Frame-Options: DENY` (D24). Nunca `Access-Control-Allow-*`.

No hay ninguna Server Action: una guarda estática prohíbe `'use server'` en `src/`. Así nada acepta mutaciones fuera de las rutas de D3, y aunque apareciera una, el paso 2 la cubre, porque Next la recibe como un `POST`.

Descartado:
- **Comprobar solo en cada ruta**: deja sin `Host` las páginas y los estáticos («Toda petición»), y cada ruta nueva podría olvidarlo.
- **`headers()` de `next.config`**: no puede responder 403.
- **Lista de orígenes permitidos configurable**: la web solo es su propio origen.

### D3. Ocho operaciones fijas y las rutas de la web

`src/server/api/operations.ts` es la **única** puerta hacia la API. Exporta exactamente ocho funciones (`listPublishedFlows`, `getFlowVersion`, `listConversations`, `getConversation`, `getTranscriptPage`, `createConversation`, `sendConversationInput` y `deleteConversation`). Cada una arma su ruta con argumentos ya validados en `src/server/ids.ts`:
- `conversationId`: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, la regla de `conversation-params.ts`.
- `flowId`: `new RegExp(schema.$defs.id.pattern)` de `@franca/spec`, sin copiarla, como hace `flow-params.ts`.
- `version`: entero `^[1-9][0-9]{0,9}$` ≤ 2147483647.
- `offset`: `^[0-9]{1,10}$` ≤ 2147483647.

El navegador habla con seis ficheros de ruta de la web (`src/app/api/**/route.ts`) que exponen las ocho operaciones (la de conversaciones agrupa `GET` y `POST`, y la de una conversación, `GET` y `DELETE`), más `src/app/api/[...rest]/route.ts`. Esta última responde `404 {"error":"not_found"}` a cualquier otra ruta o método **sin llamar a la API**. Cada manejador es una línea: `await connection()` y la función de `src/server/bff/handlers.ts`, que no importa Next y se prueba sin servidor (D19). Las URLs del navegador salen de `WEB_ENDPOINTS` y las de la API de `API_OPERATIONS`, las dos en `src/config/endpoints.ts`, la única fuente de URLs (`.claude/rules/frontend/architecture.md`).

Las rutas de la web reflejan las de la API bajo `/api/` para que el contrato se lea de un vistazo. El navegador **no** elige `limit` ni `published`: los fija el servidor (20 en los listados, 100 en la transcripción, `published=true`) y solo admite `offset`.

Descartado:
- **Una sola ruta comodín con un despachador**: funciona, pero las rutas de fichero dan `RouteContext` tipado, `405` automático para los métodos no exportados, y cada operación queda en un fichero que se puede auditar.

### D4. Transporte hacia la API: `node:http` sobre un socket propio a loopback

`src/server/api/transport.ts` (el único fichero que importa `node:http` y `node:net`) envía **una** petición:

- `http.request({method, path, headers, createConnection})` **sin `agent`**. `createConnection` abre `net.connect` con la dirección de `FRANCA_API_URL`. Si el nombre es `localhost`, usa `autoSelectFamily: true` y una `lookup` propia que devuelve `127.0.0.1` y `::1` sin preguntar al DNS ni a `/etc/hosts`. Sin agente, `globalAgent` y `NODE_USE_ENV_PROXY` no intervienen, ni las variables `HTTP(S)_PROXY`.
- Cabeceras construidas desde cero: `Host` (el *host* de `FRANCA_API_URL` con su puerto, p. ej. `127.0.0.1:3001`), `Connection: close`, `Content-Type: application/json` y `Content-Length` exacto si hay cuerpo, e `If-Match` solo en `sendConversationInput`. Nada del navegador: ni `Origin`, ni `Cookie`, ni `Authorization`, ni `Referer`, ni `User-Agent`.
- Plazo total de la petición (de abrir el socket al final del cuerpo): **180 000 ms** en las dos operaciones de avance y **15 000 ms** en el resto (`src/config/limits.ts`), los mínimos de la spec. Pasado el plazo, `destroy()`.
- Resultado: `{kind: 'response', status, body}` o `{kind: 'unreachable'}`. Cuentan como `unreachable` un error de conexión, un `close` antes de `response` (incluido un `101`, [[gotcha-node-http-createconnection-y-proxy]]) o un cierre a medio cuerpo, que es la «respuesta perdida». Status fuera de 100-599, cuerpo de más de 32 MiB o un 2xx que no es JSON UTF-8 son `{kind: 'invalid'}`.
- No se propaga el aborto del navegador: si la pestaña se cierra durante un avance, la petición a la API termina igual. Cortarla a medias es justo el caso que obliga a releer.

Descartado:
- **`fetch`**: obedece `NODE_USE_ENV_PROXY`, y Next lo instrumenta (registro de *fetches*, caché de datos).
- **`undici` con `Agent` propio**: una dependencia nueva que hay que alinear con la de Node, y el comportamiento de sus agentes con las variables de proxy cambia entre versiones.
- **Un `http.Agent` propio**: en Node 24 los agentes aceptan `proxyEnv`. Depender del valor por defecto es apostar.
- **Comprobar las variables de proxy al arrancar y negarse a arrancar**: rompería a quien tiene un proxy corporativo para otras cosas.

Enforcement: regla de ESLint `no-restricted-imports` (`node:http`, `node:https`, `node:net`, `http`, `https`, `net` y `undici` solo en `transport.ts`) y `no-restricted-globals` (`fetch` solo en `src/lib/web-client.ts`). Además, la guarda estática, el test hostil en un proceso hijo (D19) y el entorno hostil de los E2E (D20).

### D5. `FRANCA_API_URL`: validación antes de escuchar

`src/server/config/api-url.mjs` (JavaScript con `// @ts-check` y JSDoc, sin imports) exporta `parseApiUrl(raw)` y `DEFAULT_API_URL = 'http://127.0.0.1:3001'`:

- Sin la variable (`undefined`), vale el valor por defecto. Un texto vacío **no** es «sin variable»: no es válido.
- Se rechaza cualquier carácter fuera de ASCII visible **antes** de parsear, porque `new URL` quita tabuladores y saltos de línea en silencio ([[gotcha-url-whatwg-normaliza]]).
- Sobre el `URL` parseado: `protocol === 'http:'`, `hostname` ∈ {`127.0.0.1`, `[::1]`, `localhost`}, `username` y `password` vacíos, `pathname === '/'`, `search` y `hash` vacíos, y un puerto distinto de `0` si lo hay.
- Devuelve `{hostHeader, connect: {family: 4 | 6 | 'loopback', port}}`, o un error cuyo mensaje nombra `FRANCA_API_URL` y **nunca** el valor.

Lo usan dos sitios:
1. `apps/web/scripts/check-env.mjs`, que corre **antes** de `next` en los *scripts* `dev` y `start` (`node scripts/check-env.mjs && next …`) y termina con código 1 y el mensaje. Así la web no llega a escuchar (ver la auditoría: Next escucha antes de cargar `next.config`).
2. `src/server/api/transport.ts`, de forma perezosa y memorizada, como defensa si alguien ejecuta `next start` a mano. Con un valor inválido, cada ruta responde `500 {"error":"internal_error"}` y registra una línea con el nombre de la variable.

El fichero es `.mjs` para que el *script* lo importe con `node` sin cargador de TypeScript. La eliminación de tipos de Node 22 exige 22.18 o la *flag*, y `engines` admite 22.0. TypeScript lo tipa por JSDoc (`allowJs` ya está activo).

Descartado:
- **Validar en `next.config.ts`**: escucha antes (auditoría) y rompería `next build` en la CI sin motivo.
- **`instrumentation.ts`** con `process.exit`: también corre tras escuchar.

### D6. Escucha solo en `127.0.0.1`

Los *scripts* quedan así:
- `"dev": "node scripts/check-env.mjs && next dev --hostname 127.0.0.1"`
- `"start": "node scripts/check-env.mjs && next start --hostname 127.0.0.1"`

El puerto es el de Next por defecto, 3000, y se quita `--port 3000` para que los tests elijan uno libre con `PORT`. Con `pnpm dev`, turbo no pasa `PORT` a la web (modo estricto, solo `passThroughEnv`, [[gotcha-turbo-filtra-variables-de-entorno]]), así que la web siempre está en el 3000 y el `PORT` de la API no le llega. El navegador abre `http://localhost:3000`. Si `localhost` resuelve primero a `::1`, Chrome, Firefox y Safari pasan a `127.0.0.1`.

Enforcement: la guarda estática lee `package.json` (los dos *scripts* llevan `--hostname 127.0.0.1` y empiezan por `node scripts/check-env.mjs &&`), y el E2E «Otra interfaz de la máquina» arranca los dos *scripts* de verdad.

### D7. Sin caché: lecturas frescas explícitas

- Cada manejador de `src/app/api/**/route.ts` empieza con `await connection()` (`next/server`). Con Cache Components, ningún `GET` se prerenderiza en el *build* ni se reutiliza. Lo impone la guarda estática: cada `export async function GET|POST|DELETE` tiene `await connection()` como primera sentencia.
- El cliente pide con `fetch(…, {cache: 'no-store'})`. Las rutas responden con `Cache-Control: no-store` (en `jsonResponse`) y `proxy.ts` lo repite en todas, páginas incluidas. Next no lo sobrescribe (auditoría), y el test acepta cualquier `Cache-Control` que **contenga** la directiva `no-store`. Esta es la lectura que se hace de «llevan `Cache-Control: no-store`».
- `<Activity>`: cada pantalla pide sus datos en un efecto que corre al montarse **y** al volver a mostrarse. Al ocultarse, el *cleanup* (`useLayoutEffect`) pone su estado en `loading`, el patrón de `preserving-ui-state.md`, así que al volver no se ve ni un instante la lista vieja (p. ej. la conversación recién borrada). El campo «Identificador de contacto» sí se conserva al navegar dentro de la web. «Entre visitas» quiere decir cargas de página, y ahí empieza vacío.
- No se usa `use cache`, `cacheLife`, `cacheTag` ni `unstable_cache` (guarda estática).

### D8. Lo que hace el servidor de la web con peticiones y respuestas

**Peticiones del navegador** (`src/server/bff/request.ts`):
- El cuerpo se lee como texto UTF-8 estricto, con un tope de **1 MiB**: si lo supera, `413 payload_too_large`. Es mayor que los 64 KiB de la API, para que la respuesta de 70 000 caracteres llegue a la API y su 413 sea el de la API, y menor que los 10 MB del búfer de `proxy.ts`, así que nunca se reenvía un cuerpo truncado.
- Sin cuerpo, o si no es JSON, `400 invalid_json`.
- `POST /api/conversations`: `{flowId: string, contactId?: string}`. Se reenvía **solo** `{"flowId"}` o `{"flowId","contactId"}`, construido de nuevo, sin validar el patrón del contacto: lo decide la API y su 400 llega al campo. Un `flowId` o un `contactId` que no son texto dan `400 invalid_request`.
- `POST …/inputs`: hace falta la propiedad propia `input`, con cualquier valor, y se reenvía `JSON.stringify({input})`. El texto llega exacto, también con los espacios. `If-Match` debe cumplir `^"[0-9]{1,10}"$`: si falta, `428 precondition_required`, y si está mal formada, `400 invalid_request`. Se reenvía tal cual.
- Consultas: solo `offset`. Si es inválido, `400 invalid_query`. Los parámetros desconocidos se ignoran.

**Respuestas de la API** (`src/server/bff/responses.ts`):
- 2xx: el JSON de la API sin tocar, salvo dos cosas:
  - Se quita la clave `message` de todo evento `type: "error"` de `events[]` y de `items[].event`. El navegador nunca recibe el `message` de un `error`, así que tampoco lo ve en el inspector ni en la carga RSC.
  - `getFlowVersion` se reduce a `{flowId, version, name}`. La definición del flujo pesa y no se usa.
- 4xx/5xx: el cuerpo se reduce a `{error}` y, en un 412, `currentRevision` si es un entero. Se pasa **cualquier** `error` que cumpla `^[a-z][a-z0-9_]{0,63}$`, también uno desconocido, para que el chat lo trate como genérico («Código desconocido»). Sin un `error` así, `502 {"error":"invalid_api_response"}`. El `message` de la API no sale nunca del servidor.
- `unreachable` da `502 {"error":"api_unreachable"}` e `invalid` da `502 {"error":"invalid_api_response"}`.
- El estado HTTP de la API se conserva: 404, 409, 412, 413, 503…

### D9. Códigos de error: lista espejada, códigos propios y textos por contexto

- `src/config/api-error-codes.ts` exporta `API_ERROR_CODES` (las 26 de la API, mismo orden) y `type ApiErrorCode`.
- `src/config/web-error-codes.ts` exporta `WEB_ERROR_CODES = ['api_unreachable', 'invalid_api_response']`. Son disjuntos de los de la API (test).
- El cliente del navegador añade `network_error` para un `fetch` que falla, se aborta o recibe algo que no es JSON. `readErrorCode(body)` devuelve un código conocido o `'unknown'`.
- **Paridad** (`tests/api-error-codes-parity.test.ts`): lee **el texto** de `apps/api/src/http/api-error.ts`, extrae los literales entre `export const API_ERROR_CODES = [` y `] as const;`, exige al menos 20 y sin repetidos, y compara el conjunto con el de la web. No se importa el módulo: tiraría de `@nestjs/common` desde la web y «una app no depende de otra». Si cambia el formato del fichero, la extracción encuentra cero y el test falla en voz alta, nunca en verde. El escenario «Paridad de códigos» se valida con el mutante `addCodeToMirror` (D23).
- Los textos en español viven en `src/lib/chat/copy.ts`, en mapas por contexto: listas, empezar, abrir y enviar. Cada uno con su genérico. Ver la tabla de la sección «Contrato».

### D10. Modelo de la conversación en el cliente: `ConversationSession`

`src/lib/chat/conversation-session.ts` es una clase sin React con `subscribe`/`getSnapshot` (`useSyncExternalStore` en `src/hooks/use-conversation-session.ts`). Recibe como dependencias el cliente del navegador y `sleep(ms, signal)`. La instantánea es inmutable:

```ts
interface ConversationSnapshot {
  phase: 'loading' | 'not_found' | 'load_error' | 'ready';
  loadError: ChatErrorCode | null;
  conversation: ConversationResource | null;   // tipo propio de la web, forma de la API
  header: { title: string; version: number } | null; // name, o flowId si el flujo se borró o no se pudo leer
  timeline: TimelineItem[];                   // mensajes del flujo y del usuario, en orden
  activity: ActivityItem[];                   // http, llm y error (sin message), en orden
  pending: PendingQuestion | null;            // solo tras pintar el último mensaje y si status es waiting
  typing: boolean;
  sending: boolean;
  notice: Notice | null;                      // other_tab | busy | lost_not_sent | send_error | start_error | gone
  draft: UserInput | null;                    // respuesta no enviada que la pregunta siguiente recupera
}
```

- **Reproducción** de un avance en directo: los eventos se recorren en orden. Un `message` pone `typing`, espera `typingDelayMs` (con `sleep`) y se añade. `http`, `llm` y `error` van a `activity`. `end` no pinta nada: el fin lo dice `conversation.status`. Lo desconocido se ignora. La pregunta pendiente aparece al terminar. La espera del mensaje siguiente empieza cuando la vista **confirma** que el anterior está en el DOM (`useLayoutEffect` → `session.acknowledge(key)`), así que dos mensajes en pantalla quedan separados por al menos `typingDelayMs` («al menos 600 ms después»).
- **Envío** (`send(input, label)`): si `sending` ya es `true`, **no hace nada**, y esa es la defensa del doble clic, no el `disabled`. Si no, añade el mensaje del usuario, pone `typing` y `sending` y llama con `If-Match: "<conversation.revision pintada>"`. Con 200, reproduce el avance. Si falla:

| Resultado | Qué hace |
|---|---|
| `network_error`, `api_unreachable` (respuesta perdida) | Quita el mensaje del usuario y **relee** (recurso y transcripción completa). Si `revision` avanzó, pinta lo aplicado. Si no, `notice: lost_not_sent` con «Reintentar», que reenvía el mismo `input` con el mismo `If-Match`. Si la relectura falla, aviso de conexión con «Volver a cargar», **sin** reenviar |
| `revision_mismatch` | Relee, pinta y pone `notice: other_tab` |
| `conversation_busy` | `notice: busy` con «Volver a cargar» (relee). **Ningún temporizador** |
| `conversation_not_active`, `conversation_expired` | Relee y muestra el fin según el estado leído |
| `invalid_input` | Aviso propio y relee |
| `conversation_not_found` | `notice: gone` con un enlace al inicio. Se quita la pregunta |
| `payload_too_large`, `flow_version_invalid`, `database_unavailable`, `unknown` y el resto | Aviso propio o genérico. La respuesta se queda en su campo |

  En todos los casos sin éxito, el mensaje del usuario desaparece y `draft` guarda el `input`. La pregunta que se pinta después lo recupera si es del mismo tipo: el texto en el campo de texto, y en la selección múltiple, los `id` que siguen existiendo. Así «Ana» sigue en su campo aunque el 412 haya traído una pregunta nueva (`attempt` 2).
- **Abrir** (`load()`): lee el recurso y, en paralelo, el nombre de la versión. Después lee la transcripción completa (D12). Con `processing: true`, `notice: busy`. Con `conversation_not_found`, `phase: not_found`.
- **Sin sondeos**: la clase solo programa la espera de la reproducción. Lo comprueba un test con temporizadores falsos: tras un 409, avanzar 10 s no hace ninguna llamada.
- `ConversationResource`, `TranscriptItem` y los demás tipos de respuesta de la API los declara la web en `src/lib/chat/api-types.ts`, con los de eventos importados de `@franca/engine` (`import type`). La forma la fija el contrato de abajo y la comprueba el E2E de forma (D20).

### D11. Traspaso del primer avance sin almacenamiento

«Probar» y «Empezar de nuevo» hacen `POST`. Con el 201, guardan `{conversation, events}` en un `Map` de **memoria de módulo** (`src/lib/chat/first-advance.ts`; solo la última entrada) y navegan con `router.push`. No es `sessionStorage` ni nada que sobreviva a recargar.

`ConversationScreen` la lee al construir su sesión y la borra en el primer efecto. Si **todavía no ha pintado nada**, la sesión (re)empieza la reproducción desde el principio. Es lo que pasa con el montaje doble de `StrictMode` en desarrollo y con un `<Activity>` que se oculta antes del primer mensaje. Si ya pintó algo, relee de la API.

Al recargar no hay traspaso: la página se reconstruye desde la transcripción, sin ritmo, como pide la spec.

### D12. Reconstrucción desde la transcripción

- `src/lib/chat/transcript-view.ts` (puro) lee las páginas de `limit=100` en orden (`offset` 0, 100, …) hasta tener `total`. Si `total` cambia entre páginas, empieza de nuevo (como mucho tres veces; si no, `load_error`).
- Ordena por `seq` y construye:
  - el `timeline`: cada `content` de un `message` y cada entrada `user`;
  - la `activity`.
- Una entrada `user` se pinta así:
  - `{text}`: el texto tal cual.
  - `{choice}`: el `label` de esa opción en el último `input` anterior de la transcripción.
  - `{choices}`: los `label` en el orden de las opciones de ese `input`, separados por «, ».
  - Un `id` que no está en las opciones se pinta como su `id`, y una forma desconocida no se pinta.
- La pregunta pendiente es `conversation.pendingInput`, no el último `input` de la transcripción, porque el recurso manda (`null` si caducó).

### D13. Direcciones admitidas y multimedia

`admitUrl(raw, kind)` en `src/lib/chat/url-filter.ts`:
- `typeof raw === 'string'` y `URL.canParse(raw)` **sin base**, así que una relativa o un `//host/…` no pasan.
- `protocol` ∈ {`https:`, `http:`}, o solo `https:` si `kind === 'embed'`.
- `username === ''` y `password === ''`.
- Devuelve `url.href` o `null`.

La decisión se toma sobre lo parseado y se pinta **el `href`**, nunca el texto original: `java\nscript:` se vuelve `javascript:` y se rechaza por su protocolo.

| Elemento | Se pinta |
|---|---|
| `image` | `<img src={href} alt={alt ?? ''} referrerPolicy="no-referrer" loading="lazy" decoding="async">` |
| `video` | `<video src={href} controls preload="metadata">` con `aria-label={alt}` si hay `alt` |
| `audio` | `<audio src={href} controls preload="none">` con `aria-label={alt}` si hay `alt` |
| `embed` | `<iframe src={href} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" title={alt ?? 'Contenido incrustado'}>`. Sin `allow-same-origin`, `allow-top-navigation*`, `allow-popups` ni `allow-forms`: queda en un origen opaco y no puede navegar el chat |
| No admitida | `<p>Contenido no disponible</p>` y, si hay `alt`, el `alt` como texto. No se carga nada |
| `kind` desconocido | Nada, y sin pedir nada |
| `imageUrl` de una opción | `<img src={href} alt="" referrerPolicy="no-referrer">` (decorativa: el `label` es el nombre). Si no se admite, la opción sin imagen |

Sin `Referer`: `Referrer-Policy: no-referrer` en toda respuesta (D2), `<meta name="referrer" content="no-referrer">` (con `metadata.referrer` en `layout.tsx`) y el atributo donde existe.

Sin `next/image`: con URLs remotas, el servidor de la web pediría la URL (SSRF desde la frontera, ver auditoría). Una regla de ESLint lo prohíbe en `src/components/chat/`. El `<img>` nativo lleva `// eslint-disable-next-line @next/next/no-img-element` con el porqué.

### D14. Texto plano

`MessageText` pinta `text` como un nodo de texto de React dentro de un elemento con `white-space: pre-wrap` (saltos de línea y espacios, como ` Ana `) y `overflow-wrap: anywhere`, el ajuste para 320 px. No hay `dangerouslySetInnerHTML` (ESLint `react/no-danger`), Markdown ni autoenlazado. Los mensajes del usuario usan el mismo componente. Una respuesta vacía se pinta como una burbuja vacía con la marca visual «(vacía)» en `aria-hidden` y el nombre accesible «Respuesta vacía»: es presentación y el texto enviado no cambia.

### D15. Preguntas

`PendingQuestion` elige por `inputType`:

| Pregunta | Control | Envío |
|---|---|---|
| `text` (también el `input` de un `llm`) | `<textarea>` con `placeholder` del evento. Intro envía, Mayúsculas+Intro añade una línea, y no envía durante una composición (`isComposing`) | `{text: value}` |
| `email`, `phone`, `number`, `url`, `date`, `boolean` | `<input type="text">` con `inputMode` `email`, `tel`, `decimal`, `url`, `text` o `text`, `autoComplete="off"` y `spellCheck={false}` (`autoCapitalize="none"` en `email` y `url`). Nunca `type="email"`, `"url"`, `"number"` ni `"date"`: el navegador limpia o bloquea el valor (auditoría) | Intro: `{text: value}` |
| `choice` sin `multiple` | Un `<button>` por opción, en orden, con el `label` (texto plano) y la imagen si se admite | Al pulsar: `{choice: id}` |
| `choice` con `multiple` | Un `<input type="checkbox">` con `<label>` por opción, en orden, y «Enviar» | `{choices}` con las marcadas **en el orden de las opciones**. Se puede enviar sin marcar ninguna |
| Otro `inputType` | «Esta pregunta no se puede responder desde el chat de prueba.» Sin controles | — |

Todo va en un `<form noValidate>`, sin `maxLength`, `required` ni `pattern`, y sin recortar nada. Mientras `sending`, los controles están `disabled`.

Cuando aparece una pregunta (su clave es `nodeId:attempt:revision`), el foco va a su primer control. Si hay `reason`, se muestra encima un aviso enlazado con `aria-describedby`, con el texto de `copy.ts`. El tipo `Record<InvalidAnswerReason, string>` obliga a cubrir los cinco motivos, un test compara sus claves con `INVALID_ANSWER_REASONS` del motor y hay un genérico para el resto.

### D16. Pantallas, estados, accesibilidad y diseño

- `<html lang="es">`.
- `metadata.title`: `{default: 'Chat de prueba · Franca', template: '%s · Franca'}`. La conversación usa `Conversación`.
- La marca es «Franca» y nunca aparece `@franca/` ni `franca-web`.
- No hay `brand-design` en el repo: Tailwind 4 con la paleta neutra que ya trae `globals.css`, el modo oscuro existente, la fuente del sistema (D25) y ningún color nuevo sin motivo.
- La revisión de interfaz se hace con la skill `web-design-guidelines` en la fase de QA (tasks 4.6).
- Inicio: dos secciones, «Flujos publicados» y «Conversaciones recientes», con el campo «Identificador de contacto» encima.
- Conversación: cabecera (título, versión, «Empezar de nuevo», «Borrar conversación», «Volver al inicio»). Debajo, `<div role="log" aria-label="Conversación">` con los mensajes, el indicador `role="status"` («Escribiendo…»), la pregunta pendiente o el aviso de fin, y `<aside aria-labelledby>` «Detalles de la prueba».
- En pantallas anchas, el panel va en una segunda columna (`lg:grid-cols-[minmax(0,1fr)_20rem]`). En estrechas va debajo, en el orden del DOM y alcanzable con el tabulador. Los ids y URLs largos llevan `overflow-wrap: anywhere`.
- «Borrar conversación» abre un `<dialog>` modal nativo («¿Borrar la conversación? El borrado es definitivo y no borra los datos guardados del contacto.», «Borrar» / «Cancelar»). Gestiona el foco y Escape sin código propio.
- Cada botón tiene un nombre accesible propio, p. ej. «Probar Captación de leads», con el texto visible «Probar» y el nombre del flujo en `aria-label`.
- `src/app/not-found.tsx` («Página no encontrada» y un enlace al inicio) y `src/app/error.tsx` (cliente: «Algo ha fallado en el chat de prueba» y «Reintentar») en español.

Estados por pantalla:

| Pantalla / bloque | loading | empty | error | success |
|---|---|---|---|---|
| Flujos publicados | «Cargando flujos…» (`aria-busy`) | «Todavía no hay flujos publicados. Publica uno con la API de Franca y vuelve.» Sin «Probar» | Texto según el código (sin el de la API) y «Reintentar» | Lista con nombre, `id`, «Versión N», «Cambios sin publicar», «Probar» y «Ver más» si quedan |
| Conversaciones recientes | «Cargando conversaciones…» | «Aún no se ha probado ningún flujo.» | Igual que arriba | Enlaces con `flowId`, versión, estado en español, `outcome`, `contactId` y última actividad en hora local. «Ver más» |
| Empezar (botón) | «Iniciando…» en ese botón y el resto de «Probar» desactivados | — | Aviso `role="alert"` según «Errores al empezar». `invalid_request` va al campo (`aria-invalid` y el mensaje enlazado) | Navega |
| Conversación | Esqueleto con «Cargando conversación…» | — (una conversación siempre tiene algo) | «Conversación no encontrada» con un enlace; conexión o base con «Reintentar» | Historia, pregunta o fin y panel |
| Envío | Indicador «Escribiendo…» y controles desactivados | — | Aviso según «Errores al enviar». La respuesta en su campo | Avance reproducido |
| Panel de detalles | El de la conversación | «Sin actividad técnica» en la lista | — | `<dl>` con `id`, flujo y versión, contacto, estado, `outcome`, `error.code` y `error.nodeId`, intento y `reason`, coste («0 USD»), «Tope de coste alcanzado: Sí/No», `revision` y fechas en hora local. Después, «Actividad técnica» en orden |

### D17. Privacidad y registro

- Sin `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` ni `caches`: lo prohíben `no-restricted-globals` y `no-restricted-properties` de ESLint en `src/`. La web no pone cookies.
- `contactId` viaja solo en el cuerpo del `POST`, nunca en una URL. La única URL con datos de una conversación es `/conversaciones/<id>`.
- El servidor de la web no registra nada de una conversación. `src/server/log.ts` es el único sitio con `console` (ESLint `no-console` con esa excepción) y escribe `[web] <MÉTODO> <plantilla de ruta> <estado> <código> [<clase del error>]`. Usa la plantilla (`/api/conversations/[conversationId]/inputs`), nunca la ruta real, el cuerpo o las cabeceras, y solo en 5xx o en la configuración inválida. Es la misma regla que el filtro de errores de la API.

### D18. Dependencias nuevas (versiones exactas)

| Paquete | Dónde | Versión | Por qué |
|---|---|---|---|
| `@franca/spec` | `dependencies` | `workspace:*` | Patrón de `id` (D3), tipos de flujo. No se redefinen |
| `@franca/engine` | `dependencies` | `workspace:*` | Tipos de eventos (`import type`). Las constantes, solo en tests (paridad) y en el servidor si hiciera falta. Ningún componente cliente importa código de ejecución del motor (guarda estática), para que no arrastre `ajv` al *bundle* |
| `vitest` | `devDependencies` | `4.1.12` | El *runner* del monorepo, la misma versión que resuelve el *lockfile* para la API y los paquetes |
| `@playwright/test` | `devDependencies` | `1.64.1` | E2E en un navegador real: foco, teclado, `role=log`, red, *viewport* de 320 px y diálogos. Fija la versión de Chromium |
| `pg` | `devDependencies` | `8.23.1` | Solo para el arnés E2E: crear y borrar la base de cada *worker* y vaciarla entre tests (D20). Es la versión que ya está en el *lockfile* (la usa `@prisma/adapter-pg`) |
| `@types/pg` | `devDependencies` | `8.23.1` | Tipos de lo anterior, también ya en el *lockfile* |

Descartadas:
- **jsdom y Testing Library**: los comportamientos de DOM (foco, teclado, `disabled`, `role`) se prueban mejor en Chromium (E2E), y el marcado, con `react-dom/server` (D19).
- **`undici`**: D4.
- **`server-only`**: Next lo resuelve sin instalarlo, y la frontera la cubre la guarda estática.
- **MSW**: la API simulada es un servidor HTTP real (D20).
- **`@vitejs/plugin-react`**: Vite 8 transforma TSX sin *plugin*.
- **`next/font`**: D25.

### D19. Tests en `pnpm check` (Vitest, sin red, sin API y sin servidor de Next)

- `apps/web/vitest.config.ts`: `resolve.tsconfigPaths: true` (alias `@/`), entorno `node`, `include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts']` y JSX automático. Si Vite no lo lee de `tsconfig.json`, se fija con `oxc.jsx.runtime: 'automatic'`, y lo comprueba el primer test de marcado.
- Lo que cubren:
  - **Unit puros**: `ids`, `frontier`, `api-url`, `url-filter`, `events`, `transcript-view`, `copy`, `paged-list`, `request`, `responses`, `web-client` (con un `fetch` falso inyectado) y `conversation-session` (con un cliente falso, `sleep` controlado y temporizadores falsos).
  - **Marcado**: `renderToStaticMarkup` de `react-dom/server` sobre los componentes de presentación. Sin `<a>` ni `<b>` en un texto, el `src` es el `href`, el `sandbox` exacto del `iframe`, ningún atributo con `javascript:`, el control de cada `inputType` (sin `type="email"`) y ningún `message` en el fin ni en el panel.
  - **Integración**: `handlers.ts` + `operations.ts` + `transport.ts` contra una API simulada en el mismo proceso (`tests/helpers/fake-api.ts`, `node:http` en `127.0.0.1`, puerto 0) con `FRANCA_API_URL` apuntando a ella. Método, ruta, consulta, cabeceras exactas y bytes del cuerpo que recibe; respuestas y estados que devuelve; `unreachable` (puerto cerrado, cierre sin respuesta, cierre a medio cuerpo y plazo, este con un plazo corto **inyectado** en el test); `invalid`; y `localhost` hacia loopback.
- **Proceso hijo hostil** (`tests/api-transport-env-proxy.test.ts`): lanza `vitest run --config vitest.hostile.config.ts tests/hostile/env-proxy.hostile.ts` con `NODE_USE_ENV_PROXY=1` y `HTTP_PROXY`, `HTTPS_PROXY` y `ALL_PROXY` hacia un proxy trampa local. El hijo envía con `transport.ts` a una API simulada, y el padre comprueba que la API la recibió y que la trampa **no** recibió ninguna conexión. Va en un hijo porque Node lee `NODE_USE_ENV_PROXY` al arrancar. El test negativo se valida con el mutante `useGlobalAgent` (D23).
- Los datos de los tests salen del motor real: `startSession`/`continueSession` de `@franca/engine` sobre `preguntas`, `medios`, `captacion-leads` y `pregunta` (fijados en `e2e/fixtures/flows/`). Así ningún evento de prueba tiene una forma inventada.
- **Guarda estática** (`tests/static-guard.test.ts`), lo que ESLint no expresa:
  - `await connection()` como primera sentencia de cada manejador.
  - Ningún `'use server'`.
  - Ningún fichero `'use client'` importa `@/server/`.
  - `transport.ts` solo lo importa `operations.ts`, y `operations.ts` exporta exactamente ocho funciones.
  - Ningún `use cache`, `cacheLife` ni `unstable_cache`.
  - Los *scripts* `dev` y `start` de `package.json` (D6).
  - Ningún cliente importa `@franca/engine` sin `import type`.
- `test` de la web es `vitest run`. Ningún test de este nivel arranca Next, la API ni Postgres, ni sale de loopback.

### D20. E2E con Playwright contra la API real y Postgres

- **Configuración** (`apps/web/playwright.config.ts`):
  - `testDir: 'e2e'` y `testMatch: '**/*.e2e.ts'`.
  - Un solo proyecto `chromium` (Desktop Chrome). Un test que no usa `page` ni `context` no abre el navegador, así que los de HTTP en bruto de `frontier.e2e.ts` conviven con los de navegador.
  - `fullyParallel: false`, `workers: process.env.CI ? 2 : 1`, `retries: 0` (lo inestable se ve), `forbidOnly: !!process.env.CI`, `actionTimeout: 10_000` y `expect.timeout: 10_000`.
  - `trace: 'retain-on-failure'`.
- **Pila por *worker*** (`e2e/support/stack.ts`, fixture de *worker*), de modo que cada *worker* va aislado:
  1. **Base**: crea `franca_web_e2e_<pid>_<worker>` con `pg` sobre `DATABASE_URL` y aplica las migraciones con el Prisma de la API (`apps/api/node_modules/.bin/prisma migrate deploy`, `cwd` `apps/api`, `DATABASE_URL` de esa base). Al terminar, la borra con `DROP DATABASE … WITH (FORCE)`. Los errores nunca muestran la URL (patrón de `apps/api/test/global-setup.ts`).
  2. **API real**: `node apps/api/dist/main.js` con un entorno **mínimo**: `PATH`, `DATABASE_URL`, `HOST=127.0.0.1` y `PORT=0`. Sin `FRANCA_ANTHROPIC_API_KEY` ni `FRANCA_SECRET_*` / `FRANCA_HTTP_*`, así que nada sale a Anthropic ni a un CRM. El puerto se lee de la línea «escuchando en».
  3. **API simulada** (`tests/helpers/fake-api.ts`, la misma de la integración de D19, así que hay una sola implementación), en el proceso del *worker*: servidor `node:http` en `127.0.0.1`. Registra método, ruta, cabeceras y cuerpo, y por defecto **reenvía** a la API real. Un test puede guionizar respuestas (`fakeApi.respond(handler)`), retrasarlas, cerrar sin responder, o parar y volver a escuchar en el mismo puerto («API parada»).
  4. **Web**: `pnpm --filter @franca/web start` (el *script* real, así que D5 y D6 se ejercen) con `PORT` libre, `FRANCA_API_URL` hacia la API simulada, `NEXT_TELEMETRY_DISABLED=1` y un **entorno hostil**: `NODE_USE_ENV_PROXY=1` y `HTTP_PROXY`/`HTTPS_PROXY` hacia una trampa del *worker*. Al cerrar el *worker* se comprueba que la trampa recibió cero conexiones. Si Next no funciona con ese entorno por motivos propios, el entorno hostil se queda solo en el test dedicado de D19 (riesgo R4).
- **Entre tests**: `TRUNCATE` de todas las tablas de `public` salvo `_prisma_migrations` (descubiertas con `pg_tables`, sin acoplarse a sus nombres), `RESTART IDENTITY CASCADE`, y vaciado del registro y del guion de la API simulada.
- **Datos**:
  - `captacion-leads` y `faq-ia` se leen de `packages/spec/examples/`.
  - `pregunta`, `saludo-contacto`, `hola`, `preguntas` y `medios` están en `e2e/fixtures/flows/*.json`. `tests/flow-fixtures.test.ts`, en `pnpm check`, comprueba que cada uno es **igual** al JSON escrito en el texto de su spec y que `validateFlow` lo da por válido sin avisos.
  - Publicar, crear y responder «directamente en la API» se hace con `e2e/support/admin.ts`, contra la API real y sin pasar por la simulada.
- **Forma de la API simulada**: `e2e/support/api-shapes.ts` construye recursos, páginas y avances. `e2e/fake-api-shapes.e2e.ts` compara sus claves y su orden con respuestas reales de la API: el *fixture* copiado de la forma real, según `lecciones-equipo`.
- **Navegador sin Internet** (`e2e/support/browser.ts`): `context.route('**/*')` deja pasar solo el origen de la web. Lo demás (p. ej. `example.com`) se **registra** y se cumple con un recurso local mínimo (PNG de 1×1, audio vacío o HTML vacío), en vez de abortarlo, para que no haya errores de consola.
- **Consola limpia**: una *fixture* recoge `pageerror` y los `console` de tipo `error`, y falla el test si hay alguno. La única excepción son los «Failed to load resource» de respuestas 4xx/5xx de `/api/*` del propio origen que el escenario espera. «Evento desconocido» exige **cero**.
- **Escenarios lentos**: «Avance largo» espera de verdad 150 s (`test.setTimeout(200_000)`, etiqueta `@lento`) y corre en la CI. Con dos *workers*, va en paralelo con el resto. «Ocupada al enviar» usa `page.clock` para avanzar 10 s sin esperarlos.
- **«Otra interfaz de la máquina»**: elige una IPv4 no interna de `os.networkInterfaces()` (`test.skip` anotado si no la hay), arranca `pnpm --filter @franca/web dev` y `start` con un `PORT` libre y comprueba conexión rechazada en esa dirección y respuesta en `127.0.0.1`.

### D21. Turbo, raíz y CI

- `turbo.json`:
  - `@franca/web#dev`: `{dependsOn: ["^build"], cache: false, persistent: true, passThroughEnv: ["FRANCA_API_URL"]}`.
  - `@franca/web#test:e2e`: `{dependsOn: ["^build", "build", "@franca/api#build"], cache: false, passThroughEnv: ["DATABASE_URL", "CI", "PLAYWRIGHT_BROWSERS_PATH"]}`.
  - La tarea `dev` genérica no cambia ([[gotcha-turbo-filtra-variables-de-entorno]]).
- Raíz: `"test:e2e": "turbo run test:e2e --concurrency=1"`. Así los E2E de la API y los de la web no corren a la vez: comparten Postgres y CPU, y la API tiene e2e sensibles al tiempo (`database-stalls`, `http-host-tls-timing`).
- CI (`.github/workflows/ci.yml`):
  - Un paso `pnpm --filter @franca/web exec playwright install --with-deps chromium` tras `pnpm build`. Es reproducible porque `@playwright/test` va fijado en el *lockfile* y cada versión fija su Chromium.
  - `pnpm test:e2e` sigue con `DATABASE_URL`.
  - Un paso `actions/upload-artifact` con `if: failure()` que sube `apps/web/test-results/` y `apps/web/playwright-report/` durante 7 días. Solo llevan datos sintéticos.
  - No se cachean los navegadores todavía (FOLLOW-UP 7.2: medirlo en el *runner*).

### D22. Cobertura de escenarios

- `tests/spec-coverage.test.ts` lee la spec efectiva de `web-chat` (con una copia de `spec-text.ts` en `tests/helpers/`, byte a byte la del motor, comparada por `tests/spec-text-parity.test.ts`). Exige al menos 41 requisitos y 63 escenarios, ningún título repetido, y un `it('<título>'` o `test('<título>'` exacto en `src/**/*.test.{ts,tsx}`, `tests/**/*.test.ts` o `e2e/**/*.e2e.ts`.
- Es el mismo patrón que `apps/api/test/spec-coverage.spec.ts`, en la web y sin tocar la API.
- Corre en `pnpm check`: solo lee texto.

### D23. Mutación

`apps/web/scripts/mutate.mjs` reutiliza `packages/engine/scripts/mutate.mjs` como la API, con `MUTATE_ROOT=apps/web`, `MUTATE_MUTATIONS=tests/mutations.json` y el `vitest` de la web. Antes compila `@franca/spec` y `@franca/engine`. El candado `scripts/guard-mutate.mjs` ya mira `apps/*/.mutate-backup`. Todos los mutantes deben morir con tests de **Vitest**. Los E2E no entran en el bucle: necesitarían un `next build` por mutante.

| Mutante | Fichero | Lo mata |
|---|---|---|
| `allowJavascriptScheme`, `allowDataInImage`, `allowHttpEmbed`, `allowCredentials`, `allowRelative` | `url-filter.ts` | `url-filter.test.ts` |
| `renderRawUrl` (pinta el texto original) | `media-item.tsx` | `media-item.test.tsx` (el `src` es el `href` de `HTTPS://Example.COM/a.png`) |
| `autolinkText`, `renderHtml` | `message-text.tsx` | `message-text.test.tsx` |
| `iframeSameOrigin` (añade `allow-same-origin allow-top-navigation`) | `media-item.tsx` | `media-item.test.tsx` |
| `skipHostCheck`, `hostSuffixMatch` (`endsWith('localhost')`) | `frontier.ts` | `frontier.test.ts` |
| `allowMissingOrigin`, `compareOriginToFixedHost` (con `localhost:3000`) | `frontier.ts` | `frontier.test.ts` |
| `noSecurityHeaders` | `frontier.ts` | `frontier.test.ts` |
| `forwardBrowserHeaders` (copia las cabeceras de la petición) | `handlers.ts` | `handlers.test.ts` (integración) |
| `genericPassthrough` (ruta de la API desde la del navegador) | `operations.ts` | `handlers.test.ts` y la guarda estática |
| `unvalidatedConversationId` | `ids.ts` | `ids.test.ts` y `handlers.test.ts` |
| `keepErrorMessage` | `responses.ts` | `responses.test.ts` |
| `useGlobalAgent` (quita `createConnection`) | `transport.ts` | `api-transport-env-proxy.test.ts` |
| `shortAdvanceTimeout` (15 s en los avances) | `limits.ts` | `transport.test.ts` |
| `noIfMatch`, `autoResendOnLoss`, `allowDoubleSend`, `pollWhileBusy`, `dropDraft` | `conversation-session.ts` / `web-client.ts` | `conversation-session.test.ts`, `web-client.test.ts` |
| `showErrorMessage`, `paintHttpEvent` | `transcript-view.ts` / `end-notice.tsx` | `transcript-view.test.ts`, `end-notice.test.tsx` |
| `trimAnswer`, `typeEmailInput` | `pending-question.tsx` / `conversation-session.ts` | `pending-question.test.tsx`, `conversation-session.test.ts` |
| `skipConnection` | un `route.ts` | `static-guard.test.ts` |
| `listenAllInterfaces` | `package.json` | `static-guard.test.ts` |
| `echoApiUrl` (el mensaje incluye el valor) | `api-url.mjs` | `api-url.test.ts` |
| `addCodeToMirror` | `api-error-codes.ts` | `api-error-codes-parity.test.ts` |

Cada test negativo («no contiene», «no recibe», «no pide») se valida con su mutante, según `testing-pyramid.md`. Se ejecuta a mano (`pnpm --filter @franca/web mutate`) y el resultado queda en el gate de la fase 4.

### D24. Sin marcos de otras páginas (delta `e88c5ed`)

`frame-ancestors 'none'` y `X-Frame-Options: DENY` en toda respuesta, desde `checkFrontier` (D2). Lo cubren `frontier.test.ts` y el E2E «El chat dentro de un marco ajeno»: una página servida por la API simulada en otro puerto con un `iframe` de la web.

No se añade una CSP completa: Next necesita *nonces* para sus *scripts* en línea, y ningún requisito lo pide.

### D25. Fuente del sistema en lugar de `next/font/google`

`layout.tsx` deja de importar Geist. `globals.css` usa la pila del sistema (`ui-sans-serif, system-ui, …`). Así `next build` no descarga nada (la CI ni nadie depende de Google Fonts) y el navegador no pide fuentes a terceros.

Es una decisión presentacional con efecto en la red. Va aquí porque toca la promesa de «sin Internet» de los E2E.

## Contrato: navegador ↔ servidor de la web ↔ API

**Base URLs**: el navegador usa rutas relativas (`WEB_ENDPOINTS`). El servidor de la web usa `FRANCA_API_URL` (por defecto `http://127.0.0.1:3001`). **Auth**: no hay; la frontera es D2. **Comunes a todas las rutas de la web**:
- `Host` local (si no, 403 sin cuerpo).
- En `POST` y `DELETE`, `Origin: http://<Host>` (si no, 403 sin cuerpo).
- Respuestas JSON `application/json; charset=utf-8` con `Cache-Control: no-store` y las cabeceras de D2.
- Errores `{"error": "<código>"}`, nunca `message`.

### Rutas de la web (las llama el navegador)

| Ruta de la web | Operación de la API (método, ruta, consulta) | Plazo | Cuerpo hacia la API |
|---|---|---|---|
| `GET /api/flows?offset=N` | `GET /flows?published=true&limit=20&offset=N` | 15 s | — |
| `GET /api/flows/:flowId/versions/:version` | `GET /flows/:flowId/versions/:version` | 15 s | — |
| `GET /api/conversations?offset=N` | `GET /conversations?limit=20&offset=N` | 15 s | — |
| `POST /api/conversations` | `POST /conversations` | 180 s | `{"flowId"}` o `{"flowId","contactId"}` |
| `GET /api/conversations/:id` | `GET /conversations/:id` | 15 s | — |
| `GET /api/conversations/:id/transcript?offset=N` | `GET /conversations/:id/transcript?limit=100&offset=N` | 15 s | — |
| `POST /api/conversations/:id/inputs` (`If-Match`) | `POST /conversations/:id/inputs` (`If-Match`) | 180 s | `{"input": …}` |
| `DELETE /api/conversations/:id` | `DELETE /conversations/:id` | 15 s | — |
| Cualquier otra `/api/*` | Ninguna | — | — |

`offset` por defecto es 0. Cabeceras hacia la API, siempre las mismas: `Host: <host de FRANCA_API_URL>` y `Connection: close`. Con cuerpo, además `Content-Type: application/json` y `Content-Length`. En las entradas, además `If-Match`. Nada más.

**Respuestas 2xx** (lo que lee el navegador; los demás campos pasan sin tocar):

| Ruta | Estado | Cuerpo | Campos que usa la web |
|---|---|---|---|
| `GET /api/flows` | 200 | `Page<FlowSummary>` de la API | `items[].id`, `name`, `latestVersion`, `unpublishedChanges`, `total`, `offset` |
| `GET /api/flows/:flowId/versions/:version` | 200 | `{flowId, version, name}` | `name` |
| `GET /api/conversations` | 200 | `Page<ConversationSummary>` | `items[].id`, `flowId`, `version`, `status`, `outcome`, `contactId`, `updatedAt`, `total`, `offset` |
| `POST /api/conversations` | 201 | `{conversation, events}` (sin `message` en los `error`) | todo el recurso y los eventos |
| `GET /api/conversations/:id` | 200 | `ConversationResource` | las 15 claves (`processing` para el aviso de ocupada) |
| `GET /api/conversations/:id/transcript` | 200 | `Page<TranscriptItem>` (sin `message` en los `error`) | `items[].seq`, `role`, `input`, `event`, `total` |
| `POST /api/conversations/:id/inputs` | 200 | `{conversation, events}` (sin `message`) | todo |
| `DELETE /api/conversations/:id` | 204 | — | — |

Ejemplo `POST /api/conversations` con `{"flowId":"captacion-leads"}` → 201 (eventos medidos con el motor):

```json
{"conversation":{"id":"4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90","flowId":"captacion-leads","version":1,"contactId":null,"status":"waiting","revision":1,"processing":false,"pendingInput":{"type":"input","nodeId":"pedir-nombre","inputType":"text","attempt":1,"reason":null},"outcome":null,"error":null,"costUsd":0,"costLimitReached":false,"createdAt":"2026-10-17T10:30:00.000Z","updatedAt":"2026-10-17T10:30:00.000Z","expiresAt":"2026-10-18T10:30:00.000Z"},"events":[{"type":"message","nodeId":"bienvenida","content":[{"kind":"text","text":"¡Hola! Te hago tres preguntas y te paso con la persona adecuada."}],"typingDelayMs":600},{"type":"message","nodeId":"pedir-nombre","content":[{"kind":"text","text":"¿Cómo te llamas?"}],"typingDelayMs":600},{"type":"input","nodeId":"pedir-nombre","inputType":"text","attempt":1,"reason":null}]}
```

Ejemplo de un avance que falla en `enviar-crm` (la API da `message` en el `error`; la web lo quita):

```json
{"conversation":{"id":"4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90","flowId":"captacion-leads","version":1,"contactId":null,"status":"failed","revision":4,"processing":false,"pendingInput":null,"outcome":null,"error":{"code":"missing_secret","nodeId":"enviar-crm"},"costUsd":0,"costLimitReached":false,"createdAt":"2026-10-17T10:30:00.000Z","updatedAt":"2026-10-17T10:31:10.000Z","expiresAt":null},"events":[{"type":"error","nodeId":"enviar-crm","code":"missing_secret"}]}
```

Ejemplo de una página de transcripción:

```json
{"items":[{"seq":1,"at":"2026-10-17T10:30:00.000Z","role":"flow","event":{"type":"message","nodeId":"bienvenida","content":[{"kind":"text","text":"¡Hola! Te hago tres preguntas y te paso con la persona adecuada."}],"typingDelayMs":600}},{"seq":4,"at":"2026-10-17T10:30:20.000Z","role":"user","input":{"text":" Ana "}}],"total":9,"limit":100,"offset":0}
```

Ejemplo de la versión: `{"flowId":"captacion-leads","version":1,"name":"Captación de leads"}`.

**Errores** (estado + `error`; los de la API conservan su estado):

| HTTP | `error` | Origen | Cuándo | Qué hace el chat |
|---|---|---|---|---|
| 403 | — (sin cuerpo) | Frontera | `Host` no local; `Origin` ausente u otro en `POST`/`DELETE` | — (no lo provoca la propia web) |
| 404 | `conversation_not_found` | Frontera, ruta o API | id no UUID en minúsculas, o no existe | Abrir: «Conversación no encontrada». Enviar: «Esta conversación ya no existe» con enlace. Borrar: vuelve al inicio |
| 404 | `flow_not_found` / `version_not_found` | Ruta o API | `flowId` o versión inválidos o inexistentes | Cabecera con el `flowId`. Empezar: «Ese flujo ya no existe» y relee la lista |
| 404 | `not_found` | Comodín | Otra ruta de `/api` | Genérico |
| 400 | `invalid_query` | Ruta o API | `offset` inválido | Genérico de lista |
| 400 | `invalid_json` / `invalid_request` | Ruta o API | Cuerpo no JSON o mal formado. `contactId` no admitido (API) | Empezar: el campo «Identificador de contacto» lo indica |
| 428 | `precondition_required` | Ruta | Falta `If-Match` en una entrada | Genérico (la web siempre lo manda) |
| 400 | `invalid_input` | API | La entrada no tiene la forma de la pregunta | «La respuesta no tiene la forma que espera la pregunta.» y relee |
| 412 | `revision_mismatch` (+ `currentRevision`) | API | Otra pestaña avanzó | Relee, pinta, «La conversación ha avanzado en otra pestaña.» y respuesta en su campo |
| 409 | `conversation_busy` | API | Otra entrada en curso | «La conversación está procesando otra respuesta.» con «Volver a cargar» |
| 409 | `conversation_not_active` / `conversation_expired` | API | Terminada o caducada | Relee y muestra el fin |
| 409 | `flow_not_published` | API | Sin versión publicada | «Este flujo no tiene ninguna versión publicada.» |
| 409 | `flow_version_invalid` | API | La versión ya no valida | «La versión publicada ya no es válida: publica una versión nueva.» |
| 413 | `payload_too_large` | Ruta (> 1 MiB) o API (> 64 KiB) | Respuesta enorme | «La respuesta es demasiado larga para enviarla.» |
| 503 | `database_unavailable` | API | Base caída | «La base de datos de Franca no está disponible.» con «Reintentar» |
| 500 | `internal_error` | Ruta o API | Inesperado o `FRANCA_API_URL` inválida en ejecución | Genérico |
| 502 | `api_unreachable` | Servidor de la web | Sin conexión, cierre sin respuesta o plazo | Listas y empezar: «No se puede conectar con la API de Franca.» Enviar: respuesta perdida (D10) |
| 502 | `invalid_api_response` | Servidor de la web | Respuesta que no se puede leer | Genérico |
| — | `network_error` | Navegador | `fetch` fallido, abortado o respuesta no JSON | Como `api_unreachable` |
| cualquiera | otro código | API | Código nuevo | Genérico del contexto, respuesta en su campo |

Ejemplos: `{"error":"revision_mismatch","currentRevision":2}` · `{"error":"conversation_busy"}` · `{"error":"api_unreachable"}`.

**Concurrencia e idempotencia**:
- Cada entrada lleva `If-Match` con la revisión pintada, y la web nunca reenvía por su cuenta.
- «Reintentar» tras una respuesta perdida reenvía con el **mismo** `If-Match`. Si la primera se aplicó, la API responde 412 y la web relee, así que nunca se aplica dos veces.
- Dos «Probar» seguidos: el botón queda desactivado mientras se crea.

## Ficheros

**Nuevos en `apps/web`**:

| Ruta | Qué tiene |
|---|---|
| `src/proxy.ts` | Llama a `checkFrontier` y aplica sus cabeceras (D2) |
| `src/server/frontier.ts` (+ test) | `isLocalHost`, `checkFrontier` y `SECURITY_HEADERS` |
| `src/server/ids.ts` (+ test) | `isConversationId`, `isFlowId`, `parseVersion` y `parseOffset` |
| `src/server/config/api-url.mjs` (+ `api-url.test.ts`) | `parseApiUrl` y `DEFAULT_API_URL` (D5) |
| `src/server/api/transport.ts` (+ test) | Una petición a la API (D4) |
| `src/server/api/operations.ts` (+ test) | Las ocho operaciones (D3) |
| `src/server/bff/request.ts`, `responses.ts`, `handlers.ts` (+ tests) | Lectura y validación, saneado y respuestas, manejadores (D8) |
| `src/server/log.ts` | Registro mínimo (D17) |
| `src/app/api/flows/route.ts`, `src/app/api/flows/[flowId]/versions/[version]/route.ts`, `src/app/api/conversations/route.ts`, `src/app/api/conversations/[conversationId]/route.ts`, `…/transcript/route.ts`, `…/inputs/route.ts`, `src/app/api/[...rest]/route.ts` | Rutas de la web (D3) |
| `src/app/conversaciones/[conversationId]/page.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx` | Páginas (D1, D16) |
| `src/config/endpoints.ts`, `api-error-codes.ts`, `web-error-codes.ts`, `limits.ts` | URLs, códigos, tamaños de página, plazos y topes |
| `src/lib/web-client.ts` (+ test) | Cliente único del navegador hacia las rutas de la web |
| `src/lib/chat/api-types.ts`, `events.ts`, `url-filter.ts`, `transcript-view.ts`, `conversation-session.ts`, `first-advance.ts`, `copy.ts`, `paged-list.ts`, `format.ts` (+ tests de los que tienen lógica) | Modelo del chat (D10-D13) |
| `src/hooks/use-conversation-session.ts`, `use-paged-list.ts`, `use-start-conversation.ts` | Adaptadores de React |
| `src/components/chat/home-screen.tsx`, `contact-field.tsx`, `flow-list.tsx`, `conversation-list.tsx`, `list-state.tsx`, `conversation-screen.tsx`, `conversation-header.tsx`, `message-list.tsx`, `flow-message.tsx`, `message-text.tsx`, `media-item.tsx`, `user-message.tsx`, `typing-indicator.tsx`, `pending-question.tsx`, `text-question.tsx`, `single-choice-question.tsx`, `multiple-choice-question.tsx`, `answer-reason.tsx`, `end-notice.tsx`, `conversation-notice.tsx`, `test-details-panel.tsx`, `technical-activity.tsx`, `delete-conversation-dialog.tsx`, `conversation-loading.tsx`, `conversation-not-found.tsx` (+ tests de marcado de `message-text`, `media-item`, `pending-question`, `end-notice` y `test-details-panel`) | Pantallas y componentes |
| `src/components/ui/button.tsx`, `notice.tsx` | Genéricos |
| `scripts/check-env.mjs`, `scripts/mutate.mjs` | D5, D23 |
| `tests/static-guard.test.ts`, `api-error-codes-parity.test.ts`, `spec-coverage.test.ts`, `spec-text-parity.test.ts`, `flow-fixtures.test.ts`, `api-transport-env-proxy.test.ts`, `hostile/env-proxy.hostile.ts`, `helpers/spec-text.ts`, `helpers/fake-api.ts`, `mutations.json` | D19, D22, D23 |
| `vitest.config.ts`, `vitest.hostile.config.ts`, `playwright.config.ts` | Configuración de tests |
| `e2e/support/{stack,database,processes,api-shapes,admin,browser,test}.ts`, `e2e/fixtures/flows/{pregunta,saludo-contacto,hola,preguntas,medios}.json`, `e2e/{home,conversation-page,questions,rhythm,concurrency,lifecycle,frontier,accessibility,fake-api-shapes}.e2e.ts` | D20 |

**Modificados en `apps/web`**: `package.json` (*scripts*, dependencias y `mutate`), `eslint.config.mjs` (restricciones de D4, D13 y D17), `.gitignore` (`/test-results`, `/playwright-report`, `/blob-report`), `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` (fuente) y `README.md` (qué es y cómo se arranca y prueba). Se **borran** los SVG de plantilla de `public/` (`file`, `globe`, `next`, `vercel` y `window`). `next.config.ts` y `tsconfig.json` **no cambian**.

**Fuera de `apps/web`** (cada uno con su porqué):

| Fichero | Cambio |
|---|---|
| `turbo.json` | Las dos tareas de D21 |
| `package.json` (raíz) | `test:e2e` con `--concurrency=1` (D21) |
| `pnpm-lock.yaml` | Las dependencias de D18 |
| `.github/workflows/ci.yml` | Instalación de Chromium y artefactos si falla (D21) |
| `CLAUDE.md` | `FRANCA_API_URL` (solo el nombre), comandos de la web (`test`, `test:e2e` e instalar Chromium) y fila de la web en la tabla |
| `.claude/rules/always/gotchas.md`, `.claude/rules/frontend/architecture.md`, `.claude/rules/always/knowledge-wiki.md`, `.claude/wiki/*.md` (nuevos) | Fase 6 |
| `openspec/changes/web-chat/**` | Este cambio |

**Cero ficheros en `apps/api/` y `packages/`.** La paridad y la cobertura **leen** `apps/api/src/http/api-error.ts`, `packages/engine/tests/helpers/spec-text.ts` y `packages/spec/examples/` sin tocarlos.

**Criterio que hace fallar el PR** (gate 6.5, antes de abrir el PR): estos dos comandos no imprimen nada.

```bash
git diff --name-only main...HEAD -- apps/api packages
git diff --name-only main...HEAD | grep -v -E '^(apps/web/|openspec/|\.claude/wiki/|\.claude/rules/(always/(gotchas|knowledge-wiki)|frontend/architecture)\.md$|turbo\.json$|package\.json$|pnpm-lock\.yaml$|\.github/workflows/ci\.yml$|CLAUDE\.md$)'
```

Un fichero nuevo fuera de esa lista exige una decisión explícita en este documento antes del PR.

## Coherencia (checklist)

- [x] Cada campo de respuesta que lee la web está en la tabla de 2xx. Los que pasan sin uso (`revision`, `createdAt` y `updatedAt` de `FlowSummary`; `revision`, `processing`, `error`, `costUsd`, `costLimitReached`, `createdAt` y `expiresAt` del listado) son de la API, la web no los genera, y los quita cuando reduce (versión).
- [x] Cada llamada del navegador tiene su ruta y cada ruta su operación. El comodín no llama a nada.
- [x] Tipos de eventos desde `@franca/engine`, de flujo desde `@franca/spec`. El patrón de `id` se importa (`schema.$defs.id.pattern`). La web solo declara las formas de los recursos de la API (`api-types.ts`), y las comprueba `fake-api-shapes.e2e.ts`.
- [x] Cada error de la API tiene manejo, aunque sea el genérico del contexto. Los códigos desconocidos son genéricos y la lista espejada tiene test de paridad.
- [x] Permisos: no hay usuarios. La frontera (`Host` y `Origin`) se aplica a toda ruta y a toda mutación. El navegador no puede borrar contactos ni tocar flujos (ocho operaciones).
- [x] Constantes espejadas con paridad: `API_ERROR_CODES` (texto de la API), los motivos (`INVALID_ANSWER_REASONS` del motor) y los *fixtures* de flujos (texto de la spec).
- [x] Convivencia: cero ficheros de `apps/api` y `packages/`, y fuera de `apps/web` solo los de la tabla, con su porqué. Se ejerce con el criterio del *diff*.

## Plan de verificación por capas

- **Unit (aplica)**:
  - Piezas puras de la frontera (`frontier`, `ids` y `api-url`) y del chat (`url-filter`, `events`, `transcript-view`, `conversation-session`, `copy` y `paged-list`).
  - Marcado de los componentes de seguridad con `react-dom/server`.
  - Todos en `pnpm check` (D19).
- **Golden/contractual (no aplica)**: la web no genera salida contractual. Su contrato con la API lo cubren la integración y `fake-api-shapes.e2e.ts`, y los eventos salen del motor real.
- **Paridad (aplica)**: `API_ERROR_CODES`, `INVALID_ANSWER_REASONS`, los *fixtures* de flujos frente a la spec y `spec-text.ts` frente a la copia del motor.
- **Integración HTTP (aplica)**:
  - En `pnpm check`: manejadores, operaciones y transporte contra una API simulada en el mismo proceso, más el hijo hostil del proxy.
  - En `test:e2e`: el servidor real de la web (`next start`) en `frontier.e2e.ts` (`Host`, `Origin`, cabeceras, arranque, escucha y marco) y el recorrido con la API simulada delante de la real.
- **E2E opción-al-menos-una-vez (aplica)**: Chromium contra la API real y Postgres. Cubre cada `inputType`, las tres formas de entrada, cada elemento multimedia, cada fin, cada aviso y cada código de error que tiene escenario. Lo que la API real no puede producir a voluntad (ocupada, perdida, código desconocido, `llm` rechazado, 150 entradas, 150 s) va contra la API simulada.
- **Smoke de ruta (aplica)**: `/`, `/conversaciones/<id>` existente, no UUID e inexistente, y el 403 con un `Host` ajeno (`home.e2e.ts`, `conversation-page.e2e.ts` y `frontier.e2e.ts`).
- **Mutación (aplica, manual)**: los mutantes de D23, todos muertos con Vitest.

### Escenario → test

| Fichero | Escenarios (título exacto) | Contra |
|---|---|---|
| `src/lib/chat/url-filter.test.ts` | Direcciones rechazadas · Direcciones admitidas y su serialización | — |
| `tests/api-error-codes-parity.test.ts` | Paridad de códigos | texto de la API |
| `e2e/home.e2e.ts` | Marca en la página de inicio · Solo los publicados · Más de una página de flujos · Sin flujos publicados · API parada · Conversación terminada en la lista · Probar el ejemplo de captación de leads · El email pasa de un flujo a otro · Identificador de contacto no admitido · Flujo borrado después de cargar la lista · Conversación creada fuera del chat | API real |
| `e2e/conversation-page.e2e.ts` | Reabrir una conversación · Transcripción de varias páginas (simulada) · Conversación que no existe · Conversación de un flujo borrado · Marcado y direcciones en un texto · Multimedia del flujo de medios · Una imagen admitida y otra no | real salvo lo indicado |
| `e2e/questions.e2e.ts` | Las siete preguntas de texto · Respuesta vacía · Tamaño de empresa · Extras en el orden de las opciones · Ninguna marcada · Email inválido en el ejemplo · Mensaje rechazado en un llm (simulada) · Etiqueta de la opción en directo y al reabrir · Tipo de pregunta futuro (simulada) | |
| `e2e/rhythm.e2e.ts` | Retardo por defecto del ejemplo · Indicador mientras la API responde (simulada) · Avance largo (simulada, `@lento`) | |
| `e2e/concurrency.e2e.ts` | If-Match en las respuestas · Doble clic en una opción · Respuesta perdida después de aplicarse (simulada) · Dos pestañas · Ocupada al enviar (simulada, `page.clock`) · Caducada al responder (simulada) · Respuesta enorme · Conversación borrada desde otra pestaña · Código desconocido (simulada) | |
| `e2e/lifecycle.e2e.ts` | Fallo del nodo http del ejemplo · Evento desconocido (simulada) · Final con outcome · Reintentos agotados · Probar la versión nueva · Borrar y cancelar · Fallo de llm sin credenciales · Intento de la pregunta pendiente · Llamada bloqueada y turno de llm (simulada) | |
| `e2e/frontier.e2e.ts` | Otra interfaz de la máquina · Host ajeno · Nombres locales · Otra web intenta crear una conversación · El chat dentro de un marco ajeno · Recorrido completo · Id de conversación con una ruta dentro · Cabeceras que recibe la API · Direcciones no admitidas · Marcas fuera de los registros y del navegador | servidor real de la web |
| `e2e/accessibility.e2e.ts` | Solo con teclado · Pantalla estrecha | |

Son 3 en Vitest y 60 en Playwright: 63 en total, uno por escenario, con el título exacto (D22). Los requisitos sin escenario propio en el E2E también tienen unit tests:
- «Respuestas del usuario»: la etiqueta, la desaparición y el `draft`.
- «Una respuesta a la vez»: el cerrojo y la relectura.
- «Peticiones de la web a la API»: los plazos.
- «Sin caché de datos»: `connection()`.
- «Privacidad en la web»: ESLint y el registro.

## Riesgos / Trade-offs

- **R1. Next 16 cambia el enrutado de `%2F`**. Si Next decodificara `%2F` antes de enrutar, `..%2F..%2Fflows%2Fhola` podría acabar en otra ruta. Mitigación: el paso 3 de la frontera (D2) valida el segmento antes de enrutar, y el comodín nunca llama a la API. Lo cubre «Id de conversación con una ruta dentro» contra `next start`.
- **R2. `Cache-Control` en otros caminos de Next**. Algunos caminos de `base-server.js` fijan `private, no-cache, no-store, …` incondicionalmente. Contienen `no-store`, y el test acepta cualquier valor que lo contenga. Si Next quitara `no-store` en algún camino, falla «Conversación creada fuera del chat».
- **R3. `next dev` frente a `next start`**. Los E2E corren contra el *build*. El servidor de desarrollo (Turbopack, `allowedDevOrigins`, HMR por *websocket*, al que `proxy.ts` quizá no llega) solo lo ejerce «Otra interfaz de la máquina» y la verificación manual en el navegador (6.4). Si `next dev` bloquea recursos al abrir la web por `127.0.0.1`, se documenta usar `localhost` (FOLLOW-UP 7.4).
- **R4. Entorno hostil y Next**. Con `NODE_USE_ENV_PROXY=1`, una petición interna de Next (si la hubiera) iría a la trampa y rompería los E2E por un motivo ajeno. Mitigación: la trampa registra y responde 502. Si pasa, el entorno hostil se queda solo en el test dedicado (D19), y se anota.
- **R5. Duración de los E2E en la CI**. Dos *workers* y unos 62 escenarios con Chromium, la API y la web, más 150 s de «Avance largo» en paralelo. Se mide en el *runner*, nunca en el portátil (`lecciones-equipo`), y se anota en el PR (FOLLOW-UP 7.2).
- **R6. Una transcripción muy larga**. Se lee entera en páginas de 100. Una conversación de miles de entradas tarda en abrirse, y en una herramienta de prueba es aceptable. No hay tope en esta feature.
- **R7. `<Activity>` conserva el DOM oculto**. La conversación anterior sigue en el documento con `display: none` (hasta 3 rutas). Las comprobaciones de «la página no contiene» de los E2E se hacen sobre la página recién cargada o sobre el texto **visible**. No es almacenamiento del navegador.
- **R8. Contenido de terceros**. Imágenes, audio, vídeo y marcos del flujo piden a esos servidores (la IP y el momento de quien prueba), y el marco ejecuta *scripts* en un origen opaco. Es inherente a probar el flujo (propuesta). Sin `Referer`, la URL de la conversación no sale.
- **R9. La extracción por texto de `API_ERROR_CODES`**. Si la API reescribe la declaración, el test falla en vez de pasar en verde (exige 20 o más). Se corrige el extractor en el mismo PR que el cambio de la API.

## Open Questions (requieren aprobación humana)

1. **Delta `e88c5ed` («Sin marcos de otras páginas»)**: ¿se aprueba? Recomendación: sí. Cuesta dos cabeceras y un test, y cierra el único camino de una web ajena hacia las mutaciones con el `Origin` propio.
2. **`test:e2e` de la raíz con `--concurrency=1`**: serializa los E2E de la API y los de la web en local y en la CI. La alternativa es separar los pasos de la CI y dejar que en local corran a la vez. Recomendación: serializar.
3. **«Avance largo» con 150 s reales en cada PR**: la alternativa es correrlo solo con `--grep @lento` en una ejecución manual o nocturna. Recomendación: en cada PR mientras la CI no pase de lo razonable (R5).
