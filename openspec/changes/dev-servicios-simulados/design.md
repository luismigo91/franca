# Design: servicios simulados para la demo local (`dev-servicios-simulados`)

**Fecha**: 2026-10-17 · **Rama**: `feat/dev-servicios-simulados` · **Spec**: `proposal.md` y `specs/` (`139869e`, más las correcciones `d3de23f` y `09a430c`; ver «Auditoría», A7 y A11). **Revisión 2**, tras el FAIL de `popi:architecture-reviewer`: B1 en D7, B2 en D6 y B3 en A11 y C5, más los no bloqueantes y las simplificaciones que pidió el coordinador.

## Context

El cambio tiene dos partes de tamaño muy distinto:

- **Una variable nueva en un componente de seguridad**: `FRANCA_HTTP_LOCAL_NAMES` en `apps/api/src/http-host/`, con 3 requisitos y 8 escenarios en el delta de `http-host`. Es poco código (un lector, una búsqueda y una línea de arranque), pero toca la resolución de la salida http. Por eso lleva mutantes y e2e por escenario.
- **Herramientas de desarrollo**: un CRM simulado, una copia de `captacion-leads`, una semilla y un arranque de un comando, con 13 requisitos y 27 escenarios en `dev-simulated-services` (con las correcciones `d3de23f` y `09a430c`). No forman parte de la API ni de la web, y la CI no los arranca.

Lo que no cambia: el formato de flujo, `packages/*`, `apps/web`, el esquema de Prisma, la CI y `pnpm dev`.

### Auditoría de la spec contra el código fusionado

Leído en `main` + `139869e`: `apps/api/src/http-host/**`, `main.ts`, `apps/api/test/{spec-coverage.spec.ts, mutations.json, helpers/*}`, `apps/api/scripts/mutate.mjs`, el script de mutación del motor, `apps/api/src/flows/**`, `apps/web/src/server/config/api-url.mjs`, `apps/web/scripts/local-only.mjs`, `turbo.json`, `package.json`, `.github/workflows/ci.yml` y `packages/spec/examples/captacion-leads.json`. Medido además el comportamiento de `turbo run dev` ante señales (A5).

| # | Lo que decía la spec o se suponía | Lo que dice el código | Dónde se corrige |
|---|---|---|---|
| A1 | «La red del test sustituye solo `HTTP_NETWORK`» | Los e2e sustituyen `HTTP_NETWORK` **y** `HTTP_HOST_CONFIG`. La configuración es la que da el lector real (`loadHttpHostConfig`) con variables de prueba (`test/helpers/conversations-app.ts`). La fábrica de `HTTP_HOST` es código de producción | Nada que cambiar: `FRANCA_HTTP_LOCAL_NAMES` pasa por el lector real, así que los nombres locales son código de producción en los e2e (D3) |
| A2 | La línea de arranque gana los nombres locales | Tres tests comparan la línea **exacta**: `http-host-config.spec.ts` (2) y `http-host-config-edges.spec.ts` (1) | Se actualizan esos tres literales (D4). Son los únicos ficheros de test ya existentes que el diseño abre |
| A3 | Mutantes nuevos en `apps/api/test/mutations.json` | El mutante `ignoreTimeout` busca `const timer = setTimeout(() => controller.abort(), budgetMs);` en `http-host.ts`, y ese texto ya no existe: se movió a `attempt-budget.ts` en #12. El script del motor valida todas las entradas antes de mutar nada, así que `pnpm --filter @franca/api mutate` **aborta hoy sin ejecutar ningún mutante** | Se reapunta `ignoreTimeout` a `attempt-budget.ts` (D15). Sin eso no se puede ejecutar el gate de mutación de este cambio |
| A4 | «La semilla explica el id reservado por un borrado» | `GET /flows/:id` devuelve 404 `flow_not_found` tanto si el id nunca existió como si se borró. Solo `POST /flows` distingue: 409 `flow_id_reserved` frente a 409 `flow_already_exists` (`flows.service.ts`). Publicar no cambia `revision` (`flows.repository.ts`) | El algoritmo de la semilla (D12) crea tras un 404 y lee el motivo en el 409 |
| A5 | «El arranque es dueño de los procesos que lanza» | Medido el 2026-10-17 con turbo 2.11.8 en macOS: turbo arranca **cada tarea en su propio grupo de procesos**. Un `SIGINT` solo al pid del lanzador `node_modules/.bin/turbo` **se ignora**: siguió en marcha más de 5 minutos. Un `SIGINT` al grupo del lanzador (lanzador y binario) dice «Shutting down Turborepo tasks…» y libera los puertos 3000 y 3001 en menos de 1 s. Next deja un proceso auxiliar unos segundos | El arranque lanza turbo en un grupo propio y lo para con una señal al grupo (D6, D7). Ficha nueva en la wiki (D16) |
| A6 | «La semilla usa las mismas reglas y el mismo valor por defecto que la web para `FRANCA_API_URL`» | La regla vive en `apps/web/src/server/config/api-url.mjs` (`parseApiUrl`, `DEFAULT_API_URL`), un módulo ESM puro con `@ts-check` y sin dependencias | La semilla lo **importa** en vez de copiarlo (D11). La web no cambia |
| A7 | «Parada de la demo» cubría `SIGINT`, `SIGTERM` y la caída del CRM | No decía qué pasa si termina lo que arrancó de `pnpm dev` (por ejemplo, un error de compilación). La demo se quedaría con el CRM escuchando y sin API ni web | Corregido en la spec, en un commit propio (`d3de23f`): para el CRM, termina con un código distinto de 0 y lo dice. Escenario «Arranque de la API y la web que termina» |
| A8 | `spec-coverage.spec.ts` exige un `it` por escenario de `http-host` | Exige un `it` por escenario de `flows-api`, `conversations-api`, `http-host` y `flow-validation`. No incluye `dev-simulated-services`, y varios de sus escenarios solo se pueden comprobar a mano | `pnpm check` falla desde `139869e` por los 8 escenarios del delta y vuelve a verde al terminar la fase 2. Los escenarios de la demo se cubren según la tabla «Cobertura» (sin ampliar `spec-coverage`) |
| A9 | Un Ctrl+C es un `SIGINT` | `pnpm dev:demo` corre bajo pnpm 10.18, cuyo ciclo de vida **reenvía `SIGINT` a su hijo** (`pnpm.cjs`, en torno a las líneas 92967 y 92999-93001, señalado en la revisión). La terminal ya lo entrega a todo el grupo en primer plano. El arranque recibe **dos `SIGINT` casi a la vez** por un solo Ctrl+C | D7: una parada en curso ignora cualquier señal nueva, y el único `SIGKILL` es el del plazo de 7 s (revisión, B1) |
| A10 | Desactivar la telemetría de Next exigiría tocar la web | Con el *strict env mode* de turbo, pasan por defecto `TURBO_*` y `NEXT_*` (visto en las cadenas del binario de turbo 2.11.8; se confirma a mano en 6.3). `NEXT_TELEMETRY_DISABLED` llega a `@franca/web#dev` sin `passThroughEnv` | D6: la demo define `NEXT_TELEMETRY_DISABLED=1` y `TURBO_TELEMETRY_DISABLED=1` sin tocar la web. La promesa se limita a que la llamada http y Claude no salen de la máquina (`proposal.md`) |
| A11 | Desde un clon limpio bastan `pnpm install`, `docker compose up -d` y `pnpm dev:demo` | `pnpm dev` no aplica las migraciones. Con una base vacía, la API arranca, pero `GET /flows/:id` responde 500 `internal_error`: una tabla que falta no es «base no disponible» para `database-errors.ts` | La receta pasa a cuatro comandos, con `pnpm --filter @franca/api db:migrate`. La semilla lo explica ante un 500 (requisito nuevo «Semilla sin migraciones», `09a430c`, y C5) |

## Goals / Non-Goals

