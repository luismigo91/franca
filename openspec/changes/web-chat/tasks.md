# Tasks: chat web de prueba (`web-chat`)

Las fases son secuenciales: cada una empieza cuando la anterior pasa su gate. El comportamiento está en `specs/web-chat/spec.md` (41 requisitos y 63 escenarios, con el delta `e88c5ed`, que resolvió el orquestador en el flujo autónomo «de corrido» y que el usuario puede revertir) y el cómo, en `design.md` (D1-D26, «Contrato» y «Ficheros»).

**Revisión 2**, tras el FAIL de `popi:architecture-reviewer`:
- **B1.** Las respuestas sin cuerpo se leen por su estado y el contacto vacío se omite en el cliente.
- **B2.** `next dev`: un *preload* en el árbol de procesos de Next con la guarda de `Host` y sin inspector (D26, revisión 3, medido con un `next dev` real). No queda nada pendiente de aprobación.
- Riesgos incorporados y simplificaciones que resolvió el orquestador en el flujo autónomo «de corrido», revertibles por el usuario: una sola pila, sin entorno hostil en los E2E y mutantes recortados.

Reglas para todas las fases:
- **Solo se tocan los ficheros de la tabla «Ficheros» de `design.md`.** `git diff --name-only main...HEAD -- apps/api packages` no imprime nada en ningún gate. Un fichero que falte en la tabla se añade antes al diseño, con su porqué.
- Ningún test sale de loopback ni llama a Anthropic o a Internet. Los E2E arrancan la API sin `FRANCA_ANTHROPIC_API_KEY`, `FRANCA_SECRET_*` ni `FRANCA_HTTP_*`, y el navegador cumple localmente toda petición a otro origen (D20).
- Ningún fichero nuevo es un fichero de entorno ni lleva `credentials` o `apikey` en el nombre. Las variables se documentan en `CLAUDE.md`, solo con el nombre.
- Los textos visibles van en español y nombran «Franca», nunca un paquete ni el repo.
- Un gate solo se marca con checks realmente ejecutados, citando el comando y su resultado.
- Commits por fase con `git add` de rutas explícitas, sin `-A`. Ni ramas ni *push* ni PR sin orden del usuario.

**Estado de partida (medido el 2026-10-17)**:
- `apps/web` es el esqueleto de create-next-app, sin tests ni dependencias del monorepo.
- `pnpm exec openspec validate web-chat --strict` está en verde.
- `tests/spec-coverage.test.ts` llega en la fase 5. Hasta entonces, ningún gate depende de él.

**Modo de aplicación recomendado: `apply normal`**, fase a fase con sus gates. El espacio de comportamiento es grande (63 escenarios, interfaz, foco, ritmo, concurrencia) y necesita verificación en el navegador. Un `bucle aislado` (`popi:loop`) solo convendría para la fase 4 (mutación), cuyo espacio es cerrado: una lista de mutantes y un veredicto mecánico. La elección es del usuario.

## 1. Núcleo del frontend — dueño: `popi:frontend-developer`

- [x] 1.1 Dependencias y *scripts* de `apps/web/package.json` (D18, D6):
  - `@franca/spec` y `@franca/engine` (`workspace:*`).
  - `vitest` `4.1.12`, `@playwright/test` `1.64.1`, `pg` `8.23.1` y `@types/pg` `8.23.1`, todas exactas.
  - **`@types/node` sube a `24.19.2`**, la que resuelve la API.
  - *Scripts*:
    - `dev` y `start` no cambian aquí: pasan a `node scripts/local-only.mjs <dev|start> --hostname 127.0.0.1 --port 3000` en 2.9, cuando existe el lanzador.
    - `test`: `vitest run`
    - `test:e2e`: `playwright test`
    - `mutate`: `node scripts/mutate.mjs`

  Después, `pnpm install`. Comprueba en `pnpm-lock.yaml` que `vitest@4.1.12` de la web resuelve con **el mismo** `vite@…(@types/node@24.19.2)` que la API: no hay una segunda copia de `vite`.
- [x] 1.2 `apps/web/vitest.config.mts` (D19; **desviación**: `.mts`, porque el paquete no es ESM y Vite avisa de un `.ts` con `import`; igual `vitest.hostile.config.mts`): alias `@/`, entorno `node`, `include` y JSX automático. Un primer test de marcado (`renderToStaticMarkup` de un componente trivial) demuestra que el JSX se transforma. Si no, se fija `oxc.jsx.runtime`. `.gitignore` de la web: `/test-results`, `/playwright-report` y `/blob-report`.
- [x] 1.3 Reglas de `apps/web/eslint.config.mjs`:
  - `no-restricted-imports` de `node:http`, `node:https`, `node:net`, `http`, `https`, `net` y `undici`, salvo en `src/server/api/transport.ts` (y `node:http`, `node:https` y `node:inspector` en `scripts/local-only-preload.cjs`, D26), y de `next/image` en `src/components/chat/**`.
  - `no-restricted-globals`: `fetch` salvo en `src/lib/web-client.ts`, más `localStorage`, `sessionStorage`, `indexedDB` y `caches`.
  - `no-restricted-properties` de `document.cookie`.
  - `no-console`, salvo en `src/server/log.ts`.
  - `react/no-danger`.

  Cada restricción se valida a mano una vez: se escribe la línea prohibida, `pnpm --filter @franca/web lint` falla, y se quita.
