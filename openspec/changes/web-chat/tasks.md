# Tasks: chat web de prueba (`web-chat`)

Las fases son secuenciales: cada una empieza cuando la anterior pasa su gate. El comportamiento está en `specs/web-chat/spec.md` (41 requisitos y 63 escenarios, con el delta `e88c5ed` pendiente de aprobación) y el cómo, en `design.md` (D1-D25, «Contrato» y «Ficheros»).

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

**Modo de aplicación recomendado: `apply normal`**, fase a fase con sus gates. El espacio de comportamiento es grande (63 escenarios, interfaz, foco, ritmo, concurrencia), necesita verificación en el navegador y tiene una decisión pendiente (el delta). Un `bucle aislado` (`popi:loop`) solo convendría para la fase 4 (mutación), cuyo espacio es cerrado: una lista de mutantes y un veredicto mecánico. La elección es del usuario.

## 1. Núcleo del frontend — dueño: `popi:frontend-developer`

- [ ] 1.1 Dependencias y *scripts* de `apps/web/package.json` (D18, D6):
  - `@franca/spec` y `@franca/engine` (`workspace:*`).
  - `vitest` `4.1.12`, `@playwright/test` `1.64.1`, `pg` `8.23.1` y `@types/pg` `8.23.1`, todas exactas.
  - *Scripts*:
    - `dev`: `node scripts/check-env.mjs && next dev --hostname 127.0.0.1`
    - `start`: `node scripts/check-env.mjs && next start --hostname 127.0.0.1`
    - `test`: `vitest run`
    - `test:e2e`: `playwright test`
    - `mutate`: `node scripts/mutate.mjs`
  - Después, `pnpm install`. Comprueba que el *lockfile* resuelve `vitest@4.1.12` con el mismo `vite` que la API.
- [ ] 1.2 `apps/web/vitest.config.ts` (D19): alias `@/`, entorno `node`, `include` y JSX automático. Un primer test de marcado (`renderToStaticMarkup` de un componente trivial) demuestra que el JSX se transforma. Si no, se fija `oxc.jsx.runtime`. `.gitignore` de la web: `/test-results`, `/playwright-report` y `/blob-report`.
- [ ] 1.3 Reglas de `apps/web/eslint.config.mjs`:
  - `no-restricted-imports` de `node:http`, `node:https`, `node:net`, `http`, `https`, `net` y `undici`, salvo en `src/server/api/transport.ts`, y de `next/image` en `src/components/chat/**`.
  - `no-restricted-globals`: `fetch` salvo en `src/lib/web-client.ts`, más `localStorage`, `sessionStorage`, `indexedDB` y `caches`.
  - `no-restricted-properties` de `document.cookie`.
  - `no-console`, salvo en `src/server/log.ts`.
  - `react/no-danger`.

  Cada restricción se valida a mano una vez: se escribe la línea prohibida, `pnpm --filter @franca/web lint` falla, y se quita.
- [ ] 1.4 `src/config/endpoints.ts` (`WEB_ENDPOINTS` y `API_OPERATIONS`), `api-error-codes.ts` (26 códigos), `web-error-codes.ts` y `limits.ts`:
  - Páginas de 20 y de 100.
  - Plazos de 180 000 y 15 000 ms en el servidor, y de 200 000 y 30 000 ms en el navegador.
  - Topes de 1 MiB del cuerpo y 32 MiB de la respuesta.

  Con `tests/api-error-codes-parity.test.ts`, que contiene **«Paridad de códigos»**, y un test de que los códigos de la API y los de la web son disjuntos.
- [ ] 1.5 `src/server/config/api-url.mjs` y `scripts/check-env.mjs` (D5), con `src/server/config/api-url.test.ts`:
  - La matriz de la spec (`https://127.0.0.1:3001`, `http://api.example.com:3001`, `/v1`, credenciales, sin esquema, `""`, `localhost`, `[::1]` y ausente).
  - Controles y espacios.
  - Puerto `0`.
  - Mayúsculas.
  - El mensaje nombra `FRANCA_API_URL` y nunca contiene el valor.
  - El *script* termina con 1 sin escuchar (proceso hijo con `node`, sin Next).
