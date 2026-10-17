# Tasks: servicios simulados para la demo local (`dev-servicios-simulados`)

Las fases van en orden: cada una empieza cuando la anterior pasa su gate. El comportamiento está en `specs/` y el cómo, en `design.md` (D1-D16, «Contrato» C1-C6, «Ficheros» y «Cobertura»).

**Revisión 2**, tras el FAIL de `popi:architecture-reviewer`:
- **B1.** Una parada no escala por señales: un Ctrl+C llega como dos `SIGINT` por pnpm (D7).
- **B2.** `openspec/**` en los `inputs` de los tests de la API, lo que cierra el 7.6 de `web-chat` (D6).
- **B3.** Las migraciones entran en la receta y la semilla las detecta (A11, C5).
- Además, los no bloqueantes y las simplificaciones de la revisión.

**Reglas para todas las fases**:
- **Solo se tocan los ficheros de «Ficheros» de `design.md`.** `git diff --name-only main...HEAD -- apps/web packages apps/api/src/main.ts apps/api/prisma .github pnpm-lock.yaml pnpm-workspace.yaml` no imprime nada en ningún gate. Si falta un fichero, se añade antes al diseño, con su porqué.
- **Ningún test**:
  - sale de loopback ni consulta el DNS de Internet;
  - usa el puerto 4010;
  - comprueba que los puertos 3000 o 3001 estén libres (un `pnpm dev` abierto lo haría intermitente);
  - escribe ficheros dentro del repositorio.
- **Ningún valor de secreto se versiona**: los tokens de los tests son literales de prueba marcados `// gitleaks:allow`, como en `test/helpers/http-world.ts`. Ningún fichero nuevo es un fichero de entorno.
- **Un gate se marca solo con checks realmente ejecutados**, citando el comando y su resultado.
- **Commits** por fase, con `git add` de rutas explícitas. Ni ramas, ni *push*, ni PR sin orden del usuario.

**Estado de partida (2026-10-17)**:
- `pnpm check` falla desde `139869e`: a `spec-coverage.spec.ts` le faltan los 8 `it` del delta de `http-host`. Es lo esperado en spec-first (R2) y se cierra en la fase 2.
- `pnpm exec openspec validate dev-servicios-simulados --strict` pasa (`09a430c`).
- `pnpm --filter @franca/api mutate` aborta antes de mutar nada, por el mutante obsoleto `ignoreTimeout` (A3). Se repara en 2.4.

**Modo recomendado: `apply normal`**. La elección es del usuario (`design.md`, «Plan de Ejecución»).

## 1. Backend Core: nombres locales en la salida http — dueño: `popi:backend-developer`

- [ ] 1.1 `apps/api/src/http-host/local-names.ts` (D3, C1):
  - `LOCAL_NAMES_VARIABLE`, `LocalNameEntry` y `readLocalNames(value)`. Es asíncrona porque usa la sonda `isNodeUrlOrigin` de `secret-origin.ts`.
  - `LocalNames` y `createLocalNames(entries)`, con un `Map` exacto.
  - Mensajes de error exactos según C1: nombran la variable y la posición, nunca el valor.
  - Solo imports relativos, sin leer el entorno: la guarda estática no cambia.
- [ ] 1.2 `http-host-config.ts`:
  - `localNames` en `HttpHostConfig`, leída al final de `loadHttpHostConfig` (D4).
  - `describeHttpHostConfig` añade `; nombres locales: …` con el formato de C1.
  - Actualiza los tres literales de A2 en `http-host-config.spec.ts` y `http-host-config-edges.spec.ts`. No se cambia nada más de esos dos ficheros.
- [ ] 1.3 `http-host.ts`: `localNames?: LocalNames` en `HttpHostDeps`, y la búsqueda en `resolveName` después de `literalEntries` y antes del resolutor (D3). `http-host.module.ts` pasa `createLocalNames(config.localNames)`. `main.ts` no cambia.
- [ ] 1.4 `turbo.json` (D6):
  - `FRANCA_HTTP_LOCAL_NAMES` en el `passThroughEnv` de `@franca/api#dev`.
  - Tarea `@franca/api#test` con `dependsOn: ["^build", "db:generate"]` e `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/apps/web/src/server/config/api-url.mjs", "$TURBO_ROOT$/openspec/**", "$TURBO_ROOT$/packages/engine/tests/helpers/spec-text.ts"]`. Esto cierra el FOLLOW-UP 7.6 de `web-chat`.
  - Tareas `@franca/api#lint` y `@franca/api#typecheck` con `dependsOn: ["^build", "db:generate"]` e `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/apps/web/src/server/config/api-url.mjs"]`.
  - Comprobación a mano: tras un `pnpm check` en verde, un cambio de solo un espacio en `openspec/changes/dev-servicios-simulados/specs/http-host/spec.md` hace que el siguiente `pnpm check` ejecute de nuevo `@franca/api#test`, sin `cache hit`. Después se revierte.