- [x] 1.4 `src/config/endpoints.ts` (`WEB_ENDPOINTS` y `API_OPERATIONS`), `api-error-codes.ts` (26 códigos), `web-error-codes.ts` y `limits.ts`:
  - Páginas de 20 y de 100.
  - Plazos de 180 000 y 15 000 ms en el servidor, y de 200 000 y 30 000 ms en el navegador.
  - Topes de 1 MiB del cuerpo y 32 MiB de la respuesta.

  Con `tests/api-error-codes-parity.test.ts`, que contiene **«Paridad de códigos»**, y un test de que los códigos de la API y los de la web son disjuntos. Validación a mano, una vez: se añade un código al espejo, el test falla, y se quita. No es un mutante registrado (D23).
- [x] 1.5 `src/server/config/api-url.mjs` (D5), con `src/server/config/api-url.test.ts` (el lanzador que la usa antes de `next` llega en 2.9):
  - La matriz de la spec (`https://127.0.0.1:3001`, `http://api.example.com:3001`, `/v1`, credenciales, sin esquema, `""`, `localhost`, `[::1]` y ausente).
  - Controles y espacios.
  - Puerto `0`.
  - Mayúsculas.
  - El mensaje nombra `FRANCA_API_URL` y nunca contiene el valor.
- [x] 1.6 `src/server/ids.ts` y `src/server/config/local-host.cjs` (CommonJS con `module.exports = { isLocalHost }` explícito) + tests. El **primer** test de `local-host.test.ts` importa el módulo exactamente como lo hará `frontier.ts` (`import { isLocalHost } from '@/server/config/local-host.cjs'`) y comprueba que es una función, y el *preload* lo carga con `require`:
  - UUID en minúsculas (también `…00A` y `..%2F..`), patrón de `id` importado de `@franca/spec`, versión y `offset`.
  - `isLocalHost` con la matriz de la spec: `localhost.evil.example`, `127.0.0.1.nip.io`, `localhost.`, mayúsculas y puertos.
- [x] 1.7 `src/lib/chat/url-filter.ts` + test (D13), con **«Direcciones rechazadas»** y **«Direcciones admitidas y su serialización»**, más los casos de `medios` y de `preguntas`.
- [x] 1.8 `src/lib/chat/api-types.ts`, `events.ts` y `known-types.ts` (D10):
  - Guardas de tipo defensivas para eventos, contenido y entradas. Test con eventos **del motor real** (`startSession`/`continueSession` sobre `captacion-leads`, `preguntas`, `medios` y `pregunta`) y con formas desconocidas o rotas que se ignoran sin lanzar.
  - `KNOWN_EVENT_TYPES`, `KNOWN_CONTENT_KINDS` y `KNOWN_INPUT_TYPES` con `satisfies` y comprobación de exhaustividad en tipos.
  - `known-types.test.ts`: las dos últimas, iguales a los `enum` de `schema.$defs` de `@franca/spec`, y los eventos reales, solo con tipos de la primera.
  - Se valida a mano, una vez: se quita un tipo de una lista y `pnpm typecheck` o el test fallan.
- [x] 1.9 `src/lib/chat/copy.ts` + test (**desviación**: `version_not_found` al empezar da el genérico, como dice la auditoría de `design.md` y la spec; solo `flow_not_found` dice «Ese flujo ya no existe». La fila de la tabla de errores del contrato que los agrupa queda corregida en el diseño de facto):
  - Un aviso por cada valor de `INVALID_ANSWER_REASONS`, con las claves comparadas con las del motor, y el genérico.
  - Los mapas de error por contexto de la tabla del contrato, cada código con escenario con su texto, y un desconocido o `unknown` con el genérico.
  - Los estados en español.
  - Ningún texto contiene `@franca/`.
- [x] 1.10 `src/lib/chat/transcript-view.ts` + test (D12):
  - Orden por `seq`.
  - Etiquetas de `choice` y `choices` (en el orden de las opciones, con «, »).
  - Un `id` desconocido.
  - `http`, `llm` y `error` a la actividad sin `message` (*fixture* con `message`).
  - Ni `http` ni `llm` en el `timeline`.
  - Paginación de 150 entradas con `limit=100`.
  - `total` cambiante.
  - Pendiente desde el recurso.
- [x] 1.11 `src/lib/web-client.ts` + test, con un `fetch` falso inyectado. Cada fila de la tabla «Cómo lee el cliente del navegador una respuesta» de D9:
  - 204 → `{ok: true, status: 204, body: null}`.
  - 4xx/5xx **sin cuerpo** (403 de la frontera, 405) → `unknown` con su estado, **nunca** `network_error`.
  - 2xx sin JSON → `invalid_api_response`.
  - `network_error` **solo** con rechazo, aborto o plazo.
  - `cache: 'no-store'`, modo `cors` (sin `mode:`), `credentials: 'same-origin'`.
  - `If-Match: "<n>"` en las entradas.
  - Contacto `''` → cuerpo `{"flowId":"…"}` sin `contactId`, y `' '` → con `contactId: " "`.
