# @franca/engine

Motor de ejecución de flujos de Franca. TypeScript puro: sin IO, sin reloj, sin aleatoriedad y sin escribir en consola. Con el mismo flujo y las mismas entradas devuelve siempre el mismo resultado. Comportamiento vigente en `openspec/specs/flow-engine/spec.md` (y, mientras un cambio no se archiva, en su delta de `openspec/changes/`).

Ejecuta flujos del formato de [`@franca/spec`](../spec): mensajes, `input`, `http`, `set`, `jump`, `condition` y `end`. El nodo `http` necesita que el host ofrezca `EngineHost.http` (sin ella, la sesión falla con `unsupported_node`); el nodo `llm` aún no está soportado.

## API

| Export | Qué es |
|---|---|
| `startSession(request, host?)` | Arranca una sesión con `{ flow, contact? }` y la ejecuta hasta que termina o falla. |
| `continueSession(request, host?)` | Recibe `{ flow, state, input }` y continúa una sesión en espera: evalúa la respuesta al `input` y ejecuta hasta la siguiente detención. |
| `STATE_VERSION`, `MAX_STEPS_PER_ADVANCE`, `DEFAULT_TYPING_DELAY_MS`, `MAX_PATTERN_SIZE`, `MAX_RENDERED_LENGTH`, `MAX_NESTING_DEPTH`, `MAX_PATTERN_DEPTH`, `MAX_INPUT_LENGTH`, `MAX_EXTERNAL_CALLS_PER_ADVANCE`, `MAX_URL_LENGTH`, `MAX_REQUEST_BODY_LENGTH`, `MAX_RESPONSE_BODY_LENGTH` | Constantes del contrato. |
| `SESSION_ERROR_CODES` | `unsupported_node`, `invalid_rule`, `step_limit_exceeded`, `value_too_large`, `invalid_validation`, `retries_exhausted`, `invalid_http_config`, `missing_secret`, `http_host_error`, `http_limit_exceeded`. |
| `REJECTION_CODES` | `invalid_flow`, `invalid_contact`, `invalid_state`, `state_mismatch`, `session_not_active`, `invalid_input`. |
| `INVALID_ANSWER_REASONS` | Motivos de una respuesta inválida (`reason` del evento `input`): `too_long`, `required`, `invalid_format`, `out_of_range`, `pattern_mismatch`. |
| `HTTP_ERROR_REASONS` | Motivos de una llamada `http` que termina mal (`error` del evento `http`): `invalid_url`, `invalid_header_value`, `body_too_large`, `http_status`, `timeout`, `network_error`, `blocked`, `response_too_large`, `invalid_response`. |
| `@franca/engine/conformance` | Suite de conformidad del host HTTP (ver más abajo). |
| Tipos | `HttpRequest`, `HttpAttemptResult`, `HttpCapability`, `EngineHttpEvent`, `UserInput`, `InputType`, `EngineInputEvent` (unión por `inputType`), `EngineChoice`, `JsonValue`, `VariableValue`, `EngineEvent` (y sus variantes), `SessionState`, `SessionResult`, `Rejection`, `AdvanceResult`, `EngineHost`, etc. |

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

Se hacen 1 + `retries` intentos (1 reintento por defecto) y, entre `http` y el futuro `llm`, **como mucho 10 llamadas externas por operación** (`MAX_EXTERNAL_CALLS_PER_ADVANCE`): un reintento que no cabe se recorta y un primer intento que no cabe falla con `http_limit_exceeded`. El evento `http` (`{ type, nodeId, attempts, status, error }`) cuenta lo ocurrido; un error de la llamada sigue por `onError` y un fallo de sesión (`missing_secret`, `http_host_error`…) no emite el evento. La respuesta solo llega al estado por los valores de `responseMap` (todo o nada, ≤ 100 niveles y ≤ 16384 unidades por valor).

Límites que el host debe respetar o conocer:

- **Host de producción** (spec «Host de producción: …»): bloquea destinos internos comprobando la dirección real de cada conexión (par dirección y puerto), no sigue redirecciones, no añade credenciales propias, corta el cuerpo en 1 MiB **ya descomprimido**, aplica `timeoutMs` como tope **total** del intento (no de inactividad), ata cada secreto al origen exacto y no registra URL, cabeceras ni body de una petición con `containsPii`. Se comprueba con `@franca/engine/conformance`: `HOST_CONFORMANCE_CASES` y el arnés `HostConformanceHarness`, que implementa quien ofrece el host con servidores reales. El runner debe dar a cada caso un timeout **mayor** que sus esperas límite (`CALL_DEADLINE_MARGIN_MS` más `timeoutMs` más la tolerancia del entorno, ver `call.ts`).
- **Clientes que recortan espacios**: clientes como undici recortan los espacios de los extremos de un valor de cabecera; el motor los admite y el valor puede llegar sin ellos.
- **Valores en la ruta**: un valor `../admin` llega como `..%2Fadmin`, pero un servidor o proxy que decodifica `%2F` antes de enrutar lo verá como `../admin`; uno vacío deja `//` en la ruta (`/users//x`) y algunos servidores lo fusionan. Quien escribe el flujo debe validar esos valores antes (con `matches` o un `input` con `pattern`) si el servidor hace eso.
- **Coste de `responseMap`**: O(entradas × 1 MiB) en el peor caso (cada entrada puede medir y copiar un subárbol de hasta 1 MiB).
- **`timeoutMs`** es un tope total del intento: el motor no lo mide, lo aplica el host.

`EngineEvent` y `SessionErrorCode` crecen de forma aditiva: un `switch` exhaustivo del consumidor debe tener rama por defecto.

## Desarrollo

```sh
pnpm --filter @franca/engine test       # Vitest (sin --watch)
pnpm --filter @franca/engine typecheck
pnpm --filter @franca/engine build      # dist/index.mjs + dist/index.d.mts
pnpm --filter @franca/engine mutate     # mutación dirigida: cada mutación de tests/mutations.json debe matarla algún test
```

Depende de `@franca/spec` compilado (`dist/`). Con turbo (`pnpm check`, `pnpm build`) se construye antes; si ejecutas los scripts del paquete sin turbo y falla `Cannot find module '@franca/spec'`, ejecuta antes `pnpm --filter @franca/spec build`.

Los golden de `tests/golden/` se regraban con `pnpm --filter @franca/engine test -u` y se revisa el diff; no se editan a mano.