**Goals**: los de `proposal.md`. Un comando lleva `captacion-leads-local` a `lead-empresa` en el chat, sin Internet y sin credenciales reales. La salida http gana una vía de resolución acotada que no abre ningún destino nuevo.

**Non-Goals**: los de `proposal.md`: `faq-ia`, soporte simulado, TLS local, modos de fallo del CRM, cambios en la web, integrar la demo en `pnpm dev` o en la CI, y Windows. A esto se suman dos más del diseño:
- La demo no comprueba de antemano que los puertos 3000 y 3001 estén libres: eso es lo que ya hace `pnpm dev` (FOLLOW-UP 6.3).
- No hay ninguna variable para cambiar el puerto 4010.

## Decisions

### D1. Dónde vive: `apps/api/demo/`, fuera de `src/`

Las herramientas de la demo viven en una carpeta nueva del paquete de la API, **fuera de `src/`**. Así no se compilan en `dist/`, Nest no las vigila y la guarda estática de `src/http-host/` no las ve. Sus tests están en `apps/api/test/` y corren en el `pnpm check` y el `test:e2e` de la API.

| Alternativa | Por qué no |
|---|---|
| Paquete nuevo del *workspace* (`tools/demo`) | Necesita un `package.json` con sus dependencias y cambia `pnpm-lock.yaml` y `pnpm-workspace.yaml`. Además duplicaría el arnés de los e2e: la base propia del `globalSetup`, `startApi` sobre `dist/main.js` y la PKI. Y los tests de la semilla y de la cadena con la API real necesitan ese arnés |
| `scripts/` de la raíz | No hay ningún paquete turbo que ejecute sus tests, así que no entrarían en `pnpm check`. Y si un test de la API los leyera, la caché de turbo no lo sabría |
| CRM dentro del proceso del arranque | Simplifica (sin IPC), pero el escenario «CRM simulado que termina» habla de un **proceso** que termina, y quedaría sin sentido. Ver D5 para el token |

El arranque lanza también la web, aunque viva en `apps/api/`. Se acepta: es una herramienta de desarrollo cuyo centro es la API, y el contacto con la web es lanzar `turbo run dev` e importar un módulo puro (D11).

### D2. Lenguaje: ESM `.mjs` con JSDoc y `// @ts-check`

`pnpm dev:demo` tiene que funcionar antes de compilar nada: es turbo quien compila la spec y la API. Por eso el código de la demo es JavaScript que Node ejecuta tal cual. El tipado viene de JSDoc con `// @ts-check`, como `apps/web/scripts/local-only.mjs` y `api-url.mjs`.

- **Typecheck**: un proyecto propio, `apps/api/demo/tsconfig.json`, con `allowJs`, `checkJs`, `noEmit`, `declaration: false`, `types: ["node"]` e `include: ["*.mjs"]`. Si TypeScript se queja de `rootDir` al seguir el import de la web, `rootDir: "../.."`. El *script* `typecheck` de la API pasa a `tsc --noEmit -p tsconfig.json && tsc -p demo/tsconfig.json`.
  - **No** se activa `allowJs` en `apps/api/tsconfig.json`. Medido: con `--allowJs`, el typecheck actual falla con `TS4081` en `src/conversations/llm-providers.ts`, una interacción entre `allowJs` y `declaration`.
- **Lint**: el *script* `lint` pasa a `oxlint --type-aware src/ test/ demo/`. Medido: oxlint 1.88 aplica las reglas con tipos (`no-floating-promises`) a un `.mjs`.
- **Cómo los importan los tests**: con un import normal (`import { startCrm } from '../../demo/crm.mjs'`) y una declaración de una línea, `test/demo/mjs-modules.d.ts`: `declare module '*.mjs';`.
  - Medido con el `tsc` 6.0.3 de la API: sin ella, el import da `TS7016`; con ella, el typecheck pasa y lo importado es `any`.
  - El código que corre en los tests es siempre el real, sin dobles. El tipado de la demo lo comprueba su propio proyecto `checkJs`.
  - Hoy ningún fichero TypeScript de la API importa un `.mjs`, así que la declaración no cambia nada más.
  - Descartado: un cargador tipado con interfaces escritas a mano y un test de los nombres exportados. Repite las firmas, y la revisión lo marcó como sobreingeniería.

Descartadas:
- **TypeScript con *type stripping* de Node**: sin *flag* solo desde 22.18, y `engines` dice `>=22`. Además exige imports `.ts`, que `apps/api/tsconfig.json` no admite sin otra opción.
- **TypeScript compilado**: un paso de compilación más antes de la demo.

### D3. Nombres locales: una búsqueda en `resolveName`, encima de la costura

Hay un módulo nuevo, `src/http-host/local-names.ts`:
- `LOCAL_NAMES_VARIABLE` y los tipos `LocalNameEntry` (`{ name, addresses: [{ display, address, family }] }`).
- `readLocalNames(value)`: el lector (D4).
- `LocalNames` (`lookup(hostname): readonly ResolvedEntry[] | undefined`) y `createLocalNames(entries)`: un `Map` exacto por nombre, con las direcciones en el orden escrito.

Integración en `http-host.ts`:

- `HttpHostDeps` gana `localNames?: LocalNames`. **Es opcional**: sin él no hay nombres locales. El arnés de conformidad, `http-host.spec.ts` y el hijo de `http-host-system-network.e2e-spec.ts` no cambian.
  - Ausente es lo seguro: nada nuevo se abre. Si alguien olvidara conectarlo en el módulo, el escenario «CRM con nombre local» fallaría.
- En `resolveName`, después de `literalEntries` y antes de `network.resolver.lookup`:
  ```ts
  const local = localNames?.lookup(url.hostname);
  if (local !== undefined) return { kind: 'entries', entries: local };
  ```
- `http-host.module.ts` pasa `localNames: createLocalNames(config.localNames)`.

Así el orden de un intento no cambia: `url` → secretos → plazo → **resolución (local o del sistema)** → política → conexión. Lo que devuelve un nombre local entra en `decideDestination` exactamente igual que una respuesta del resolutor: se vuelve a analizar, falla cerrado y se compara con los pares permitidos. `127.0.0.1` no es unicast global, así que sin su par permitido el resultado es `blocked` `internal_destination`. **No hay un segundo camino de red**: el abridor y `transport.ts` no cambian.

| Alternativa | Por qué no |
|---|---|
| Un resolutor que envuelve al de la costura (`HttpNetwork.resolver`) | La costura es lo único que sustituyen los tests y no puede tener lógica ([[harness-red-del-test-http]]). En los e2e los nombres locales desaparecerían, y el escenario «la API no ha pedido resolver» no probaría nada |
| `lookup` personalizado en `net.connect` | `network.ts` conecta siempre a una IP literal, con un resolutor que falla a propósito. Resolver allí saltaría la política |
| `/etc/hosts` o `localtest.me` | Descartados en la propuesta: piden permisos de administrador o Internet |

El nombre se compara con `url.hostname`, que WHATWG y el motor entregan en minúsculas («Nombre local en mayúsculas en la url»). La comparación es exacta: `otro.franca.test` o `crm.franca.test.` (con punto final) no son locales y se resuelven como siempre.

### D4. Dónde se valida la variable y cómo se anuncia

- **Validación**: `loadHttpHostConfig` llama a `readLocalNames(env.FRANCA_HTTP_LOCAL_NAMES)` después de los destinos permitidos (orden: orígenes → secretos → destinos → nombres locales). `HttpHostConfig` gana `localNames: readonly LocalNameEntry[]`.
  - `main.ts` ya llama a `loadHttpHostConfig` antes de abrir el puerto y convierte un `ConfigError` en código 1 y un mensaje por `stderr`. **`main.ts` no cambia.**
  - La guarda estática no cambia: el fichero nuevo solo importa módulos relativos y no lee el entorno.
- **Línea de arranque**: `describeHttpHostConfig` añade una cuarta parte, `nombres locales: …`. Formato exacto en «Contrato», C1.
  - Los tres literales de A2 se actualizan con `; nombres locales: ninguno` al final.
  - Los nombres locales no son secretos y se muestran enteros.
