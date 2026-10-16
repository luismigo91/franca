# @franca/llm-anthropic

Proveedor de Claude (Anthropic) para el nodo `llm` del motor de Franca ([`@franca/engine`](../engine)). Implementa la capacidad `llm` del motor con el SDK oficial `@anthropic-ai/sdk`: hace un turno de la conversación con salida estructurada, calcula su coste y respeta las restricciones de la API de los modelos actuales. Comportamiento vigente en `openspec/specs/llm-anthropic/spec.md` (y, mientras un cambio no se archiva, en su delta de `openspec/changes/`).

## Uso

```ts
import { createLlmCapability, startSession } from '@franca/engine';
import { createAnthropicProvider } from '@franca/llm-anthropic';

const llm = createLlmCapability({ principal: createAnthropicProvider() });
const result = await startSession({ flow }, { llm });
```

`createAnthropicProvider(options?)` devuelve una función con la firma exacta de `EngineHost.llm` (usa los tipos del motor, no los redefine). Hace como mucho **una petición lógica** por turno y **siempre resuelve**: su promesa nunca se rechaza.

| Opción | Por defecto | Qué hace |
|---|---|---|
| `client` | `createAnthropicClient()` | Cliente del SDK. Sin él, las credenciales las resuelve el SDK desde el entorno. |
| `defaultModel` | `claude-opus-5-5` | Modelo de los nodos sin `model`. Si no está en la tabla, sus turnos dan `not_configured`. |
| `models` | `DEFAULT_ANTHROPIC_MODELS` | Tabla de modelos permitidos, con precios, `effort` y fallback. **Sustituye** a la de por defecto: para ampliarla, `{ ...DEFAULT_ANTHROPIC_MODELS, 'claude-propio': { prices: … } }`. |
| `maxOutputTokens` | 8192 | `max_tokens` de cada petición. |
| `maxRetries` | 2 | Reintentos del SDK ante errores transitorios (408, 409, 429, 5xx, `retry-after`). El motor nunca repite un turno. |
| `turnTimeoutMs` | 60000 | Tiempo total de un turno, reintentos incluidos. Al vencer aborta la petición y resuelve `failed`, también si el cliente ignora la señal de aborto. |
| `serverFallback` | `true` | `false` desactiva el fallback de rechazo en el servidor en todos los modelos. |
| `onWarning` | — | Recibe `{ code: 'temperature_ignored', nodeId, model }`. Es el único canal además del resultado; si lanza, el turno sigue. |

Un modelo que no está en la tabla da `not_configured` **sin llamar a la API**. Un valor de la tabla o de las opciones que no se puede aplicar lanza un `TypeError` con un mensaje fijo, sin valores, al crear el proveedor.

## Cómo resuelve un turno

| Situación | Resultado |
|---|---|
| Salida estructurada válida con `stop_reason` `end_turn` | `turn` (`text`, `done`, y solo los slots con valor) |
| `stop_reason` `refusal` | `refusal` con el coste de su `usage` |
| `max_tokens`, `pause_turn`, otro motivo, salida sin JSON o que no cumple el esquema | `failed` con el coste de su `usage` |
| Error 401, 403 o 404 de la API | `not_configured` |
| Cualquier otro error (400, 429, 5xx, 529, conexión, tiempo agotado, sin credenciales) tras los reintentos | `failed` con `costUsd` 0 |

Los errores se clasifican **solo por `status`**; nunca se lee su mensaje, cuerpo ni cabeceras, que pueden llevar datos. Los bloques de pensamiento y `stop_details` no llegan nunca al resultado.

Sin credenciales, el SDK crea el cliente y cada turno falla antes de enviar nada: el resultado es `failed` (→ `onExhausted` en el motor), no `not_configured`. Quien despliega debe comprobar las credenciales al arrancar.

## Modelos, precios, `effort` y fallback

Precios de `DEFAULT_ANTHROPIC_MODELS`, en dólares por millón de tokens, de la página de precios de Anthropic a fecha de **2026-10-16** (revisar antes de cada release):

| Modelo | Entrada | Salida | Lectura de caché | Escritura de caché (5 min) | `effort` | Fallback en el servidor |
|---|---|---|---|---|---|---|
| `claude-opus-5-5` | 4 | 20 | 0,20 | 5 | `low` | sí |
| `claude-sonnet-5-5` | 2 | 10 | 0,20 | 2,50 | `low` | sí |
| `claude-haiku-5-5` | 0,10 | 0,50 | 0,01 | 0,125 | `low` | no |

Haiku 5.5, con un prompt (entrada + lectura + escritura de caché) de **más de 100000 tokens**, factura todo el turno a 0,50 / 2,50 / 0,05 / 0,625.

- **`effort`** (`output_config.effort`) se envía solo si la configuración del modelo lo define (`low`, `medium`, `high`, `xhigh` o `max`). La tabla por defecto lo fija en `low`: un paso conversacional no necesita razonamiento profundo. La instalación puede cambiarlo por modelo.
- **Fallback de rechazo en el servidor**: con `serverFallback: true` en el modelo y en las opciones, el turno va por la API beta (`client.beta.messages`, `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`); si no, por la estable. Un modelo de la instalación no lo admite salvo que lo diga.
- **Temperatura**: ningún modelo actual admite valores distintos del de por defecto, así que `temperature` se ignora (con aviso `temperature_ignored`). Tampoco se envían `thinking`, `tool_choice`, herramientas, `top_p` ni `top_k`.