- [ ] 1.5 `apps/api/src/http-host/local-names.spec.ts` (unit):
  - Cada valor no admitido de «Nombres locales no admitidos» y de «Entradas vacías…» da un `ConfigError` que contiene `FRANCA_HTTP_LOCAL_NAMES` y no contiene el valor.
  - Los valores admitidos y `""` / ausente dan la lista esperada.
  - La línea de arranque coincide exactamente con C1, con y sin nombres.
  - `createHttpHost` con una red espía: un nombre local no llama al resolutor y conecta con sus direcciones en orden; sin par permitido da `blocked` `internal_destination` sin abrir nada; un nombre `.test` no local sí llama al resolutor.
  - Son títulos propios: los títulos de la spec van en los e2e de la fase 2.

**Gate 1**:
- `pnpm --filter @franca/api lint` y `typecheck` pasan.
- `pnpm --filter @franca/api exec vitest run src/http-host` pasa, incluida la guarda estática.
- `pnpm check` solo falla en `spec-coverage.spec.ts`, por los 8 títulos del delta. Se pega la lista de los que fallan.
- Una comprobación del paso de variables de turbo, para no repetir lo de [[gotcha-turbo-filtra-variables-de-entorno]]: `FRANCA_HTTP_LOCAL_NAMES=crm.franca.test=127.0.0.1 pnpm exec turbo run dev --filter=@franca/api`, con `DATABASE_URL` definida. La línea `salida http:` dice `nombres locales: crm.franca.test (127.0.0.1)`. Después se para con Ctrl+C.

Commit: `feat(api): nombres locales en la salida http (FRANCA_HTTP_LOCAL_NAMES)`.

## 2. Tests backend: escenarios de `http-host` y mutación — dueño: `popi:qa-tester` (modo backend)

- [ ] 2.1 `apps/api/test/http-host-local-names.e2e-spec.ts`, con `startWorld` y la red del test. Un `it` con el título exacto de cada escenario:
  - **«CRM con nombre local»**:
    - Usa la copia de `captacion-leads` con la `url` de `enviar-crm` cambiada en el test, un servidor en el par virtual `127.0.0.1:4010` y las variables del escenario.
    - El servidor ha recibido una sola petición, con `host` `crm.franca.test:4010` y `authorization` `Bearer prueba-crm-1`.
    - La conversación termina en `lead-empresa` y `network.resolved()` está vacío.
  - **«Nombre local en mayúsculas en la url»**: 200 y `resolved()` vacío.
  - **«Nombre local sin destino permitido»**:
    - El evento es exacto, la conversación termina en `lead-sin-enviar` y `connections()` está vacío.
    - La salida contiene el aviso `blocked` con `internal_destination`.
  - **«Orden de las direcciones de un nombre local»**: `connections()` es `[{::1, 4010}, {127.0.0.1, 4010}]`, la respuesta es 200 y `resolved()` está vacío.
  - **«Nombres que no son locales»**:
    - `api.example.com` resuelve a `P`, con un servidor TLS de ese nombre en `P:443`, y `otro.franca.test` no resuelve.
    - Los eventos son exactos (con `retries` 0) y `resolved()` contiene los dos nombres.
- [ ] 2.2 `apps/api/test/http-host-local-names-startup.e2e-spec.ts`, con el proceso real (`startApi` y una base falsa, como `http-host-startup.e2e-spec.ts`; la función `expectNeverListens` se copia en el fichero nuevo, sin tocar el existente):
  - **«Nombres locales no admitidos»**:
    - Los 19 valores, en paralelo: ninguno llega a escuchar, cada uno termina con un código distinto de 0 (no `null`) y su salida nombra la variable.
    - El valor válido de la spec arranca.
  - **«Entradas vacías en los nombres locales»**: los 5 valores, y `""` arranca con `nombres locales: ninguno`.
  - **«Salida de arranque con nombres locales»**:
    - La línea que contiene `127.0.0.1:4010` contiene también `crm.franca.test`, `127.0.0.1` y `[::1]`, en ese orden. El orden se busca **a partir** de la posición de `crm.franca.test`, porque `127.0.0.1` ya aparece antes, en el par.
    - Sin la variable, la línea dice `nombres locales: ninguno`.