- **Sin quitar repetidos**: «un nombre puede repetirse» y la línea muestra lo escrito. Una misma dirección repetida es inocua: `decideDestination` ya quita los objetivos repetidos y cada uno se intenta una vez.

### D5. El token de la ejecución: memoria, IPC y el entorno de turbo

- **Se genera** con `'Bearer ' + randomBytes(32).toString('base64url')`: 256 bits y 43 caracteres de `[A-Za-z0-9_-]`. Cumple la regla de `FRANCA_SECRET_*`.
- **Llega a la API** solo por el entorno del hijo `turbo`, como `FRANCA_SECRET_CRM_TOKEN`. Turbo lo filtra ([[gotcha-turbo-filtra-variables-de-entorno]]) y solo lo pasa a `@franca/api#dev`, que ya declara `FRANCA_SECRET_*`. La web y los `dev` de los paquetes no lo reciben. El `process.env` del arranque no se modifica: el entorno del hijo es un objeto nuevo.
- **Llega al CRM** por el canal IPC de `fork`, en el mensaje `start`, nunca en su entorno ni en sus argumentos. El CRM arranca con el entorno mínimo (`PATH`).
- **No llega a ningún sitio más**:
  - Ni a la línea de comandos: `ps` no lo muestra sin `e`.
  - Ni a un fichero: la spec lo prohíbe, y además las guardas de ficheros de entorno darían problemas ([[harness-guard-env-falsos-positivos]]).
  - Ni a la salida: ningún mensaje de la demo interpola el token. La API nunca imprime valores de secreto, y el CRM no registra cabeceras.
- **Límite aceptado (R7)**: `ps eww` muestra el entorno de los procesos del mismo usuario (turbo, sus envoltorios y la API). Es el límite de todos los secretos ([[decision-salida-http-politica]]), y el token solo abre un CRM simulado durante una ejecución.

Descartadas:
- Pasarlo por argumentos: visible en `ps`.
- Por un fichero con permisos `0600`: escribe en disco.
- Por el entorno del CRM: innecesario, porque el IPC ya existe para el arranque (D8).

### D6. Cómo convive con turbo

- **La demo arranca lo mismo que `pnpm dev`**: el arranque lanza `node_modules/.bin/turbo run dev --ui=stream --no-daemon` desde la raíz del repositorio, con `detached: true`, la entrada `ignore` y la salida heredada.
  - `detached` da a turbo un grupo propio para poder pararlo (A5, D7).
  - `--ui=stream` fija la interfaz de líneas: un grupo en segundo plano no puede tener la terminal, que sí necesitaría la interfaz interactiva de turbo.
  - `--no-daemon` evita que turbo deje un proceso de larga vida que hereda el entorno de esta ejecución, token incluido.
  - Las tareas son las mismas que las de `pnpm dev`.
- **`turbo.json`**:
  - `FRANCA_HTTP_LOCAL_NAMES` entra en el `passThroughEnv` de `@franca/api#dev`. Sin eso, la API de la demo no vería la variable y la conversación terminaría en `lead-sin-enviar`. También sirve para quien la defina con `pnpm dev`.
  - Hay una tarea nueva, `@franca/api#test`, con el mismo `dependsOn` que `test` (`["^build", "db:generate"]`) y estos `inputs`, el mismo patrón que `@franca/web#test`:
    - `$TURBO_DEFAULT$`;
    - `$TURBO_ROOT$/apps/web/src/server/config/api-url.mjs`, del que dependen la semilla y sus tests (D11);
    - `$TURBO_ROOT$/openspec/**`, que lee `spec-coverage.spec.ts`;
    - `$TURBO_ROOT$/packages/engine/tests/helpers/spec-text.ts`, que compara `spec-text-parity.spec.ts`.

    **Esto cierra el FOLLOW-UP 7.6 de `web-chat`**: la caché local ya no puede dar por buena una spec cambiada.
  - Hay también `@franca/api#lint` y `@franca/api#typecheck` con su `dependsOn` actual (`["^build", "db:generate"]`) e `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/apps/web/src/server/config/api-url.mjs"]`. El proyecto `checkJs` de la demo y oxlint con tipos leen ese fichero al seguir el import.
  - En la CI no hay caché, así que estos `inputs` solo cambian las ejecuciones locales.
- **El entorno de turbo** es el de la shell menos `FRANCA_ANTHROPIC_API_KEY`, más las cuatro variables de C3, `NEXT_TELEMETRY_DISABLED=1` y `TURBO_TELEMETRY_DISABLED=1`.
  - Las dos de telemetría pasan el filtro de turbo sin declararlas (A10). Con ellas, ni Next ni turbo envían telemetría durante la demo, sin tocar la web.
  - Otras herramientas (Prisma, el aviso de versiones de pnpm) pueden intentar sus comprobaciones. La demo **no** promete cortarlas: promete que la llamada http del flujo y Claude no salen de la máquina (`proposal.md`).
  - `FRANCA_API_URL`, `HOST`, `PORT` y `DATABASE_URL` pasan sin tocar.

### D7. Parada: una señal al grupo, un plazo y una comprobación de puertos

El CRM se lanza con `fork` y `detached: true`. Así el Ctrl+C de la terminal (que va al grupo en primer plano: pnpm y el arranque) **solo** le llega al arranque, que es el único que decide la parada. Le llega **dos veces**: una de la terminal y otra que reenvía pnpm (A9). Todas las causas siguen el mismo camino, `stopAll(motivo)`:

| Causa | Qué hace la demo | Código de salida |
|---|---|---|
| `SIGINT` (Ctrl+C) | Para todo | 130 |
| `SIGTERM` | Para todo | 143 |
| `SIGHUP` (se cierra la terminal) | Para todo. Con `detached`, turbo está en otra sesión y no recibe el `SIGHUP` de la terminal: si el arranque no lo atendiera, turbo y sus tareas quedarían huérfanos | 129 |
| El CRM termina sin que se le pida | «El CRM simulado se ha parado…» y para el resto | 1 |
| turbo termina solo | «`pnpm dev` ha terminado…» y para el CRM | El de turbo, o 1 si fue 0 o una señal |

Pasos de `stopAll`:
1. Envía `SIGINT` al grupo de turbo (`process.kill(-pid, 'SIGINT')`) y `{type: 'stop'}` al CRM.
2. Espera a que salgan los dos, como mucho **7 s**. Después, `SIGKILL` al grupo de turbo y al CRM. Las tareas de turbo están en sus propios grupos y solo turbo puede pararlas, así que un `SIGKILL` puede dejarlas huérfanas. Por eso sigue el paso 3.
3. Comprueba durante 2 s como mucho que **nada acepta conexiones** en 3000, `PORT` (3001 por defecto) y 4010, en `127.0.0.1` y en `::1` (la API puede escuchar en `::1` con `HOST`). Si queda algo, lo dice por dirección y puerto, con la orden `lsof` para encontrarlo, y termina con 1.

**Una parada no se escala por señales.** Mientras `stopAll` está en curso, cualquier `SIGINT`, `SIGTERM` o `SIGHUP` nuevo se ignora, y el código de salida es el de la primera causa. El único `SIGKILL` es el del plazo de 7 s.

- Descartado: que «un segundo Ctrl+C» fuerce el `SIGKILL`, como proponía la primera versión. Por A9, un solo Ctrl+C ya llega como dos `SIGINT`, así que mataría turbo al momento y dejaría las tareas huérfanas, con 3000 y 3001 ocupados (revisión, B1).
- Descartado también: una ventana de 1 s para agrupar señales. Da el mismo resultado con un temporizador más.
- Quien necesite matarlo todo ya puede hacerlo desde otra terminal.