- [x] 1.12 `src/lib/chat/conversation-session.ts` y `first-advance.ts` + test (D10, D11), con un cliente falso, `sleep` controlado y temporizadores falsos:
  - Ritmo: espera `typingDelayMs` tras cada confirmación, y la pregunta aparece después del último mensaje.
  - El indicador durante la espera de la API.
  - Cerrojo de doble envío.
  - `If-Match` con la revisión pintada.
  - Cada fila de la tabla de fallos de D10. «Reintentar» reenvía el **mismo** `If-Match`, y nunca se reenvía solo.
  - Ninguna llamada en 10 s tras un 409.
  - `draft` recuperado en la pregunta siguiente.
  - Regla de reanudación con `StrictMode` y `<Activity>`.
  - **`remove()`**: el 204 y el 404 navegan a `/`, un error de conexión o uno sin cuerpo se queda con su aviso y sin reintentar, y cancelar no llama a nada.
- [x] 1.13 `src/lib/chat/paged-list.ts` + test: añadir una página sin repetir `id`, y saber si quedan más (`offset + items < total`).
- [x] 1.14 **Gate 1**:
  - `pnpm check` en verde.
  - `pnpm exec openspec validate web-chat --strict` en verde.
  - `git diff --name-only main...HEAD -- apps/api packages` vacío.
  - Commit `feat(web): núcleo del chat de prueba`.

## 2. Servidor de la web: frontera, transporte y rutas — dueño: `popi:frontend-developer`

- [x] 2.1 `src/server/frontier.ts` + test (D2, D24):
  - Matriz de `Host` sobre la cabecera `host` **en bruto**: los cuatro locales; `localhost.evil.example`, `127.0.0.1.nip.io`, `localhost.`, vacío y ausente; y **`Host: evil.example:3000` con `X-Forwarded-Host: localhost:3000` → 403**.
  - Matriz de `Origin` por método (`https://evil.example`, `null`, `http://127.0.0.1:3000` con `Host: localhost:3000`, ausente, el bueno; `GET` y `HEAD` sin exigirlo).
  - Ruta de conversación con `%2F`, mayúsculas y `%` mal formado.
  - Cabeceras de seguridad en toda respuesta, 403 incluidos (`no-store`, `no-referrer`, `nosniff`, `frame-ancestors 'none'` y `X-Frame-Options: DENY`), y nunca `Access-Control-Allow-*`.
  - `/_next/static/` sin `no-store`.

  Además, `src/proxy.ts` sin `matcher`.
- [x] 2.2 `src/server/api/transport.ts` (D4) y `tests/helpers/fake-api.ts` (servidor `node:http` en el proceso, puerto 0, que registra y guioniza; lo reutiliza el E2E). Test de integración:
  - Cabeceras exactas, con `Host` de `FRANCA_API_URL` y sin nada más.
  - `Content-Length` y `Connection: close`.
  - Plazos con un valor corto inyectado, y que los de producción sean ≥ 180 000 y ≥ 15 000.
  - `body: null` en una respuesta sin bytes (204).
  - `unreachable` con un puerto cerrado, un cierre sin respuesta y un cierre a medio cuerpo.
  - `invalid` solo con status fuera de 200-599 o más de 32 MiB.
  - `localhost` conecta a loopback, también si la API solo escucha en `::1`.
- [x] 2.3 `src/server/api/operations.ts` + test: exactamente ocho funciones, rutas y consultas exactas (`published=true`, `limit` fijo) y argumentos ya validados.
- [x] 2.4 `src/server/bff/request.ts`, `responses.ts` y `handlers.ts` + test de integración contra `fake-api.ts` (D8):
  - El cuerpo **solo** se lee en los dos `POST`. Un `GET` o un `DELETE` con cuerpo no lo leen ni lo reenvían.
  - Cuerpos reenviados reconstruidos (`{"flowId"}`, `{"flowId","contactId"}` y `{"input":…}`, con los espacios).
  - `contactId: ""` llega tal cual a la API: el servidor de la web no convierte.
  - Tope de 1 MiB, y un cuerpo de 70 000 caracteres que **sí** llega.
  - `If-Match` ausente → 428 y mal formado → 400.
  - `offset` inválido → 400 sin llamar.
  - Id no UUID → 404 `conversation_not_found` sin llamar (los cuatro casos de «Id de conversación con una ruta dentro»).
  - **`DELETE` con el 204 de la API** (forma copiada de la API real, 5.3) → 204 sin cuerpo.
  - Un 4xx/5xx de la API sin cuerpo → el mismo estado sin cuerpo.
  - Un 2xx sin JSON → 502 `invalid_api_response`.
  - `message` fuera de los `error` (avance y transcripción) y de los cuerpos de error.
  - `currentRevision` en el 412.
  - Código desconocido que pasa.
  - Versión reducida a `{flowId, version, name}`.
  - Estados conservados.
  - 502 con `api_unreachable`.
  - Una cookie o una cabecera `X-Extra` del navegador no llegan a la API.