- [ ] 2.3 Validación de los tests negativos, a mano y una vez cada uno: el fichero o la condición se mutan para producir el caso prohibido, se comprueba que el test falla y se revierte.
  - En «Nombre local sin destino permitido», se pone el par permitido: el test falla.
  - En «Nombres que no son locales», `otro.franca.test` se añade a la lista: el test falla.
  - Se anota el resultado en el commit.
- [ ] 2.4 `apps/api/test/mutations.json` (D15):
  - Los 9 mutantes `localName*`, con un `find` que aparece exactamente una vez y la lista de tests de la tabla de D15.
  - `ignoreTimeout` reapuntado a `src/http-host/attempt-budget.ts`.
- [ ] 2.5 Mutación: `DATABASE_URL=… pnpm --filter @franca/api mutate --only localNameAnySuffix,localNameNotSerialized,localNameAnyIpv4,localNameAnyIpv6,localNameSkipsPolicy,localNameAlsoResolves,localNameFirstAddressOnly,localNameMatchesAnyTest,localNamesNotWired,ignoreTimeout`. Todos muertos y la línea base en verde. Si alguno sobrevive, se añade el test que falta, no se quita el mutante.

**Gate 2**:
- `pnpm check` pasa por primera vez desde `139869e`. Desde 1.4, la caché de turbo ya no puede ocultar un cambio en `openspec/`.
- `pnpm --filter @franca/api test:e2e` pasa.
- Se pega la salida de la mutación de 2.5.

Commit: `test(api): escenarios y mutantes de los nombres locales`.

## 3. Scripts de la demo — dueño: `popi:backend-developer`

- [ ] 3.1 `apps/api/demo/captacion-leads-local.json` (D10): copia literal del ejemplo con los cuatro cambios.
  - Las secuencias `\uXXXX` se pueden escribir como caracteres: la comparación es como JSON.
  - `pnpm --filter @franca/spec exec node dist/cli.mjs ../../apps/api/demo/captacion-leads-local.json`, o el equivalente con `validateFlow`, da válido y sin avisos.
- [ ] 3.2 `apps/api/demo/demo-config.mjs` (C3, D5, D9):
  - `CRM_HOST`, `CRM_PORT` (4010), `CRM_NAME`, `DEMO_FLOW_NAME`, `WEB_URL` (`http://localhost:3000`) y `DEMO_VARIABLE_NAMES`.
  - `demoHttpVariables({ token, crmPort })`, `findConflicts(env)`, `buildApiEnvironment(env, token)` (sin `FRANCA_ANTHROPIC_API_KEY`) y `createRunToken()`.
  - Todo con `// @ts-check` y JSDoc.
- [ ] 3.3 `apps/api/demo/crm.mjs` (C2): `createCrmHandler`, `startCrm` y el modo proceso con IPC.
  - Con 404 y 401, `req.resume()` antes de responder con `Connection: close`.
  - El modo proceso va detrás de un `if` sobre `import.meta.url` y `process.argv[1]`, para que importarlo no arranque nada.
- [ ] 3.4 `apps/api/demo/seed.mjs` (C5, D11):
  - `requestApi` con `node:http`, `agent: false` y sin `Origin`.
  - `seedDemo` para **un solo flujo**, sin lista (D12), y el modo proceso (código 0/1).
  - Un 500 a la primera lectura da el mensaje «sin migraciones».
  - El `error` del cuerpo solo se imprime si cumple `^[a-z_]{1,64}$` (D11, C5).
  - Importa `parseApiUrl` de `../../web/src/server/config/api-url.mjs`.
