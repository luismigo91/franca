# Design: chat web de prueba (`web-chat`)

**Fecha**: 2026-10-17 · **Rama**: `feat/web-chat` · Motivación y alcance en `proposal.md`. El comportamiento está en `specs/web-chat/spec.md` (41 requisitos y 63 escenarios), que manda sobre este documento. Antes de este diseño se añadió a la spec un requisito: «Sin marcos de otras páginas» (commit `e88c5ed`, ver D24). Lo resolvió el orquestador dentro del flujo autónomo que acordó el usuario («de corrido»: solo se para ante decisiones de producto), y **el usuario puede revertirlo**.

**Revisión 3**, tras la segunda ronda de `popi:architecture-reviewer`. El guardián de la revisión 2 no cerraba el inspector, porque el `next dev` hijo atendía en su puerto efímero con cualquier `Host`. D26 pasa a ser un *preload* en el árbol de procesos de Next, medido con un `next dev` real. Ya no hay decisiones pendientes.

**Revisión 2**, tras el FAIL de `popi:architecture-reviewer`:
- **B1.** Las respuestas sin cuerpo se leen por su estado. El 204 de `DELETE` es un éxito, la regla de cuerpo solo se aplica a los dos `POST`, y el cliente omite un contacto vacío (D4, D8, D9, D10).
- **B2.** En `next dev`, los recursos propios del servidor de desarrollo de Next se atienden **antes** de `proxy.ts`. Entre ellos, uno abre el inspector de Node y deja ejecutar código con un DNS rebinding (medido, ver la auditoría). Se cierra con un *preload* dentro del proceso de Next (D26, revisión 3).

Además se incorporan los riesgos señalados y las simplificaciones que resolvió el orquestador:
- `fetch` en modo `cors` y sin envío nativo de formularios (D9, D15).
- Solo la cabecera `host` en bruto (D2).
- Paridad de las listas de tipos conocidos (D10).
- `inputs` de turbo (D21).
- Puertos explícitos (D6).
- `@types/node` alineado (D18).
- E2E sin entorno hostil y con una sola pila (D20).
- Mutantes recortados (D23).

Dentro del flujo autónomo «de corrido» que acordó el usuario, el orquestador resolvió cuatro cosas, y **el usuario puede revertir cualquiera**:
- El delta `e88c5ed` (sin marcos).
- `test:e2e` serializado.
- Las simplificaciones de los E2E y de la mutación.
- «Avance largo» en la ejecución de cada PR.

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
| La web «no arranca» con un `FRANCA_API_URL` inválido | `next dev` y `next start` llaman a `server.listen` y cargan `next.config` **dentro** del *callback* de escucha (`next/dist/server/lib/start-server.js`): un error en la configuración llega después de escuchar | D5 y D26: el lanzador `scripts/local-only.mjs` la valida **antes** de ejecutar `next` en `dev` y `start` |
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
| Toda respuesta de la API es JSON | `DELETE /conversations/:id` responde **204 sin cuerpo** (`conversations.controller.ts:55-60`, `@HttpCode(204)`), y los 403 de la frontera de la web tampoco llevan cuerpo | D4, D8 y D9: un 204 es éxito, y un error sin cuerpo se lee por su estado, nunca como `network_error` |
| El `Host` de la petición | Next rellena `x-forwarded-host` con `??=` desde `host` (`next/dist/server/base-server.js:564`): si el cliente manda un `X-Forwarded-Host` propio, se conserva, y `request.nextUrl` y `request.url` se derivan de lo que Next normaliza | D2: la frontera lee **solo** la cabecera `host` en bruto |
| Un POST del navegador lleva su `Origin` | Con `Referrer-Policy: no-referrer`, una petición `no-cors` que no es `GET` ni `HEAD` (p. ej. el envío nativo de un `<form>`) lleva `Origin: null` (Fetch, «append a request Origin header») | D9 y D15: solo `fetch` en modo `cors` y siempre `preventDefault` |
| `proxy.ts` ve «toda petición» | En `next dev`, `router-server.js:387-403` ejecuta `blockCrossSiteDEV` y `hotReloader.run` **antes** de `resolveRoutes` (donde corre `proxy.ts`). `hot-reloader-turbopack.js:963-975` registra los middlewares de desarrollo, que atienden `/__nextjs_*` y `/_next/*` sin pasar por la frontera | D26 (*preload*) y R3 |
| `blockCrossSiteDEV` protege los recursos de desarrollo | `block-cross-site-dev.js`: solo bloquea un `no-cors` *cross-site* o un `Origin` no permitido, y deja pasar **toda petición sin `Origin`** («Allow requests with no origin»). Un `GET` del mismo origen tras un DNS rebinding no lleva `Origin` | D26 |
| Lo que expone el servidor de desarrollo | `/__nextjs_attach-nodejs-inspector` (cualquier método, `attach-nodejs-debugger-middleware.js`) abre el inspector de Node y devuelve su `devtoolsFrontendUrl` con el UUID secreto. El inspector **acepta** un WebSocket con `Host: 127.0.0.1:<puerto>` y `Origin: http://evil.example:3000` (medido en Node 22.23.3: `101`; con `Host: evil.example` responde `400`). Con el UUID, una página con DNS rebinding puede **ejecutar código** en el proceso de `next dev`. Además, `GET /__nextjs_launch-editor` abre en el editor el fichero de la consulta y responde 204 o 404 según exista (`existsSync`, un oráculo de ficheros), y `GET /__nextjs_source-map?filename=` devuelve mapas de fuentes de módulos cargados | D26 (*preload*: guarda de `Host` en todo `http.Server` y `inspector.open` neutralizado) |

No queda ninguna contradicción de producto. El hueco de conducta de los marcos va en el delta `e88c5ed`. El de `next dev` se cierra con D26 (*preload*), así que «Host local en la web» y «Sin marcos de otras páginas» valen tal como están, también en `next dev`, sin delta.

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

0. **Solo la cabecera `host` en bruto**: nunca `request.nextUrl.host`, `request.url` ni `x-forwarded-host`, porque Next rellena esta última con `??=` y respeta la que manda el cliente (auditoría). La matriz incluye `Host: evil.example:3000` con `X-Forwarded-Host: localhost:3000`, que da 403. Sin `x-forwarded-*` en ninguna decisión.
1. **Host** (todas las peticiones que llegan a `proxy.ts`; antes, en el *socket*, la guarda del *preload* de D26 hace lo mismo con toda petición del proceso, recursos de desarrollo incluidos): `isLocalHost(request.headers.get('host'))` (de `src/server/config/local-host.cjs`) con la regla de la API: nombre exacto `localhost`, `127.0.0.1` o `[::1]`, sin distinguir mayúsculas, con puerto opcional `:[0-9]{1,5}`. Si no, `403` sin cuerpo.
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
- Resultado: `{kind: 'response', status, body: Uint8Array | null}` (`null` si la respuesta no trae bytes, como el **204** de `DELETE`), `{kind: 'unreachable'}` o `{kind: 'invalid'}`.
  - Cuentan como `unreachable` un error de conexión, un `close` antes de `response` (incluido un `101`, [[gotcha-node-http-createconnection-y-proxy]]) o un cierre a medio cuerpo, que es la «respuesta perdida».
  - Solo son `invalid` un status fuera de 200-599 y un cuerpo de más de 32 MiB.
  - El transporte **no interpreta** el cuerpo. Si es JSON y qué significa un cuerpo vacío lo decide `responses.ts` (D8).
- No se propaga el aborto del navegador: si la pestaña se cierra durante un avance, la petición a la API termina igual. Cortarla a medias es justo el caso que obliga a releer.

Descartado:
- **`fetch`**: obedece `NODE_USE_ENV_PROXY`, y Next lo instrumenta (registro de *fetches*, caché de datos).
- **`undici` con `Agent` propio**: una dependencia nueva que hay que alinear con la de Node, y el comportamiento de sus agentes con las variables de proxy cambia entre versiones.
- **Un `http.Agent` propio**: en Node 24 los agentes aceptan `proxyEnv`. Depender del valor por defecto es apostar.
- **Comprobar las variables de proxy al arrancar y negarse a arrancar**: rompería a quien tiene un proxy corporativo para otras cosas.