El total es como mucho de 9 s, dentro de los 10 s de «Parada con Ctrl+C». Medido (A5): con `SIGINT` al grupo, los puertos se liberan en menos de 1 s. La verificación final repite la medida **a través de `pnpm dev:demo`** en una terminal real, no con el binario de turbo a pelo (tasks, 6.5).

- **El CRM se protege solo**: termina al recibir `{type: 'stop'}`, `SIGTERM` o al perder el canal IPC (`disconnect`, si el arranque muere de golpe), y **ignora `SIGINT`**. Así una carrera entre el Ctrl+C y el aviso de salida no se confunde con «el CRM se ha parado».
- **Límite aceptado**: si el arranque recibe `SIGKILL`, turbo y sus tareas quedan huérfanos, igual que con `pnpm dev`.

### D8. Puerto 4010 ocupado: lo detecta el propio CRM, antes de turbo

El arranque hace `fork` del CRM, le envía `{type: 'start', token, port: 4010}` y espera hasta 5 s su respuesta: `{type: 'listening', port}` o `{type: 'failed', code}`. Con `failed` (`EADDRINUSE` u otro código), o sin respuesta, la demo termina con 1 **sin lanzar turbo** y con un mensaje que nombra el puerto 4010 (C4). Descartado: sondear el puerto antes de escuchar. Es un TOCTOU y además un segundo camino que mantener.

### D9. Variables en conflicto y clave de Claude

- **Conflictos**: antes de crear el token o lanzar nada, `findConflicts(env)` devuelve, en orden fijo, los nombres de C3 para los que `Object.hasOwn(env, nombre)` es cierto (con `""` incluido). Si hay alguno, la demo escribe el mensaje de C4 (solo nombres) y termina con 1.
- **Claude**: no es un conflicto. `buildApiEnvironment` quita `FRANCA_ANTHROPIC_API_KEY` y la demo **siempre** escribe que no usa Claude. Si la shell tenía la clave, añade que la ha quitado, sin el valor. La API, sin la clave, ya escribe «sin proveedor llm principal…» (`conversations.module.ts`).
- Otras `FRANCA_SECRET_*` de la shell pasan sin tocar: la API las ignora si no tienen origen y las lista en su línea de arranque. La spec no las cuenta como conflicto.

### D10. Copia local y paridad

`apps/api/demo/captacion-leads-local.json` es una copia literal de `packages/spec/examples/captacion-leads.json` en la que cambian:
- `id`: `captacion-leads-local`
- `name`: `Captación de leads (local)`
- `description`: `Copia de captacion-leads para la demo local: envía el lead al CRM simulado.`
- `nodes[6].request.url`: `http://crm.franca.test:4010/api/leads`

El test de paridad (C6) la compara con el ejemplo que resuelve `@franca/spec` (`test/helpers/examples.ts`), y `validateFlow` la valida. Un segundo test cruza la copia con la configuración de la demo:
- el origen de la `url` está en `FRANCA_HTTP_SECRET_ORIGINS`;
- su host, en `FRANCA_HTTP_LOCAL_NAMES`;
- y `127.0.0.1:<puerto>`, en `FRANCA_HTTP_ALLOWED_DESTINATIONS`.

Así las constantes espejadas fallan juntas.

Descartado: generar la copia al sembrar a partir del ejemplo. No tendría deriva, pero la spec pide que el repositorio la incluya, y quien la lea en el editor no la vería.

### D11. Cliente HTTP de la semilla

- **Destino**: `parseApiUrl(env.FRANCA_API_URL)` **importado** de `apps/web/src/server/config/api-url.mjs`. Da las mismas reglas, el mismo valor por defecto y el mismo error (que nombra `FRANCA_API_URL` sin el valor). Si el valor no vale, la semilla termina con 1 **sin hacer ninguna petición**.
- **Transporte**: `node:http.request` con `agent: false`, `host` y `port` del destino, la cabecera `Host` = `hostHeader` y **ninguna cabecera `Origin`** (la API respondería 403 `forbidden_origin`).
  - Con `agent: false` no se usa `http.globalAgent`, que es lo que desvía `NODE_USE_ENV_PROXY` ([[gotcha-node-http-createconnection-y-proxy]]). Aquí no se usa `createConnection`, así que la trampa de `agent: false` no aplica.
  - Para `localhost` intenta `127.0.0.1` y, si la conexión se rechaza, `::1`, sin DNS.
- **Límites**: cada petición tiene 5 s y la semilla entera, 12 s (`AbortSignal`), para cumplir «en menos de 15 segundos». La respuesta se corta a los 4 MiB.
- **Errores**:
  - Conexión rechazada o cortada antes de responder: `unreachable`.
  - Plazo agotado: `timeout`.
  - 503 `database_unavailable`: un motivo propio. Es el caso «Postgres parado», que la API responde rápido (`database-unavailable.e2e-spec.ts`).
  - 500 a la primera lectura: el motivo «sin migraciones» (C5).
- **Del cuerpo de un error** solo se imprime el campo `error`, y solo si cumple `^[a-z_]{1,64}$`. Si no, se omite. Así un cuerpo inesperado, o de otro servicio en ese puerto, no puede meter texto en la salida.
- El arranque usa el mismo cliente para esperar a la API (D13).

### D12. Semilla idempotente contra la API real

Siembra **un solo flujo**, `captacion-leads-local`, con el algoritmo de C5. No hay una lista de flujos: hoy solo hay una copia, y generalizar es trivial cuando llegue la de `faq-ia` (FOLLOW-UP 7.1). En resumen:
- Lee el flujo.
- Si no existe, lo crea. Si el `id` está reservado, lo dice.
- Si el borrador no es igual a la copia como JSON (`util.isDeepStrictEqual` sobre el `flow` leído), no lo toca.
- Si lo es, publica con `If-Match` (el `ETag` leído), y un 201 o un 200 dicen qué ha pasado.
- Si la primera lectura responde 500, apunta a las migraciones sin aplicar (A11, «Semilla sin migraciones»).

Es idempotente porque publicar sin cambios devuelve 200 con la última versión, sin escribir, y no cambia `revision` (A4). El `If-Match` evita publicar un borrador que alguien cambió entre la lectura y la publicación. Un `unreachable`, un `timeout`, un `database_unavailable` cortan la semilla entera, porque afectan a todos los flujos.

### D13. Espera a la API antes de sembrar

Tras `listening` del CRM y el lanzamiento de turbo, el arranque pide `GET /` a la API (lo atiende `AppController` sin tocar la base) cada 500 ms, con 2 s por intento, hasta recibir **cualquier** respuesta HTTP o hasta que pasen 120 s. Una parada en curso corta la espera.

- Si la API responde, ejecuta `seedDemo` en el mismo proceso, con su salida.
- Si no responde a tiempo, o la semilla falla, escribe el motivo y `pnpm demo:seed` (C4) y **sigue en marcha**.

### D14. Dónde van los tests y qué arrancan

- **Unit** (`pnpm check`):
  - Los nombres locales: `src/http-host/local-names.spec.ts`.
  - La demo: `test/demo/*.spec.ts`. Usan servidores reales en `127.0.0.1:0` y procesos `node` hijos para el CRM con IPC y para el arranque con variables en conflicto.
  - Ningún test usa el 4010, ni comprueba que los puertos 3000 y 3001 estén libres: un `pnpm dev` abierto mientras se ejecuta `pnpm check` lo haría intermitente.
  - El arranque se prueba con `runDemo(deps)` y dobles de los procesos. Son dobles **de procesos**, no de integraciones con otro código: la costura con turbo se comprueba a mano (6.x), y la costura con la API se prueba con la API real en los e2e.