- [ ] 1.6 `src/server/ids.ts` + test: UUID en minúsculas (también `…00A` y `..%2F..`), patrón de `id` importado de `@franca/spec`, versión y `offset`.
- [ ] 1.7 `src/lib/chat/url-filter.ts` + test (D13), con **«Direcciones rechazadas»** y **«Direcciones admitidas y su serialización»**, más los casos de `medios` y de `preguntas`.
- [ ] 1.8 `src/lib/chat/api-types.ts` y `events.ts`: guardas de tipo defensivas para eventos, contenido y entradas. Test con eventos **del motor real** (`startSession`/`continueSession` sobre `captacion-leads`, `preguntas`, `medios` y `pregunta`) y con formas desconocidas o rotas que se ignoran sin lanzar.
- [ ] 1.9 `src/lib/chat/copy.ts` + test:
  - Un aviso por cada valor de `INVALID_ANSWER_REASONS`, con las claves comparadas con las del motor, y el genérico.
  - Los mapas de error por contexto de la tabla del contrato, cada código con escenario con su texto y un desconocido con el genérico.
  - Los estados en español.
  - Ningún texto contiene `@franca/`.
- [ ] 1.10 `src/lib/chat/transcript-view.ts` + test (D12):
  - Orden por `seq`.
  - Etiquetas de `choice` y `choices` (en el orden de las opciones, con «, »).
  - Un `id` desconocido.
  - `http`, `llm` y `error` a la actividad sin `message` (*fixture* con `message`).
  - Ni `http` ni `llm` en el `timeline`.
  - Paginación de 150 entradas con `limit=100`.
  - `total` cambiante.
  - Pendiente desde el recurso.
- [ ] 1.11 `src/lib/web-client.ts` + test, con un `fetch` falso inyectado: `cache: 'no-store'`, `If-Match: "<n>"` en las entradas, códigos leídos del cuerpo, `network_error` (rechazo, aborto, plazo y no JSON) y desconocidos a `unknown`.
- [ ] 1.12 `src/lib/chat/conversation-session.ts` y `first-advance.ts` + test (D10, D11), con un cliente falso, `sleep` controlado y temporizadores falsos:
  - Ritmo: espera `typingDelayMs` tras cada confirmación, y la pregunta aparece después del último mensaje.
  - El indicador durante la espera de la API.
  - Cerrojo de doble envío.
  - `If-Match` con la revisión pintada.
  - Cada fila de la tabla de fallos de D10. «Reintentar» reenvía el **mismo** `If-Match`, y nunca se reenvía solo.
  - Ninguna llamada en 10 s tras un 409.
  - `draft` recuperado en la pregunta siguiente.
  - Regla de reanudación con `StrictMode` y `<Activity>`.
- [ ] 1.13 `src/lib/chat/paged-list.ts` + test: añadir una página sin repetir `id`, y saber si quedan más (`offset + items < total`).
- [ ] 1.14 **Gate 1**:
  - `pnpm check` en verde.
  - `pnpm exec openspec validate web-chat --strict` en verde.
  - `git diff --name-only main...HEAD -- apps/api packages` vacío.
  - Commit `feat(web): núcleo del chat de prueba`.

## 2. Servidor de la web: frontera, transporte y rutas — dueño: `popi:frontend-developer`

- [ ] 2.1 `src/server/frontier.ts` + test (D2, D24):
  - Matriz de `Host` (los cuatro locales y `localhost.evil.example`, `127.0.0.1.nip.io`, `localhost.`, vacío y ausente).
  - Matriz de `Origin` por método (`https://evil.example`, `null`, `http://127.0.0.1:3000` con `Host: localhost:3000`, ausente, el bueno; `GET` y `HEAD` sin exigirlo).
  - Ruta de conversación con `%2F`, mayúsculas y `%` mal formado.
  - Cabeceras de seguridad en toda respuesta, 403 incluidos, y nunca `Access-Control-Allow-*`.
  - `/_next/static/` sin `no-store`.

  Además, `src/proxy.ts` sin `matcher`.