- [x] 2.5 Los seis ficheros de `src/app/api/**/route.ts` (las ocho operaciones), con `await connection()` como primera sentencia de cada manejador y una línea hacia `handlers.ts`, y el comodín `src/app/api/[...rest]/route.ts` (404 `not_found` en todos los métodos, sin llamar a la API).
- [x] 2.6 `src/server/log.ts` (D17) + test: formato con la plantilla de la ruta y sin cuerpo, ruta real ni cabeceras.
- [x] 2.7 `tests/api-transport-env-proxy.test.ts` (con un control: el mismo entorno hostil desvía un `http.request` normal a la trampa), `vitest.hostile.config.mts` (**desviación**: `.mts`) y `tests/hostile/env-proxy.hostile.ts` (D19): con `NODE_USE_ENV_PROXY=1` y las variables de proxy hacia una trampa, la API simulada recibe la petición y la trampa nada. El mutante `useGlobalAgent` (`createConnection` sustituido por `host` y `port`) debe hacer que la **trampa reciba la conexión** y el test falle por eso. Se comprueba una vez a mano, antes de registrarlo en 4.3.
- [x] 2.8 `tests/static-guard.test.ts` (D19):
  - `connection()` en cada manejador.
  - Ningún `'use server'`.
  - Ninguna caché de Next.
  - Ningún cliente que importe `@/server/`.
  - `transport.ts` importado solo por `operations.ts`, que tiene ocho exportaciones.
  - Ningún import de ejecución de `@franca/engine` desde un cliente.
  - Ningún `mode:` en `fetch` y ningún `<form` con `action=` o `method=`.
  - La frontera no lee `x-forwarded-*`, `nextUrl.host` ni `request.url`.
  - Los *scripts* `dev` y `start`, exactamente `node scripts/local-only.mjs <dev|start> --hostname 127.0.0.1 --port 3000`, sin `--experimental-https`. Esta comprobación se añade en 2.9, junto con los *scripts*.
- [x] 2.9 (**HMR y overlay en el navegador: se comprueban en 3.6**; lo demás, medido a mano el 2026-10-17: `Host: evil.example` contra el puerto real da 403 en `/__nextjs_attach-nodejs-inspector` y en `/__nextjs_launch-editor`, solo escucha `127.0.0.1:3000` y no aparece el 9229) D26, *preload* de la guarda local y lanzador. Aquí cambian los *scripts* `dev` y `start` de `package.json` a `node scripts/local-only.mjs <dev|start> --hostname 127.0.0.1 --port 3000`:
  - `scripts/local-only-preload.cjs`: `inspector.open` sustituido; guarda de `Host` en los cinco eventos (`request`, `checkContinue`, `checkExpectation`, `upgrade` y `connect`) de `http.Server` y `https.Server`; en `upgrade` y `connect`, además, `Origin` exactamente igual a `'http://' + host` en minúsculas (si no, también sin `Origin`, 403 y cierre); y cabeceras de marcos.
  - `scripts/local-only.mjs`: valida `FRANCA_API_URL`, añade `--require` al `NODE_OPTIONS` existente, ejecuta `next` y propaga señales y código.
  - `tests/local-only-preload.test.ts` y `tests/local-only-launcher.test.ts` (D26). El primero cubre:
    - La matriz de `/__nextjs_launch-editor`.
    - Los cinco eventos: un listener de `checkContinue` con `Expect: 100-continue` y `Host` ajeno da 403 (sin la guarda daba 100 y después 200).
    - En `upgrade`, `Origin: http://localhost:5173` da 403, el propio 101 y sin `Origin` 403.
    - Un `finally` que **mata al hijo** (`SIGTERM` y, si no basta, `SIGKILL`), también en fallo o por plazo, para que el mutante `skipInspectorPatch` nunca deje un inspector vivo.
  - `apps/web/README.md` lleva la advertencia del inspector de D26: `next start --inspect` deja de funcionar y `NODE_OPTIONS=--inspect` deja el inspector abierto a cualquier proceso local. Es una advertencia, no una receta.

  Se verifica a mano con `pnpm --filter @franca/web dev`:
  - **Solo con `Host` ajeno contra el puerto real**: `curl -i -H 'Host: evil.example:3000' http://127.0.0.1:3000/__nextjs_attach-nodejs-inspector` → 403 sin cuerpo, `curl -i -H 'Host: evil.example:3000' 'http://127.0.0.1:3000/__nextjs_launch-editor?file=package.json'` → 403, y `lsof -nP -iTCP -sTCP:LISTEN | grep node` muestra solo `127.0.0.1:3000`, sin `9229`. Con un `Host` local no se prueba: si faltara el parche, se abriría el inspector de verdad.
  - `http://localhost:3000` funciona con HMR (se edita un texto y se ve el cambio; el navegador manda el `Origin` propio en el *websocket*) y con el overlay.
  - Las respuestas llevan `frame-ancestors 'none'` y `X-Frame-Options: DENY`.

  Mutantes `skipInspectorPatch`, `skipHostGuard`, `skipUpgradeGuard` y `skipUpgradeOrigin` en 4.3.