- **e2e** (`pnpm test:e2e`, con la base del `globalSetup`):
  - Los escenarios de `http-host` con `startWorld` (la red del test) y con el proceso real para el arranque.
  - La semilla contra el proceso real de la API (`startApi` con `inject('databaseUrl')` y `PORT=0`).
  - «Base de datos sin migraciones para la semilla»: el test crea una base vacía en el mismo Postgres (el usuario de los e2e puede crearla: el `globalSetup` ya lo hace), arranca contra ella otra API real y la borra al terminar.
  - La cadena de la demo con el proceso real, `systemNetwork()` y el CRM simulado de verdad en un puerto libre. Como el puerto cambia, la copia se publica con **solo** el puerto de la `url` sustituido.
    - Es el único test que prueba toda la conexión de producción de los nombres locales: entorno → `main.ts` → módulo → `resolveName` → política → `net.connect`.
    - `crm.franca.test` no resuelve en ninguna máquina (`.test`), así que si se llegara a consultar el DNS, la petición no llegaría al CRM.

### D15. Mutantes

Entradas nuevas en `apps/api/test/mutations.json`. El `find` exacto se fija al escribir el código, y cada una debe aparecer exactamente una vez.

**Solo matan los tests que ejecutan `src/`** en el mismo proceso de Vitest: unit, y e2e con `startWorld` o `createTestApp`. `scripts/mutate.mjs` compila `dist/` **antes** de mutar, así que los tests que lanzan `dist/main.js` (`http-host-local-names-startup.e2e-spec.ts` y `demo.e2e-spec.ts`) nunca ven el mutante. No van en ninguna lista de «Lo matan» (revisión). Por eso cada valor de «Nombres locales no admitidos» tiene también un caso en el unit.

| id | Fichero | Qué rompe | Lo matan |
|---|---|---|---|
| `localNameAnySuffix` | `local-names.ts` | Acepta nombres que no terminan en `.test` | `src/http-host/local-names.spec.ts` (los valores de «Nombres locales no admitidos»: `crm.example.com=…`, `localhost=…`) |
| `localNameNotSerialized` | `local-names.ts` | Quita la comparación con la serialización WHATWG | Los mismos (`CRM.franca.test=…`, la entrada con espacio) |
| `localNameAnyIpv4` | `local-names.ts` | Cualquier IPv4 bien escrita vale como dirección | Los mismos (`10.0.0.5`, `1.2.3.4`) |
| `localNameAnyIpv6` | `local-names.ts` | Cualquier IPv6 entre corchetes vale | Los mismos (`[::2]`, `[::ffff:127.0.0.1]`) |
| `localNameSkipsPolicy` | `http-host.ts` | Un nombre local conecta sin `decideDestination` | `test/http-host-local-names.e2e-spec.ts` («Nombre local sin destino permitido») |
| `localNameAlsoResolves` | `http-host.ts` | Pregunta además al resolutor (con `catch`) y usa lo local | Ídem («CRM con nombre local», «Nombre local en mayúsculas en la url») |
| `localNameFirstAddressOnly` | `local-names.ts` | Se queda solo con la primera dirección de un nombre | Ídem («Orden de las direcciones de un nombre local») |
| `localNameMatchesAnyTest` | `local-names.ts` | `lookup` devuelve las direcciones del primer nombre local para cualquier host `.test` | Ídem («Nombres que no son locales») |
| `localNamesNotWired` | `http-host.module.ts` | La fábrica no pasa `localNames` | Ídem («CRM con nombre local»: `startWorld` crea el módulo desde `src/`) |

Además, **`ignoreTimeout` se reapunta** (A3) a `src/http-host/attempt-budget.ts`: `find` `      else controller.abort();` y `replace` `      else void 0;`, con los mismos tests. No es un mutante nuevo: es la reparación del que ya existe.

Las herramientas de la demo no tienen mutantes: no son un componente de seguridad, y su frontera (el token, los conflictos y no escribir valores) se prueba con tests negativos validados a mano (tasks, 4.6).

### D16. Meta

- `decision-salida-http-politica.md` gana un apartado «Nombres locales»:
  - Por qué solo `.test` (RFC 6761: no tapa un dominio real) y solo loopback.
  - Por qué encima de la costura y debajo de la política.
  - Por qué no `localtest.me` (DNS de un tercero, routers que filtran) ni `/etc/hosts`.
  - Enforcement: los mutantes `localName*`.
- Ficha nueva `gotcha-turbo-senal-al-grupo.md`:
  - Turbo ignora un `SIGINT` a su pid si no le llega también al binario, y ejecuta cada tarea en su propio grupo.
  - Para pararlo, una señal al grupo del lanzador; un `SIGKILL` deja las tareas huérfanas.
  - Medido con turbo 2.11.8 el 2026-10-17.
  - `metadata.enforcement`: `apps/api/test/demo/dev-demo.spec.ts` (la parada envía la señal al grupo) y la comprobación de puertos al parar.
  - Su línea va en el índice de `.claude/rules/always/knowledge-wiki.md`.

## Contrato

### C1. `FRANCA_HTTP_LOCAL_NAMES` (API)

**Gramática**: `valor = "" | entrada *("," entrada)`, con `entrada = nombre "=" dirección`. Se separa por la **primera** `=` de cada entrada.

- **`nombre`**, todo a la vez:
  - `new URL("http://" + nombre).origin === "http://" + nombre`. Rechaza mayúsculas, puerto, ruta, usuario, espacios y controles que WHATWG quitaría ([[gotcha-url-whatwg-normaliza]]).
  - Termina en `.test` y tiene algo delante: `test` y `.test` no valen.
  - El motor lo admite como host de la `url` de un nodo `http`. Se pregunta con `isNodeUrlOrigin("http://" + nombre)`, la sonda que ya usan los orígenes de los secretos. No se copia la regla.
- **`dirección`**: `127.a.b.c`, con cada octeto `0|[1-9][0-9]{0,2}` de valor ≤ 255, o exactamente `[::1]`. Se guarda como `{ display: <texto escrito>, address: '127.a.b.c' | '::1', family: 4 | 6 }`.
- **Ausente o `""`**: no hay nombres locales.

**Errores de arranque**: `ConfigError`, código 1 y una línea por `stderr` antes de abrir el puerto. El mensaje nunca contiene el valor.

| Caso | Mensaje |
|---|---|
| Entrada vacía (coma al principio o al final, `,,`, `,`) | `FRANCA_HTTP_LOCAL_NAMES no es válida: la entrada nº <n> está vacía (sobra una coma o un espacio).` |
| Sin `=` o con un `nombre` que no vale (también `" "`) | `FRANCA_HTTP_LOCAL_NAMES no es válida: la entrada nº <n> debe ser nombre=dirección, con un nombre de dominio en minúsculas terminado en .test (sin punto final, puerto, ruta ni espacios).` |
| `dirección` que no vale | `FRANCA_HTTP_LOCAL_NAMES no es válida: la entrada nº <n> debe llevar una dirección de loopback: una IPv4 de 127.0.0.0/8 en decimal sin ceros a la izquierda, o [::1], sin puerto.` |

**Resolución**: si `url.hostname` es exactamente un `nombre` de la lista, la resolución es `[{address, family}, …]`, en el orden escrito y con todas las entradas de ese nombre, sin llamar a `network.resolver`. El resto del intento no cambia.

**Línea de arranque**: `salida http: secretos …; variables ignoradas: …; destinos permitidos: …; nombres locales: <lista>`.
- `<lista>` es `ninguno`, o `<nombre> (<dir>, <dir>)` separados por `, `.
- Los nombres van por orden de primera aparición, y las direcciones como se escribieron.
- Ejemplo con la configuración de la demo:
  ```
  salida http: secretos CRM_TOKEN (http://crm.franca.test:4010); variables ignoradas: ninguna; destinos permitidos: 127.0.0.1:4010; nombres locales: crm.franca.test (127.0.0.1)
  ```

### C2. CRM simulado (`apps/api/demo/crm.mjs`)

- **Exporta**:
  - `createCrmHandler({ token, log })`: el manejador de `node:http`.
  - `startCrm({ token, port, log })`: escucha en `127.0.0.1:<port>` y resuelve `{ port, close() }`; si `listen` falla, rechaza con el `code` del sistema.