- [ ] 2.2 `src/server/api/transport.ts` (D4) y `tests/helpers/fake-api.ts` (servidor `node:http` en el proceso, puerto 0, que registra y guioniza). Test de integración:
  - Cabeceras exactas, con `Host` de `FRANCA_API_URL` y sin nada más.
  - `Content-Length` y `Connection: close`.
  - Plazos con un valor corto inyectado, y que los de producción sean ≥ 180 000 y ≥ 15 000.
  - `unreachable` con un puerto cerrado, un cierre sin respuesta y un cierre a medio cuerpo.
  - `invalid` con status 600, más de 32 MiB y no JSON.
  - `localhost` conecta a loopback, también si la API solo escucha en `::1`.
- [ ] 2.3 `src/server/api/operations.ts` + test: exactamente ocho funciones, rutas y consultas exactas (`published=true`, `limit` fijo) y argumentos ya validados.
- [ ] 2.4 `src/server/bff/request.ts`, `responses.ts` y `handlers.ts` + test de integración contra `fake-api.ts` (D8):
  - Cuerpos reenviados reconstruidos (`{"flowId"}`, `{"flowId","contactId"}` y `{"input":…}`, con los espacios).
  - Tope de 1 MiB, y un cuerpo de 70 000 caracteres que **sí** llega.
  - `If-Match` ausente → 428 y mal formado → 400.
  - `offset` inválido → 400 sin llamar.
  - Id no UUID → 404 `conversation_not_found` sin llamar (los cuatro casos de «Id de conversación con una ruta dentro»).
  - `message` fuera de los `error` (avance y transcripción) y de los cuerpos de error.
  - `currentRevision` en el 412.
  - Código desconocido que pasa.
  - Versión reducida a `{flowId, version, name}`.
  - Estados conservados.
  - 502 con `api_unreachable` e `invalid_api_response`.
  - Una cookie o una cabecera `X-Extra` del navegador no llegan a la API.
- [ ] 2.5 Los seis ficheros de `src/app/api/**/route.ts` (las ocho operaciones), con `await connection()` como primera sentencia de cada manejador y una línea hacia `handlers.ts`, y el comodín `src/app/api/[...rest]/route.ts` (404 `not_found` en todos los métodos, sin llamar a la API).
- [ ] 2.6 `src/server/log.ts` (D17) + test: formato con la plantilla de la ruta y sin cuerpo, ruta real ni cabeceras.
- [ ] 2.7 `tests/api-transport-env-proxy.test.ts`, `vitest.hostile.config.ts` y `tests/hostile/env-proxy.hostile.ts` (D19): con `NODE_USE_ENV_PROXY=1` y las variables de proxy hacia una trampa, la API simulada recibe la petición y la trampa nada. Se valida haciendo que el hijo use `http.get` con `globalAgent` y comprobando que entonces **falla** (lo deja fijado el mutante `useGlobalAgent`).
- [ ] 2.8 `tests/static-guard.test.ts` (D19): `connection()` en cada manejador, ningún `'use server'`, ninguna caché de Next, ningún cliente que importe `@/server/`, `transport.ts` importado solo por `operations.ts`, ocho exportaciones, ningún import de ejecución de `@franca/engine` desde un cliente, y los *scripts* `dev` y `start`.
- [ ] 2.9 **Gate 2**:
  - `pnpm check` en verde.
  - Con `docker compose up -d`, la API en marcha (`pnpm --filter @franca/api dev`), `pnpm --filter @franca/web build` y `pnpm --filter @franca/web start`, se comprueba con `curl -i`:
    - `GET /` con `Host: evil.example:3000` → 403 sin cuerpo.
    - `POST /api/conversations` sin `Origin` → 403, y con `Origin: http://localhost:3000` → la respuesta de la API.
    - Sin `Access-Control-Allow-*`.
    - `Cache-Control` con `no-store`, `frame-ancestors 'none'` y `X-Frame-Options: DENY`.
    - `GET /api/conversations/no-es-un-uuid` → 404 `conversation_not_found`.
    - `GET /api/flows` → la lista.
  - `FRANCA_API_URL=http://api.example.com:3001 pnpm --filter @franca/web start` termina con 1 sin escuchar y sin el valor en la salida.
  - Commit `feat(web): frontera local y rutas del servidor de la web`.

