# @franca/engine

Motor de ejecución de flujos de Franca. TypeScript puro: sin IO, sin reloj, sin aleatoriedad y sin escribir en consola. Con el mismo flujo y las mismas entradas devuelve siempre el mismo resultado. Comportamiento vigente en `openspec/specs/flow-engine/spec.md` (y, mientras un cambio no se archiva, en su delta de `openspec/changes/`).

Ejecuta flujos del formato de [`@franca/spec`](../spec): mensajes, `input`, `http`, `llm`, `set`, `jump`, `condition` y `end`. Los nodos `http` y `llm` necesitan que el host ofrezca `EngineHost.http` y `EngineHost.llm` (sin la capacidad, la sesión falla con `unsupported_node`).

## API

| Export | Qué es |
|---|---|
| `startSession(request, host?)` | Arranca una sesión con `{ flow, contact? }` y la ejecuta hasta que termina o falla. |
| `continueSession(request, host?)` | Recibe `{ flow, state, input }` y continúa una sesión en espera: evalúa la respuesta al `input` (o el mensaje al `llm`) y ejecuta hasta la siguiente detención. |
| `createLlmCapability(providers)` | Compone la capacidad `EngineHost.llm` a partir de los proveedores de la instalación (un objeto o un `Map` de nombre a función): cada petición va al de nombre exacto `request.provider`; si ninguno coincide, resuelve `not_configured`. |
| `STATE_VERSION`, `MAX_STEPS_PER_ADVANCE`, `DEFAULT_TYPING_DELAY_MS`, `MAX_PATTERN_SIZE`, `MAX_RENDERED_LENGTH`, `MAX_NESTING_DEPTH`, `MAX_PATTERN_DEPTH`, `MAX_INPUT_LENGTH`, `MAX_EXTERNAL_CALLS_PER_ADVANCE`, `MAX_URL_LENGTH`, `MAX_REQUEST_BODY_LENGTH`, `MAX_RESPONSE_BODY_LENGTH` | Constantes del contrato. |
| `SESSION_ERROR_CODES` | `unsupported_node`, `invalid_rule`, `step_limit_exceeded`, `value_too_large`, `invalid_validation`, `retries_exhausted`, `invalid_http_config`, `missing_secret`, `http_host_error`, `http_limit_exceeded`, `llm_not_configured`, `llm_host_error`, `llm_limit_exceeded`. |
| `REJECTION_CODES` | `invalid_flow`, `invalid_contact`, `invalid_state`, `state_mismatch`, `session_not_active`, `invalid_input`. |
| `INVALID_ANSWER_REASONS` | Motivos de una respuesta inválida (`reason` del evento `input`): `too_long`, `required`, `invalid_format`, `out_of_range`, `pattern_mismatch`. |
| `LLM_EXIT_REASONS` | Por qué un `llm` sale por `onExhausted` (`reason` del evento `llm`): `max_turns`, `cost_cap`, `refusal`, `provider_error`, `invalid_turn`. |
| `HTTP_ERROR_REASONS` | Motivos de una llamada `http` que termina mal (`error` del evento `http`): `invalid_url`, `invalid_header_value`, `body_too_large`, `http_status`, `timeout`, `network_error`, `blocked`, `response_too_large`, `invalid_response`. |
| `@franca/engine/conformance` | Suite de conformidad del host de producción: `http` y `llm` (ver más abajo). |
| Tipos | `HttpRequest`, `HttpAttemptResult`, `HttpCapability`, `EngineHttpEvent`, `LlmTurnRequest`, `LlmTurnResult`, `LlmCapability`, `LlmMessage`, `LlmSlotRequest`, `LlmConversation`, `EngineLlmEvent`, `VariableType`, `UserInput`, `InputType`, `EngineInputEvent` (unión por `inputType`), `EngineChoice`, `JsonValue`, `VariableValue`, `EngineEvent` (y sus variantes), `SessionState`, `SessionResult`, `Rejection`, `AdvanceResult`, `EngineHost`, etc. |

## Contrato