- **Como proceso** (`fork`), por IPC:
  - Recibe `{type: 'start', token, port}` y responde `{type: 'listening', port}` o `{type: 'failed', code}`.
  - Termina con `{type: 'stop'}`, `SIGTERM` o `disconnect`, e ignora `SIGINT`.
  - Sin canal IPC, escribe «El CRM simulado se arranca con pnpm dev:demo.» y termina con 2.
- **Comprobaciones**, en este orden; se responde con la primera que falla:

| # | Comprobación | Si falla |
|---|---|---|
| 1 | `método === 'POST'` y la ruta (`req.url` hasta el primer `?`) `=== '/api/leads'` | 404 `{"error":"not_found"}` |
| 2 | `authorization` igual al token (longitud y luego `timingSafeEqual`) | 401 `{"error":"unauthorized"}` |
| 3 | El tipo de medio de `content-type` (antes de `;`, sin espacios y en minúsculas) `=== 'application/json'` | 400 `{"error":"unsupported_media_type"}` |
| 4 | Cuerpo de 64 KiB como mucho, UTF-8, que `JSON.parse` convierte en un objeto (ni `null` ni array) | 400 `{"error":"invalid_body"}` |
| — | Todo bien: `n += 1` | 201 `{"id":"L-<n>"}` |

- **Respuestas**: siempre `Content-Type: application/json` y `Connection: close`. Los errores no repiten nada de la petición, y el contador solo sube en un 201. Con 404 y 401 el cuerpo no se interpreta: se drena con `req.resume()` **antes** de responder, para que el cliente no reciba un `ECONNRESET` mientras aún envía.
- **Registro**: una línea por petición, `[crm simulado] <MÉTODO> <ruta> <status>[ L-<n>]`.
  - La ruta va sin consulta, cortada a 200 caracteres, y lo que no es ASCII visible se escribe como `?`.
  - Al escuchar: `[crm simulado] escuchando en 127.0.0.1:<port>`.
  - Nunca escribe cabeceras, consulta ni cuerpo. No escribe nada en disco.

### C3. Configuración que fija la demo (`apps/api/demo/demo-config.mjs`)

| Variable | Valor |
|---|---|
| `FRANCA_HTTP_LOCAL_NAMES` | `crm.franca.test=127.0.0.1` |
| `FRANCA_HTTP_ALLOWED_DESTINATIONS` | `127.0.0.1:<crmPort>` (4010) |
| `FRANCA_HTTP_SECRET_ORIGINS` | `CRM_TOKEN=http://crm.franca.test:<crmPort>` |
| `FRANCA_SECRET_CRM_TOKEN` | El token de la ejecución (D5) |

`demoHttpVariables({ token, crmPort = 4010 })` las construye. Los e2e la llaman con un puerto libre, y un test fija los valores por defecto contra la spec. `DEMO_VARIABLE_NAMES` son esos cuatro nombres, en ese orden: es la lista de conflictos.

### C4. Arranque (`pnpm dev:demo` → `node apps/api/demo/dev-demo.mjs`)

**Secuencia**: conflictos → token → aviso de Claude → `fork` del CRM y espera de `listening` (5 s) → turbo → espera de la API (120 s) → semilla → «Lista».

**Mensajes**, con el prefijo `[demo] `:

| Momento | Texto | Sale con |
|---|---|---|
| Conflicto | `La demo no arranca: la shell ya define <A>, <B>. La demo fija esas variables ella misma: quítalas con unset o usa pnpm dev.` | 1 |
| Claude | `La demo no usa Claude: la API arranca sin FRANCA_ANTHROPIC_API_KEY y los nodos llm terminan en llm_not_configured.` Si la shell la tenía, añade ` (se ha quitado la de la shell)` | — |
| CRM sin puerto | `La demo no arranca: el CRM simulado no puede escuchar en 127.0.0.1:4010 (<puerto 4010 ocupado \| código>).` | 1 |
| CRM listo | `CRM simulado en http://127.0.0.1:4010 (crm.franca.test). Arrancando la API y la web (pnpm dev)…` | — |
| API lista | `La API responde; sembrando la copia local…` | — |
| Semilla correcta | `Lista: abre http://localhost:3000 y prueba «Captación de leads (local)». Ctrl+C para parar.` | — |
| Semilla fallida | `La semilla no ha terminado bien (motivo arriba); la demo sigue en marcha. Puedes repetirla con pnpm demo:seed.` | — |
| API sin respuesta | `La API no ha respondido en 120 s; la demo sigue en marcha. Cuando arranque, siembra con pnpm demo:seed.` | — |
| Parada | `Parando…` y después `Parada.` Las señales que lleguen durante la parada no escriben nada ni cambian el código | 130 / 143 / 129 |
| El CRM termina | `El CRM simulado se ha parado (código <c>); paro la API y la web.` | 1 |
| turbo termina | `pnpm dev ha terminado (código <c>); paro el CRM simulado.` | `<c>`, o 1 si fue 0 o una señal |
| Puerto ocupado tras parar | `Atención: algo sigue escuchando en <127.0.0.1 \| [::1]>:<p>; búscalo con lsof -nP -iTCP:<p> -sTCP:LISTEN.` | 1 |

### C5. Semilla (`pnpm demo:seed` → `node apps/api/demo/seed.mjs`)

**Exporta**: `seedDemo({ env, write, request? })` → `Promise<{ ok: boolean }>`, y `requestApi`. Como proceso: código 0 si `ok` y 1 si no.

**Algoritmo**, con `F` = `captacion-leads-local` y `copia = JSON.parse(fichero)`:

1. Valida `FRANCA_API_URL` (D11). Si no vale, escribe el error y termina con 1 sin peticiones.
2. `GET /flows/F`:
   - **200**: si `isDeepStrictEqual(body.flow, copia)` es falso, `F` queda «no tocado» (mal). Si es cierto, `etag = ETag` y se va al paso 4.
   - **404 `flow_not_found`**: paso 3.
   - **500** (en la primera lectura, no al repetirla tras un 409): «sin migraciones» (mal).
   - Cualquier otra respuesta: «inesperada».
3. `POST /flows` con `JSON.stringify(copia)` y `Content-Type: application/json`:
   - **201**: `etag = ETag` y se marca «creado»; paso 4.
   - **409 `flow_id_reserved`**: «reservado» (mal).
   - **409 `flow_already_exists`**: otro proceso lo creó entre medias. Vuelve al paso 2 **una sola vez**.
   - Cualquier otra respuesta: «inesperada».
4. `POST /flows/F/versions` con `If-Match: etag`:
   - **201**: «publicado (versión v)», o «creado y publicado» si venía del paso 3.
   - **200**: «ya estaba publicado (versión v)».
   - **412 `revision_mismatch`**: «cambió mientras se sembraba» (mal).
   - Cualquier otra respuesta: «inesperada».
   - En los dos casos buenos se comprueba además `isDeepStrictEqual(body.flow, copia)`; si no coincide, «inesperada».
5. En cualquier paso, `unreachable`, `timeout` o 503 `database_unavailable` cortan la semilla con su mensaje.

**Mensajes** (una línea cada uno, prefijo `[semilla] `):

| Resultado | Texto |
|---|---|
| Creado y publicado | `captacion-leads-local: creado y publicado (versión 1).` |
| Publicado | `captacion-leads-local: publicado (versión <v>).` |
| Al día | `captacion-leads-local: ya estaba publicado (versión <v>).` |
| No tocado | `captacion-leads-local: su borrador no es la copia de la demo y no se ha tocado. Para volver a la copia, sustituye el borrador por apps/api/demo/captacion-leads-local.json.` |
| Cambió | `captacion-leads-local: el borrador ha cambiado mientras se sembraba y no se ha publicado. Repite pnpm demo:seed.` |
| Reservado | `captacion-leads-local: el id captacion-leads-local está reservado por un borrado y la API no deja reutilizarlo. Solo se recupera borrando la base de datos local (docker compose down -v), que borra todos los flujos y conversaciones.` |
| Inesperada | `captacion-leads-local: respuesta inesperada de la API (HTTP <status>[, <error>]).` |
| Sin conexión | `No puedo conectar con la API de Franca en http://<hostHeader>. ¿Está arrancada (pnpm dev o pnpm dev:demo)?` |
| Plazo agotado | `La API de Franca en http://<hostHeader> no ha respondido a tiempo.` |
| Sin base de datos | `La base de datos de la API no responde: arráncala con docker compose up -d y repite pnpm demo:seed.` |
| Sin migraciones | `captacion-leads-local: la API ha respondido 500 al leerlo. Si la base de datos es nueva, aplica las migraciones con pnpm --filter @franca/api db:migrate y repite pnpm demo:seed.` |
| `FRANCA_API_URL` | El mensaje de `ApiUrlError`, que nombra la variable |