## 3. Interfaz — dueño: `popi:frontend-developer`

- [ ] 3.1 `src/app/layout.tsx`, `globals.css` y `public/` (D16, D25):
  - `lang="es"`.
  - `metadata` con el título de la marca y `referrer: 'no-referrer'`.
  - Sin `next/font/google`: pila de fuentes del sistema.
  - Borrar los cinco SVG de plantilla.
- [ ] 3.2 Inicio (`src/app/page.tsx`, `home-screen`, `contact-field`, `flow-list`, `conversation-list`, `list-state`, `use-paged-list` y `use-start-conversation`):
  - Estados de la tabla de D16.
  - «Ver más».
  - Volver a leer al mostrarse y reiniciar al ocultarse (D7).
  - «Iniciando…».
  - Errores al empezar, con `invalid_request` en el campo.
  - Traspaso del primer avance y `router.push`.
- [ ] 3.3 Conversación (`src/app/conversaciones/[conversationId]/page.tsx` con `Suspense` y validación del id, `conversation-screen`, `use-conversation-session` y los componentes de D16):
  - `role="log"`, indicador, preguntas (D15), motivo, fin, avisos, «Empezar de nuevo», «Borrar conversación» con `<dialog>` y panel de detalles con actividad técnica.
  - El foco va a la pregunta.
  - 320 px sin desplazamiento horizontal.
- [ ] 3.4 Tests de marcado (D19) de `message-text`, `media-item`, `pending-question` (cada `inputType` con su control, sin `type="email|url|number|date"`, sin `maxLength` ni `required`, y lo desconocido sin controles), `end-notice` y `test-details-panel` (ningún `message`). Cada uno se valida con su mutante de D23.
- [ ] 3.5 `src/app/not-found.tsx` y `src/app/error.tsx` en español.
- [ ] 3.6 **Gate 3**:
  - `pnpm check` en verde.
  - Con la API y Postgres en local, y `captacion-leads`, `faq-ia` y `preguntas` publicados con `curl`, `pnpm dev` y en el navegador `http://localhost:3000`:
    - Probar los tres.
    - Recargar una conversación.
    - Responder en dos pestañas (412).
    - Borrar.
    - Ver 320 px con las herramientas del navegador.
  - **Consola sin errores ni avisos de React** y **pestaña de red revisada**: el navegador solo pide al origen de la web, y nunca a `:3001`.
  - Capturas o notas en el gate.
  - Commit `feat(web): pantallas del chat de prueba`.

## 4. Tests unit y mutación — dueño: `popi:qa-tester` (modo unit y adversarial)