- `flow`, `contact` y `state` llegan como `unknown` y se validan en cada operación. El flujo se valida y se ejecuta en su forma JSON (`JSON.parse(JSON.stringify(flow))`).
- Un rechazo es un valor (`{ ok: false, code, message }`), no una excepción. Una sesión que falla es `ok: true` con `status: 'failed'`.
- Una promesa rechazada es un defecto del motor, o un flujo construido en memoria que no se puede serializar (ciclos, `bigint`). Los flujos reales llegan como JSON.
- El estado es JSON puro y el host lo trata como opaco, salvo `status`, `outcome`, `error` y `contact`.
- La salida es texto plano: el cliente no debe interpretarla como HTML ni Markdown. El motor no espera `typingDelayMs`: lo aplica el cliente.
- Los mensajes de error no incluyen valores de variables ni de contacto.

## Respuestas del usuario (`input`)

Al llegar a un `input`, la operación emite un `message` con el `prompt` y un evento `input` (`attempt`, `reason`, y `placeholder`, `multiple` y `choices` cuando proceden) y termina con `status: 'waiting'`. El host guarda el `state` y, cuando el usuario responde, llama a `continueSession` con una de estas entradas (cualquier otra forma se rechaza con `invalid_input`):

| Tipo del nodo | Entrada |
|---|---|
| `text`, `email`, `phone`, `number`, `url`, `date`, `boolean` | `{ text: string }` |
| `choice` (selección única) | `{ choice: id }` |
| `choice` con `multiple: true` | `{ choices: [id, …] }` |

Una respuesta inválida no es un rechazo: la sesión sigue en `waiting` con un nuevo evento `input` (`attempt` + 1 y el `reason`) hasta agotar `validation.maxRetries` (3 por defecto), que falla con `retries_exhausted`. La respuesta del usuario nunca aparece en eventos, estado ni errores salvo, ya convertida, en su variable.

`SessionStatus` y `EngineEvent` admiten valores nuevos (`waiting`, `input`) y los arrays de códigos crecen de forma aditiva: un `switch` exhaustivo del consumidor debe tener rama por defecto.

## Llamadas HTTP (`http`)

El motor no tiene red, reloj ni temporizadores: el host aporta `EngineHost.http`, una función `(request: HttpRequest) => Promise<HttpAttemptResult>` que ejecuta **un intento**, y el motor decide si reintenta. `startSession` y `continueSession` aceptan `host` omitido o `null` (equivale a `{}`).

**Petición** (objeto nuevo por intento): `{ nodeId, method, url, headers, body, timeoutMs, attempt, containsPii }`. `url` es la serialización WHATWG ya validada (los valores insertados van codificados, no pueden añadir `/ ? # @ :`); `headers` es una lista `{ name, value }` o `{ name, secret }` (el motor solo conoce el **nombre** del secreto; el host lo resuelve); `body` es JSON compacto o `null`; `containsPii` avisa de que la petición lleva datos personales (el host no debe registrarla en claro).

**Resultado de un intento**: `{ kind: 'response', status, body }`, `{ kind: 'timeout' }`, `{ kind: 'network_error', requestSent? }`, `{ kind: 'blocked' }`, `{ kind: 'response_too_large' }` o `{ kind: 'missing_secret' }`. Rechazar la promesa, lanzar o devolver otra forma es un defecto del host: la sesión falla con `http_host_error` y no se mira nada de lo que lanzó o devolvió.

| Resultado | `GET` / `PUT` / `DELETE` | `POST` / `PATCH` |
|---|---|---|
| 2xx | éxito | éxito |
| 408, 429 | reintenta | reintenta |
| 500, 502, 503, 504 | reintenta | no (el servidor pudo procesarla) |
| otro status | `http_status`, sin reintento | ídem |
| `timeout` | reintenta | no |
| `network_error` con `requestSent: false` | reintenta | reintenta |
| `network_error` con `requestSent` `true` u omitido | reintenta | no |
| `blocked`, `response_too_large` | sin reintento | ídem |
| `missing_secret` | falla la sesión | ídem |