- [ ] 3.5 `apps/api/demo/dev-demo.mjs` (C4, D6-D9, D13):
  - `runDemo(deps)` con la secuencia y los mensajes de C4.
  - `main` con los procesos reales:
    - `fork` del CRM con `detached`, `stdio: ['ignore', 'inherit', 'inherit', 'ipc']`, `env: { PATH }` y `execArgv: []`;
    - `spawn` de `node_modules/.bin/turbo run dev --ui=stream --no-daemon` con `detached`, `stdio: ['ignore', 'inherit', 'inherit']` y el entorno de `buildApiEnvironment`. Ese entorno no tiene la clave de Claude y sí tiene las cuatro variables de C3, `NEXT_TELEMETRY_DISABLED=1` y `TURBO_TELEMETRY_DISABLED=1`;
    - las señales del proceso: `SIGINT`, `SIGTERM` y `SIGHUP`.
  - `stopAll` (D7):
    - la señal al grupo y 7 s de margen;
    - `SIGKILL` **solo** al vencer ese plazo;
    - las señales que lleguen durante la parada se ignoran;
    - la comprobación de puertos en `127.0.0.1` y `::1`.
- [ ] 3.6 `apps/api/demo/tsconfig.json` (D2). `apps/api/package.json`:
  - `"lint": "oxlint --type-aware src/ test/ demo/"`
  - `"typecheck": "tsc --noEmit -p tsconfig.json && tsc -p demo/tsconfig.json"`

  `package.json` de la raíz:
  - `"dev:demo": "node apps/api/demo/dev-demo.mjs"`
  - `"demo:seed": "node apps/api/demo/seed.mjs"`
- [ ] 3.7 Tests unit, junto al código que cubren (TDD):
  - `apps/api/test/demo/mjs-modules.d.ts`: `declare module '*.mjs';` (D2). Los tests importan los `.mjs` directamente.
  - `demo-config.spec.ts`:
    - `demoHttpVariables` por defecto da los cuatro valores exactos de la spec.
    - El token cumple `^Bearer [A-Za-z0-9_-]{43}$` y dos llamadas dan valores distintos.
    - `findConflicts` cubre los cuatro nombres y `""`.
    - `buildApiEnvironment` no contiene la clave de Claude, sí contiene `NEXT_TELEMETRY_DISABLED=1` y `TURBO_TELEMETRY_DISABLED=1`, y no modifica su entrada.
  - `captacion-leads-local.spec.ts`: **«Paridad con el ejemplo canónico»** (C6) y el cruce copia ↔ C3 (D10).
  - `crm.spec.ts`, con `startCrm` en `127.0.0.1:0`:
    - **«Rutas y cuerpos que rechaza»**: los 7 casos, el cuerpo de error y ningún `id` asignado (el siguiente 201 es `L-1`). Un `POST /api/leads` de 32 KiB sin `Authorization` recibe el 401 entero, sin `ECONNRESET` en el cliente.
    - 201 con `L-1` y `L-2`, y una línea de registro por petición sin cabeceras, consulta ni cuerpo.
    - Un tipo `application/json; charset=utf-8` se acepta, y un cuerpo de más de 64 KiB da 400.
    - **«CRM solo en loopback»**: `[::1]:<puerto>` rechazado, y la primera IPv4 no interna de `os.networkInterfaces()` también, con `it.skipIf` si no hay ninguna.
    - **«Puerto del CRM ocupado»** (la parte del CRM): `startCrm` sobre un puerto ocupado del test rechaza con `EADDRINUSE`.
    - El modo proceso: `fork` real con `{start, port: 0}` responde `listening`, atiende una petición, y `stop` y `disconnect` lo terminan.
  - `seed.spec.ts`:
    - **«Dirección de la API no admitida en la semilla»** (`http://192.168.1.10:3001` y `""`): código 1, la salida nombra `FRANCA_API_URL` y el `request` espía no se llama ninguna vez.
    - Con un `request` que devuelve el 500 real de la API (`{"message":"error interno","error":"internal_error"}`, copiado de `api-error.ts`), la salida nombra `pnpm --filter @franca/api db:migrate`.
    - Un `error` como `<script>` o de 65 caracteres no se imprime.

**Gate 3**:
- `pnpm check` pasa (lint y typecheck de `demo/` incluidos).
- `pnpm dev:demo` arranca de verdad una vez en la máquina: aparecen la línea del CRM, la de `salida http:` de C1, el aviso de Claude, la semilla `creado y publicado` y «Lista». Se para con Ctrl+C. La prueba completa es de la fase 6; aquí basta con que arranque, siembre y pare.
- `git status` está limpio tras parar.

Commit: `feat(api): demo local con CRM simulado, semilla y pnpm dev:demo`.

## 4. Tests de los scripts — dueño: `popi:qa-tester` (modo backend)