- [ ] 4.1 Auditar requisito por requisito que cada «SHALL» con lógica en el cliente o en el servidor de la web tiene un test de Vitest que fallaría sin ella, y completar lo que falte. Ninguna aserción sobre el propio *fixture*, ni `expect` dentro de un `if`.
- [ ] 4.2 Validar cada test negativo («no contiene», «no recibe», «no pide», «no llama») produciendo a propósito el caso prohibido: tiene que fallar.
- [ ] 4.3 `apps/web/scripts/mutate.mjs` (reutiliza `packages/engine/scripts/mutate.mjs`, D23) y `apps/web/tests/mutations.json` con los mutantes de D23. Cada uno con su `find` único, su `replace` y sus `tests`.
- [ ] 4.4 `pnpm --filter @franca/web mutate`: **ningún mutante sobrevive**. Se anota la salida resumida en el gate. Un superviviente obliga a un test nuevo, nunca a quitar el mutante.
- [ ] 4.5 Revisión adversarial de las costuras con su código abierto:
  - Navegador ↔ rutas de la web: `web-client` frente a `handlers`.
  - Rutas ↔ API: `operations` y `transport` frente a `apps/api/src/http/` y `conversations.controller.ts`, con al menos un *fixture* copiado de una respuesta real de la API (412, 409 y 201).
  - Hallazgos corregidos con su test.
- [ ] 4.6 Revisión de interfaz con la skill `web-design-guidelines` sobre `src/components/chat/**` y `src/app/**`. Se corrige lo que afecte a accesibilidad o a 320 px, y el resto se anota.
- [ ] 4.7 **Gate 4**:
  - `pnpm check` en verde.
  - `mutate` sin supervivientes.
  - Commit `test(web): cobertura unitaria y mutación del chat`.

## 5. E2E — dueño: `popi:qa-tester` (modo e2e)

- [ ] 5.1 `apps/web/playwright.config.ts` y `e2e/support/*` (D20):
  - Pila por *worker*: base con `pg` y `prisma migrate deploy` de la API, API real con entorno mínimo, API simulada (`tests/helpers/fake-api.ts`) que reenvía y registra, y `pnpm --filter @franca/web start` con entorno hostil y la trampa de proxy comprobada al cerrar.
  - `TRUNCATE` entre tests.
  - `admin.ts`.
  - Interceptación y registro de otros orígenes, cumplidos en local.
  - *Fixture* de consola limpia.
  - Cómo se ejecuta en local:
    ```bash
    docker compose up -d
    pnpm --filter @franca/web exec playwright install chromium
    DATABASE_URL=postgresql://franca@127.0.0.1:5432/franca pnpm test:e2e
    ```
- [ ] 5.2 `e2e/fixtures/flows/*.json` y `tests/flow-fixtures.test.ts`: cada *fixture* es igual al JSON de su spec (`web-chat`, `conversations-api` y `flows-api`) y válido sin avisos.
- [ ] 5.3 `e2e/fake-api-shapes.e2e.ts`: las claves y el orden de los recursos simulados coinciden con respuestas reales (recurso, resumen, avance, página de transcripción, página de flujos y error 412).
- [ ] 5.4 `e2e/home.e2e.ts` (11 escenarios), `e2e/conversation-page.e2e.ts` (7) y `e2e/questions.e2e.ts` (9), con los títulos exactos de la tabla «Escenario → test».
- [ ] 5.5 `e2e/rhythm.e2e.ts` (3; «Avance largo» con `@lento` y 200 s de plazo), `e2e/concurrency.e2e.ts` (9; «Ocupada al enviar» con `page.clock`) y `e2e/lifecycle.e2e.ts` (9).
- [ ] 5.6 `e2e/frontier.e2e.ts` (10, incluido «El chat dentro de un marco ajeno»; «Otra interfaz de la máquina» arranca `dev` y `start`) y `e2e/accessibility.e2e.ts` (2).
- [ ] 5.7 `tests/spec-coverage.test.ts`, `tests/helpers/spec-text.ts` (copia byte a byte de `packages/engine/tests/helpers/spec-text.ts`) y `tests/spec-text-parity.test.ts` (D22): al menos 41 requisitos y 63 escenarios, sin títulos repetidos, y cada uno con su test.
- [ ] 5.8 `turbo.json` (`@franca/web#dev` con `FRANCA_API_URL` y `@franca/web#test:e2e`), `test:e2e` de la raíz con `--concurrency=1` y `.github/workflows/ci.yml`:
  - `playwright install --with-deps chromium` tras `pnpm build`.
  - Subida de `test-results` y `playwright-report` si falla.

  Se comprueba con `FRANCA_API_URL=http://api.example.com:3001 pnpm exec turbo run dev --filter=@franca/web`, que no arranca la web, de modo que la variable llega a través de turbo.