`<error>` es el campo `error` del cuerpo, solo si cumple `^[a-z_]{1,64}$` (D11). Del cuerpo no se escribe nada más.

### C6. Paridad de la copia

`omit(copia) ≡ omit(ejemplo)` como JSON, donde `omit` quita `id`, `name`, `description` y `nodes[6].request.url`, y `nodes[6].id === 'enviar-crm'`. Además, los cuatro valores de D10 y `validateFlow(copia)` = `{ valid: true, warnings: [] }`.

### Checklist de coherencia

- [x] Cada variable de C3 la lee la API (`loadHttpHostConfig`) y la deja pasar turbo (`passThroughEnv`): `FRANCA_HTTP_LOCAL_NAMES` es la única nueva.
- [x] Cada valor de C3 coincide con la copia (test cruzado de D10) y con la spec («Configuración de la salida http de la demo»).
- [x] El CRM responde 201 con `{"id":…}`; la copia no lee la respuesta (`enviar-crm` no tiene `saveAs`), y el motor acepta cualquier 2xx.
- [x] Cada error de la API que puede ver la semilla tiene su rama: 404, 409 ×2, 412, 500 (primera lectura), 503 y el resto como «inesperada».
- [x] Ningún mensaje de la demo, la semilla ni el CRM interpola un valor de secreto, de `FRANCA_API_URL` o de una variable en conflicto.
- [x] Constantes espejadas: copia ↔ ejemplo (C6), copia ↔ C3 (D10) y `parseApiUrl` importado, no copiado (D11).
- [x] Ficheros ajenos que abre el diseño: los tres tests de A2 (necesarios: la línea cambia por la spec), `mutations.json` (A3), `http-host-config.ts`, `http-host.ts` y `http-host.module.ts` (el requisito es suyo), y la configuración y la documentación de la tabla «Ficheros». Ni `apps/web` ni `packages/` ni `main.ts`.

## Ficheros

Criterio de diff: `git diff --name-only main...HEAD` solo puede listar estos ficheros. Un fichero que falte se añade antes aquí, con su porqué.

| Fichero | Cambio | Fase |
|---|---|---|
| `apps/api/src/http-host/local-names.ts` | nuevo: lector, `LocalNames` y `createLocalNames` | 1 |
| `apps/api/src/http-host/local-names.spec.ts` | nuevo: unit del lector, de la búsqueda y de `createHttpHost` con nombres locales | 1 |
| `apps/api/src/http-host/http-host-config.ts` | `localNames` en `HttpHostConfig`, lectura y línea de arranque | 1 |
| `apps/api/src/http-host/http-host.ts` | `localNames?` en `HttpHostDeps` y búsqueda en `resolveName` | 1 |
| `apps/api/src/http-host/http-host.module.ts` | pasa `localNames` a `createHttpHost` | 1 |
| `apps/api/src/http-host/http-host-config.spec.ts` | 2 literales de la línea de arranque (A2) | 1 |
| `apps/api/src/http-host/http-host-config-edges.spec.ts` | 1 literal de la línea de arranque (A2) | 1 |
| `turbo.json` | `FRANCA_HTTP_LOCAL_NAMES` en `@franca/api#dev`; tareas `@franca/api#test`, `#lint` y `#typecheck` con `inputs` (D6) | 1 |
| `apps/api/test/http-host-local-names.e2e-spec.ts` | nuevo: 5 escenarios de resolución | 2 |
| `apps/api/test/http-host-local-names-startup.e2e-spec.ts` | nuevo: 3 escenarios de arranque (proceso real) | 2 |
| `apps/api/test/mutations.json` | 9 mutantes nuevos y `ignoreTimeout` reapuntado (D15) | 2 |
| `apps/api/demo/captacion-leads-local.json` | nuevo: la copia (D10) | 3 |
| `apps/api/demo/demo-config.mjs` | nuevo: C3, `findConflicts`, `buildApiEnvironment` y `createRunToken` | 3 |
| `apps/api/demo/crm.mjs` | nuevo: C2 | 3 |
| `apps/api/demo/seed.mjs` | nuevo: C5 y `requestApi` | 3 |
| `apps/api/demo/dev-demo.mjs` | nuevo: C4 (`runDemo(deps)` y `main` con los procesos reales) | 3 |
| `apps/api/demo/tsconfig.json` | nuevo: proyecto `checkJs` (D2) | 3 |
| `apps/api/package.json` | `lint` con `demo/` y `typecheck` con el proyecto de la demo | 3 |
| `package.json` | `dev:demo` y `demo:seed` | 3 |
| `apps/api/test/demo/mjs-modules.d.ts` | nuevo: `declare module '*.mjs';` (D2) | 3 |
| `apps/api/test/demo/demo-config.spec.ts`, `captacion-leads-local.spec.ts`, `crm.spec.ts`, `seed.spec.ts` | nuevos: unit | 3 |
| `apps/api/test/demo/dev-demo.spec.ts` | nuevo: unit del arranque con dobles y proceso real con conflictos | 4 |
| `apps/api/test/demo-seed.e2e-spec.ts` | nuevo: la semilla contra el proceso real | 4 |
| `apps/api/test/demo.e2e-spec.ts` | nuevo: la cadena con `systemNetwork`, el CRM y la copia | 4 |
| `README.md`, `apps/api/README.md`, `CLAUDE.md` | variable y comandos, sin valores | 5 |
| `.claude/wiki/decision-salida-http-politica.md`, `.claude/wiki/gotcha-turbo-senal-al-grupo.md`, `.claude/rules/always/knowledge-wiki.md` | D16 | 5 |
| `openspec/changes/dev-servicios-simulados/**` | artefactos | todas |

`git diff --name-only main...HEAD -- apps/web packages apps/api/src/main.ts apps/api/prisma .github pnpm-lock.yaml pnpm-workspace.yaml` no imprime nada en ningún gate.

## Cobertura de los escenarios

Los de `http-host` llevan un `it` con el título exacto (lo exige `spec-coverage.spec.ts`). Los de `dev-simulated-services`, también cuando son automatizables. Los marcados «manual» se comprueban en la verificación final (tasks, 6.x), y el test automático que los acompaña cubre la parte que no necesita el navegador ni la red de la máquina.