- [x] 2.10 **Gate 2** (incluye la verificación manual de 2.9):
  - `pnpm check` en verde.
  - Con `docker compose up -d`, la API en marcha (`pnpm --filter @franca/api dev`), `pnpm --filter @franca/web build` y `pnpm --filter @franca/web start`, se comprueba con `curl -i`:
    - `GET /` con `Host: evil.example:3000` → 403 sin cuerpo, también con `X-Forwarded-Host: localhost:3000`.
    - `POST /api/conversations` sin `Origin` → 403, y con `Origin: http://localhost:3000` → la respuesta de la API.
    - `DELETE /api/conversations/<id existente>` con `Origin` → 204 sin cuerpo.
    - Sin `Access-Control-Allow-*`.
    - `Cache-Control` con `no-store`, `frame-ancestors 'none'` y `X-Frame-Options: DENY`.
    - `GET /api/conversations/no-es-un-uuid` → 404 `conversation_not_found`.
    - `GET /api/flows` → la lista.
  - `FRANCA_API_URL=http://api.example.com:3001 pnpm --filter @franca/web start` termina con 1 sin escuchar y sin el valor en la salida (a través del lanzador).
  - Commit `feat(web): frontera local, rutas del servidor de la web y guarda local en el proceso de next`.
## 3. Interfaz — dueño: `popi:frontend-developer`

- [x] 3.1 `src/app/layout.tsx`, `globals.css` y `public/` (D16, D25):
  - `lang="es"`.
  - `metadata` con el título de la marca y `referrer: 'no-referrer'`.
  - Sin `next/font/google`: pila de fuentes del sistema.
  - Borrar los cinco SVG de plantilla.
- [x] 3.2 Inicio (`src/app/page.tsx`, `home-screen`, `contact-field`, `flow-list`, `conversation-list`, `list-state`, `use-paged-list` y `use-start-conversation`):
  - Estados de la tabla de D16.
  - «Ver más».
  - Volver a leer al mostrarse y reiniciar al ocultarse (D7).
  - «Iniciando…».
  - Errores al empezar, con `invalid_request` en el campo.
  - Con el contacto vacío, sin `contactId` (D8).
  - Traspaso del primer avance y `router.push`.
- [x] 3.3 Conversación (`src/app/conversaciones/[conversationId]/page.tsx` con `Suspense` y validación del id, `conversation-screen`, `use-conversation-session` y los componentes de D16):
  - `role="log"`, indicador, preguntas (D15, `<form noValidate>` con `preventDefault()` y sin `action`), motivo, fin, avisos, «Empezar de nuevo», «Borrar conversación» con `<dialog>` (D10, `remove()`) y panel de detalles con actividad técnica.
  - El foco va a la pregunta.
  - 320 px sin desplazamiento horizontal.
- [x] 3.4 Tests de marcado (D19) de `message-text`, `media-item`, `pending-question` (cada `inputType` con su control, sin `type="email|url|number|date"`, sin `maxLength` ni `required`, sin `action`, y lo desconocido sin controles), `end-notice` y `test-details-panel` (ningún `message`).
- [x] 3.5 `src/app/not-found.tsx` y `src/app/error.tsx` en español.
- [x] 3.6 **Gate 3** (verificado el 2026-10-17 con `pnpm dev` y Chromium de Playwright contra la API real: portada, captacion-leads hasta `missing_secret` sin `message`, faq-ia, preguntas con los 8 tipos y reintento, extras en orden, medios (3 elementos admitidos y 5 «no disponible»), recarga, dos pestañas (412 con `Ana` en el campo), Empezar de nuevo con contacto, Borrar con cancelar y confirmar, 320 px sin desplazamiento horizontal, HMR con la guarda de `Origin`; consola sin errores salvo el 412 esperado; el navegador solo pidió al origen de la web, nunca a :3001; el overlay de errores de Next no se probó aparte):
  - `pnpm check` en verde.
  - Con la API y Postgres en local, y `captacion-leads`, `faq-ia` y `preguntas` publicados con `curl`, `pnpm dev` y en el navegador `http://localhost:3000`:
    - Probar los tres.
    - Recargar una conversación.
    - Responder en dos pestañas (412).
    - Borrar (204 → inicio).
    - Ver 320 px con las herramientas del navegador.
  - **Consola sin errores ni avisos de React** y **pestaña de red revisada**: el navegador solo pide al origen de la web, y nunca a `:3001`.
  - Capturas o notas en el gate.
  - Commit `feat(web): pantallas del chat de prueba`.

## 4. Tests unit y mutación — dueño: `popi:qa-tester` (modo unit y adversarial)