- [ ] 4.1 `apps/api/test/demo/dev-demo.spec.ts`, con `runDemo(deps)` y dobles de procesos (`EventEmitter`s con `pid`, `exited` y `stop`) y temporizadores falsos:
  - **«Variables de la shell en conflicto»**:
    - Los dobles de proceso no se llaman.
    - La salida nombra las dos variables y no contiene `no-mostrar-3` ni `127.0.0.1:8080`, y el código es 1.
    - Además, un proceso real: `node apps/api/demo/dev-demo.mjs` con `PATH` y esas variables da un código distinto de 0 y la misma salida.
      - Se lanza con `detached: true` y un plazo de 5 s.
      - Al terminar, pase lo que pase, se mata su grupo (`process.kill(-pid, 'SIGKILL')` en un `finally`, sin fallar si ya no existe). Así un fallo que lanzara turbo no deja procesos.
  - **«Variable vacía en la shell»**: lo mismo con `FRANCA_HTTP_LOCAL_NAMES` = `""`.
  - **«Clave de Claude en la shell»** (la parte del arranque):
    - El entorno que recibe el doble de turbo no tiene `FRANCA_ANTHROPIC_API_KEY`.
    - La salida dice que la demo no usa Claude y no contiene `clave-no-usar`.
  - **«Puerto del CRM ocupado»** (la parte del arranque): el CRM responde `failed`, turbo no se lanza, el código es 1 y la salida nombra el 4010.
  - **«Token de la ejecución fuera de la salida»** (la parte automática):
    - Toda la salida de una ejecución completa con dobles no contiene el token que recibió el doble de turbo.
    - Dos ejecuciones dan tokens distintos.
  - **«Siembra fallida al arrancar»**: con una semilla que escribe la línea de «reservado» y devuelve `ok: false`, la salida contiene `reservado` y `pnpm demo:seed`, no se llama a ningún `stop` y la demo sigue en marcha.
  - **«Parada con Ctrl+C»**:
    - `SIGINT` lleva a `SIGINT` al grupo de turbo (`-pid`) y a `stop` del CRM, con código 130.
    - Si los dobles no salen, a los 7 s hay `SIGKILL` al grupo.
    - Un puerto que sigue ocupado tras parar da su aviso y el código 1.
    - **Dos `SIGINT` con menos de 50 ms entre ellos** (el Ctrl+C reenviado por pnpm, A9) dan un único `SIGINT` al grupo y ningún `SIGKILL` antes de los 7 s, y el código es 130.
    - Un `SIGTERM` o un `SIGHUP` durante la parada no cambian nada.
    - Con `SIGTERM`, el código es 143; con `SIGHUP`, 129, y en los dos hay señal al grupo.
    - La comprobación de puertos mira `127.0.0.1` y `::1`.
  - **«CRM simulado que termina»**: el CRM sale sin que se le pida, hay `SIGINT` al grupo de turbo, el mensaje de C4 y el código 1.
  - **«Arranque de la API y la web que termina»**: turbo sale, se pide `stop` al CRM, aparece el mensaje de C4 y el código es distinto de 0.
  - La API que no responde en 120 s da su mensaje, y la demo sigue en marcha.
- [ ] 4.2 `apps/api/test/demo-seed.e2e-spec.ts`, con la API real (`startApi` con `inject('databaseUrl')` y `PORT=0`, una por fichero), la base vaciada entre tests y `seedDemo` llamado en el mismo proceso con `FRANCA_API_URL=http://127.0.0.1:<puerto>`:
  - **«Primera siembra»**: además, una vez como proceso real (`node apps/api/demo/seed.mjs`), para el código de salida.
  - **«Siembra repetida»**: `total` 1 y `revision` 1.
  - **«Copia creada sin publicar»**.
  - **«Borrador cambiado a mano»**: con `PUT` e `If-Match`, el `name` y la `revision` se conservan y no hay versiones nuevas.
  - **«Id reservado por un borrado»**: el texto contiene `reservado` y `docker compose down -v`.
  - **«API no disponible para la semilla»**:
    - Primera ronda: un puerto cerrado.
    - Segunda ronda: un `startApi` con la base falsa (`127.0.0.1:59999`).
    - Cada ronda termina en menos de 15 s, medido.
  - **«Base de datos sin migraciones para la semilla»**:
    - El test crea una base vacía en el Postgres de los e2e (`CREATE DATABASE` con un nombre `franca_e2e_*_vacia`) y arranca contra ella otra API real.
    - La semilla termina con 1 y nombra `pnpm --filter @franca/api db:migrate`.
    - La base se borra en un `finally`.