| Escenario | Dónde |
|---|---|
| Nombres locales no admitidos | `test/http-host-local-names-startup.e2e-spec.ts` (proceso real, en paralelo) + unit |
| Entradas vacías en los nombres locales | ídem |
| CRM con nombre local | `test/http-host-local-names.e2e-spec.ts` |
| Nombre local en mayúsculas en la url | ídem |
| Nombre local sin destino permitido | ídem |
| Orden de las direcciones de un nombre local | ídem |
| Nombres que no son locales | ídem |
| Salida de arranque con nombres locales | `test/http-host-local-names-startup.e2e-spec.ts` |
| Lead de punta a punta en la demo | manual (6.2) + `test/demo.e2e-spec.ts` («Leads consecutivos», a nivel de API) |
| Demo sin Internet | manual (6.3: la demo funciona sin red; con la red **conectada** se observa que la API y el CRM solo abren conexiones a loopback) + `test/http-host-local-names.e2e-spec.ts` (sin resolución) |
| Copia local sin la demo | `test/demo.e2e-spec.ts` (`startWorld` sin variables) |
| Línea de arranque de la API en la demo | `test/demo.e2e-spec.ts` (proceso real con `demoHttpVariables` por defecto) + manual |
| Token de la ejecución fuera de la salida | `test/demo/dev-demo.spec.ts` (salida sin el token y dos tokens distintos) + manual (6.4) |
| Variables de la shell en conflicto | `test/demo/dev-demo.spec.ts` (dobles: ningún proceso; proceso real: código y salida) |
| Variable vacía en la shell | ídem |
| Clave de Claude en la shell | `test/demo/dev-demo.spec.ts` (entorno de turbo sin la clave y salida) + manual (6.6) |
| Puerto del CRM ocupado | `test/demo/crm.spec.ts` (`EADDRINUSE` real en un puerto libre ocupado) + `dev-demo.spec.ts` (sin turbo, mensaje con 4010) + manual |
| CRM solo en loopback | `test/demo/crm.spec.ts` (`[::1]` y la primera IPv4 no interna con `it.skipIf`) |
| Leads consecutivos | `test/demo.e2e-spec.ts` |
| Lead con otro token | ídem |
| Rutas y cuerpos que rechaza | `test/demo/crm.spec.ts` |
| Lead fuera del registro del CRM | `test/demo.e2e-spec.ts` (el `log` del CRM capturado) |
| Paridad con el ejemplo canónico | `test/demo/captacion-leads-local.spec.ts` |
| Primera siembra · Siembra repetida · Copia creada sin publicar · Borrador cambiado a mano · Id reservado por un borrado · API no disponible para la semilla | `test/demo-seed.e2e-spec.ts` |
| Base de datos sin migraciones para la semilla | `test/demo-seed.e2e-spec.ts` (API real contra una base vacía creada por el test) + manual (6.1) |
| Dirección de la API no admitida en la semilla | `test/demo/seed.spec.ts` (`request` espía: cero llamadas) |
| Siembra fallida al arrancar | `test/demo/dev-demo.spec.ts` (sigue en marcha) + manual (6.7) |
| Parada con Ctrl+C | `test/demo/dev-demo.spec.ts` (señal al grupo, dos `SIGINT` que no escalan, `SIGKILL` solo a los 7 s, `SIGHUP`) + manual a través de `pnpm dev:demo` (6.5) |
| CRM simulado que termina | `test/demo/dev-demo.spec.ts` + manual (6.5) |
| Arranque de la API y la web que termina | `test/demo/dev-demo.spec.ts` |

## Plan de verificación por capas

- **Unit (aplica)**:
  - El lector y la búsqueda de nombres locales.
  - `createHttpHost` con nombres locales y una red espía: no se resuelve, se aplica la política y se respeta el orden.
  - La configuración de la demo, la paridad, el CRM (cada status, el contador y el registro) y la semilla sin red.
  - El arranque con dobles, más un proceso real para los conflictos.
- **Golden / contractual (aplica)**: la paridad de la copia (C6) y el cruce copia ↔ C3. No hay *baselines* protegidos nuevos.
- **Integración HTTP / e2e (aplica)**:
  - Los 8 escenarios de `http-host` (red del test y proceso real).
  - La semilla contra el proceso real.
  - La cadena con `systemNetwork()` y el CRM de verdad.
- **E2E opción-al-menos-una-vez (no aplica)**: la web no cambia. El recorrido en el navegador se hace a mano (6.2).
- **Smoke de ruta (no aplica)**: no hay rutas nuevas.
- **Mutación (aplica)**: D15. `pnpm --filter @franca/api mutate --only <ids nuevos>,ignoreTimeout` en la fase 2, y la ejecución completa en la verificación final.
- **Manual (aplica)**: tasks, fase 6. Desconectar la red solo demuestra que la demo funciona sin Internet: un intento de salida fallaría en silencio. Las conexiones se observan con la red conectada (6.3).

## Plan de Ejecución

Resumen; el detalle con ficheros y gates está en `tasks.md`.

1. **Backend Core** (`popi:backend-developer`): `local-names.ts`, configuración, línea de arranque, `resolveName`, módulo y `turbo.json`, con sus unit tests.
2. **Tests backend** (`popi:qa-tester`, modo backend): los e2e de los 8 escenarios y los mutantes. Al terminar, `pnpm check` vuelve a verde.
3. **Scripts de la demo** (`popi:backend-developer`): la copia, la configuración, el CRM, la semilla, el arranque, el `tsconfig`, los *scripts* y sus unit tests.
4. **Tests de los scripts** (`popi:qa-tester`, modo backend): el arranque con dobles, los e2e de la semilla y de la cadena, y los tests negativos validados a mano.
5. **Documentación y meta** (`popi:backend-developer`).
6. **Verificación final** (`popi:qa-tester`, modo verificación): la demo real en el navegador y la mutación completa.

**Modo recomendado: `apply normal`**, fase a fase. El espacio de comportamiento es pequeño, pero los procesos y las señales solo se validan de verdad con una ejecución real y en el navegador, y eso no cabe en un bucle mecánico. Un `bucle aislado` solo encajaría en el gate de mutación de la fase 2. La elección es del usuario.

## Risks / Trade-offs

- **R1 (variable de seguridad)**: la mitigación es lo que no puede hacer la variable. Solo cambia la resolución, la política sigue mandando, y no admite nada fuera de `.test` ni de loopback. Hay 9 mutantes y la revisión adversarial. Llevada a otra instalación, no abre nada que `FRANCA_HTTP_ALLOWED_DESTINATIONS` no abra ya.
- **R2 (`pnpm check` en rojo)**: lo está desde `139869e` por 8 `it` de `http-host`, y vuelve a verde al cerrar la fase 2. La fase 1 lo declara en su gate. Nadie empuja en ese estado.
- **R3 (procesos)**: es lo que más se ha medido (A5), y el doble `SIGINT` de pnpm (A9) ya no escala.
  - Queda el hueco de que turbo no reenvíe la señal en otra versión o en Linux.
  - La comprobación de puertos al parar, en `127.0.0.1` y `::1`, lo haría visible (C4).
  - La ficha de la wiki dice qué medir, y 6.5 mide a través de `pnpm dev:demo`.
- **R4 (primera compilación lenta)**: tras 120 s la demo sigue en marcha y lo dice (C4).
- **R5 (deriva de la copia)**: la paridad está en `pnpm check`. En la base de una persona que actualiza el repositorio, el borrador sembrado queda antiguo y la semilla dice «no tocado». El README explica cómo ponerlo al día: sustituir el borrador por la copia o, si no hay nada que conservar, `docker compose down -v`.
- **R6 (4010 ocupado)**: lo detecta el propio `listen` (D8). Ningún test usa el 4010.
- **R7 (token en el entorno)**: D5.
- **R8 (acoplamiento con la web)**: la semilla importa un fichero de `apps/web`. Si la web lo mueve, fallan el typecheck, el lint y los tests de la API, y las tareas `@franca/api#test`, `#lint` y `#typecheck` lo vigilan en la caché (D6).
- **R10 (herramientas que llaman a casa)**: Next y turbo tienen la telemetría desactivada (D6). Prisma y pnpm pueden intentar sus comprobaciones. La promesa de la demo es que la llamada http del flujo y Claude no salen de la máquina, no que ningún proceso intente salir (`proposal.md`).
- **R9 (`--ui=stream`)**: el aspecto de la salida de turbo en la demo puede diferir del de `pnpm dev` en una terminal. Es una diferencia de presentación; las tareas son las mismas.

## Migration Plan

No hay migración: no cambian ni la base ni el formato, y la variable nueva es opcional. Para volver atrás basta revertir el PR.

## Open Questions

Ninguna. La de la primera versión (`openspec/**` en los `inputs` de los tests de la API) está resuelta: entra en D6 y cierra el FOLLOW-UP 7.6 de `web-chat`.