- [ ] 5.9 **Gate 5**:
  - `pnpm check` en verde, con `spec-coverage` incluido.
  - `pnpm test:e2e` en verde en local, con Postgres de `docker compose` (API y web en serie), y la duración anotada como referencia, no como medida.
  - La trampa de proxy, con cero conexiones.
  - Commit `test(web): E2E del chat de prueba contra la API real`.
- [ ] 5.10 DEPLOY-TIME: la CI del PR en verde, con el paso de Chromium y `pnpm test:e2e`. Se anota la duración del job medida en el *runner* para FOLLOW-UP 7.2. Se cierra cuando el usuario pida el PR.

## 6. Documentación, wiki y verificación final — dueño: `popi:frontend-developer`

- [ ] 6.1 `CLAUDE.md`:
  - Fila de `@franca/web` (Vitest y Playwright, `127.0.0.1:3000`).
  - Comandos: `pnpm --filter @franca/web test`, `test:e2e` (necesita Postgres, `DATABASE_URL` y Chromium instalado) y `playwright install chromium`.
  - `FRANCA_API_URL` (web, opcional, por defecto `http://127.0.0.1:3001`, solo `http://` a loopback, y un valor inválido impide arrancar), solo con el nombre.
  - `test:e2e` serializado.
- [ ] 6.2 `.claude/rules/always/gotchas.md`:
  - La web escucha solo en `127.0.0.1` y valida `FRANCA_API_URL` antes de `next` (enforced: `static-guard.test.ts`, `frontier.e2e.ts`).
  - Cada ruta de la web empieza con `await connection()` (enforced: `static-guard.test.ts`).
  - El servidor de la web no usa `fetch` (enforced: ESLint y `api-transport-env-proxy.test.ts`).

  `.claude/rules/frontend/architecture.md`: la frontera (`proxy.ts`, ocho operaciones, `WEB_ENDPOINTS` y `API_OPERATIONS`), el cliente único `web-client.ts` y los tests de la web (Vitest en `pnpm check` y Playwright en `test:e2e`).
- [ ] 6.3 Wiki (`/popi:wiki add`), cada ficha con su línea en `.claude/rules/always/knowledge-wiki.md`:
  - `decision-frontera-local-de-la-web`: proxy en el servidor y no lista de orígenes; `Host` más `Origin`; sin Server Actions; sin marcos; ocho operaciones.
  - `decision-filtro-de-urls-sobre-lo-parseado`: `href` y no el texto; sin `next/image` (SSRF); sin `Referer`; `iframe` sin `allow-same-origin`.
  - `gotcha-next-escucha-antes-de-cargar-la-config` (enforcement: `e2e/frontier.e2e.ts`, `tests/static-guard.test.ts`).
  - `gotcha-input-email-recorta-el-valor` (enforcement: `src/components/chat/pending-question.test.tsx`, `e2e/questions.e2e.ts`).
  - `gotcha-cache-components-activity-y-prerender`: `<Activity>` conserva rutas y DOM, y un `GET` sin `connection()` se prerenderiza (enforcement: `tests/static-guard.test.ts`, `e2e/home.e2e.ts`).

  Al final, `pnpm wiki:lint` en verde.
- [ ] 6.4 Verificación final en el navegador con `pnpm dev` (la API con Postgres y la web por turbo):
  - El recorrido de 3.6 repetido.
  - **Consola limpia y pestaña de red revisada**.
  - Comprobado que `pnpm dev` escucha en `127.0.0.1:3000` (`lsof -iTCP:3000 -sTCP:LISTEN`).
  - Notas en el gate.
- [ ] 6.5 Criterio del *diff* de `design.md` («Ficheros»): los dos comandos no imprimen nada.
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