Se hacen 1 + `retries` intentos (1 reintento por defecto) y, entre `http` y `llm`, **como mucho 10 llamadas externas por operación** (`MAX_EXTERNAL_CALLS_PER_ADVANCE`): un reintento que no cabe se recorta y un primer intento que no cabe falla con `http_limit_exceeded`. El evento `http` (`{ type, nodeId, attempts, status, error }`) cuenta lo ocurrido; un error de la llamada sigue por `onError` y un fallo de sesión (`missing_secret`, `http_host_error`…) no emite el evento. La respuesta solo llega al estado por los valores de `responseMap` (todo o nada, ≤ 100 niveles y ≤ 16384 unidades por valor).

Límites que el host debe respetar o conocer:

- **Host de producción** (spec «Host de producción: …»): bloquea destinos internos comprobando la dirección real de cada conexión (par dirección y puerto), no sigue redirecciones, no añade credenciales propias, corta el cuerpo en 1 MiB **ya descomprimido**, aplica `timeoutMs` como tope **total** del intento (no de inactividad), ata cada secreto al origen exacto y no registra URL, cabeceras ni body de una petición con `containsPii`. Se comprueba con `@franca/engine/conformance`: `HOST_CONFORMANCE_CASES` y el arnés `HostConformanceHarness`, que implementa quien ofrece el host con servidores reales. `HostConformanceHarness.sleep(ms, signal?)` recibe un `AbortSignal` que `call.ts` aborta en cuanto responde el host: el arnés debe liberar su temporizador. El runner debe dar a cada caso un timeout **mayor** que sus esperas límite (`CALL_DEADLINE_MARGIN_MS` más `timeoutMs` más la tolerancia del entorno, ver `call.ts`).
- **Clientes que recortan espacios**: clientes como undici recortan los espacios de los extremos de un valor de cabecera; el motor los admite y el valor puede llegar sin ellos.
- **Valores en la ruta**: un valor `../admin` llega como `..%2Fadmin`, pero un servidor o proxy que decodifica `%2F` antes de enrutar lo verá como `../admin`; uno vacío deja `//` en la ruta (`/users//x`) y algunos servidores lo fusionan. Quien escribe el flujo debe validar esos valores antes (con `matches` o un `input` con `pattern`) si el servidor hace eso.
- **Coste de `responseMap`**: O(entradas × 1 MiB) en el peor caso (cada entrada puede medir y copiar un subárbol de hasta 1 MiB).
- **`timeoutMs`** es un tope total del intento: el motor no lo mide, lo aplica el host.

`EngineEvent` y `SessionErrorCode` crecen de forma aditiva: un `switch` exhaustivo del consumidor debe tener rama por defecto (el evento `llm` y los códigos `llm_*` son aditivos).

## Conversaciones con IA (`llm`)

El motor no llama a ningún modelo: el host aporta `EngineHost.llm`, una función `(request: LlmTurnRequest) => Promise<LlmTurnResult>` que hace **un turno**, y el motor lleva la conversación, valida lo que devuelve y decide cuándo sale del nodo. `createLlmCapability({ principal, … })` enruta por `llm.provider`; el paquete `@franca/llm-anthropic` ofrece un proveedor de Claude. Un turno nunca se repite.

**Petición** (objeto nuevo por turno): `{ nodeId, provider, model, system, goal, slots, history, temperature, locale, turn, maxTurns }`. `system` y `goal` van renderizados como plantillas; `slots` lista cada variable distinta del nodo con `{ name, type, description, required, collected }`; `history` lo mantiene el motor (lo que el host haga con la petición no lo altera).

**Resultado**: `{ kind: 'turn', text, slots, done, costUsd }`, `{ kind: 'refusal', costUsd }`, `{ kind: 'failed', costUsd }` o `{ kind: 'not_configured' }`. `costUsd` es un number finito ≥ 0. Rechazar la promesa, lanzar o devolver otra forma es un defecto del host: la sesión falla con `llm_host_error`. `not_configured` falla con `llm_not_configured`; el turno que sería la llamada 11 de la operación, con `llm_limit_exceeded`.