## Coste y tope de parada

`costUsd` se calcula con el `usage` de la respuesta y los precios del modelo que indica **la respuesta**; un modelo que no está en la tabla paga el precio más alto de cada concepto. Con fallback del servidor es el **mayor** de dos importes: el `usage` de la cabecera y la suma de `usage.iterations` (cada salto con su modelo), para no quedar nunca por debajo. Un contador ausente, `null` o que no es un entero seguro ≥ 0 cuenta 0.

`costCapUsd` del flujo es un **tope de parada** que aplica el motor: puede superarse como mucho en el coste de un turno. **No es un límite de gasto.** Lo facturado puede superar lo contabilizado: si la API procesa una petición que el adaptador da por fallida (tiempo agotado, corte de conexión tras enviar), se factura pero cuenta 0, y cada reintento del SDK puede repetirlo (hasta `maxRetries` + 1 veces por turno). Concilia con la facturación real y pon un presupuesto por sesión o tenant en el host.

## Caché de la conversación

El proveedor marca con `cache_control` exactamente dos bloques: el de `system` (se comparte entre sesiones del mismo nodo) y el texto del último mensaje `user`, justo antes del estado del turno. El estado (turno, `maxTurns` y claves recogidas) va **el último y solo ahí**: el turno siguiente envía ese mensaje sin él, así que nunca entra en lo cacheado. No se usa `cache_control` de nivel superior (caería en el estado, que no se vuelve a leer, y cada turno pagaría una escritura sin ninguna lectura). Si el prefijo es menor que el mínimo cacheable del modelo, la API no cachea y no da error.

## Cliente seguro y credenciales

`createAnthropicClient(options?)` crea un cliente del SDK con `logLevel: 'off'` (el SDK lee `ANTHROPIC_LOG`, que con `debug` vuelca los detalles de cada petición) y trazas de OpenTelemetry **solo de metadatos** (o desactivadas si las opciones lo piden), aunque el entorno pida otra cosa.

- El paquete no contiene claves, no lee el entorno por su cuenta ni asigna credenciales: las resuelve el SDK. El host que despliega crea un cliente por tenant con `createAnthropicClient` pasando la clave y la URL base desde su almacén de secretos.
- **Un cliente inyectado es responsabilidad de quien lo crea.** Usa `createAnthropicClient` y pasa siempre la clave y `baseURL` explícitos: el SDK también lee `ANTHROPIC_BASE_URL` y `ANTHROPIC_CUSTOM_HEADERS`, y un cliente creado a pelo con el entorno de la máquina enviaría las conversaciones adonde diga esa variable.
- El proveedor no registra ni escribe en consola el contenido de peticiones ni respuestas.

## Privacidad y límites conocidos

- Enviar lo que dice el usuario a un tercero es inherente al nodo `llm`; lo decide la instalación.
- `system` y `goal` del flujo son plantillas: si el autor inserta en ellos una variable que escribió el usuario, ese texto llega al `system` del modelo. El proveedor lo encierra en JSON y avisa al modelo de que los mensajes del usuario son datos, pero no puede impedirlo.
- El SDK escribe con `console.warn` si la instalación añade a su tabla un modelo que el SDK marca como obsoleto (solo el nombre del modelo).
- El JSON Schema de la salida lo genera `zodOutputFormat` del SDK; un parche del SDK puede cambiarlo. Los golden del cuerpo enviado (`tests/golden/`) lo detectan al actualizar.

## Desarrollo

```sh
pnpm --filter @franca/llm-anthropic test       # Vitest (sin --watch), con el SDK real y un fetch inyectado: sin red
pnpm --filter @franca/llm-anthropic typecheck
pnpm --filter @franca/llm-anthropic build      # dist/index.mjs + dist/index.d.mts
pnpm --filter @franca/llm-anthropic mutate     # mutación dirigida: cada mutación de tests/mutations.json debe matarla algún test
```

Los golden del cuerpo enviado se regraban con `pnpm --filter @franca/llm-anthropic test -u` y se revisa el diff; no se editan a mano.

### Test en vivo (opcional)

Tres turnos reales (uno de Haiku 5.5 por la API estable y dos seguidos de la misma conversación de Opus 5.5 por la beta, con `fallbacks`, `effort` y salida estructurada) que comprueban lo que no se puede verificar sin red, incluido que el segundo turno lee la caché del historial. **No lo ejecutan `pnpm test` ni la CI.**

```sh
FRANCA_LIVE_ANTHROPIC=1 pnpm --filter @franca/llm-anthropic test:live   # con la clave de Anthropic exportada en la shell
```

Si existe `CI`, exige además `FRANCA_LIVE_ANTHROPIC_CI=1`. Con la opción activada y sin credenciales falla con un mensaje claro. Coste: céntimos (el `system` de prueba mide unos 6000 tokens para superar el mínimo cacheable de Opus). La clave nunca se guarda en el repo.