Enforcement: regla de ESLint `no-restricted-imports` (`node:http`, `node:https`, `node:net`, `http`, `https`, `net` y `undici` solo en `transport.ts`) y `no-restricted-globals` (`fetch` solo en `src/lib/web-client.ts`). Además, la guarda estática y el test hostil en un proceso hijo con su mutante `useGlobalAgent` (D19, D23). Los E2E no corren con un entorno hostil (simplificación aprobada). La excepción de ESLint también cubre `scripts/local-only-preload.cjs` (`node:http`, `node:https` y `node:inspector`), que no envía nada: solo envuelve los servidores del propio proceso.

### D5. `FRANCA_API_URL`: validación antes de escuchar

`src/server/config/api-url.mjs` (JavaScript con `// @ts-check` y JSDoc, sin imports) exporta `parseApiUrl(raw)` y `DEFAULT_API_URL = 'http://127.0.0.1:3001'`:

- Sin la variable (`undefined`), vale el valor por defecto. Un texto vacío **no** es «sin variable»: no es válido.
- Se rechaza cualquier carácter fuera de ASCII visible **antes** de parsear, porque `new URL` quita tabuladores y saltos de línea en silencio ([[gotcha-url-whatwg-normaliza]]).
- Sobre el `URL` parseado: `protocol === 'http:'`, `hostname` ∈ {`127.0.0.1`, `[::1]`, `localhost`}, `username` y `password` vacíos, `pathname === '/'`, `search` y `hash` vacíos, y un puerto distinto de `0` si lo hay.
- Devuelve `{hostHeader, connect: {family: 4 | 6 | 'loopback', port}}`, o un error cuyo mensaje nombra `FRANCA_API_URL` y **nunca** el valor.

Lo usan dos sitios:
1. El lanzador `apps/web/scripts/local-only.mjs` (D26), que la comprueba **antes** de ejecutar `next` en los *scripts* `dev` y `start` y termina con código 1 y el mensaje. Así la web no llega a escuchar (ver la auditoría: Next escucha antes de cargar `next.config`).
2. `src/server/api/transport.ts`, de forma perezosa y memorizada, como defensa si alguien ejecuta `next start` a mano. Con un valor inválido, cada ruta responde `500 {"error":"internal_error"}` y registra una línea con el nombre de la variable.

El fichero es `.mjs` para que el *script* lo importe con `node` sin cargador de TypeScript. La eliminación de tipos de Node 22 exige 22.18 o la *flag*, y `engines` admite 22.0. TypeScript lo tipa por JSDoc (`allowJs` ya está activo).

Descartado:
- **Validar en `next.config.ts`**: escucha antes (auditoría) y rompería `next build` en la CI sin motivo.
- **`instrumentation.ts`** con `process.exit`: también corre tras escuchar.

### D6. Escucha solo en `127.0.0.1`

Los *scripts* quedan así:
- `"dev": "node scripts/local-only.mjs dev --hostname 127.0.0.1 --port 3000"`
- `"start": "node scripts/local-only.mjs start --hostname 127.0.0.1 --port 3000"`

El lanzador valida `FRANCA_API_URL` y carga el *preload* de D26.

El puerto y la dirección van **explícitos** (`-p` gana a `PORT`), así que un `PORT` de la API en la shell no mueve la web. Los E2E usan el 3000: hay una sola pila en serie (D20), y el arnés falla con un mensaje claro si el 3000 está ocupado («para `pnpm dev` antes de los E2E»). El navegador abre `http://localhost:3000`. Si `localhost` resuelve primero a `::1`, Chrome, Firefox y Safari pasan a `127.0.0.1`.

Enforcement: la guarda estática lee `package.json` (los dos *scripts* son exactamente `node scripts/local-only.mjs <dev|start> --hostname 127.0.0.1 --port 3000`), y el E2E «Otra interfaz de la máquina» arranca los dos *scripts* de verdad. Para ello, la pila para su web, la prueba y la vuelve a arrancar.

### D7. Sin caché: lecturas frescas explícitas

- Cada manejador de `src/app/api/**/route.ts` empieza con `await connection()` (`next/server`). Con Cache Components, ningún `GET` se prerenderiza en el *build* ni se reutiliza. Lo impone la guarda estática: cada `export async function GET|POST|DELETE` tiene `await connection()` como primera sentencia.
- El cliente pide con `fetch(…, {cache: 'no-store'})`. Las rutas responden con `Cache-Control: no-store` (en `jsonResponse`) y `proxy.ts` lo repite en todas, páginas incluidas. Next no lo sobrescribe (auditoría), y el test acepta cualquier `Cache-Control` que **contenga** la directiva `no-store`. Esta es la lectura que se hace de «llevan `Cache-Control: no-store`».
- `<Activity>`: cada pantalla pide sus datos en un efecto que corre al montarse **y** al volver a mostrarse. Al ocultarse, el *cleanup* (`useLayoutEffect`) pone su estado en `loading`, el patrón de `preserving-ui-state.md`, así que al volver no se ve ni un instante la lista vieja (p. ej. la conversación recién borrada). El campo «Identificador de contacto» sí se conserva al navegar dentro de la web. «Entre visitas» quiere decir cargas de página, y ahí empieza vacío.
- No se usa `use cache`, `cacheLife`, `cacheTag` ni `unstable_cache` (guarda estática).

### D8. Lo que hace el servidor de la web con peticiones y respuestas

**Peticiones del navegador** (`src/server/bff/request.ts`):
- **Solo en los dos `POST`** (`/api/conversations` y `…/inputs`), el cuerpo se lee como texto UTF-8 estricto, con un tope de **1 MiB**: si lo supera, `413 payload_too_large`. Es mayor que los 64 KiB de la API, para que la respuesta de 70 000 caracteres llegue a la API y su 413 sea el de la API, y menor que los 10 MB del búfer de `proxy.ts`, así que nunca se reenvía un cuerpo truncado. Sin cuerpo, o si no es JSON, `400 invalid_json`.
- Los `GET` y el `DELETE` **no leen** el cuerpo, y uno que llegue se ignora. Nunca se reenvía.
- `POST /api/conversations`: `{flowId: string, contactId?: string}`. Se reenvía **solo** `{"flowId"}` o `{"flowId","contactId"}`, construido de nuevo, sin validar el patrón del contacto: lo decide la API y su 400 llega al campo. Un `flowId` o un `contactId` que no son texto dan `400 invalid_request`.
  - El **cliente** convierte el campo vacío en «sin contacto»: si el valor es exactamente `''`, el cuerpo es `{"flowId":"…"}` sin la clave `contactId` (escenario «Probar el ejemplo de captación de leads»).
  - Cualquier otro valor, también de solo espacios, se manda tal cual y lo decide la API. El servidor de la web no recorta ni convierte: reenvía `contactId` si viene y es texto, aunque sea `''`, que la API rechaza.
- `POST …/inputs`: hace falta la propiedad propia `input`, con cualquier valor, y se reenvía `JSON.stringify({input})`. El texto llega exacto, también con los espacios. `If-Match` debe cumplir `^"[0-9]{1,10}"$`: si falta, `428 precondition_required`, y si está mal formada, `400 invalid_request`. Se reenvía tal cual.
- Consultas: solo `offset`. Si es inválido, `400 invalid_query`. Los parámetros desconocidos se ignoran.

**Respuestas de la API** (`src/server/bff/responses.ts`):