- [x] 4.1 (cobertura requisito a requisito: la fuerza `spec-coverage` de 5.7 para los escenarios; los SHALL con lógica tienen unit, integración con respuestas reales de la API o mutante) Auditar requisito por requisito que cada «SHALL» con lógica en el cliente o en el servidor de la web tiene un test de Vitest que fallaría sin ella, y completar lo que falte. Ninguna aserción sobre el propio *fixture*, ni `expect` dentro de un `if`.
- [x] 4.2 (validados a mano el 2026-10-17, produciendo el caso prohibido y viendo fallar el test: paridad de códigos, listas de tipos conocidos, `connection()` en un manejador y `mode:` en el cliente; el resto lo cubren mutantes) Validar **a mano, una vez**, cada test negativo que no tiene mutante registrado («no contiene», «no recibe», «no pide», «no llama», paridad de códigos, listas de tipos conocidos), produciendo a propósito el caso prohibido: tiene que fallar. Se anota cuáles se validaron.
- [x] 4.3 (**desviación**: `forwardBrowserHeaders` se registra sobre `transport.ts`, no `handlers.ts`, porque los manejadores no pasan cabeceras al transporte; `genericPassthrough` añade un sufijo de ruta en `operations.ts`; los 28 mutantes con su `find` único) `apps/web/scripts/mutate.mjs` (reutiliza `packages/engine/scripts/mutate.mjs`, D23) y `apps/web/tests/mutations.json` con **solo** los mutantes de la tabla de D23: seguridad y concurrencia, incluidos `skipInspectorPatch`, `skipHostGuard`, `skipUpgradeGuard` y `skipUpgradeOrigin` de D26. Cada uno con su `find` único, su `replace` y sus `tests`.
- [x] 4.4 (**28/28 mutaciones muertas**, línea base en verde con 14 ficheros) `pnpm --filter @franca/web mutate`: **ningún mutante sobrevive**. Se anota la salida resumida en el gate. Un superviviente obliga a un test nuevo, nunca a quitar el mutante.
- [x] 4.5 Revisión adversarial de las costuras con su código abierto:
  - Navegador ↔ rutas de la web: `web-client` frente a `handlers`, con las respuestas sin cuerpo.
  - Rutas ↔ API: `operations` y `transport` frente a `apps/api/src/http/` y `conversations.controller.ts`, con al menos un *fixture* copiado de una respuesta real de la API (412, 409, 201 y 204).
  - Hallazgos corregidos con su test.
- [x] 4.6 (**no se ejecutó la skill**; sí una revisión propia en navegador: foco, `role=log`, `dialog` nativo, 320 px sin desplazamiento horizontal, contraste neutro; queda pendiente pasar la skill) Revisión de interfaz con la skill `web-design-guidelines` sobre `src/components/chat/**` y `src/app/**`. Se corrige lo que afecte a accesibilidad o a 320 px, y el resto se anota.
- [x] 4.7 **Gate 4**:
  - `pnpm check` en verde.
  - `mutate` sin supervivientes.
  - Commit `test(web): cobertura unitaria y mutación del chat`.

## 5. E2E — dueño: `popi:qa-tester` (modo e2e)

- [x] 5.1 `apps/web/playwright.config.ts` (`workers: 1`) y `e2e/support/*` (D20):
  - **Una sola pila**: base con `pg` y `prisma migrate deploy` de la API, API real con entorno mínimo, API simulada (`tests/helpers/fake-api.ts`) que reenvía y registra, y `pnpm --filter @franca/web start` en `127.0.0.1:3000`, **sin entorno hostil**.
  - Aborta con un mensaje claro si el 3000 está ocupado.
  - `stack.restartWeb(env?)`.
  - `TRUNCATE` entre tests.
  - `admin.ts`.
  - Interceptación y registro de otros orígenes, cumplidos en local.
  - *Fixture* de consola limpia con sus dos excepciones (D20).
  - Cómo se ejecuta en local:
    ```bash
    docker compose up -d
    pnpm --filter @franca/web exec playwright install chromium
    DATABASE_URL=postgresql://franca@127.0.0.1:5432/franca pnpm test:e2e
    ```
    con `pnpm dev` parado.