- [ ] 4.3 `apps/api/test/demo.e2e-spec.ts`:
  - Un CRM simulado real (`startCrm` en `127.0.0.1:0` con un token de prueba y `log` capturado).
  - La API real con `demoHttpVariables({ token, crmPort })`, sin `NODE_EXTRA_CA_CERTS` ni red del test.
  - La copia publicada con **solo** el puerto de la `url` cambiado.
  - Escenarios:
    - **«Leads consecutivos»**: `L-1` y `L-2`, `lead-empresa` y `lead-pyme`.
    - **«Lead fuera del registro del CRM»**: hay una línea con `POST`, `/api/leads`, `201` y `L-1`, y la salida no contiene `Ana`, `ana@example.com`, `51+`, `empresa` ni el token.
    - **«Lead con otro token»**: una segunda API con `Bearer t-2` contra el CRM con `Bearer t-1` da el evento `{attempts: 1, status: 401, error: "http_status"}` y termina en `lead-sin-enviar`.
    - **«Línea de arranque de la API en la demo»**: una API con `demoHttpVariables({ token })` por defecto (no conecta a nada al arrancar). Su línea `salida http:` contiene `CRM_TOKEN`, `http://crm.franca.test:4010`, `127.0.0.1:4010` y `crm.franca.test`, y la salida no contiene el token.
    - **«Copia local sin la demo»**: `startWorld` sin variables y la copia **sin cambiar** publicada. Termina en `failed` con `{code: "missing_secret", nodeId: "enviar-crm"}` y `network.connections()` vacío.
- [ ] 4.4 Comprobación de que los títulos de «Cobertura» de `design.md` existen: `grep -rn "it('<título>'" apps/api/test apps/api/src` para cada escenario automatizable. Se pega la lista.
- [ ] 4.5 Tiempo: `pnpm --filter @franca/api test` y `test:e2e` en la CI del PR comparados con los de `main` (métrica: +5 % como mucho). No se mide en el portátil (`lecciones-equipo.md`). Si no hay PR todavía, queda **FOLLOW-UP** 7.4.
- [ ] 4.6 Validación de los tests negativos, a mano y una vez cada uno, para ver que fallan con el caso prohibido:
  - Se hace que el arranque imprima el token: falla el test del token.
  - Se quita `delete` de la clave de Claude: falla el test de la clave.
  - Se registra `req.headers` en el CRM: falla «Lead fuera del registro del CRM».
  - Se hace que la semilla publique sin comparar el borrador: falla «Borrador cambiado a mano».
  - Se quita el «ignorar señales durante la parada»: falla el caso de dos `SIGINT` en menos de 50 ms.
  - Se quita el saneado de `<error>`: falla el caso de `<script>`.

**Gate 4**: `pnpm check` y `pnpm test:e2e` pasan (con Postgres, `DATABASE_URL`, Chromium y el puerto 3000 libre), y se pegan los resultados de 4.4 y 4.6.

Commit: `test(api): demo local (arranque, semilla y cadena con el CRM simulado)`.

## 5. Documentación y meta — dueño: `popi:backend-developer`

- [ ] 5.1 `CLAUDE.md`:
  - Entran en «Comandos» `pnpm dev:demo` y `pnpm demo:seed`, con lo que necesitan (Postgres, `DATABASE_URL`, los puertos 3000, 3001 y 4010 libres) y la nota de que `pnpm dev` no cambia.
  - Entra en «Variables de entorno» `FRANCA_HTTP_LOCAL_NAMES`: la forma, solo `.test` y loopback, que no salta `FRANCA_HTTP_ALLOWED_DESTINATIONS` y que un valor mal escrito impide arrancar.
  - Solo nombres, nunca valores de secreto. El valor de ejemplo `crm.franca.test=127.0.0.1` no es un secreto.
- [ ] 5.2 `README.md` (sección «Desarrollo»):
  - La demo local desde un clon limpio, en cuatro comandos: `pnpm install`, `docker compose up -d`, `pnpm --filter @franca/api db:migrate` (con `DATABASE_URL` exportada) y `pnpm dev:demo`.
  - Qué abrir y qué esperar.
  - Que `faq-ia` sigue en `llm_not_configured`.
  - Cómo recuperar el `id` reservado.
  - Una línea sobre la deriva de la copia: tras actualizar el repositorio, la semilla puede decir «no tocado». Para ponerla al día, se sustituye el borrador por `apps/api/demo/captacion-leads-local.json` (`PUT` con `If-Match`) o, si no hay nada que conservar, `docker compose down -v` y las migraciones.

  `apps/api/README.md`: la variable y la carpeta `demo/`. `CLAUDE.md` (5.1) incluye la misma receta de cuatro comandos.