Lo que decide el modelo queda acotado por construcción: el **texto** (se emite tal cual, recortado y de ≤ 4096 unidades; nunca es una plantilla), los **slots declarados** por el nodo (solo se leen esos nombres; cada valor se convierte con las reglas de un `input` del tipo de su variable, y los de tipo `json` se copian en una pasada con tope de 100 niveles y 4096 unidades) y `done`, que solo termina el nodo con todos los slots obligatorios recogidos. Un texto inválido descarta el turno entero (`invalid_turn`).

Tras cada turno que no termina el nodo, la operación emite el `message` del asistente y un `input` de texto, y espera. El usuario responde con `{ text }` (más de 4096 unidades, vacío o con caracteres que no se pueden guardar es un mensaje inválido: no llama al host ni cuenta como turno). El nodo sale por `next` al cumplirse el objetivo y por `onExhausted` al llegar a `maxTurns` (8 por defecto) o al alcanzar `costCapUsd` (un tope de parada: puede superarse como mucho en el coste de un turno), o por rechazo y fallo del proveedor. Al salir, guarda los slots recogidos en sus variables, emite el evento `{ type: 'llm', nodeId, turns, costUsd, reason }` (sin textos ni slots) y descarta la conversación. Un `next` hacia el propio nodo sigue en la misma conversación, con sus turnos y su coste.

**Estado en espera.** El estado de una espera en un `llm` lleva `conversation` (mensajes, coste acumulado y slots recogidos): contiene lo que escribió el usuario, así que es un **dato personal** que el host persiste con retención y borrado. Tamaño máximo: 99 mensajes de ≤ 4096 unidades más ≤ 4096 unidades de forma textual por slot recogido. Qué tipo de espera tiene un estado lo dice el estado (hay `conversation` o no), no el flujo. `stateVersion` sigue en 1.

**Custodia del estado (obligatoria en el host de producción).** `maxTurns` y `costCapUsd` solo se pueden verificar si la continuación parte del estado que devolvió el motor: un cliente que reenvía un estado anterior reinicia turnos y coste. El host de producción debe **guardar el estado en el servidor**, continuar solo con el guardado y **reclamarlo antes de ejecutar el motor** (compare-and-swap sobre su versión o concesión «en curso» con caducidad): una segunda continuación del mismo estado se rechaza por conflicto sin llamar al proveedor. La suite de conformidad lo comprueba (`custodia-estado`, `una-continuacion`, `reclamacion-caducada`, con `HostConformanceHarness.sessions`). Sin esto, un ciclo `llm` → `set` → `llm` también empieza conversaciones nuevas y reinicia `costCapUsd`; el presupuesto por sesión o tenant es del host.

**Límite que el motor no puede cerrar.** `system` y `goal` son plantillas: si el autor inserta en ellos una variable que escribió el usuario (`{{nombre}}` de un `input`), ese texto llega al `system` del modelo. El adaptador de Claude lo encierra en JSON, pero lo decide quien escribe el flujo.

**Registros.** El host de producción trata toda petición `llm` y su resultado como datos personales: no registra `system`, `goal`, `history`, textos ni slots (caso `registros-llm`).

## Desarrollo

```sh
pnpm --filter @franca/engine test       # Vitest (sin --watch)
pnpm --filter @franca/engine typecheck
pnpm --filter @franca/engine build      # dist/index.mjs + dist/index.d.mts
pnpm --filter @franca/engine mutate     # mutación dirigida: cada mutación de tests/mutations.json debe matarla algún test
                                        # (antes ejecuta una línea base: si no está en verde, aborta; SIGINT restaura el fichero)
```

Depende de `@franca/spec` compilado (`dist/`). Con turbo (`pnpm check`, `pnpm build`) se construye antes; si ejecutas los scripts del paquete sin turbo y falla `Cannot find module '@franca/spec'`, ejecuta antes `pnpm --filter @franca/spec build`.

Los golden de `tests/golden/` se regraban con `pnpm --filter @franca/engine test -u` y se revisa el diff; no se editan a mano.