| La API responde | La web responde |
|---|---|
| **204** (solo `deleteConversation`) | **204 sin cuerpo** |
| 2xx con un objeto JSON en UTF-8 | El mismo estado y el JSON sin tocar, salvo dos cosas: se quita la clave `message` de todo evento `type: "error"` de `events[]` y de `items[].event` (el navegador nunca la recibe, así que tampoco la ve en el inspector ni en la carga RSC), y `getFlowVersion` se reduce a `{flowId, version, name}` (la definición del flujo pesa y no se usa) |
| Otro 2xx (vacío, no JSON, o un 204 en otra operación) | `502 {"error":"invalid_api_response"}` |
| 4xx/5xx con JSON y un `error` que cumple `^[a-z][a-z0-9_]{0,63}$` | El mismo estado con `{error}` y, en un 412, `currentRevision` si es entero. Pasa **cualquier** código así, también uno desconocido, para que el chat lo trate como genérico («Código desconocido») |
| 4xx/5xx sin cuerpo o sin un `error` legible | El **mismo estado, sin cuerpo**. Se lee por su estado (D9) |
| `unreachable` | `502 {"error":"api_unreachable"}` |
| `invalid` | `502 {"error":"invalid_api_response"}` |

El `message` de la API no sale nunca del servidor.

### D9. Códigos de error: lista espejada, códigos propios y textos por contexto

- `src/config/api-error-codes.ts` exporta `API_ERROR_CODES` (las 26 de la API, mismo orden) y `type ApiErrorCode`.
- `src/config/web-error-codes.ts` exporta `WEB_ERROR_CODES = ['api_unreachable', 'invalid_api_response']`. Son disjuntos de los de la API (test).
- **Cómo lee el cliente del navegador una respuesta** (`src/lib/web-client.ts`):

  | Llega | El cliente devuelve |
  |---|---|
  | 204 | `{ok: true, status: 204, body: null}`: «Borrar» lo trata como éxito |
  | Otro 2xx con JSON | `{ok: true, status, body}` |
  | Otro 2xx sin JSON | `{ok: false, status, code: 'invalid_api_response'}` |
  | 4xx/5xx con `{error}` | `{ok: false, status, code}` (código conocido o `'unknown'`) y `currentRevision` en un 412 |
  | 4xx/5xx **sin cuerpo** o sin `error` legible (el 403 de la frontera, un 405 de Next…) | `{ok: false, status, code: 'unknown'}`: se lee por su estado, **nunca** `network_error` |
  | `fetch` rechazado, abortado o con plazo agotado | `{ok: false, code: 'network_error'}`: **solo** en este caso |

- **Siempre `fetch` en modo `cors`**, el de por defecto, con `credentials: 'same-origin'`. Nunca `mode: 'no-cors'` ni el envío nativo de un formulario. Con `Referrer-Policy: no-referrer`, un `POST` `no-cors` lleva `Origin: null` y la frontera lo rechazaría (auditoría). Los `<form>` de D15 llaman siempre a `preventDefault()` y no tienen `action` ni `method`. Lo comprueban la guarda estática (ningún `mode:` en `src/`, ningún `<form` con `action=`) y los E2E, donde cualquier envío nativo daría 403.
- **Paridad** (`tests/api-error-codes-parity.test.ts`): lee **el texto** de `apps/api/src/http/api-error.ts`, extrae los literales entre `export const API_ERROR_CODES = [` y `] as const;`, exige al menos 20 y sin repetidos, y compara el conjunto con el de la web. No se importa el módulo: tiraría de `@nestjs/common` desde la web y «una app no depende de otra». Si cambia el formato del fichero, la extracción encuentra cero y el test falla en voz alta, nunca en verde. El escenario «Paridad de códigos» se valida a mano una vez: se añade un código al espejo, el test falla, y se quita (tasks 1.4). No es un mutante registrado (D23).
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
- **Borrar** (`remove()`, tras confirmar en el `<dialog>`):

  | Resultado de `DELETE` | Qué hace |
  |---|---|
  | `204` | Navega a `/`, que vuelve a leer la lista (D7) |
  | `404` `conversation_not_found` | Navega a `/` también, como pide la spec |
  | `network_error` o `api_unreachable` | Aviso «No se puede conectar con la API de Franca.». Se queda en la página y **no** reintenta solo |
  | Cualquier otro error, también uno sin cuerpo (`unknown`) | Aviso genérico «No se ha podido borrar la conversación.». Se queda en la página |

  Cancelar cierra el diálogo sin llamar a nada.
- **Sin sondeos**: la clase solo programa la espera de la reproducción. Lo comprueba un test con temporizadores falsos: tras un 409, avanzar 10 s no hace ninguna llamada.
- `ConversationResource`, `TranscriptItem` y los demás tipos de respuesta de la API los declara la web en `src/lib/chat/api-types.ts`, con los de eventos importados de `@franca/engine` (`import type`). La forma la fija el contrato de abajo y la comprueba el E2E de forma (D20).
- **Listas de tipos conocidos en ejecución** (`src/lib/chat/known-types.ts`): el cliente necesita en ejecución qué `type` de evento, qué `kind` de contenido y qué `inputType` sabe pintar. Así lo desconocido se ignora o va a «Pregunta no soportada».
  - Se declaran `KNOWN_EVENT_TYPES`, `KNOWN_CONTENT_KINDS` y `KNOWN_INPUT_TYPES` con `as const satisfies readonly X[]`, donde `X` es `EngineEvent['type']`, `RenderedContentItem['kind']` e `InputType`.
  - Exhaustividad en tipos: `type _Missing = Exclude<X, (typeof LIST)[number]>` debe ser `never` (`const _check: [_Missing] extends [never] ? true : false = true`). Si el motor o la spec añaden un tipo, `pnpm typecheck` falla hasta que la web lo pinte o lo excluya **explícitamente** con su porqué.
  - Paridad en ejecución (`known-types.test.ts`) contra el esquema de `@franca/spec`, sin copiarlo:
    - `KNOWN_INPUT_TYPES` es igual a `schema.$defs.inputNode.properties.inputType.enum`.
    - `KNOWN_CONTENT_KINDS` es igual a la unión del `const` y del `enum` de `kind` de `schema.$defs.contentItem.oneOf`.
  - `KNOWN_EVENT_TYPES` no tiene equivalente en ejecución en el motor, así que lo cubre solo la comprobación de tipos. Además, el test verifica que los eventos reales del motor (D19) solo tienen tipos de la lista.

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

Todo va en un `<form noValidate>` sin `action` ni `method`. Su `onSubmit` llama **siempre** a `event.preventDefault()` y envía con el cliente (`fetch` en modo `cors`, D9). Sin `maxLength`, `required` ni `pattern`, y sin recortar nada. Mientras `sending`, los controles están `disabled`.

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
| `pg` | `devDependencies` | `8.23.1` | Solo para el arnés E2E: crear y borrar la base de la ejecución y vaciarla entre tests (D20). Es la versión que ya está en el *lockfile* (la usa `@prisma/adapter-pg`) |
| `@types/pg` | `devDependencies` | `8.23.1` | Tipos de lo anterior, también ya en el *lockfile* |
| `@types/node` | `devDependencies` (ya está, `^20`) | `24.19.2` | Se **sube** a la que resuelve la API. Así `vitest` y `vite` no se duplican en el *lockfile* por un `@types/node` distinto (son *peers* de `vite`). La web corre en Node 22 o superior |

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
    - **El 204 de `DELETE`**: la API simulada responde exactamente lo que responde la API real (`HTTP/1.1 204 No Content`, sin cuerpo; las cabeceras exactas se miden con la API de verdad en `fake-api-shapes.e2e.ts` y se copian en el *fixture*). `handlers.ts` responde 204 sin cuerpo y `web-client.ts` da `{ok: true, status: 204, body: null}`.
    - Un 4xx/5xx sin cuerpo de la API llega al navegador con el mismo estado y sin cuerpo, y el cliente lo lee como `unknown`, nunca como `network_error`.