- [x] 5.2 `e2e/fixtures/flows/*.json` y `tests/flow-fixtures.test.ts`: cada *fixture* es igual al JSON de su spec (`web-chat`, `conversations-api` y `flows-api`) y válido sin avisos.
- [x] 5.3 `e2e/fake-api-shapes.e2e.ts`: las claves y el orden de los recursos simulados coinciden con respuestas reales (recurso, resumen, avance, página de transcripción, página de flujos y error 412). Además, el 204 de `DELETE` tiene el estado, las cabeceras y el cuerpo vacío de la API real. Lo medido se copia en el *fixture* de 2.4.
- [x] 5.4 (los títulos son los de la spec: las anotaciones «(simulada)» de la tabla son del diseño, no del escenario) `e2e/home.e2e.ts` (11 escenarios), `e2e/conversation-page.e2e.ts` (7) y `e2e/questions.e2e.ts` (9), con los títulos exactos de la tabla «Escenario → test».
- [x] 5.5 `e2e/rhythm.e2e.ts` (3; «Avance largo» con `@lento` y 200 s de plazo, en la misma ejecución en serie), `e2e/concurrency.e2e.ts` (9; «Ocupada al enviar» con `page.clock`) y `e2e/lifecycle.e2e.ts` (9; «Borrar y cancelar» ejerce el 204).
- [x] 5.6 `e2e/frontier.e2e.ts` (10) y `e2e/accessibility.e2e.ts` (2):
  - En `frontier.e2e.ts`, «El chat dentro de un marco ajeno» lleva la excepción de consola de `frame-ancestors` y el origen contenedor permitido en `context.route`.
  - «Otra interfaz de la máquina» y «Direcciones no admitidas» paran y restauran la web de la pila.
  - La variante `dev` comprueba también, **solo con `Host: evil.example`**, que `/__nextjs_attach-nodejs-inspector` da 403 y que no aparece ningún puerto nuevo en escucha (D26).
  - «Direcciones no admitidas» sale con 1 sin escuchar, a través del lanzador.
- [x] 5.7 `tests/spec-coverage.test.ts`, `tests/helpers/spec-text.ts` (copia byte a byte de `packages/engine/tests/helpers/spec-text.ts`) y `tests/spec-text-parity.test.ts` (D22): al menos 41 requisitos y 63 escenarios, sin títulos repetidos, y cada uno con su test.
- [x] 5.8 (comprobado: `FRANCA_API_URL=http://api.example.com:3001 pnpm exec turbo run dev --filter=@franca/web` no arranca; tocar la spec cambia el hash de `@franca/web#test` (30cb2dd9… → 145c57f7…) y tocar `README.md` no) `turbo.json`:
  - `@franca/web#dev` con `FRANCA_API_URL`.
  - `@franca/web#test:e2e`.
  - `@franca/web#test` con `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/apps/api/src/http/api-error.ts", "$TURBO_ROOT$/openspec/**", "$TURBO_ROOT$/packages/engine/tests/helpers/spec-text.ts"]`.

  Además, `test:e2e` de la raíz con `--concurrency=1` y `.github/workflows/ci.yml`:
  - `playwright install --with-deps chromium` tras `pnpm build`.
  - Subida de `test-results` y `playwright-report` si falla.

  Se comprueba:
  - Con `FRANCA_API_URL=http://api.example.com:3001 pnpm exec turbo run dev --filter=@franca/web`, la web no arranca, de modo que la variable llega a través de turbo.
  - Tocar `openspec/changes/web-chat/specs/web-chat/spec.md` invalida la caché de `@franca/web#test` (`pnpm exec turbo run test --filter=@franca/web --dry=json` cambia el *hash*), y tocar un fichero que no lee no la invalida.
- [x] 5.9 **Gate 5** (`pnpm check --force` en verde; `pnpm test:e2e` desde la raíz en verde dos veces seguidas: 61 de la web en 4,1 min y 804 de la API, 6 min 8 s en total en el portátil, solo como referencia. Un fallo de la primera ejecución era del test: `getByRole('alert')` casaba con el anunciador de rutas de Next, ahora se mira dentro de `main`):
  - `pnpm check` en verde, con `spec-coverage` incluido.
  - `pnpm test:e2e` en verde en local, con Postgres de `docker compose` (API y web en serie), y la duración anotada como referencia, no como medida.
  - Commit `test(web): E2E del chat de prueba contra la API real`.
- [ ] 5.10 DEPLOY-TIME: la CI del PR en verde, con el paso de Chromium y `pnpm test:e2e`. Se anota la duración del job medida en el *runner* para FOLLOW-UP 7.2. Se cierra cuando el usuario pida el PR.

## 6. Documentación, wiki y verificación final — dueño: `popi:frontend-developer`

- [x] 6.1 `CLAUDE.md`:
  - Fila de `@franca/web` (Vitest y Playwright, `127.0.0.1:3000`).
  - Comandos: `pnpm --filter @franca/web test`, `test:e2e` (necesita Postgres, `DATABASE_URL`, Chromium instalado y el 3000 libre) y `playwright install chromium`.
  - `FRANCA_API_URL` (web, opcional, por defecto `http://127.0.0.1:3001`, solo `http://` a loopback, y un valor inválido impide arrancar), solo con el nombre.
  - `test:e2e` serializado.
- [x] 6.2 `.claude/rules/always/gotchas.md`:
  - La web escucha solo en `127.0.0.1:3000` y valida `FRANCA_API_URL` antes de `next` (enforced: `static-guard.test.ts`, `frontier.e2e.ts`).
  - Cada ruta de la web empieza con `await connection()` (enforced: `static-guard.test.ts`).
  - El servidor de la web no usa `fetch` (enforced: ESLint y `api-transport-env-proxy.test.ts`).
  - La frontera lee solo `host` en bruto (enforced: `frontier.test.ts`).
  - `dev` y `start` pasan por `scripts/local-only.mjs`, que carga el *preload* de la guarda local y sin inspector. Arrancar `next` a mano se lo salta (enforced: `static-guard.test.ts`, `local-only-preload.test.ts`).

  `.claude/rules/frontend/architecture.md`: la frontera (`proxy.ts`, ocho operaciones, `WEB_ENDPOINTS` y `API_OPERATIONS`), el cliente único `web-client.ts`, las respuestas sin cuerpo y los tests de la web (Vitest en `pnpm check` y Playwright en `test:e2e`).

  `.claude/rules/README.md`: la fila de `frontend/architecture.md` pasa a declarar su respaldo, que es ESLint, la guarda estática, la paridad y la cobertura en Vitest (`pnpm check`) y los E2E de Playwright (`test:e2e`).