- [ ] 5.3 Wiki (D16):
  - El apartado «Nombres locales» en `decision-salida-http-politica.md`, con los mutantes en su `enforcement`.
  - `gotcha-turbo-senal-al-grupo.md`, con `metadata.enforcement`.
  - Su línea en `.claude/rules/always/knowledge-wiki.md`.
  - `pnpm wiki:lint` pasa.

**Gate 5**: `pnpm wiki:lint` y `pnpm check` pasan, y `grep -rn "Bearer [A-Za-z0-9_-]\{20,\}" README.md CLAUDE.md apps/api/README.md .claude/wiki` no encuentra nada.

Commit: `docs: demo local y FRANCA_HTTP_LOCAL_NAMES`.

## 6. Verificación final — dueño: `popi:qa-tester` (modo verificación)

Con Postgres en marcha (`docker compose up -d`) y `DATABASE_URL` exportada, desde la raíz. Se anota cada paso con lo observado.

- [ ] 6.1 `pnpm dev:demo` desde un estado limpio, con la receta de cuatro comandos (5.2).
  - **Antes** de aplicar las migraciones (`docker compose down -v && docker compose up -d`):
    - Se arranca la API con `pnpm dev`, y `pnpm demo:seed` nombra `pnpm --filter @franca/api db:migrate`: es «Base de datos sin migraciones para la semilla» con la base real.
    - Se para con Ctrl+C.
  - Después, `pnpm --filter @franca/api db:migrate` y `pnpm dev:demo`. Se comprueban en la salida:
  - la línea del CRM;
  - la línea `salida http:` exacta de C1 (contiene `CRM_TOKEN`, `http://crm.franca.test:4010`, `127.0.0.1:4010` y `crm.franca.test`);
  - el aviso de Claude;
  - `[semilla] captacion-leads-local: creado y publicado (versión 1).`;
  - «Lista».
- [ ] 6.2 **«Lead de punta a punta en la demo»** en el navegador, en `http://localhost:3000`, probando «Captación de leads (local)»:
  - Con «Ana», «ana@example.com» y «Más de 50»: aparece el mensaje final de `lead-empresa`, y «Detalles de la prueba» muestra el evento `http` con status 201. El CRM registra `POST /api/leads 201 L-1`.
  - Una segunda conversación con «1 a 10» termina en `lead-pyme`, con `L-2`.
  - La consola del navegador está limpia, y la pestaña de red solo muestra peticiones a `localhost:3000`.
- [ ] 6.3 **«Demo sin Internet»**, en dos partes. Desconectar la red **no** basta para dar por probado que nada sale: un intento fallaría en silencio.
  - **Con la red conectada**, durante una conversación hasta `lead-empresa`:
    - Cada 0,5 s, `lsof -nP -iTCP -a -p <pids>` sobre la API, el CRM y `next-server`. Los pids se toman de `lsof -nP -iTCP:3001,4010,3000 -sTCP:LISTEN`.
    - La API y el CRM solo tienen conexiones con `127.0.0.1` o `::1`.
    - Se anota cualquier conexión de otra herramienta (Prisma, pnpm…) como observación (R10), sin hacerla fallar.
    - `ps eww -p <pid de next-server> | tr ' ' '\n' | grep -E '^(NEXT|TURBO)_TELEMETRY_DISABLED=1$'` confirma que las dos variables de telemetría llegan (A10).
  - **Con la Wi-Fi y cualquier otra red desconectadas**, se repite 6.1 y una conversación hasta `lead-empresa`, con el mismo resultado.
- [ ] 6.4 **«Token de la ejecución fuera de la salida»**:
  - Dos ejecuciones seguidas, cada una con un `lead-empresa`, con la salida copiada **fuera del repositorio** (`pnpm dev:demo 2>&1 | tee "$TMPDIR/demo-1.log"`).
  - `grep -E 'Bearer [A-Za-z0-9_-]{43}'` no encuentra nada en los dos ficheros.
  - `git status` está limpio.
  - Que los dos tokens son distintos lo prueba 4.1, sin leer el entorno de los procesos.