- **Proceso hijo hostil** (`tests/api-transport-env-proxy.test.ts`): lanza `vitest run --config vitest.hostile.config.ts tests/hostile/env-proxy.hostile.ts` con `NODE_USE_ENV_PROXY=1` y `HTTP_PROXY`, `HTTPS_PROXY` y `ALL_PROXY` hacia un proxy trampa local. El hijo envía con `transport.ts` a una API simulada, y el padre comprueba que la API la recibió y que la trampa **no** recibió ninguna conexión. Va en un hijo porque Node lee `NODE_USE_ENV_PROXY` al arrancar. El test negativo se valida con el mutante `useGlobalAgent` (D23), que sustituye `createConnection` por `host` y `port`. Así la petición pasa por `globalAgent`, el proxy del entorno la desvía a la trampa, y el test muere porque **la trampa recibe la conexión**, no por una conexión rechazada. Es la única defensa del proxy del entorno: los E2E no lo repiten.
- Los datos de los tests salen del motor real: `startSession`/`continueSession` de `@franca/engine` sobre `preguntas`, `medios`, `captacion-leads` y `pregunta` (fijados en `e2e/fixtures/flows/`). Así ningún evento de prueba tiene una forma inventada.
- **Guarda estática** (`tests/static-guard.test.ts`), lo que ESLint no expresa:
  - `await connection()` como primera sentencia de cada manejador.
  - Ningún `'use server'`.
  - Ningún fichero `'use client'` importa `@/server/`.
  - `transport.ts` solo lo importa `operations.ts`, y `operations.ts` exporta exactamente ocho funciones.
  - Ningún `use cache`, `cacheLife` ni `unstable_cache`.
  - Los *scripts* `dev` y `start` de `package.json` (D6, D26), sin `--experimental-https`.
  - Ningún cliente importa `@franca/engine` sin `import type`.
  - Ningún `mode:` en una llamada a `fetch` y ningún `<form` con `action=` o `method=` en `src/` (D9).
  - La frontera no lee `x-forwarded-*`, `nextUrl.host` ni `request.url` para decidir (D2).
- `test` de la web es `vitest run`. Ningún test de este nivel arranca Next, la API ni Postgres, ni sale de loopback.

### D20. E2E con Playwright contra la API real y Postgres

- **Configuración** (`apps/web/playwright.config.ts`):
  - `testDir: 'e2e'` y `testMatch: '**/*.e2e.ts'`.
  - Un solo proyecto `chromium` (Desktop Chrome). Un test que no usa `page` ni `context` no abre el navegador, así que los de HTTP en bruto de `frontier.e2e.ts` conviven con los de navegador.
  - `fullyParallel: false`, **`workers: 1`**, `retries: 0` (lo inestable se ve), `forbidOnly: !!process.env.CI`, `actionTimeout: 10_000` y `expect.timeout: 10_000`.
  - `trace: 'retain-on-failure'`.
- **Una sola pila para toda la ejecución** (`e2e/support/stack.ts`, *fixture* de *worker* con un único *worker*). Corre en serie y entre tests se vacía la base:
  1. **Base**: crea `franca_web_e2e_<pid>` con `pg` sobre `DATABASE_URL` y aplica las migraciones con el Prisma de la API (`apps/api/node_modules/.bin/prisma migrate deploy`, `cwd` `apps/api`, `DATABASE_URL` de esa base). Al terminar, la borra con `DROP DATABASE … WITH (FORCE)`. Los errores nunca muestran la URL (patrón de `apps/api/test/global-setup.ts`).
  2. **API real**: `node apps/api/dist/main.js` con un entorno **mínimo**: `PATH`, `DATABASE_URL`, `HOST=127.0.0.1` y `PORT=0`. Sin `FRANCA_ANTHROPIC_API_KEY` ni `FRANCA_SECRET_*` / `FRANCA_HTTP_*`, así que nada sale a Anthropic ni a un CRM. El puerto se lee de la línea «escuchando en».
  3. **API simulada** (`tests/helpers/fake-api.ts`, la misma de la integración de D19, así que hay una sola implementación), en el proceso del *worker*: servidor `node:http` en `127.0.0.1`. Registra método, ruta, cabeceras y cuerpo, y por defecto **reenvía** a la API real. Un test puede guionizar respuestas (`fakeApi.respond(handler)`), retrasarlas, cerrar sin responder, o parar y volver a escuchar en el mismo puerto («API parada»).
  4. **Web**: `pnpm --filter @franca/web start` (el *script* real, así que D5 y D6 se ejercen) en `127.0.0.1:3000`, con `FRANCA_API_URL` hacia la API simulada y `NEXT_TELEMETRY_DISABLED=1`. **Sin entorno hostil de proxy**: esa defensa la cubre solo el hijo de Vitest con su mutante (D19, simplificación aprobada). Si el 3000 está ocupado, el arnés aborta con un mensaje que lo dice. `stack.restartWeb(env?)` la para y la vuelve a arrancar para los escenarios de arranque y escucha.
- **Entre tests**: `TRUNCATE` de todas las tablas de `public` salvo `_prisma_migrations` (descubiertas con `pg_tables`, sin acoplarse a sus nombres), `RESTART IDENTITY CASCADE`, y vaciado del registro y del guion de la API simulada.
- **Datos**:
  - `captacion-leads` y `faq-ia` se leen de `packages/spec/examples/`.
  - `pregunta`, `saludo-contacto`, `hola`, `preguntas` y `medios` están en `e2e/fixtures/flows/*.json`. `tests/flow-fixtures.test.ts`, en `pnpm check`, comprueba que cada uno es **igual** al JSON escrito en el texto de su spec y que `validateFlow` lo da por válido sin avisos.
  - Publicar, crear y responder «directamente en la API» se hace con `e2e/support/admin.ts`, contra la API real y sin pasar por la simulada.
- **Forma de la API simulada**: `e2e/support/api-shapes.ts` construye recursos, páginas y avances. `e2e/fake-api-shapes.e2e.ts` compara sus claves y su orden con respuestas reales de la API: el *fixture* copiado de la forma real, según `lecciones-equipo`.
- **Navegador sin Internet** (`e2e/support/browser.ts`): `context.route('**/*')` deja pasar solo el origen de la web. Lo demás (p. ej. `example.com`) se **registra** y se cumple con un recurso local mínimo (PNG de 1×1, audio vacío o HTML vacío), en vez de abortarlo, para que no haya errores de consola.
- **Consola limpia**: una *fixture* recoge `pageerror` y los `console` de tipo `error`, y falla el test si hay alguno. Dos excepciones, y nada más:
  - Los «Failed to load resource» de respuestas 4xx/5xx de `/api/*` del propio origen que el escenario espera.
  - En «El chat dentro de un marco ajeno», el error de Chromium por `frame-ancestors` («Refused to frame … because an ancestor violates … frame-ancestors 'none'») en la página contenedora. El origen de esa página (la API simulada en su puerto) se deja pasar en `context.route`, solo en ese test.

  «Evento desconocido» exige **cero**.
- **Escenarios lentos**: «Avance largo» espera de verdad 150 s (`test.setTimeout(200_000)`, etiqueta `@lento`). Corre en la CI dentro de la misma ejecución en serie, así que suma unos 150 s (R5). «Ocupada al enviar» usa `page.clock` para avanzar 10 s sin esperarlos.
- **«Otra interfaz de la máquina»**: elige una IPv4 no interna de `os.networkInterfaces()` (`test.skip` anotado si no la hay). Para la web de la pila y arranca por turno `pnpm --filter @franca/web dev` y `start` en el 3000. Comprueba conexión rechazada en esa dirección y respuesta en `127.0.0.1:3000`, y después restaura la pila. En la variante `dev` comprueba además, contra el puerto real y **solo con `Host: evil.example`** (con un `Host` local se abriría el inspector si faltara el parche), que `/__nextjs_attach-nodejs-inspector` da 403 y que no aparece ningún puerto nuevo en escucha (D26).

### D21. Turbo, raíz y CI