- [x] 6.3 Wiki (`/popi:wiki add`), cada ficha con su línea en `.claude/rules/always/knowledge-wiki.md`:
  - `decision-frontera-local-de-la-web`: proxy en el servidor y no lista de orígenes; `Host` en bruto más `Origin`; sin Server Actions; sin marcos; ocho operaciones; `fetch` en modo `cors` por `no-referrer`.
  - `decision-filtro-de-urls-sobre-lo-parseado`: `href` y no el texto; sin `next/image` (SSRF); sin `Referer`; `iframe` sin `allow-same-origin`.
  - `gotcha-next-escucha-antes-de-cargar-la-config` (enforcement: `e2e/frontier.e2e.ts`, `tests/static-guard.test.ts`).
  - `gotcha-input-email-recorta-el-valor` (enforcement: `src/components/chat/pending-question.test.tsx`, `e2e/questions.e2e.ts`).
  - `gotcha-cache-components-activity-y-prerender`: `<Activity>` conserva rutas y DOM, y un `GET` sin `connection()` se prerenderiza (enforcement: `tests/static-guard.test.ts`, `e2e/home.e2e.ts`).
  - `gotcha-next-dev-fuera-de-la-frontera`: en `next dev`, los recursos de desarrollo se atienden antes de `proxy.ts`, `blockCrossSiteDEV` deja pasar lo que no lleva `Origin`, la cadena del inspector de Node con DNS rebinding, el `devtoolsFrontendUrl` que Next manda en el `SYNC` del *websocket* de HMR (por eso `upgrade` exige el `Origin` propio), por qué un guardián delante no basta y por qué el *preload* sí, y que `--inspect` queda desaconsejado. Enforcement: `apps/web/tests/local-only-preload.test.ts`, `apps/web/tests/static-guard.test.ts`, `apps/web/e2e/frontier.e2e.ts`.

  Al final, `pnpm wiki:lint` en verde.
- [ ] 6.4 Verificación final en el navegador con `pnpm dev` (la API con Postgres y la web por turbo):
  - El recorrido de 3.6 repetido.
  - **Consola limpia y pestaña de red revisada**.
  - Comprobado que `pnpm dev` escucha solo en `127.0.0.1:3000` y que ningún otro proceso de Node del árbol escucha (`lsof -nP -iTCP -sTCP:LISTEN`).
  - Notas en el gate.
- [ ] 6.5 Criterio del *diff* de `design.md` («Ficheros»): los dos comandos no imprimen nada. La lista blanca incluye `.claude/rules/README.md` y `.claude/wiki/`.
- [ ] 6.6 **Gate 6**:
  - `pnpm check` en verde.
  - `pnpm test:e2e` en verde.
  - `pnpm wiki:lint` en verde.
  - `pnpm exec openspec validate web-chat --strict` en verde.
  - Commit `docs(web): chat de prueba en CLAUDE.md, reglas y wiki`.
  - El siguiente paso es `/popi:verify` y el archivo del cambio en la misma rama, antes del PR.

## 7. Seguimiento

- [ ] 7.1 FOLLOW-UP: el cambio `dev-servicios-simulados` (pregunta abierta 1 de `proposal.md`), para que los ejemplos terminen en local.
- [ ] 7.2 FOLLOW-UP: medir en el *runner* la duración de los E2E de la web (5.10). Si pasan de unos 10 minutos, cachear `~/.cache/ms-playwright` por versión de Playwright, o mover `@lento` a una ejecución aparte.
- [ ] 7.3 FOLLOW-UP: exportar la API a OpenAPI cuando haya un consumidor externo (fuera de esta feature, según la propuesta).
- [ ] 7.4 FOLLOW-UP: si `next dev` bloquea recursos de desarrollo al abrir la web por `127.0.0.1` (R3 de `design.md`), documentar `localhost` o fijar `allowedDevOrigins`.
- [ ] 7.5 FOLLOW-UP: una CSP completa con *nonces* para los *scripts* de Next, si llega un requisito que la pida.
- [ ] 7.6 FOLLOW-UP: `inputs` de turbo para el `test` de `@franca/api`. `apps/api/test/spec-coverage.spec.ts` y `spec-text-parity.spec.ts` leen `openspec/` y `packages/engine/tests/helpers/spec-text.ts` sin declararlos, así que la caché puede dar por bueno un `test` tras cambiar la spec. Se arregla en un cambio de la API, no aquí.