- [ ] 6.5 **Parada**:
  - **«Parada con Ctrl+C»**: se repite la medida de A5 **a través de `pnpm dev:demo`**, en una terminal real, con un solo Ctrl+C (B1).
    - La demo termina en menos de 10 s (se cronometra).
    - Su salida no dice que haya matado nada a la fuerza, y su código es 130.
    - `lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:4010 -sTCP:LISTEN` no muestra nada.
    - Se repite tres veces.
  - Se cierra la ventana de la terminal con la demo en marcha (`SIGHUP`). Desde otra terminal, los puertos quedan libres en menos de 10 s.
  - `ps -axo pid,command | grep -E 'turbo|nest|next|tsdown|crm.mjs'` no muestra procesos de la demo, ni un *daemon* de turbo.
  - **«CRM simulado que termina»**: con la demo en marcha, `kill <pid del CRM>` (se busca con `lsof -nP -iTCP:4010 -sTCP:LISTEN`). La demo para la API y la web, sale con un código distinto de 0 y dice que el CRM se ha parado.
- [ ] 6.6 **Shell en conflicto y clave de Claude**:
  - `FRANCA_HTTP_ALLOWED_DESTINATIONS=127.0.0.1:8080 FRANCA_SECRET_CRM_TOKEN='Bearer no-mostrar-3' pnpm dev:demo`: sale con un código distinto de 0, nombra las dos variables y no muestra ningún valor.
  - `FRANCA_HTTP_LOCAL_NAMES= pnpm dev:demo`: lo mismo.
  - Con el puerto 4010 ocupado por `node -e "require('net').createServer().listen(4010,'127.0.0.1')"`: sale con un código distinto de 0, nombra el 4010, y no hay nada en 3000 ni en 3001.
  - **«Clave de Claude en la shell»**: `FRANCA_ANTHROPIC_API_KEY=clave-no-usar pnpm dev:demo`. Se publica `faq-ia` con `curl` contra `127.0.0.1:3001`. Una conversación suya queda en `failed` con `llm_not_configured` en `asistente`, y ninguna salida contiene `clave-no-usar`.
- [ ] 6.7 **Semilla**:
  - `pnpm demo:seed` dos veces: «ya estaba publicado».
  - `curl -X DELETE http://127.0.0.1:3001/flows/captacion-leads-local`, y se rearranca la demo: **«Siembra fallida al arrancar»** (dice «reservado» y `pnpm demo:seed`, y el CRM, la API y la web siguen escuchando).
  - Se restaura con `docker compose down -v`.
- [ ] 6.8 Mutación completa: `pnpm --filter @franca/api mutate`. Ningún mutante sobrevive.
- [ ] 6.9 `pnpm check`, `pnpm test:e2e`, `pnpm validate`, `pnpm wiki:lint` y `pnpm exec openspec validate dev-servicios-simulados --strict` pasan. Además, el criterio de diff de las reglas iniciales.
- [ ] 6.10 Revisión adversarial de las costuras (`lecciones-equipo.md`):
  - un nombre local no puede llegar a una dirección sin su par permitido;
  - el token no sale por ningún mensaje;
  - Ctrl+C no deja huérfanos.

Commit, si hay algún ajuste: `fix(api): …` o `test(api): …`, según toque. Después, `/opsx:archive` antes del merge, en la misma rama.

## 7. Seguimiento

- [ ] 7.1 FOLLOW-UP: `dev-llm-simulado`, el proveedor `llm` simulado con el soporte simulado y la copia local de `faq-ia` (pregunta abierta 2 de la propuesta).
- [ ] 7.2 FOLLOW-UP: los modos de fallo del CRM simulado (429, 503, lentitud), si el editor (8) los necesita.
- [ ] 7.3 FOLLOW-UP: comprobar de antemano que los puertos 3000 y 3001 están libres en `pnpm dev:demo`. Hoy los detecta `pnpm dev`, sin que la demo lo diga.
- [ ] 7.4 FOLLOW-UP: la métrica de tiempo de 4.5, si no se pudo medir en la CI de un PR.
- [ ] 7.5 Cerrado por este cambio (1.4): el FOLLOW-UP 7.6 de `web-chat`, `openspec/**` en los `inputs` de los tests de la API. Se marca así al archivar, y queda anotado en la descripción del PR.