- `turbo.json`:
  - `@franca/web#dev`: `{dependsOn: ["^build"], cache: false, persistent: true, passThroughEnv: ["FRANCA_API_URL"]}`.
  - `@franca/web#test:e2e`: `{dependsOn: ["^build", "build", "@franca/api#build"], cache: false, passThroughEnv: ["DATABASE_URL", "CI", "PLAYWRIGHT_BROWSERS_PATH"]}`.
  - `@franca/web#test`: `{dependsOn: ["^build"], inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/apps/api/src/http/api-error.ts", "$TURBO_ROOT$/openspec/**", "$TURBO_ROOT$/packages/engine/tests/helpers/spec-text.ts"]}`. Sin esto, la caché de turbo daría por buenos los tests de paridad, de cobertura de la spec y de *fixtures* aunque cambiara lo que leen fuera de `apps/web`. `$TURBO_DEFAULT$` conserva las entradas por defecto del paquete. Los ejemplos de `packages/spec/examples/` ya entran por `^build`, porque son parte del paquete `@franca/spec` (`files`).
  - La tarea `dev` genérica no cambia ([[gotcha-turbo-filtra-variables-de-entorno]]).
  - La API tiene el mismo hueco: `apps/api/test/spec-coverage.spec.ts` lee `openspec/` y `packages/` sin declararlos como `inputs`. Queda anotado como FOLLOW-UP 7.6 y no se arregla aquí.
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

La lista se limita, como se aprobó, a **seguridad** (frontera, filtro de URLs, `message` de los `error`, transporte y proxy, marcos y `no-store`) y **concurrencia** (`If-Match` y sin reenvíos). Lo que ya cubre la guarda estática (`connection()`, *scripts* de `package.json`) no se repite como mutante.

| Mutante | Fichero | Lo mata |
|---|---|---|
| `allowJavascriptScheme`, `allowDataInImage`, `allowHttpEmbed`, `allowCredentials`, `allowRelative` | `url-filter.ts` | `url-filter.test.ts` |
| `renderRawUrl` (pinta el texto original) | `media-item.tsx` | `media-item.test.tsx` (el `src` es el `href` de `HTTPS://Example.COM/a.png`) |
| `autolinkText` (texto con enlaces) | `message-text.tsx` | `message-text.test.tsx` |
| `iframeSameOrigin` (añade `allow-same-origin allow-top-navigation`) | `media-item.tsx` | `media-item.test.tsx` |
| `skipHostCheck`, `hostSuffixMatch` (`endsWith('localhost')`), `readForwardedHost` (usa `x-forwarded-host` si viene) | `frontier.ts` | `frontier.test.ts` |
| `allowMissingOrigin`, `compareOriginToFixedHost` (con `localhost:3000`) | `frontier.ts` | `frontier.test.ts` |
| `dropFrameHeaders` (sin `frame-ancestors` ni `X-Frame-Options`), `dropNoStore` | `frontier.ts` | `frontier.test.ts` |
| `forwardBrowserHeaders` (copia las cabeceras de la petición) | `handlers.ts` | `handlers.test.ts` (integración) |
| `genericPassthrough` (ruta de la API desde la del navegador) | `operations.ts` | `handlers.test.ts` |
| `unvalidatedConversationId` | `ids.ts` | `ids.test.ts` y `handlers.test.ts` |
| `keepErrorMessage` | `responses.ts` | `responses.test.ts` |
| `useGlobalAgent` (sustituye `createConnection` por `host` y `port`) | `transport.ts` | `api-transport-env-proxy.test.ts` (muere porque la trampa recibe la conexión) |
| `showErrorMessage` | `transcript-view.ts` | `transcript-view.test.ts` |
| `noIfMatch`, `autoResendOnLoss`, `allowDoubleSend` | `conversation-session.ts` / `web-client.ts` | `conversation-session.test.ts`, `web-client.test.ts` |
| `skipInspectorPatch` (sin sustituir `inspector.open`), `skipHostGuard` (sin la guarda en `request`, `checkContinue` y `checkExpectation`), `skipUpgradeGuard` (sin la guarda en `upgrade` y `connect`), `skipUpgradeOrigin` (sin exigir el `Origin` propio en `upgrade`) | `scripts/local-only-preload.cjs` | `local-only-preload.test.ts` (`skipInspectorPatch` muere porque el middleware real de Next devuelve una URL e `inspector.url()` deja de ser `undefined`; el test mata al hijo en un `finally`, así que no queda ningún inspector vivo) |

Los demás tests negativos («no contiene», «no recibe», «no pide», paridad de códigos) se validan **una vez a mano**, provocando el caso prohibido y viendo que fallan (`testing-pyramid.md`, tasks 4.2), sin registrarlos como mutantes. La mutación se ejecuta a mano (`pnpm --filter @franca/web mutate`) y el resultado queda en el gate de la fase 4.

### D24. Sin marcos de otras páginas (delta `e88c5ed`)

`frame-ancestors 'none'` y `X-Frame-Options: DENY` en toda respuesta, desde `checkFrontier` (D2). Lo cubren `frontier.test.ts` y el E2E «El chat dentro de un marco ajeno»: una página servida por la API simulada en otro puerto con un `iframe` de la web, con la excepción de consola de D20. En `next dev`, los recursos de desarrollo de Next no pasan por `checkFrontier`, y las cabeceras de marcos se las pone el *preload* de D26 a toda respuesta del proceso.

No se añade una CSP completa: Next necesita *nonces* para sus *scripts* en línea, y ningún requisito lo pide.

### D25. Fuente del sistema en lugar de `next/font/google`

`layout.tsx` deja de importar Geist. `globals.css` usa la pila del sistema (`ui-sans-serif, system-ui, …`). Así `next build` no descarga nada (la CI ni nadie depende de Google Fonts) y el navegador no pide fuentes a terceros.

Es una decisión presentacional con efecto en la red. Va aquí porque toca la promesa de «sin Internet» de los E2E.

### D26. Guarda local dentro del proceso de Next (preload) y sin inspector

**El problema** (medido, ver la auditoría). En `next dev`, `router-server.js:387-403` atiende los recursos de desarrollo con `blockCrossSiteDEV` y `hotReloader.run` **antes** de `resolveRoutes`, así que `proxy.ts` no los ve, y `blockCrossSiteDEV` deja pasar toda petición sin `Origin`. Una página con DNS rebinding hace `GET` del mismo origen sin `Origin` y llega a:

| Recurso | Qué hace | Gravedad |
|---|---|---|
| `/__nextjs_attach-nodejs-inspector` | Abre el inspector de Node y devuelve su `devtoolsFrontendUrl` con el UUID. El inspector acepta un WebSocket con `Host: 127.0.0.1:<puerto>` y cualquier `Origin`, así que la página **ejecuta código** en el proceso de `next dev` | Crítica |
| `/__nextjs_launch-editor?file=…` | Abre el fichero en el editor y responde 204 o 404 según exista | Media |
| `/__nextjs_source-map?filename=…` | Mapas de fuentes de módulos cargados | Baja (código público) |

Un guardián delante (la revisión 2) **no lo cierra**: el `next dev` hijo, en su puerto efímero, atiende esos recursos con cualquier `Host`, y su puerto se puede localizar desde una página por tiempos.

**Solución elegida, la opción (a')**: un *preload* en el árbol de procesos de Next, sin proceso guardián.
- `apps/web/scripts/local-only-preload.cjs`, cargado con `--require` en **todo** proceso de Node que lance Next:
  1. Sustituye `open` de `node:inspector` y de `node:inspector/promises` por una función que lanza. `_interop_require_wildcard` de Next copia las propiedades del módulo **después** del *preload*, así que el middleware recibe la función sustituida.
  2. Envuelve `emit` de `http.Server.prototype` y de `https.Server.prototype` en los **cinco** eventos con los que Node entrega una petición:
     - **`request`, `checkContinue` y `checkExpectation`**: pone `Content-Security-Policy: frame-ancestors 'none'` y `X-Frame-Options: DENY` en la respuesta. Si la cabecera `host` en bruto no es local (`isLocalHost` de `src/server/config/local-host.cjs`, la misma que usa `frontier.ts`), responde `403` sin cuerpo y no emite el evento.
     - **`upgrade` y `connect`**: exige un `host` local **y** un `Origin` exactamente igual a `'http://' + host` en minúsculas. Si no, también sin `Origin`, escribe `HTTP/1.1 403` y cierra el *socket*.
     - **Por qué el `Origin` en `upgrade`**: el *websocket* de HMR no tiene CORS. Con el inspector abierto, Next manda `devtoolsFrontendUrl` (con el UUID) a todo cliente en el mensaje `SYNC` (`hot-reloader-turbopack.js:1120-1131` y `1376-1392`), además de errores de compilación y `requestInsights`. `blockCrossSiteDEV` admite siempre `localhost` y `**.localhost`, así que una página de `http://localhost:5173` mandaría `Host: localhost:3000` y leería ese canal.
     - **Sin listener de `checkExpectation`**, Node responde `417` por su cuenta sin emitir el evento y sin contenido (medido), y no hace falta guarda.
- `apps/web/scripts/local-only.mjs` es el lanzador de los *scripts* `dev` y `start`:
  1. Valida `FRANCA_API_URL` (D5) y sale con 1 sin escuchar.
  2. Añade `--require "<ruta absoluta del preload>"` al `NODE_OPTIONS` que haya, sin pisarlo.
  3. Ejecuta `next` (`next/dist/bin/next`, resuelto con `createRequire`) con los argumentos recibidos.
  4. Reenvía `SIGINT` y `SIGTERM` y termina con el código del hijo.
- *Scripts*: `"dev": "node scripts/local-only.mjs dev --hostname 127.0.0.1 --port 3000"` y `"start": "node scripts/local-only.mjs start --hostname 127.0.0.1 --port 3000"`. `next dev` escucha **directamente** en `127.0.0.1:3000` con la guarda dentro. No hay puerto interno ni proceso guardián, porque no aportaría nada más.
- `proxy.ts` se queda igual (D2): `Origin`, ruta de conversación, `no-store`, `no-referrer` y `nosniff`, y repite `Host` y marcos como defensa por si alguien ejecuta `next` sin el lanzador.

**Mediciones** (Node 22.23.3, Next 16.4.2, `next dev --hostname 127.0.0.1 --port 3456` real sobre `apps/web`, con un prototipo del *preload* en el *scratchpad*):

| Comprobación | Sin *preload* | Con *preload* |
|---|---|---|
| `GET /__nextjs_attach-nodejs-inspector` con `Host: evil.example:3456` | **200** con `devtools://…ws=127.0.0.1:9229/<uuid>`, e inspector escuchando en `127.0.0.1:9229` | **403** sin cuerpo; nada en 9229 |
| El mismo con `Host: localhost:3456` | (no se probó: abriría el inspector) | **500** sin URL (el middleware atrapa el error de `open`); nada en 9229 |
| `_interop_require_wildcard` real de Next sobre `inspector`, y `getAttachNodejsDebuggerMiddleware()` de Next llamado en un proceso con el *preload* | — | `open` lanza, el middleware responde 500 sin URL e `inspector.url()` es `undefined` |
| ¿El `--require` sobrevive al *fork* de `next-dev.js:393-416`, que reconstruye `NODE_OPTIONS`? | — | Sí. Lo cargan la CLI (`next/dist/bin/next`), `start-server.js` (el proceso `next-server`) y el *worker* de Turbopack (`pool_entry-[turbopack-node]…`). `formatNodeOptions` conserva `--require="<ruta con espacios>"` |
| Procesos que escuchan | — | Solo `next-server` en `127.0.0.1:3456`. La CLI y el *worker* de Turbopack no escuchan |
| `Host: evil.example` en `/`, `/__nextjs_launch-editor`, `/__nextjs_source-map`, `/_next/static/x`, `localhost.evil.example`, y `Host: evil.example` con `X-Forwarded-Host: localhost` | — | 403 en todos |
| *Upgrade* de HMR (`/_next/hmr`, `router-server.js:757`) con `Host` local / ajeno | — | `101` / `403` |
| Guarda v3 sobre un `http.Server` propio: `upgrade` con el `Origin` propio / `Origin: http://localhost:5173` / sin `Origin` / `Host` ajeno | `101` en los cuatro | `101` / `403` / `403` / `403` |
| Guarda v3: `POST` con `Expect: 100-continue` y un listener de `checkContinue`, `Host` ajeno / local; `CONNECT` con `Host` ajeno | `100` / `100`; `200` | `403` / `100`; `403` |
| Overlay (`POST /__nextjs_original-stack-frames` con `Origin` local), `/`, `/__nextjs_server_status`, `/__nextjs_source-map` con `Host` local, *chunks* y sus `.js.map` | — | 200, 200, 200, 204 y 200 (los mapas con `Host` ajeno, 403) |
| `frame-ancestors 'none'` y `X-Frame-Options: DENY` en `/`, en un recurso de desarrollo y en el 403 | — | Presentes en los tres |

**Tests**, en Vitest y sin Next salvo lo indicado:
- `tests/local-only-preload.test.ts` lanza un hijo `node --require scripts/local-only-preload.cjs --inspect-port=0` con un `http.createServer` propio. Comprueba:
  - La matriz de `Host` en los cinco eventos (`request`, `checkContinue` con `Expect: 100-continue`, `checkExpectation`, `upgrade` y `connect`) y las cabeceras de marcos.
  - En `upgrade`: `Origin: http://localhost:5173` da 403, el `Origin` propio da 101 y sin `Origin` da 403.
  - Que `inspector.open(0)` lanza, también desde `_interop_require_wildcard` de `@swc/helpers` (el que resuelve `next`) y desde el `getAttachNodejsDebuggerMiddleware` real de Next (500 sin URL).
  - Que `inspector.url()` es `undefined`.

  El hijo arranca con `--inspect-port=0`, así que el mutante `skipInspectorPatch` abriría el inspector en un puerto aleatorio de loopback. El test **mata al hijo en un `finally`** (también si falla o se agota el plazo, con `SIGKILL` si `SIGTERM` no basta) y comprueba que no queda ningún proceso suyo vivo, de modo que nunca queda un inspector abierto.
- `tests/local-only-launcher.test.ts` comprueba con un `next` simulado que `NODE_OPTIONS` lleva el `--require`, conserva el anterior, sale con 1 con un `FRANCA_API_URL` inválido sin lanzar `next`, y propaga señales y código. También pasa el `NODE_OPTIONS` resultante por `getParsedNodeOptions`/`formatNodeOptions` de `next/dist/server/lib/utils` (la función del *fork*) y comprueba que el `--require` sigue.
- El `next dev` real se prueba en el E2E «Otra interfaz de la máquina» (5.6): con `Host: evil.example`, el endpoint del inspector da 403 y no aparece ningún puerto nuevo en escucha.
- Mutantes `skipInspectorPatch`, `skipHostGuard`, `skipUpgradeGuard` y `skipUpgradeOrigin` (D23).

**Coste**: dos ficheros pequeños (*preload* y lanzador) y `isLocalHost` en un `.cjs` compartido (`module.exports = { isLocalHost }` explícito). El inspector de Node queda **desactivado** en la web:
- El botón «adjuntar el depurador de Node» de las herramientas de desarrollo de Next responde 500.
- **`next start --inspect` deja de funcionar**: `next-start.js:91` llama a `inspector.open`, que lanza, y Next sale con 1 («Failed to start the Node.js inspector»).
- **No se recomienda `NODE_OPTIONS=--inspect`**: abre el inspector al arrancar sin pasar por `open`, y Next manda entonces su URL con el UUID por el *websocket* de HMR. La guarda de `Origin` cierra ese canal a otras páginas, pero el inspector queda abierto en `127.0.0.1:9229` para **cualquier proceso local** durante toda la sesión.
- No hay una forma recomendada de depurar el servidor de la web con el inspector. Quien lo active (`NODE_OPTIONS=--inspect` u otra) lo hace a sabiendas, sin otras páginas abiertas, y lo cierra al terminar. `apps/web/README.md` lo dice como **advertencia**, no como receta.

**Descartado**:
- **(a) Solo neutralizar `inspector.open`**: deja `launch-editor` (oráculo de ficheros y efecto lateral), los mapas de fuentes y cualquier recurso futuro con un `Host` ajeno, y sin marcos en los recursos de desarrollo.
- **Guardián delante** (revisión 1): no cubre el puerto real de `next dev`.
- **`allowedDevOrigins`**: el rebinding no lleva `Origin`.
- **Un `pnpm patch` de Next**: se rompe en cada versión.
- **`next build && next start` como dev**: sin HMR.

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

`offset` por defecto es 0. **Cuerpo del navegador**: solo en los dos `POST`. En `POST /api/conversations`, el cliente manda `{"flowId"}` si el campo «Identificador de contacto» está vacío (`''`) y `{"flowId","contactId"}` con el valor tal cual si no lo está. Cabeceras hacia la API, siempre las mismas: `Host: <host de FRANCA_API_URL>` y `Connection: close`. Con cuerpo, además `Content-Type: application/json` y `Content-Length`. En las entradas, además `If-Match`. Nada más.

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
| `DELETE /api/conversations/:id` | 204 | **sin cuerpo** (como la API) | el estado: el cliente da `{ok: true, status: 204, body: null}` y navega a `/` |

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
| 403 | — (sin cuerpo) | Frontera | `Host` no local; `Origin` ausente u otro en `POST`/`DELETE` | Se lee por su estado (`unknown`), y el chat muestra el genérico del contexto. La propia web no lo provoca |
| 4xx/5xx | — (sin cuerpo) | API o Next | Error de la API sin un `error` legible, o un 405 de Next | El mismo estado sin cuerpo y, en el cliente, `unknown`: genérico del contexto, **nunca** `network_error` |
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
| — | `network_error` | Navegador | **Solo** un `fetch` rechazado, abortado o con plazo agotado | Como `api_unreachable` |
| 2xx | `invalid_api_response` | Navegador | Un 2xx distinto de 204 sin JSON | Genérico |
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
| `src/server/frontier.ts` (+ test) | `checkFrontier` y `SECURITY_HEADERS` (lee solo `host` en bruto) |
| `src/server/config/local-host.cjs` (+ `local-host.test.ts`) | `isLocalHost`, compartida por `frontier.ts` y el *preload* (CommonJS, para que la cargue `--require` en cualquier Node 22) |
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
| `src/lib/chat/api-types.ts`, `events.ts`, `url-filter.ts`, `transcript-view.ts`, `conversation-session.ts`, `first-advance.ts`, `copy.ts`, `paged-list.ts`, `format.ts`, `known-types.ts` (+ tests de los que tienen lógica) | Modelo del chat (D10-D13) y listas de tipos conocidos con paridad (D10) |
| `src/hooks/use-conversation-session.ts`, `use-paged-list.ts`, `use-start-conversation.ts` | Adaptadores de React |
| `src/components/chat/home-screen.tsx`, `contact-field.tsx`, `flow-list.tsx`, `conversation-list.tsx`, `list-state.tsx`, `conversation-screen.tsx`, `conversation-header.tsx`, `message-list.tsx`, `flow-message.tsx`, `message-text.tsx`, `media-item.tsx`, `user-message.tsx`, `typing-indicator.tsx`, `pending-question.tsx`, `text-question.tsx`, `single-choice-question.tsx`, `multiple-choice-question.tsx`, `answer-reason.tsx`, `end-notice.tsx`, `conversation-notice.tsx`, `test-details-panel.tsx`, `technical-activity.tsx`, `delete-conversation-dialog.tsx`, `conversation-loading.tsx`, `conversation-not-found.tsx` (+ tests de marcado de `message-text`, `media-item`, `pending-question`, `end-notice` y `test-details-panel`) | Pantallas y componentes |
| `src/components/ui/button.tsx`, `notice.tsx` | Genéricos |
| `scripts/local-only.mjs` (lanzador), `scripts/local-only-preload.cjs` (+ `tests/local-only-launcher.test.ts`, `tests/local-only-preload.test.ts`), `scripts/mutate.mjs` | D5, D26, D23 |
| `tests/static-guard.test.ts`, `api-error-codes-parity.test.ts`, `spec-coverage.test.ts`, `spec-text-parity.test.ts`, `flow-fixtures.test.ts`, `api-transport-env-proxy.test.ts`, `hostile/env-proxy.hostile.ts`, `helpers/spec-text.ts`, `helpers/fake-api.ts`, `mutations.json` | D19, D22, D23 |
| `vitest.config.ts`, `vitest.hostile.config.ts`, `playwright.config.ts` | Configuración de tests |
| `e2e/support/{stack,database,processes,api-shapes,admin,browser,test}.ts`, `e2e/fixtures/flows/{pregunta,saludo-contacto,hola,preguntas,medios}.json`, `e2e/{home,conversation-page,questions,rhythm,concurrency,lifecycle,frontier,accessibility,fake-api-shapes}.e2e.ts` | D20 |

**Modificados en `apps/web`**: `package.json` (*scripts*, dependencias y `mutate`), `eslint.config.mjs` (restricciones de D4, D13 y D17), `.gitignore` (`/test-results`, `/playwright-report`, `/blob-report`), `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` (fuente) y `README.md` (qué es, cómo se arranca y se prueba, y la advertencia sobre el inspector de D26). Se **borran** los SVG de plantilla de `public/` (`file`, `globe`, `next`, `vercel` y `window`). `next.config.ts` y `tsconfig.json` **no cambian**.

**Fuera de `apps/web`** (cada uno con su porqué):

| Fichero | Cambio |
|---|---|
| `turbo.json` | Las tres tareas de D21 (`dev`, `test:e2e` y `test` con `inputs`) |
| `package.json` (raíz) | `test:e2e` con `--concurrency=1` (D21) |
| `pnpm-lock.yaml` | Las dependencias de D18 |
| `.github/workflows/ci.yml` | Instalación de Chromium y artefactos si falla (D21) |
| `CLAUDE.md` | `FRANCA_API_URL` (solo el nombre), comandos de la web (`test`, `test:e2e` e instalar Chromium) y fila de la web en la tabla |
| `.claude/rules/always/gotchas.md`, `.claude/rules/frontend/architecture.md`, `.claude/rules/always/knowledge-wiki.md`, `.claude/wiki/*.md` (nuevos) | Fase 6 |
| `.claude/rules/README.md` | La fila de `frontend/architecture.md` pasa a declarar su respaldo: Vitest en `pnpm check` (guarda estática, paridad, cobertura) y Playwright en `test:e2e` (fase 6) |
| `openspec/changes/web-chat/**` | Este cambio |

**Cero ficheros en `apps/api/` y `packages/`.** La paridad y la cobertura **leen** `apps/api/src/http/api-error.ts`, `packages/engine/tests/helpers/spec-text.ts` y `packages/spec/examples/` sin tocarlos.

**Criterio que hace fallar el PR** (gate 6.5, antes de abrir el PR): estos dos comandos no imprimen nada.

```bash
git diff --name-only main...HEAD -- apps/api packages
git diff --name-only main...HEAD | grep -v -E '^(apps/web/|openspec/|\.claude/wiki/|\.claude/rules/(README|always/(gotchas|knowledge-wiki)|frontend/architecture)\.md$|turbo\.json$|package\.json$|pnpm-lock\.yaml$|\.github/workflows/ci\.yml$|CLAUDE\.md$)'
```

Un fichero nuevo fuera de esa lista exige una decisión explícita en este documento antes del PR.

## Coherencia (checklist)

- [x] Cada campo de respuesta que lee la web está en la tabla de 2xx. Los que pasan sin uso (`revision`, `createdAt` y `updatedAt` de `FlowSummary`; `revision`, `processing`, `error`, `costUsd`, `costLimitReached`, `createdAt` y `expiresAt` del listado) son de la API, la web no los genera, y los quita cuando reduce (versión).
- [x] Cada llamada del navegador tiene su ruta y cada ruta su operación. El comodín no llama a nada.
- [x] Tipos de eventos desde `@franca/engine`, de flujo desde `@franca/spec`. El patrón de `id` se importa (`schema.$defs.id.pattern`). La web solo declara las formas de los recursos de la API (`api-types.ts`), y las comprueba `fake-api-shapes.e2e.ts`.
- [x] Cada error de la API tiene manejo, aunque sea el genérico del contexto. Los códigos desconocidos son genéricos y la lista espejada tiene test de paridad. Las respuestas sin cuerpo (el 204 de `DELETE`, los 403 de la frontera, un 4xx/5xx sin `error`) se leen por su estado y nunca como `network_error` (D8, D9).
- [x] Permisos: no hay usuarios. La frontera (`Host` en bruto y `Origin`) se aplica a toda ruta y a toda mutación en `next start`. En `next dev`, el *preload* (D26) aplica `Host` y marcos a toda petición del proceso, recursos de desarrollo incluidos, y `proxy.ts` el resto. El navegador no puede borrar contactos ni tocar flujos (ocho operaciones).
- [x] Constantes espejadas con paridad: `API_ERROR_CODES` (texto de la API), los motivos (`INVALID_ANSWER_REASONS` del motor), los *fixtures* de flujos (texto de la spec) y las listas de tipos conocidos en ejecución (`KNOWN_INPUT_TYPES` y `KNOWN_CONTENT_KINDS` frente a los `enum` del esquema de `@franca/spec`; `KNOWN_EVENT_TYPES` con exhaustividad de tipos frente a `EngineEvent['type']`, D10).
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

Son 3 en Vitest y 60 en Playwright: 63 en total, uno por escenario, con el título exacto (D22). Recalculado en la revisión 2: el reparto no cambia. «Borrar y cancelar» ejerce ahora el 204 de punta a punta, y «Otra interfaz de la máquina» y «Direcciones no admitidas» paran y restauran la web de la pila única. Los requisitos sin escenario propio en el E2E también tienen unit tests:
- «Respuestas del usuario»: la etiqueta, la desaparición y el `draft`.
- «Una respuesta a la vez»: el cerrojo y la relectura.
- «Peticiones de la web a la API»: los plazos.
- «Sin caché de datos»: `connection()`.
- «Privacidad en la web»: ESLint y el registro.

## Riesgos / Trade-offs

- **R1. Next 16 cambia el enrutado de `%2F`**. Si Next decodificara `%2F` antes de enrutar, `..%2F..%2Fflows%2Fhola` podría acabar en otra ruta. Mitigación: el paso 3 de la frontera (D2) valida el segmento antes de enrutar, y el comodín nunca llama a la API. Lo cubre «Id de conversación con una ruta dentro» contra `next start`.
- **R2. `Cache-Control` en otros caminos de Next**. Algunos caminos de `base-server.js` fijan `private, no-cache, no-store, …` incondicionalmente. Contienen `no-store`, y el test acepta cualquier valor que lo contenga. Si Next quitara `no-store` en algún camino, falla «Conversación creada fuera del chat».
- **R3. `next dev` frente a `next start`**. Los E2E corren contra el *build*. En `next dev`, los recursos de desarrollo de Next se atienden antes de `proxy.ts` (`router-server.js:387-403`, `hot-reloader-turbopack.js:963-975`), y los cubre el *preload* de D26 en el *socket* (medido). La guarda depende de que Next siga creando su servidor con `http.createServer` (`start-server.js:229-232`) y el inspector con `inspector.open`. Si una versión futura cambiara eso, fallarían el test del *preload* (que ejecuta el middleware real de Next) o el E2E de `dev`. El resto de `next dev` lo ejercen «Otra interfaz de la máquina» y la verificación manual (6.4). Si `next dev` bloquea recursos al abrir la web por `127.0.0.1`, se documenta usar `localhost` (FOLLOW-UP 7.4).
- **R4. El proxy del entorno solo se prueba en el transporte**. Sin entorno hostil en los E2E (simplificación aprobada), una petición del servidor de la web que no pasara por `transport.ts` y obedeciera al proxy no se vería en los E2E. Mitigación: ESLint y la guarda estática prohíben `fetch` y `node:http` fuera de `transport.ts`, y el hijo de Vitest con `useGlobalAgent` cubre el transporte.
- **R5. Duración de los E2E en la CI**. Un solo *worker* en serie con unos 60 escenarios con Chromium, la API y la web, más los 150 s de «Avance largo» en la misma ejecución. Se mide en el *runner*, nunca en el portátil (`lecciones-equipo`), y se anota en el PR (FOLLOW-UP 7.2).
- **R6. Una transcripción muy larga**. Se lee entera en páginas de 100. Una conversación de miles de entradas tarda en abrirse, y en una herramienta de prueba es aceptable. No hay tope en esta feature.
- **R7. `<Activity>` conserva el DOM oculto**. La conversación anterior sigue en el documento con `display: none` (hasta 3 rutas). Las comprobaciones de «la página no contiene» de los E2E se hacen sobre la página recién cargada o sobre el texto **visible**. No es almacenamiento del navegador.
- **R8. Contenido de terceros**. Imágenes, audio, vídeo y marcos del flujo piden a esos servidores (la IP y el momento de quien prueba), y el marco ejecuta *scripts* en un origen opaco. Es inherente a probar el flujo (propuesta). Sin `Referer`, la URL de la conversación no sale.
- **R9. La extracción por texto de `API_ERROR_CODES`**. Si la API reescribe la declaración, el test falla en vez de pasar en verde (exige 20 o más). Se corrige el extractor en el mismo PR que el cambio de la API.
- **R10. Lo que queda abierto tras D26**. No hay puerto interno: `next dev` y `next start` escuchan solo en `127.0.0.1:3000` y rechazan un `Host` ajeno en todo el proceso, como hace la API (`local-only.ts:16-31`), así que un DNS rebinding no llega a ningún recurso. Sigue abierto:
  - (1) **Una página servida desde otro puerto de `localhost`** (otra herramienta de desarrollo de la máquina, p. ej. `http://localhost:5173`) manda `Host: localhost:3000`, que es local, y un `Origin` que `blockCrossSiteDEV` admite. Lo único que le queda es **provocar** `GET /__nextjs_launch-editor` (abrir un fichero en el editor) **sin leer la respuesta**, que no tiene CORS. No puede leer el *websocket* de HMR (la guarda exige el `Origin` propio en `upgrade`) ni abrir el inspector (`open` lanza). Se acepta: es un efecto lateral sin datos, provocado por código que ya corre en la máquina.
  - (2) **Un proceso local** puede usar la web y la API como hoy (propuesta) y abrir el inspector con `SIGUSR1`, que requiere ser el mismo usuario.
  - (3) **Arrancar `next` sin el lanzador** (`pnpm exec next dev`) se salta el *preload*. La guarda estática obliga a que los *scripts* pasen por él, `pnpm dev` lo usa (turbo ejecuta el *script*), y `proxy.ts` sigue aplicando `Host` y `Origin` a lo que no es de desarrollo.
  - (4) **`--experimental-https`** usaría `https.Server`. El *preload* también lo envuelve, pero no se prueba con certificados: la guarda estática prohíbe esa opción en los *scripts*.

## Open Questions

Resueltas por el orquestador dentro del flujo autónomo «de corrido» que acordó el usuario, que solo se para ante decisiones de producto. **El usuario puede revertir cualquiera**:
- El delta `e88c5ed` (sin marcos).
- `test:e2e` serializado.
- «Avance largo» en la misma ejecución en serie de cada PR.
- Las simplificaciones de la revisión 2 (una pila, sin entorno hostil, mutantes recortados).

Nada pendiente de aprobación. D26 es una decisión técnica sin efecto de producto. Su único coste visible es que el botón de adjuntar el depurador de Node de las herramientas de desarrollo de Next deja de funcionar, con la alternativa documentada.
