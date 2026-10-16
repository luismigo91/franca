# Design: nodo `http` en el motor (`engine-http`)

**Fecha**: 2026-10-16 · **Rama**: `feat/engine-http` · Motivación y alcance en `proposal.md`; comportamiento en `specs/flow-engine/spec.md` (manda sobre este documento). Amplía de forma aditiva el contrato de `engine-base` (D2, D3, D9) y de `engine-input` (D1, D4, D6), archivados en `openspec/changes/archive/2026-10-16-*`.

## Context

- `EXECUTORS.http` es `executeUnsupported` (`src/nodes/index.ts`). `EngineHost` es una interfaz vacía y `startSession`/`continueSession` aceptan `host: EngineHost = {}` sin leerlo nunca (`src/session.ts`).
- `StepContext` (`src/nodes/types.ts`) tiene `vars`, `typingDelayMs`, `host` y `emit`; `run` (`src/run.ts`) crea uno por operación, hace `await` de cada ejecutor y cuenta pasos antes de mirar el tipo del nodo.
- Piezas reutilizables ya fusionadas: `renderTemplate`, `textOf`, `ValueTooLargeError` (`src/template.ts`); `exceedsDepth`, `cloneJsonWithinDepth` (`src/json.ts`); `hasUnstorable`, `isBlank`, `isControl`, `isDefaultIgnorable` (`src/input/parsers/chars.ts`); `isDomainName` (`src/input/parsers/domain.ts`); `hasHiddenChars` y `hasPercentInHost`, privadas de `src/input/parsers/url.ts`.
- `@franca/spec`: `HttpNode` generado (`method` con 5 valores, `url: Template`, `headers: {[k]: Template | SecretRef}`, `body`, `timeoutMs` 100-30000 por defecto 10000, `retries` 0-5 por defecto 1, `responseMap[].{variable, pointer}` con `pattern: ^(/[^/]*)*$`). `writtenVars` del validador ya exige declarar las variables de `responseMap`.

### Auditoría de la spec contra el código fusionado

Medido con Node 22.23.3 y `packages/engine/dist` / `packages/spec/dist` (no leyendo documentos):

| Lo que decía o se podía suponer | Lo que dice el código / el runtime | Dónde se corrige |
|---|---|---|
| `body` es un objeto (`HttpNode.request.body: {[k: string]: unknown}`) | En el esquema `body` es `{}` (cualquier JSON): `"hola {{nombre}}"`, `["{{a}}"]`, `5` o `null` validan; el tipo generado miente | D6: el motor trata `body` como `unknown` de la forma JSON, nunca confía en el tipo |
| Las cabeceras y las claves del body salen «en el orden del flujo» | La forma JSON (`JSON.parse`) enumera primero las claves que son índices: `{"b":1,"2":2}` → `{"2":2,"b":1}`; `{"X-A":…,"2":…}` → `['2','X-A']` | **Spec**: requisito nuevo «Orden de cabeceras y claves del body» con dos escenarios (incluido `__proto__`) |
| Basta con rechazar sustitutos sueltos en los valores insertados | Un sustituto suelto **literal** en la `url` (flujo en memoria) lo cambia WHATWG en silencio: `https://a.com/\ud800` → `…/%EF%BF%BD` | **Spec**: «URL de la petición» los rechaza en todo el texto; escenario «Sustituto suelto en el texto de la URL». D7 |
| «Sin `localhost`» se cumple con `isDomainName` | `localhost` cae (una etiqueta), pero `http://api.localhost/` pasa WHATWG y `isDomainName`; RFC 6761 reserva `.localhost` para loopback | **Spec**: «Destino y longitud de la URL» rechaza `localhost` y `*.localhost`. D7 |
| Una URL renderizada de más de 8192 unidades siempre serializa en más de 8192 | WHATWG también **encoge**: quita el puerto por defecto y los ceros a la izquierda del puerto (`:0000000000443` → nada) | **Spec**: el límite se aplica antes y después de serializar; escenario «Longitud antes de serializar». D7 |
| `%2e` es el único disfraz del punto | WHATWG trata como `..` también `.%2e`, `%2e.` y `%2E%2e` (sin distinguir mayúsculas), como `.` también `%2e`; `..a`, `...` y `%252e` no son segmentos de punto | **Spec**: «Segmentos de punto» ampliado y «Segmentos que no son de punto». D7 |
| Las formas anchas no llegan al host | `http://１２７．０．０．１/` → IDNA → `127.0.0.1`; `http://a.com／b/` (barra ancha en el host) lanza | **Spec**: añadido a «Destinos internos». D7: `isDomainName` mira el `hostname` **serializado** |
| `encodeURIComponent` codifica todo salvo los no reservados | Deja sin codificar `! ' ( ) *` y lanza `URIError` con un sustituto suelto | D7: post-pase propio para esos cinco y `URIError` → `invalid_url` |
| `JSON.parse` de un cuerpo hostil desborda la pila | 524 288 niveles (1 MiB de `[`) se parsean sin lanzar; `JSON.stringify` de ese valor lanza `RangeError` | D11: profundidad del valor mapeado con `exceedsDepth` (iterativo) **antes** de copiarlo; hipótesis con test |
| `JSON.parse` normaliza números | `JSON.parse('1e400')` = `Infinity`, `JSON.parse('-0')` = `-0` | D11: `cloneJsonWithinDepth` rechaza no finitos y normaliza `-0` |
| `__proto__` en el cuerpo de la respuesta | `JSON.parse` lo crea como propiedad propia | D11: punteros con `Object.hasOwn`; nunca `in` |
| El contacto de 999 niveles es «aceptado» y la sesión sigue | `startSession` da `waiting`; `continueSession` con ese estado da `invalid_state` (estado de 1001 niveles contra `MAX_NESTING_DEPTH` 1000 en `cloneJsonStrict`). Un `default` de 997 y los valores de `choice` (escalares, esquema `["string","number","boolean"]`) no llegan | **Spec**: MODIFIED «Profundidad máxima de anidamiento» + dos escenarios. D13 |
| «Una variable no puede aportar el host» | Con `https://{{sub}}.example.com/` un valor de solo no reservados (`api`, `api.eu`, `attacker`) sí completa etiquetas del host (el `.` es no reservado y separa etiquetas); con `https://{{h}}/` aporta el host entero. Lo que impide la codificación es añadir el esquema o `/ ? # @ :`, no aportar etiquetas | **Spec**: escenario renombrado («no puede añadir el esquema ni los caracteres / ? # @ :») y escenario nuevo «Etiquetas del host que el autor deja abiertas». Conducta aprobada; aviso del validador como FOLLOW-UP |
| Nadie lee `host` hoy, así que `startSession(req, null)` funciona | En cuanto el ejecutor lea `host.http`, un `null` haría rechazar la promesa | **Spec**: requisito «Lectura de la capacidad http» (host omitido o `null` = `{}`, lectura única, `this` = host). D3 |

## Goals / Non-Goals

**Goals:**
- `http` ejecutable con un contrato de host pequeño, serializable y comprobado en cada intento, sin que el motor gane IO, reloj ni temporizadores.
- Que ningún valor del usuario cambie el origen, la ruta o la consulta de la petición más allá de lo que el autor dejó abierto, con cada filtro probado también en sus formas codificadas.
- Cada cota de coste o tamaño con un test sobre **la hipótesis** de la que depende, y cada hipótesis validada por una mutación que la rompe (D16, D17).
- Que la feature 6 reciba el contrato del host como una suite ejecutable que solo tiene que pasar (D14).
- Arreglar la ida y vuelta del estado en el límite de profundidad (D13).

**Non-Goals (de diseño, además de los de la proposal):**
- Ninguna dependencia nueva (ni cliente HTTP, ni JSON Pointer, ni herramienta de mutación).
- Ningún adaptador HTTP real, red simulada ni host de referencia, ni en `src/` ni en `tests/` (D14).
- No se exponen las piezas internas (URL, cabeceras, punteros) en la API principal.
- No se toca `packages/spec`, `apps/api` ni `apps/web`.

## Decisions

### D1. Contrato público: cambios aditivos

```ts
// ---- constants.ts (exportadas desde index.ts)
export const MAX_EXTERNAL_CALLS_PER_ADVANCE = 10; // llamadas externas al host por operación (http hoy, llm después), reintentos incluidos
export const MAX_URL_LENGTH = 8192;             // unidades UTF-16, antes y después de serializar
export const MAX_REQUEST_BODY_LENGTH = 65536;   // unidades UTF-16 del body serializado
export const MAX_RESPONSE_BODY_LENGTH = 1048576; // unidades UTF-16 del body recibido (el host corta a 1 MiB en bytes)
export const SESSION_ERROR_CODES = [
  'unsupported_node', 'invalid_rule', 'step_limit_exceeded', 'value_too_large',
  'invalid_validation', 'retries_exhausted',
  'invalid_http_config', 'missing_secret', 'http_host_error', 'http_limit_exceeded',
] as const;
export const HTTP_ERROR_REASONS = [
  'invalid_url', 'invalid_header_value', 'body_too_large',
  'http_status', 'timeout', 'network_error', 'blocked', 'response_too_large', 'invalid_response',
] as const;
export type HttpErrorReason = (typeof HTTP_ERROR_REASONS)[number];

// ---- constants.ts (internas: no se exportan desde index.ts)
export const MAX_HTTP_HEADERS = 32;
export const MAX_MAPPED_VALUE_DEPTH = 100;
export const DEFAULT_HTTP_TIMEOUT_MS = 10000;  // paridad con schema.$defs.httpNode.properties.timeoutMs.default
export const DEFAULT_HTTP_RETRIES = 1;         // paridad con …retries.default

// ---- types.ts
import type { HttpNode } from '@franca/spec';
export type HttpMethod = HttpNode['request']['method'];      // derivado, nunca redefinido

/** Cabecera de una petición: valor ya renderizado, o secreto por nombre (el motor nunca tiene su valor). */
export type HttpRequestHeader = { name: string; value: string } | { name: string; secret: string };

/** Lo que recibe el host en cada intento. Objeto nuevo por intento; el host puede quedárselo o mutarlo. */
export interface HttpRequest {
  nodeId: string;
  method: HttpMethod;
  url: string;                  // serialización WHATWG (href) de la URL ya validada
  headers: HttpRequestHeader[]; // orden del flujo; Content-Type por defecto al final
  body: string | null;          // JSON compacto, o null sin body
  timeoutMs: number;            // del nodo o 10000; el host lo aplica a este intento
  attempt: number;              // 1 el primero
  containsPii: boolean;         // alguna plantilla de url, cabeceras o body nombra una variable pii
}

/** Resultado de **un** intento. Propiedades adicionales se ignoran. */
export type HttpAttemptResult =
  | { kind: 'response'; status: number; body: string }   // status entero 200-599; body decodificado
  | { kind: 'timeout' }
  | { kind: 'network_error'; requestSent?: boolean }      // omitido = true
  | { kind: 'blocked' }
  | { kind: 'response_too_large' }
  | { kind: 'missing_secret' };

/** Capacidad http del host: ejecuta un intento. Debe resolver siempre; rechazar es un defecto del host. */
export type HttpCapability = (request: HttpRequest) => Promise<HttpAttemptResult>;

export interface EngineHost {
  /** Sin ella, un nodo http falla con unsupported_node. */
  http?: HttpCapability;
}

export interface EngineHttpEvent {
  type: 'http';
  nodeId: string;
  attempts: number;             // llamadas hechas al host (0 si la petición no se pudo construir)
  status: number | null;        // del último intento si fue una respuesta
  error: HttpErrorReason | null;
}
export type EngineEvent = EngineMessageEvent | EngineInputEvent | EngineHttpEvent | EngineEndEvent | EngineErrorEvent;

// ---- session.ts
export function startSession(request: StartSessionRequest, host?: EngineHost | null): Promise<AdvanceResult>;
export function continueSession(request: ContinueSessionRequest, host?: EngineHost | null): Promise<AdvanceResult>;
```

Razones:
- **Cabeceras como lista de `{name, value | secret}` y no como `Record`**: conserva el orden y la capitalización escritos, distingue secreto y valor sin centinelas y evita que el host tropiece con un nombre válido como `__proto__` (es un token de RFC 9110: `_` es `tchar`) al hacer `headers[name]` ([[gotcha-variables-nombre-proto]]).
- **`url` como string serializado, no como objeto `URL`**: es serializable (golden, registros del host, transporte a un worker) y lo que el motor validó es exactamente lo que el host recibe. El host la vuelve a parsear; la serialización WHATWG de URLs `http(s)` es idempotente (`new URL(href).href === href`), y un test de propiedad lo comprueba sobre toda URL aceptada (D16).
- **`body` ya serializado**: el motor mide su tamaño (`body_too_large`) sobre lo mismo que se envía, y el golden congela los bytes exactos. El host lo envía como UTF-8.
- **Sin campo para el valor de un secreto, en ninguna dirección**: la petición solo lleva el nombre y el resultado no tiene dónde devolverlo. El motor no puede filtrar lo que nunca tiene (D12).
- **Un intento por llamada y política en el motor**: «el proveedor provee, el consumidor decide». El host aporta hechos (`status`, `timeout`, `requestSent`); qué se reintenta vive en una tabla determinista (D10).
- **`HttpCapability` tipada como promesa**: es el contrato. En runtime el motor hace `await` de lo que devuelva, así que un valor síncrono válido también funciona, pero no se promete.
- **`host?: EngineHost | null`**: el `null` de un llamador JS no puede convertir una sesión en una promesa rechazada (spec «Lectura de la capacidad http»).
- **Constantes exportadas: solo las que un consumidor usa**. El host necesita `MAX_RESPONSE_BODY_LENGTH` (corta a 1 MiB), `MAX_EXTERNAL_CALLS_PER_ADVANCE` (dimensiona el tiempo de un avance: 10 × 30 s), `MAX_URL_LENGTH` y `MAX_REQUEST_BODY_LENGTH` (límites de su cliente y de sus registros). `MAX_HTTP_HEADERS` y `MAX_MAPPED_VALUE_DEPTH` solo los usa el motor (y en el futuro el validador, que no puede depender del motor: FOLLOW-UP de la proposal).
- **No se exporta una lista de `kind`**: el host construye resultados con el tipo; la lista interna `HTTP_RESULT_KINDS` está atada a `HttpAttemptResult['kind']` con `satisfies` y la usan el lector (D9) y la suite de conformidad.
- **Lo que rompe en compilación**: un `switch` exhaustivo sobre `EngineEvent['type']` o `SessionErrorCode`. No hay consumidores (proposal); el README lo dice.

Ejemplos (JSON válido, reutilizable en tests; los golden los congelan):

Petición del ejemplo de captación de leads (spec «Petición del ejemplo de captación de leads»):

```json
{
  "nodeId": "enviar-crm",
  "method": "POST",
  "url": "https://crm.example.com/api/leads",
  "headers": [
    { "name": "Authorization", "secret": "CRM_TOKEN" },
    { "name": "Content-Type", "value": "application/json" }
  ],
  "body": "{\"name\":\"Ana\",\"email\":\"ana@example.com\",\"companySize\":\"51+\",\"segment\":\"empresa\"}",
  "timeoutMs": 8000,
  "attempt": 1,
  "containsPii": true
}
```

Resultados de un intento:

```json
[
  { "kind": "response", "status": 201, "body": "{\"id\":\"L-1\"}" },
  { "kind": "timeout" },
  { "kind": "network_error", "requestSent": false },
  { "kind": "blocked" },
  { "kind": "response_too_large" },
  { "kind": "missing_secret" }
]
```

Eventos (éxito tras un reintento; petición que no se pudo construir; fallo de sesión):

```json
[
  { "type": "http", "nodeId": "consultar", "attempts": 2, "status": 200, "error": null },
  { "type": "http", "nodeId": "consultar", "attempts": 0, "status": null, "error": "invalid_url" },
  { "type": "error", "nodeId": "enviar-crm", "code": "missing_secret", "message": "el host no tiene un secreto que pide el nodo o no puede enviarlo a ese destino" }
]
```

Tabla de códigos nuevos (se suman a D2 de `engine-base` y D1 de `engine-input`; el `message` exacto lo fija la implementación y lo congelan los golden):

| Código | Tipo | Cuándo | `nodeId` |
|---|---|---|---|
| `invalid_http_config` | error de sesión | nombre de cabecera que no es token, repetido sin distinguir mayúsculas o reservado; más de 32 cabeceras; `GET` con body no `null`; puntero con `~` mal escapado | el http |
| `missing_secret` | error de sesión | el host resuelve `{kind: "missing_secret"}` | el http |
| `http_host_error` | error de sesión | leer `host.http` lanza; `http` lanza o rechaza; resultado fuera de contrato o con un getter que lanza | el http |
| `http_limit_exceeded` | error de sesión | un **primer** intento sería la llamada 11 de la operación | el http |
| `value_too_large` (ampliado) | error de sesión | también un valor de cabecera o un string del body renderizado de más de 16384 | el http |

| `error` del evento `http` | Cuándo (en el orden en que se comprueba) |
|---|---|
| `invalid_url` | la URL renderizada no cumple «Valores insertados», «URL de la petición» o «Destino y longitud de la URL» |
| `invalid_header_value` | un valor de cabecera renderizado tiene algo distinto de U+0021-U+007E, espacio o tabulador |
| `body_too_large` | el body serializado tiene más de 65536 unidades |
| `response_too_large` | el host lo devuelve, o `body.length > MAX_RESPONSE_BODY_LENGTH` (con el status recibido) |
| `http_status` | respuesta con status fuera de 200-299 |
| `timeout`, `network_error`, `blocked` | el host lo devuelve |
| `invalid_response` | 2xx con `responseMap` no vacío cuyo cuerpo no es JSON o cuyos valores encontrados no se pueden guardar |

### D2. Estructura de módulos y contratos internos

```
packages/engine/src/
  http/
    capability.ts     readHttpCapability, invokeHost: único sitio que toca host.http
    config.ts         checkHttpConfig: invalid_http_config (D5)
    url.ts            encodeUrlValue, buildRequestUrl (D7)
    request.ts        prepareRequest, requestFor, containsPii (D6, D8)
    result.ts         readAttemptResult, HTTP_RESULT_KINDS (D9)
    retry.ts          IDEMPOTENT, judgeAttempt (D10)
    response-map.ts   checkPointerEscapes, decodePointer, resolvePointer, mapResponse (D11)
  nodes/http.ts       executeHttp: orquesta el orden de la spec y los intentos (D4)
  conformance/        suite de conformidad del host, exportada como @franca/engine/conformance (D14)
    index.ts  types.ts  cases.ts  call.ts
```

Cambios en ficheros existentes del motor (todos dentro de `packages/engine`):

| Fichero | Cambio | Por qué |
|---|---|---|
| `src/constants.ts`, `src/types.ts`, `src/index.ts` | D1 | contrato |
| `src/nodes/types.ts` | `StepContext` gana `readonly piiVariables: ReadonlySet<string>` y `reserveExternalCall(): boolean` | `containsPii` (D6) y el presupuesto de llamadas externas por operación (D10) sin pasar el flujo entero a los ejecutores. El presupuesto es **uno solo** para `http` y el futuro `llm`: la feature 4 llama a la misma función, no crea otro contador |
| `src/run.ts` | construye esos dos miembros por operación (`piiVariables` con el cierre de D6) | el contador vive en la operación, no en un módulo (guarda de estado de módulo) |
| `src/nodes/index.ts` | `http: executeHttp` | — |
| `src/session.ts` | `host ?? {}` y tipo `EngineHost \| null` | D3 |
| `src/state.ts` | límite de profundidad del estado | D13 |
| `src/template.ts` | `renderTemplate(template, lookup, options?)` con `{ maxLength?, insert? }`, `measureTemplate(template, lookup)` y `templateVariables(template)` | una sola gramática de marcadores (`TEMPLATE_VAR`) para URL, cabeceras, body y `containsPii`; sin opciones se comporta exactamente como hoy |
| `src/input/parsers/url.ts` | `export` de `hasHiddenChars` y `hasPercentInHost` (sin cambiar su código) | mismas reglas que el tipo `url` de `input` ([[gotcha-url-whatwg-normaliza]]) |
| `package.json`, `tsdown.config.ts` | `entry: { index: 'src/index.ts', conformance: 'src/conformance/index.ts' }` (con nombre: comprobado con tsdown 0.23 en un directorio temporal, da `dist/index.mjs`, `dist/conformance.mjs`, sus `.d.mts` y un chunk compartido, que `files: ["dist"]` ya publica); subruta `./conformance` en `exports`; script `mutate`; `.mutate-backup/` en un `packages/engine/.gitignore` nuevo (el paquete no tiene uno) | D14, D17 |

- `renderTemplate` con opciones: `maxLength` (por defecto `MAX_RENDERED_LENGTH`) y `insert(text, budget)`, que transforma la forma textual de cada valor insertado y recibe lo que queda de presupuesto; si `insert` lanza, el error se propaga. Los tests de `template` existentes no cambian (comprueban la llamada sin opciones). Alternativa descartada: un segundo renderizador en `http/url.ts`. Duplicaría la gramática de marcadores, que ya está copiada una vez de `@franca/spec` (FOLLOW-UP 6.7 de `engine-base`).
- `piiVariables`: nombres con **alguna** declaración `pii: true` (el motor se queda con la primera declaración de un nombre repetido, FOLLOW-UP 6.9 de `engine-base`, pero para el indicador de privacidad se elige el lado conservador), cerrados de forma estática por `set` (D6).

### D3. Lectura de la capacidad y llamada al host (`http/capability.ts`)

```ts
type Capability = { kind: 'absent' } | { kind: 'present'; call: Function } | { kind: 'error' };
export function readHttpCapability(host: EngineHost): Capability;
export async function invokeHost(call: Function, host: EngineHost, request: HttpRequest): Promise<{ ok: true; value: unknown } | { ok: false }>;
```

- **Una lectura de `host.http` por llegada al nodo**, dentro de un `try`: un getter que lanza → `error` (`http_host_error`); `typeof !== 'function'` → `absent` (`unsupported_node`, con el mismo mensaje que hoy para que el golden `fixtures-nodo-http` no cambie). Los reintentos usan esa misma función: un host no puede cambiar de capacidad entre intentos del mismo nodo, y el coste de la lectura no depende de los intentos.
- **`Reflect.apply(call, host, [request])`**: `this` es el host (un cliente con estado escrito como clase funciona) y no se lee `call.call`, que un host podría haber sobrescrito.
- **`try { value = await Reflect.apply(...) } catch { return { ok: false } }`, sin variable en el `catch`**: lo que lanza el host puede llevar URL, PII o el valor de un secreto, y no se mira ni se propaga. Una guarda estática prohíbe `catch (` con variable en `http/capability.ts` (D16). El `try` envuelve solo la llamada y su `await`: un defecto del propio motor fuera de esa línea sigue rechazando la promesa, como pide «Ejecución determinista».
- Llamadas en secuencia por construcción: el ejecutor hace `await` de cada intento antes de cualquier otra cosa y `run` hace `await` de cada ejecutor.
- **El motor no impone tiempo**: si la promesa del host no se resuelve nunca, la operación tampoco. Por eso el timeout por intento es un **MUST** del host (spec «Host de producción: tiempo por intento») y está en la suite de conformidad.

### D4. El ejecutor (`nodes/http.ts`): orden de la spec

`run` ya comprueba el límite de pasos antes de llamar al ejecutor. `executeHttp(node, ctx)`:

1. `readHttpCapability(ctx.host)` → `absent`: `unsupported_node`; `error`: `http_host_error`.
2. `checkHttpConfig(node)` → `invalid_http_config` (D5). Antes de renderizar nada.
3. `prepareRequest(node, ctx)` (D6): renderiza valores de cabecera y strings del body con el límite general; un `ValueTooLargeError` → `value_too_large`. Después, en el orden de la spec, URL (D7) → valores de cabecera en orden (D8) → tamaño del body (D8). El primer fallo da `{ invalid: reason }`: emite `{type: 'http', nodeId, attempts: 0, status: null, error: reason}` y continúa en `onError`.
4. Bucle de intentos (D10), con `ctx.reserveExternalCall()` antes de cada llamada.
5. Éxito: aplica la asignación (D11), emite el evento con `error: null` y continúa en `next`. Error final: emite el evento con el motivo y el status del último intento y continúa en `onError`, sin tocar variables.

Un fallo de sesión (`unsupported_node`, `invalid_http_config`, `value_too_large`, `missing_secret`, `http_host_error`, `http_limit_exceeded`) nunca emite el evento `http`. `prepareRequest` es puro y se ejecuta **una vez** por llegada; cada intento solo construye un objeto nuevo con `requestFor(prepared, attempt)` (lista de cabeceras y entradas nuevas). Así el host no puede alterar los intentos siguientes (escenario «El host no altera los intentos siguientes») y el renderizado no se repite.

### D5. Configuración que no se puede ejecutar (`http/config.ts`)

`checkHttpConfig(node): string | null` (mensaje fijo por causa, sin nombres ni valores, o `null`):

- `Object.keys(headers)` (forma JSON) con más de 32 → error.
- Cada nombre: al menos un carácter y todos en `tchar` de RFC 9110 (`A-Z a-z 0-9 ! # $ % & ' * + - . ^ _ \` | ~`), comprobado **antes** de pasar a minúsculas: así `toLowerCase` solo ve ASCII y no hay plegado Unicode (`K` U+212A → `k`) que convierta un nombre inválido en uno reservado.
- Duplicados: `Set` de nombres en minúsculas ASCII.
- Reservados: `host`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `te`, `trailer`, `expect`, o prefijo `proxy-`.
- `method === 'GET'` y `body !== undefined && body !== null` → error. `DELETE` con body se admite (spec).
- `checkPointerEscapes(pointer)` para cada entrada de `responseMap`: todo `~` va seguido de `0` o `1`.
- Los mensajes no nombran la cabecera: una clave del flujo puede ser arbitrariamente larga y el editor recibirá estas reglas del validador (FOLLOW-UP de `packages/spec`).

### D6. Renderizado de cabeceras y body e indicador `containsPii` (`http/request.ts`)

- **Cabeceras**: `Object.entries(headers)` de la forma JSON, que ya da el orden de la spec («Orden de cabeceras y claves del body»). String → `renderTemplate(valor, lookup)` (límite 16384, `value_too_large`); `{secret}` → `{name, secret}` sin tocar.
- **Body**: recorrido de la forma JSON (profundidad ≤ 996 porque el flujo está acotado a 1000: la recursión es segura, igual que `cloneNode`). String → `renderTemplate`; number, boolean y `null` tal cual; arrays con su orden; objetos reconstruidos con `Object.fromEntries`, que conserva `__proto__` y `constructor` como claves propias (escenario «Claves con nombre de Object»). `body` ausente o `null` → sin body. Se serializa con `JSON.stringify` (compacto); un sustituto suelto que venga de una variable sale como escape `\ud800`, JSON válido.
- **Todos** los valores de cabecera y strings del body se comprueban contra 16384 antes de construir nada (el `value_too_large` gana a cualquier `onError`, spec «Orden de comprobación»).
- **Memoria acotada del body**: se lleva la suma de las longitudes renderizadas. Mientras no supere `MAX_REQUEST_BODY_LENGTH`, cada string se renderiza y se conserva; en cuanto la supera, `body_too_large` ya es seguro (la serialización JSON mide al menos la suma de sus strings: hipótesis con test en D16) y se deja de construir el body. Los strings restantes se **miden** sin construirlos con `measureTemplate(template, lookup)` (nuevo en `src/template.ts`: misma gramática, suma longitudes con salida temprana en 16385 y lanza `ValueTooLargeError`), para conservar el `value_too_large` de un string posterior. Lo retenido queda acotado por 65536 + 16384 unidades, no por N × 16384. El tiempo sigue siendo O(número de strings × 16384), la misma clase que un `message` con muchos elementos.
- **`containsPii`**: `templateVariables(t)` sobre la `url`, cada valor de cabecera string y cada string del body (no las claves: son literales), contra `ctx.piiVariables`. Se calcula una vez por llegada y es igual en todos los intentos. Mira la plantilla, no el valor: una variable `pii` sin valor cuenta (spec «Indicador de datos personales»).
- **Cierre por `set`** (`personalVariables(flow)` en `src/http/request.ts`, llamado por `run` una vez por operación): parte de las declaradas con `pii: true` y, mientras cambie, añade cada variable a la que algún `set` del flujo asigna un string cuya plantilla nombra una variable del conjunto. Es estático (todos los `set` del flujo, se ejecuten o no) porque el indicador describe la petición, no un camino concreto, y así no depende de los datos. Coste O(asignaciones × variables) en el peor caso, una vez por operación y acotado por el tamaño del flujo. No se propaga por `input`, `condition` ni `responseMap`, que no copian plantillas (un `responseMap` hacia una variable no `pii` trae datos del servidor; si el autor sabe que son personales, la declara `pii`).

### D7. URL: codificación de valores y validación (`http/url.ts`)

**Renderizado con codificación.** `renderTemplate(url, lookup, { maxLength: MAX_URL_LENGTH, insert: encodeUrlValue })`:

```ts
/** RFC 3986 unreserved sin codificar; todo lo demás en UTF-8 %XX mayúsculas. */
export function encodeUrlValue(text: string, budget: number): string;
// 1. text.length > budget → ValueTooLargeError, sin recorrer el texto (codificar nunca encoge: ≥ 1 unidad por unidad)
// 2. encodeURIComponent(text) → URIError (sustituto suelto) → InvalidUrlError (interna)
// 3. post-pase de una pasada que sustituye ! ' ( ) * por %21 %27 %28 %29 %2A
```

- `ValueTooLargeError` e `InvalidUrlError` se capturan en `buildRequestUrl` y dan `invalid_url`: la `url` nunca produce `value_too_large` (spec «Justo en el límite y URL larga»).
- `encodeURIComponent` es el codificador del runtime (UTF-8, `%XX` en mayúsculas, rechaza sustitutos sueltos); el post-pase es un bucle sobre unidades de código, sin expresión regular. Alternativa descartada: un codificador UTF-8 propio. Más código para el mismo resultado; un test diferencial lo compara igualmente con la definición (D16).
- El texto literal de la plantilla no se codifica: lo escribe el autor.

**Validación del texto renderizado**, en este orden, cada paso con su porqué:

1. Empieza por `http://` o `https://` sin distinguir mayúsculas (ASCII). Sin esquema implícito: a diferencia del tipo `url` de `input`, aquí el texto lo escribe el autor.
2. `hasUnstorable` (U+0000 y sustitutos sueltos, también literales), `hasHiddenChars` (blancos, controles, `Default_Ignorable_Code_Point`), `\` y `#` en cualquier posición.
3. `hasPercentInHost(texto, longitudDelEsquema + 3)`: el host no puede llevar `%` (WHATWG lo decodificaría y quitaría invisibles; `api%2eexample.com` también cae aquí).
4. Segmentos de punto: la ruta va del primer `/` tras la autoridad hasta `?` o el final; cada segmento se normaliza sustituyendo `%2e` sin distinguir mayúsculas por `.` y, si queda `.` o `..`, se rechaza. Es la misma definición que usa WHATWG («single-dot» y «double-dot path segment»), así que cubre `.%2E` y `%2e.` por construcción; `%252e` no es un punto (WHATWG no decodifica dos veces).
5. `new URL(texto)` en `try`; `protocol` `http:`/`https:`; `username` y `password` vacíos.
6. `isDomainName(url.hostname)` sobre el host **serializado** (tras IDNA: `１２７．０．０．１` ya es `127.0.0.1`, que no es un dominio) y `hostname !== 'localhost' && !hostname.endsWith('.localhost')`.
7. Longitud: el texto renderizado ya está acotado a 8192 por el renderizador; además `url.href.length <= MAX_URL_LENGTH`. Doble límite porque WHATWG crece (no ASCII ×9) y también encoge (puerto por defecto y ceros a la izquierda del puerto).
8. Se entrega `url.href`.

**Límite que el motor no puede cerrar (va al README).** La garantía es sobre la URL que se envía, no sobre cómo la interpreta el servidor: un valor `../admin` llega como `..%2Fadmin`, pero un servidor o proxy que decodifica `%2F` antes de enrutar verá `../admin`; y un valor vacío en `/users/{{id}}/x` da `/users//x`, que algunos servidores fusionan en `/users/x`. Quien escribe el flujo debe validar antes esos valores (con `matches` o un `input` con `pattern`) si el servidor hace eso.

Lo que WHATWG sí cambia y se acepta (canonicaliza sin cambiar el recurso, como en el tipo `url`): host a minúsculas e IDNA, puerto por defecto, percent-encoding de no ASCII y de `"<>\`{}` en la ruta, `/` final en una ruta vacía.

**Lo que garantiza la codificación y lo que no.** Un valor insertado solo aporta caracteres no reservados (`A-Z a-z 0-9 - . _ ~`) o secuencias `%XX`. No puede añadir `/`, `?`, `#`, `@`, `:` ni `&`, y un `%XX` en el host se rechaza. Pero si el autor deja una parte del host en una plantilla (`https://{{sub}}.example.com/`, o `https://{{h}}/`), un valor de no reservados sí elige esas etiquetas. Es la conducta que fija la spec («Etiquetas del host que el autor deja abiertas»); los secretos siguen ligados a su origen exacto en el host y los destinos internos los bloquea el host. El orquestador decidió mantener esta conducta; el aviso del validador para marcadores en el esquema, el host o pegados a él es FOLLOW-UP (tarea 6.5).

### D8. Valores de cabecera, Content-Type y tamaño del body

- Valor de cabecera: un bucle sobre unidades de código que solo admite U+0021-U+007E, U+0020 y U+0009 (`invalid_header_value`). No hay forma codificada que el motor decodifique: el valor viaja tal cual, así que CR, LF y NUL solo pueden aparecer literales y se rechazan.
- `Content-Type` por defecto: si hay body y ningún nombre es `content-type` en minúsculas ASCII, se añade `{name: 'Content-Type', value: 'application/json'}` al final. No cuenta en el límite de 32 (es del motor).
- `body.length > MAX_REQUEST_BODY_LENGTH` → `body_too_large`.

### D9. Lectura del resultado del host (`http/result.ts`)

`readAttemptResult(raw: unknown): AttemptResult | null`, con la misma disciplina que `readUserInput` de `engine-input`:

- `raw` debe ser un objeto no `null` (cualquier prototipo: la forma la dan sus propiedades, no su clase).
- **Cada propiedad se lee una sola vez** a una variable local, dentro de un `try` (un getter que lanza → `null`): `kind`; después, según `kind`, `status` y `body`, o `requestSent`. Ninguna otra: `headers`, `set-cookie` o lo que añada el host no se tocan (escenario «Propiedades adicionales»). El test con `Proxy` que registra las lecturas es **unitario sobre `readAttemptResult`**: a través de la promesa, el runtime lee además `then` del valor resuelto, y esa lectura no es del motor (D16).
- `response`: `Number.isInteger(status) && 200 <= status <= 599` y `typeof body === 'string'`. `network_error`: `requestSent` `undefined` → `true`; `true`/`false` tal cual; otra cosa → `null`.
- `null` → `http_host_error`.

### D10. Reintentos, idempotencia y límite de llamadas (`http/retry.ts`, `nodes/http.ts`)

```ts
/** Métodos idempotentes de RFC 9110. El tipo mapeado hace fallar tsc si el esquema añade un método. */
export const IDEMPOTENT: { readonly [M in HttpMethod]: boolean } = { GET: true, PUT: true, DELETE: true, POST: false, PATCH: false };
```

| Resultado del intento | `GET` / `PUT` / `DELETE` | `POST` / `PATCH` |
|---|---|---|
| `response` 2xx con `body.length ≤ 1 MiB` | éxito (o `invalid_response`, sin reintento) | éxito (ídem) |
| `response` con `body.length > 1 MiB` (cualquier status) | `response_too_large`, sin reintento | ídem |
| `response` 408 o 429 | reintenta | reintenta |
| `response` 500, 502, 503 o 504 | reintenta | **no** |
| `response` con otro status (3xx, 4xx, 501, 505-599) | `http_status`, sin reintento | ídem |
| `timeout` | reintenta | **no** |
| `network_error`, `requestSent: false` | reintenta | reintenta |
| `network_error`, `requestSent` `true` u omitido | reintenta | **no** |
| `blocked`, `response_too_large` | sin reintento | ídem |
| `missing_secret` | la sesión falla (`missing_secret`) | ídem |
| fuera de contrato | la sesión falla (`http_host_error`) | ídem |

El tamaño de la respuesta se comprueba **antes** que el status y antes de cualquier `JSON.parse` (spec «Tamaño máximo de la respuesta»).

Bucle (pseudocódigo del contrato, no de la implementación):

```
maxAttempts = 1 + (node.retries ?? DEFAULT_HTTP_RETRIES)
attempts = 0
loop:
  if !ctx.reserveExternalCall():
    attempts == 0 ? fail http_limit_exceeded : break          // reintento recortado → onError con el último motivo
  attempts += 1
  raw = await invokeHost(call, host, requestFor(prepared, attempts))
  raw falla o readAttemptResult(raw) es null → fail http_host_error
  missing_secret → fail missing_secret
  veredicto = judgeAttempt(result, method)                     // éxito | { reason, status, retryable }
  éxito → mapResponse (D11) → evento → next (o evento invalid_response → onError)
  last = veredicto
  if !retryable || attempts >= maxAttempts: break
evento { attempts, status: last.status, error: last.reason } → onError
```

- `reserveExternalCall()` lo crea `run` por operación con un contador local (`MAX_EXTERNAL_CALLS_PER_ADVANCE`): se reinicia en cada `startSession`/`continueSession` y cuenta reintentos. Un primer intento que no cabe es un ciclo (fallo visible); un reintento que no cabe se recorta sin drama (spec «Límite de llamadas al host por avance»).
- El nodo cuenta como un paso del límite de pasos, haga los intentos que haga: el bucle está dentro del ejecutor.
- Sin esperas: el motor no tiene temporizadores (guarda estática) y nunca espera entre intentos. El host puede aplicar un *backoff* porque recibe `attempt`.
- Peor caso de un avance: 10 llamadas de hasta 30 s cada una, **siempre que el host aplique `timeoutMs` como tope total del intento** (resolución, conexión, envío y lectura completa) y no como tiempo de inactividad: con un timeout de inactividad (`headersTimeout`/`bodyTimeout` de undici), un servidor que escribe un byte cada pocos segundos alarga un intento sin límite. Es un MUST del host («Host de producción: tiempo por intento») y lo comprueban los casos `servidor-no-responde` y `servidor-muy-lento` de D14. El tope de tiempo total por avance sigue siendo del host (FOLLOW-UP 6.5 de `engine-base`).

### D11. `responseMap`: JSON Pointer, todo o nada y límites (`http/response-map.ts`)

Solo con un éxito y `responseMap` no vacío (sin él, el cuerpo no se parsea):

1. `doc = JSON.parse(body)` en `try`; si lanza (`"<html>"`, `""`) → `invalid_response`.
2. Para **cada** entrada, en orden, sin asignar todavía:
   - `decodePointer(pointer)`: `""` → documento entero; si no, se quita el `/` inicial, se parte por `/` y cada token se decodifica en una pasada (`~1` → `/`, `~0` → `~`; `~01` → `~1`, como pide RFC 6901). Los escapes inválidos ya los rechazó D5.
   - `resolvePointer(doc, tokens)`: iterativo, un token cada vez. En un array, el token debe ser `0` o `[1-9][0-9]*` (escaneado a mano, sin `Number()` de texto arbitrario: `"1e1"`, `" 1"`, `"0x1"` no son índices) y menor que `length`; `-` no encuentra nada. En un objeto, `Object.hasOwn(obj, token)`: `__proto__` del cuerpo se encuentra (es propia tras `JSON.parse`) y `constructor` no. En un escalar, nada. Coste O(número de tokens).
   - No encontrado o `null` → la variable quedará sin valor.
   - Encontrado → `checkMappedValue(v)`:
     1. `exceedsDepth(v, MAX_MAPPED_VALUE_DEPTH)` (iterativo y con salida temprana: un `""` sobre 524 288 niveles no recursa).
     2. `cloneJsonWithinDepth(v)`: rechaza números no finitos (`1e400`) y normaliza `-0`; recursivo, seguro con ≤ 100 niveles.
     3. Barrido iterativo de strings **y claves** con `hasUnstorable` (U+0000 y sustitutos sueltos).
     4. `textOf(copia).length ≤ MAX_RENDERED_LENGTH` (16384).
     Cualquier fallo → `invalid_response` para todo el nodo.
3. Solo si todas pasan, se aplican en orden con `ctx.vars.set(variable, valor ?? null)`: el último gana si una variable se repite, y una variable de contacto se refleja en `contact` (escenario «Orden y variables de contacto»).

Coste: `JSON.parse` es O(cuerpo) ≤ 1 MiB una vez; cada entrada cuesta O(tokens) en resolver y, en el peor caso, O(1 MiB) en medir y copiar su valor (un `""` o un puntero a un subárbol enorme), así que el total es O(entradas × 1 MiB). Las entradas las fija el autor en el flujo; lo que queda retenido en variables está acotado por 16384 unidades de forma textual por entrada. Se documenta en el README.

Razones de los valores (proposal): 100 niveles y 16384 unidades caben en cualquier respuesta de API razonable, en una plantilla y en `jsonb`, y mantienen el estado muy por debajo de 1000 niveles (D13). Lo que no se mapea no se copia, no se mide y no llega al estado.

### D12. Evento `http`, privacidad y secretos

- El evento lleva solo `type, nodeId, attempts, status, error`, en ese orden de claves (golden estables).
- Los mensajes de error de sesión son textos fijos por código o causa; nunca incluyen la URL, cabeceras, body, respuesta ni nada de lo que lance o devuelva el host.
- **Dónde vive la resolución de secretos**: en el host, dentro de cada intento: parsea `request.url`, resuelve cada `{name, secret}` con el almacén de la instalación o tenant dueño del flujo **solo** si el origen exacto (esquema, host y puerto) está autorizado para ese secreto, y si no devuelve `missing_secret` sin abrir conexión. El motor no tiene ni tipo ni campo para el valor, en la petición ni en el resultado.
- **Cómo se prueba que el valor nunca toca estado, eventos ni errores** (spec «Valor de un secreto devuelto por el host»): un host falso resuelve `CRM_TOKEN` a un marcador único (`ZQXJ-SECRETO-…`) y, en casos separados, lanza un `Error` con el marcador, rechaza con él, devuelve 500 con el marcador en el `body`, devuelve 200 con el marcador en una propiedad extra, y devuelve un resultado mal formado que lo contiene. En todos: el marcador no aparece en `JSON.stringify` de la petición recibida, de los eventos ni del estado. Se valida por mutación: propagar el mensaje del error del host en `http_host_error` y copiar el resultado del host al evento deben hacer fallar el test (D17).
- **PII**: la misma técnica con una variable `pii` en la URL y el body (spec «Datos personales en la petición»), y `containsPii` para que el host decida qué registrar.

### D13. Arreglo de la profundidad del estado (bug de la feature 1)

**Qué estaba roto.** `parseState` copia el estado con `cloneJsonStrict`, que rechaza más de `MAX_NESTING_DEPTH` (1000) niveles **del estado entero**. El estado añade un nivel sobre sus campos (`{contact: {c: v}}`): un valor de contacto de 999 niveles (contacto de profundidad 1000, aceptado al arrancar) da un estado de 1001, que el propio motor no acepta al continuar.

**Corrección elegida.** `parseState` mide con `exceedsDepth(input, STATE_MAX_DEPTH)` y copia con `cloneJsonWithinDepth`, donde `STATE_MAX_DEPTH = MAX_NESTING_DEPTH + 1` (constante interna con su porqué en un comentario): el objeto del estado no cuenta y cada campo admite 1000 niveles, exactamente lo que se admite en el contacto recibido.

**Por qué esta y no las otras:**
- *Medir cada valor dentro del estado*: obliga a recorrer el estado antes de saber si es un objeto con esa forma, y un estado hostil (100 000 niveles en un campo extra que se ignora) seguiría necesitando una medida global previa e iterativa. Es equivalente en resultado (campo ≤ 1000 ⇔ estado ≤ 1001) con más código.
- *Bajar el límite del contacto a 999*: rompe un escenario aprobado («el de 999 no se rechaza») y desplaza el problema a la siguiente fuente de valores.
- *Reservar «2 niveles»*: el estado añade uno sobre `contact`/`variables`; reservar dos aceptaría estados que el motor nunca produce.

**Otros sitios con el mismo desfase** (auditados en el código; profundidad máxima de un valor según su origen):

| Origen del valor | Profundidad máxima | Por qué | ¿Cabe en un campo del estado (≤ 1000)? |
|---|---|---|---|
| `default` de una variable | 997 | flujo ≤ 1000 y el `default` está a 3 niveles | sí |
| valor de contacto inyectado | 999 | contacto ≤ 1000 | sí (era el caso roto) |
| `set` | 0 | escalares o strings | sí |
| `input` | 1 | escalares; múltiple = array de `choice.value`, que son escalares por esquema | sí |
| `responseMap` | 100 | `MAX_MAPPED_VALUE_DEPTH` | sí |
| estado restaurado | 999 | campo ≤ 1000 | sí |

Ningún otro sitio mide la profundidad de algo que haya producido el motor: el flujo y el contacto se miden al entrar con su propio límite, y `buildState` serializa sin medir. `cloneJsonStrict` mantiene su contrato (1000) para los `default`. La feature 4 (`llm`, slots) añadirá un origen: su límite debe quedar ≤ 999 (FOLLOW-UP).

**Regresión**: escenarios «Ida y vuelta con un contacto en el límite» y «Estado justo en el límite de anidamiento», más una propiedad: para cada origen de la tabla en su máximo, arrancar → (JSON) → continuar no se rechaza. Mutación: volver a `cloneJsonStrict` en `parseState` debe hacer fallar ambos.

### D14. Suite de conformidad del host (`@franca/engine/conformance`)

**Decisión: se publica ya el catálogo de casos**, con los tipos del arnés y el ayudante `call.ts`, puros y sin IO. La feature 6 implementa el arnés con servidores reales, la pasa y la valida con mutantes de su propio host. Convierte los requisitos «Host de producción: …» en una comprobación que la feature 6 no puede reinterpretar. Lo que **no** se hace aquí (decisión del orquestador tras la revisión): ni red simulada, ni host de referencia simulado, ni hosts rotos. Validar la suite contra dobles con la forma que imaginamos es justo lo que la proposal descarta para el adaptador. Esa validación se hace en la feature 6, contra el host real (tarea 6.1).

**Modelo de destinos del arnés** (es contrato, no detalle: la feature 6 escuchará en loopback y una lista de permitidos ingenua lo dejaría todo abierto):
- Un destino permitido es un par **dirección y puerto** exactos (spec «Host de producción: destinos permitidos y resolución»). El arnés añade a la lista del host solo los pares de los servidores que levanta con `serve`, y ningún otro.
- `serve` escucha en una dirección que **no** está en `CONFORMANCE_INTERNAL_ADDRESSES`, la lista exportada de direcciones que usan los casos de bloqueo (incluye `127.0.0.1` y `::1`). En Linux, la feature 6 puede usar `127.0.0.2`, `127.0.0.3`… (todo `127/8` es local); en macOS, un alias de loopback. Así `127.0.0.1` sigue bloqueada aunque haya servidores en loopback.
- Los casos de bloqueo piden URLs al puerto `harness.blockedPort`, donde el arnés garantiza que no escucha ningún servidor y que no aparece en ningún par permitido. Un host que permitiera «la dirección» sin mirar el puerto, o «loopback» entero, falla los casos.
- `connectionsTo()` devuelve pares `{address, port}`, y las aserciones comparan pares.

```ts
// src/conformance/types.ts
export type ServerBehaviour =
  | { kind: 'respond'; status: number; body?: string; headers?: Readonly<Record<string, string>> }
  | { kind: 'redirect'; status: 301 | 302 | 303 | 307 | 308; location: string }
  | { kind: 'endless-body'; encoding: 'identity' | 'gzip' | 'deflate' | 'br' | 'x-franca-test' } // escribe sin fin hasta que el cliente cierra
  | { kind: 'compressed-body'; encoding: 'gzip' | 'deflate' | 'br'; decompressedBytes: number } // cuerpo finito de `a` comprimido (< 64 KiB en red)
  | { kind: 'stall-headers' }   // acepta la conexión y la petición y nunca responde
  | { kind: 'stall-body' }      // envía las cabeceras y deja de escribir
  | { kind: 'drip-body'; intervalMs: number } // envía las cabeceras y un byte del cuerpo cada intervalMs, sin terminar
  | { kind: 'set-cookie'; cookie: string };

export interface ServeOptions { readonly tls?: 'none' | 'trusted' | 'untrusted' }

export interface ConformanceServer {
  /** Origen con un nombre DNS que el arnés resuelve a la dirección del servidor (p. ej. http://srv-1.conformance.test:41234). */
  readonly origin: string;
  /** Par permitido para el host: la dirección (fuera de CONFORMANCE_INTERNAL_ADDRESSES) y el puerto en que escucha. */
  readonly address: string;
  readonly port: number;
  received(): Promise<readonly ReceivedRequest[]>;
}
export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>; // nombres en minúsculas
  readonly body: string;
}
export interface Connection { readonly address: string; readonly port: number }

export interface HostConformanceHarness {
  /** El http del host bajo prueba para el tenant dado, con el resolutor, la lista de permitidos y el almacén de secretos del arnés. */
  http(tenant?: string): HttpCapability;
  /** Levanta un servidor y añade su par (dirección, puerto) a la lista de permitidos del host. Nada más se permite. */
  serve(behaviour: ServerBehaviour, options?: ServeOptions): Promise<ConformanceServer>;
  /** `name` resuelve a cada lista de direcciones en resoluciones sucesivas (la última se repite). Una lista puede mezclar direcciones. */
  resolve(name: string, answers: readonly (readonly string[])[]): Promise<void>;
  /** Puerto en el que no escucha nada y que no está en ningún par permitido. */
  readonly blockedPort: number;
  /** Par permitido en el que nadie escucha (la conexión se rechaza) y un origen cuyo nombre resuelve a él. */
  refusing(): Promise<{ readonly origin: string; readonly address: string; readonly port: number }>;
  /** Pares a los que el host intentó conectar desde el último reset. */
  connectionsTo(): Promise<readonly Connection[]>;
  setSecret(name: string, value: string, origins: readonly string[], tenant?: string): Promise<void>;
  /** Líneas que el host registró desde el último reset. */
  logs(): Promise<readonly string[]>;
  /** Reloj del arnés en ms y tolerancia de los casos de tiempo (la fija el entorno; el runner de CI de la feature 6 la mide). */
  now(): number;
  readonly timeToleranceMs: number;
  /** Espera real de `ms` (la pone el arnés: el motor no tiene temporizadores). La usa call.ts para su espera límite. */
  sleep(ms: number): Promise<void>;
  reset(): Promise<void>;
}

export interface HostConformanceCase {
  readonly id: string;           // estable, kebab-case
  readonly requirement: string;  // título exacto del requisito «Host de producción: …»
  readonly scenario: string;     // título exacto del #### Scenario
  /** @returns Fallos encontrados; [] si pasa. Los mensajes no incluyen valores de secretos ni PII. */
  run(harness: HostConformanceHarness): Promise<string[]>;
}
export const HOST_CONFORMANCE_CASES: readonly HostConformanceCase[];
export const CONFORMANCE_INTERNAL_ADDRESSES: readonly string[];
export const CALL_DEADLINE_MARGIN_MS = 1000;
```

Uso en la feature 6 (con cualquier runner):

```ts
it.each(HOST_CONFORMANCE_CASES.map((c) => [c.id, c] as const))('%s', async (_, c) => {
  await harness.reset();
  expect(await c.run(harness)).toEqual([]);
});
```

`call.ts` envuelve cada llamada: anota un fallo si la promesa se rechaza o si el resultado no pasa `readAttemptResult` (el mismo lector del motor: no puede haber deriva entre lo que la suite exige y lo que el motor acepta), y mide `now()` antes y después. **Espera límite propia**: compite la llamada con `harness.sleep(request.timeoutMs + harness.timeToleranceMs + CALL_DEADLINE_MARGIN_MS)` (margen exportado de 1000 ms). Si gana la espera, el caso falla con «el host no resolvió en N ms» en vez de morir por el timeout del runner (que da un mensaje genérico y puede cortar los casos siguientes). La feature 6 debe dar a cada test un timeout del runner mayor que la suma de las esperas límite del caso; el README lo documenta. Cada caso usa `timeoutMs` explícitos y pequeños, así que esa suma es de segundos.

Casos (uno por escenario de la spec, con sus títulos exactos):

| `id` | Escenario | Comprobación |
|---|---|---|
| `destinos-internos` | Dominios que resuelven a direcciones internas | un nombre por cada dirección de la spec (25: una por clase, IPv4, IPv6 y v4 mapeada, más `::ffff:7f00:1`, `0:0:0:0:0:0:0:1` y la forma con ceros completos, para un host que compara cadenas en vez de direcciones; todas en `CONFORMANCE_INTERNAL_ADDRESSES`), al `blockedPort`: `blocked` y ningún par con esas direcciones en `connectionsTo` |
| `cambio-de-resolucion` | Cambio de resolución entre comprobación y conexión | nombre → `[A.address]` y después `[127.0.0.1]`, al puerto de A: `response` de A o `blocked`; nunca `127.0.0.1:A.port` |
| `resolucion-mezclada` | Resolución con respuestas mezcladas | tres rondas al mismo nombre: `[A.address, 127.0.0.1]` y `[127.0.0.1, A.address]` al puerto de A (`response` de A o `blocked`), y `[R.address, 127.0.0.1]` al puerto de R, con R de `refusing()` (`blocked` o `network_error`); en ninguna aparece `127.0.0.1` con ese puerto en `connectionsTo`. Detecta «solo miro la primera respuesta», «basta con que alguna esté permitida» y el salto a la siguiente dirección al fallar la primera (`autoSelectFamily` / *happy eyeballs* de undici) |
| `redireccion` | Redirección a un destino interno | A responde 302 a `http://127.0.0.1:<blockedPort>/` y, en otra ronda, a `B.origin`: `{kind: 'response', status: 302}`, A recibe 1 petición y B ninguna |
| `cookies` | Cookies de una respuesta anterior | dos peticiones a un servidor `set-cookie`: la segunda sin cabecera `cookie` |
| `tls-invalido` | Certificado no válido | `https` a un servidor `untrusted`: `network_error` con `requestSent: false` y 0 peticiones recibidas |
| `cuerpo-sin-fin` | Cuerpo sin fin | `endless-body` `identity` con `timeoutMs` 5000: `response_too_large` antes de 5000 ms |
| `cuerpo-comprimido-sin-fin` | Cuerpo comprimido sin fin | `endless-body` con `gzip`, `deflate`, `br` y `x-franca-test`, `timeoutMs` 5000: `response_too_large` antes de 5000 ms en los cuatro |
| `bomba-descompresion` | Bomba de descompresión | `compressed-body` de 2 MiB con `gzip`, `deflate` y `br` (< 64 KiB en red): `response_too_large`; el mismo con `decompressedBytes` 1048576 (`gzip`): `response` con un `body` de 1048576 caracteres. Un host que solo limita los bytes de red entrega los tres primeros y falla |
| `servidor-a-medias` | Servidor que se queda a medias | `stall-body`, `timeoutMs` 500: `timeout` en `[500, 500 + timeToleranceMs]` |
| `servidor-no-responde` | Servidor que no responde | `stall-headers`, `timeoutMs` 500: ídem |
| `servidor-muy-lento` | Servidor que escribe muy despacio | `drip-body` con `intervalMs` 50, `timeoutMs` 500: ídem (un timeout de inactividad no vence nunca) |
| `conexion-rechazada` | Conexión rechazada | origen de `refusing()`: `network_error` con `requestSent: false` |
| `secreto-a-su-origen` | Secreto enviado a su origen | marcador ligado a `A.origin`: A recibe `authorization` = marcador; ni `JSON.stringify(resultado)` ni `logs()` lo contienen |
| `secreto-origen-no-autorizado` | Secreto enviado a un origen no autorizado | ligado a `A.origin` (TLS `trusted`): petición a `B.origin` y a la variante `http://` de A → `missing_secret` y 0 conexiones |
| `secreto-otro-tenant` | Secreto de otro tenant | secreto solo en el tenant B; `harness.http('A')` → `missing_secret` |
| `registros-pii` | Petición con datos personales | `containsPii: true` con un email marcador en la URL (codificado) y en el body: `logs()` no contiene el marcador ni su forma codificada |

**Codificaciones.** El host MUST decodificar `gzip`, `deflate` y `br` (las que decodifican `fetch`/undici y `node:zlib` en Node 22) y aplicar el límite a lo ya descomprimido; con cualquier otra que no decodifique, lo aplica a los bytes recibidos. Dos clases de caso, porque cada una atrapa un fallo que la otra deja pasar:
- **Finito** (`bomba-descompresion`): menos de 64 KiB en red que descomprimen a 2 MiB. Un host que solo cuenta bytes de red los entrega y falla. El borde de 1 MiB exacto evita que un host «pase» rechazando toda respuesta comprimida.
- **Sin fin** (`cuerpo-sin-fin`, `cuerpo-comprimido-sin-fin`): un host que acumula lo descomprimido sin límite acaba en `timeout` o sin memoria. La codificación desconocida representa cualquier codificación futura (`zstd`) que el cliente empiece a decodificar al actualizar Node: el caso falla si lo hace sin límite.

Alternativa descartada: obligar a rechazar las codificaciones no limitadas. Exigiría al host conocer la lista exacta de lo que decodifica su cliente en cada versión, y no comprueba lo que de verdad importa. Entregar `gzip` sin decodificar tampoco vale: un `responseMap` no puede leer bytes comprimidos y la spec lo prohíbe.

**Lo que se prueba aquí** (`tests/conformance.test.ts`, sin red):
- Cada `requirement`/`scenario` del catálogo existe con ese título exacto en `specs/flow-engine/spec.md` del cambio (y en `openspec/specs/` tras archivar), y todo escenario de un requisito «Host de producción: …» tiene exactamente un caso. Así la spec y la suite no se separan.
- `CONFORMANCE_INTERNAL_ADDRESSES` contiene todas las direcciones del escenario «Dominios que resuelven a direcciones internas».
- `call.ts` con capacidades triviales en memoria y un `sleep` del arnés que resuelve al momento: una que rechaza, una que devuelve algo fuera de contrato, una que nunca resuelve y una que devuelve un resultado válido. Se anota un fallo en las tres primeras (la tercera, con el mensaje de espera límite) y ninguno en la cuarta. Es lógica del catálogo, no un doble de host.
- `src/conformance/` cumple la guarda estática: sin reloj (usa `harness.now()`) y sin IO (lo pone el arnés).

**Riesgo asumido**: el arnés supone que el host de la feature 6 admite un resolutor, una lista de permitidos por par, un almacén de secretos y un registro inyectables. Son también lo que necesita para probar SSRF de forma determinista. Si su diseño pide otra forma, el arnés se ajusta por cambio de spec en esa feature; el catálogo de casos, que es lo estable, no cambia.

### D15. Host falso programable para los tests del motor (`tests/helpers/http-host.ts`)

```ts
type Step = unknown | ((request: HttpRequest, index: number) => unknown);  // valor a resolver, o función (puede lanzar o devolver una promesa)
export function scriptedHost(steps: readonly Step[], options?: { repeatLast?: boolean }): {
  host: EngineHost;
  requests: HttpRequest[];   // structuredClone de cada petición en el momento de la llamada
  maxInFlight: number;       // llamadas en curso a la vez, para «Llamadas en secuencia»
  overrun: number;           // llamadas de más sobre el guion (todo test lo exige a 0 con expectScript)
};
export const respond = (status = 200, body = '') => ({ kind: 'response', status, body }) as const;
export const always = (step: Step) => scriptedHost([step], { repeatLast: true });
```

- Sin red, sin reloj y determinista: cada test fija el guion y lee `requests`. `structuredClone` en la llamada hace que un host que muta su petición no altere el registro del test.
- Variantes en el mismo fichero: `throwingHost`, `rejectingHost(valor)`, `getterHost` (getter `http` que lanza o cuenta lecturas), `ClassHost` (método que usa `this`), y `secretLeakingHost(marcador)` (D12). El `Proxy` de lecturas del resultado no está aquí: es unitario (D9).
- Los tests de temporizadores usan `vi.useFakeTimers()` sin avanzar (el motor no espera) y un host que avanza 60 000 ms simulados antes de resolver (escenario «Respuesta que llega tarde»).

### D16. Garantías de coste y tamaño, y el test que prueba cada hipótesis

Lección de las features 1 y 2: cada cota depende de una hipótesis, y en la 2 se escaparon formas codificadas que el filtro solo miraba en literal. Cada fila tiene un test sobre la hipótesis y una mutación (D17) que la rompe:

| Garantía | Hipótesis | Test de la hipótesis (`tests/unit/http-hypotheses.test.ts` salvo que se diga) |
|---|---|---|
| Codificar un valor cuesta ≤ 8192 unidades | `encodeUrlValue` comprueba `text.length > budget` antes de recorrer, y codificar nunca encoge | 10⁷ `"a"` seguidos de un sustituto suelto con presupuesto 8192 → «demasiado largo», no «sustituto» (no llegó al final); propiedad con PRNG: `encodeUrlValue(t).length ≥ t.length` |
| Un valor no cambia origen, ruta ni consulta | Solo quedan sin codificar los 66 no reservados | `tests/unit/http-url-oracle.test.ts`: para textos generados (alfabeto con `/ ? # @ : % \ . ~`, espacio, no ASCII, emoji y mitades de sustituto), `https://api.example.com/x/{{v}}?q={{v}}` o es `invalid_url` (sustituto suelto, longitud, o `v` ∈ {`.`, `..`}) o tiene `origin` `https://api.example.com`, exactamente 2 segmentos de ruta y una sola clave `q` cuyo `decodeURIComponent` es `v`; diferencial de `encodeUrlValue` contra la definición carácter a carácter |
| El body retiene ≤ 65536 + 16384 unidades | La serialización JSON mide al menos la suma de las longitudes de sus strings, y el render deja de construir al superar 65536 | Propiedad: `JSON.stringify(b).length ≥ Σ longitudes` para bodies generados; un body de 1000 strings de 16384 seguido de uno de 16385 da `value_too_large`, y con el último de 16384 da `body_too_large` con un contador opcional de `prepareRequest` (como `MatchStats`) que registra el máximo retenido ≤ 81920 |
| `containsPii` ve lo derivado por `set` | El cierre es transitivo y estático | Escenario «Variables derivadas de una pii con set» más un unit con una cadena de 5 `set` en orden inverso de declaración y un `set` en una rama que no se ejecuta |
| Lo validado es lo que el host reparsea | La serialización WHATWG es idempotente para `http(s)` | Toda URL aceptada en los tests: `new URL(href).href === href` |
| Ningún disfraz del punto pasa | La normalización de segmentos cubre `%2e` en cualquier combinación de mayúsculas | Diferencial: para rutas generadas con segmentos de {`.`, `..`, `%2e`, `%2E`, `.%2e`, `%2e.`, `%2E%2e`, `..a`, `...`, `%252e`, `a`, ``}, si el motor acepta, `new URL(u).pathname` tiene el mismo número de segmentos que la ruta escrita (WHATWG no colapsó nada); si rechaza, existe un segmento que WHATWG colapsa |
| Ningún disfraz de IP o loopback pasa | `isDomainName` mira el `hostname` serializado (tras IDNA y decodificación) | Tabla: decimal, octal, hex, formas cortas (`127.1`), dígitos y puntos anchos, IPv6 y v4 mapeada, `localhost.`, `api.localhost`, `LOCALHOST` → `invalid_url` |
| El host nunca lleva `%` | `hasPercentInHost` se aplica antes del parser | `api%2eexample.com`, `exa%C2%ADmple.com`, `%31%32%37.0.0.1` → `invalid_url` |
| El tamaño de la respuesta no depende del parser | `body.length` se mide antes de `JSON.parse` | Cuerpo de 1 048 577 unidades que no es JSON con `responseMap` → `response_too_large`, no `invalid_response` |
| Mapear no recursa sobre datos del servidor | `exceedsDepth` (iterativo, salida temprana) va antes de `cloneJsonWithinDepth` | Puntero `""` sobre 100 000 niveles → `invalid_response` y la promesa se resuelve; y la hipótesis del runtime: `JSON.parse` de 524 288 niveles (1 MiB) no lanza en Node 22 |
| Un valor mapeado se guarda y se renderiza | 100 niveles, sin U+0000 ni sustitutos en strings **ni claves**, finitos, `textOf` ≤ 16384 | Bordes 100/101 niveles y 16384/16385 unidades (spec) y, por mutación, cada comprobación quitada hace fallar su escenario |
| Todo estado se puede continuar | Cada fuente de valores ≤ 999 niveles (tabla de D13) y `parseState` admite campos de 1000 | Propiedad de D13 por cada fuente en su máximo |
| 10 llamadas por operación como mucho | `reserveExternalCall` antes de **cada** intento, contador creado por `run` | Escenarios «Ciclo de llamadas», «Reintentos recortados por el límite», «El contador se reinicia al continuar» |
| Un nodo lee el host una vez | `readHttpCapability` fuera del bucle | Getter contador: un nodo con 3 intentos → 1 lectura; dos llegadas → 2 |
| Del resultado solo se leen sus campos, una vez | `readAttemptResult` con lecturas a variables locales | Unit sobre `readAttemptResult` (no a través de la promesa, donde el runtime lee `then`): un `Proxy` que registra lecturas ve exactamente `kind` y los campos de ese `kind`, una vez cada uno |
| Lo que lanza el host no se mira | `catch` sin variable en `http/capability.ts` | Guarda estática (`static-guard.test.ts`) y escenario «El host rechaza con un mensaje sensible» |
| El motor sigue sin IO | Sin `fetch`, temporizadores ni `node:` en `src/` (también `src/http/` y `src/conformance/`) | Guarda estática existente; en `src/http/` además las reglas de `src/input/` (sin `RegExp`, `.exec`/`.match`/`.search` ni literales de regex: los filtros son bucles) |

### D17. Mutación dirigida sin dependencias (`scripts/mutate.mjs`)

No hay herramienta de mutación (FOLLOW-UP 6.8 de `engine-base`) y la validación manual de las features 1 y 2 dependía de la disciplina de quien la hacía. Se añade un script de ~60 líneas en el paquete:

- `tests/mutations.json`: lista de `{ id, file, find, replace, tests }`. `find` debe aparecer **exactamente una vez** en `file` (si no, el script falla: la tabla no puede quedarse obsoleta en silencio).
- `pnpm --filter @franca/engine mutate`: para cada mutación lee el contenido original del fichero, guarda una copia en `.mutate-backup/` (ignorado por git), escribe el fichero mutado, ejecuta `vitest run <tests>` y **restaura reescribiendo el contenido original** en un `finally`; después borra la copia. No usa git: los ficheros nuevos de la feature aún no están versionados y un `git checkout` no los restauraría. Si al empezar existe `.mutate-backup/` (una ejecución anterior se mató a medias), restaura esas copias y se detiene avisando. Una mutación **sobrevive** si los tests pasan; el script termina con código 1 si sobrevive alguna e imprime cuáles.
- No entra en `pnpm check` (cada mutación es una ejecución de Vitest); es gate de las fases 2 a 4 y de la verificación de QA.

Tabla inicial (cada `id` con el test que debe matarla; la implementación fija `find`/`replace` exactos):

| id | Mutación | Debe fallar |
|---|---|---|
| `state-depth` | `STATE_MAX_DEPTH` = `MAX_NESTING_DEPTH` | «Ida y vuelta con un contacto en el límite» |
| `encode-budget` | sin la comprobación previa de presupuesto | hipótesis «no llegó al final» |
| `encode-subdelims` | no codificar `! ' ( ) *` | oráculo de codificación |
| `dot-encoded` | segmentos de punto solo en literal | «Segmentos de punto» |
| `dot-case` | solo `%2e` en minúsculas | «Segmentos de punto» (`%2E%2e`, `.%2E`) |
| `percent-host` | sin `hasPercentInHost` | «Esquemas y formas no permitidos» (`api%2eexample.com`) |
| `raw-host` | `isDomainName` sobre el host escrito en vez del serializado | «Destinos internos» (dígitos anchos) |
| `localhost-suffix` | sin `.localhost` | «Destinos internos» (`api.localhost`) |
| `literal-surrogate` | sin `hasUnstorable` en la URL | «Sustituto suelto en el texto de la URL» |
| `url-prelength` | sin el límite antes de serializar | «Longitud antes de serializar» |
| `header-crlf` | admitir controles en valores | «Salto de línea insertado» |
| `header-token` | admitir espacio en nombres | «Nombres que no son tokens» |
| `header-dup` | duplicados distinguiendo mayúsculas | «Nombres repetidos sin distinguir mayúsculas» |
| `content-type-case` | buscar `Content-Type` distinguiendo mayúsculas | «Content-Type por defecto» |
| `get-body` | sin la regla de `GET` con body | «GET con body» |
| `post-idempotent` | `POST: true` | «POST tras un timeout o un 503» |
| `request-sent-default` | `requestSent` omitido = `false` | «requestSent omitido» |
| `limit-first-only` | reservar solo en el primer intento | «Reintentos recortados por el límite» |
| `limit-per-node` | contador creado por nodo | «Ciclo de llamadas» |
| `body-retain` | conservar todos los strings del body | hipótesis «el body retiene ≤ 65536 + 16384» |
| `pii-closure` | sin el cierre por `set` | «Variables derivadas de una pii con set» |
| `size-after-parse` | medir el cuerpo después de `JSON.parse` | hipótesis de tamaño de respuesta |
| `mapped-depth` | sin `exceedsDepth` en el valor mapeado | hipótesis «puntero vacío sobre 100 000 niveles» |
| `all-or-nothing` | asignar dentro del bucle | «Todo o nada» |
| `unstorable-keys` | `hasUnstorable` solo en strings | «Valores que no se pueden guardar» (`{"k\u0000": 1}`) |
| `pointer-leading-zero` | admitir `01` como índice | «Punteros que no encuentran nada» |
| `pointer-inherited` | `in` en vez de `Object.hasOwn` | «Escapes y nombres de Object» (`/constructor`) |
| `request-reuse` | reutilizar el objeto petición entre intentos | «El host no altera los intentos siguientes» |
| `pii-body` | `containsPii` sin mirar el body | «Plantillas con y sin variables pii» |
| `capability-per-attempt` | leer `host.http` en cada intento | hipótesis «un nodo lee el host una vez» |
| `this-binding` | llamar sin `this` | «Host con métodos» |
| `host-error-leak` | mensaje de `http_host_error` con el error del host | «Valor de un secreto devuelto por el host» (o la guarda estática) |

### D18. Golden, fixtures y tests existentes

- **Golden actuales sin cambios**: ningún golden existente pasa host, así que todos siguen terminando en `unsupported_node` con el mismo mensaje (D3). Gate: `git diff --stat packages/engine/tests/golden/` solo **añade** ficheros.
- **Golden nuevos** (formato `{ requests, results }`, con `scriptedHost`): `http-captacion-leads-exito` (201), `http-captacion-leads-error-post` (siempre 500: 1 llamada, `lead-sin-enviar`), `http-captacion-leads-429` (429, 429, 201: 3 llamadas y `lead-empresa`), y `http-fixture-response-map` con el fixture nuevo `tests/fixtures/http-response-map.json` (`GET`, cabecera con plantilla y secreto, `responseMap` con escapes y un `default` previo). Las peticiones forman parte del golden porque son el contrato con las features 6 y 8.
- **Tests existentes que cambian porque la spec los modifica**: «Ejemplo de FAQ con IA» (ahora con host que ofrece `http` y `http` sin llamar), `parity.test.ts` (códigos nuevos emitidos, `method` del esquema = claves de `IDEMPOTENT`, defaults `timeoutMs`/`retries` del esquema = constantes internas, todo `error` del evento ∈ `HTTP_ERROR_REASONS` y cada motivo emitido al menos una vez), `exports.test.ts` (constantes, lista exacta de exports y la subruta `conformance`), `static-guard.test.ts` (reglas de D16), `examples.test.ts` (recorrido también con un host que responde 200 `{}`: `captacion-leads` termina en `ended`), `properties.test.ts` (las propiedades también con host: determinismo de resultados **y** peticiones, entradas congeladas, consola, un único terminal) y los de profundidad de `robustness-adversarial.test.ts` (escenarios nuevos de D13). Ningún otro test existente se toca.

### Plan de verificación por capas

| Capa | Veredicto | Cómo |
|---|---|---|
| Unit | **Aplica** | Un fichero por módulo de `src/http/` (`tests/unit/http-{config,url,request,result,retry,response-map}.test.ts`) con tablas `it.each`: nombres de cabecera (cada `tchar`, separadores, no ASCII, vacío, reservados en mayúsculas y minúsculas, `Proxy-*`), valores de cabecera (U+0000-U+007F completos, no ASCII, sustitutos), codificación (cada ASCII, no ASCII, emoji, sustitutos), URL (tablas de la spec más los bordes de D16), lectura del resultado (cada forma válida e inválida, getters, prototipos), tabla de reintentos método × resultado completa, punteros (escapes, índices, `-`, `__proto__`, escalares) y valores mapeados (cada límite); `template.test.ts` ampliado con las opciones; `state.test.ts` con el borde 1000/1001 por campo |
| Escenarios de la spec | **Aplica** | Un `it` por cada `#### Scenario` del delta con su mismo título (`tests/scenarios/http-*.test.ts` por requisito; los MODIFIED en sus ficheros actuales), contra flujos que pasan `validateFlow` (helper `httpNode()` en `tests/helpers/flows.ts`) y `scriptedHost` |
| Golden / contractual | **Aplica** | D18; Vitest no escribe snapshots nuevos en CI |
| Paridad | **Aplica** | D18 |
| Propiedades | **Aplica** | Determinismo con el mismo guion (resultados y peticiones), entradas congeladas, ida y vuelta JSON, no fuga de PII y secretos con marcador (D12), consola, temporizadores detenidos (D15), estado continuable (D13) |
| Hipótesis de coste y tamaño | **Aplica** | Tabla de D16 |
| Conformidad del host | **Aplica** (catálogo) | D14: títulos de casos ↔ escenarios de la spec, direcciones internas completas y `call.ts`. La ejecución contra un host real y sus mutantes es de la feature 6 (tarea 6.1) |
| Integración HTTP | No aplica aquí | El motor no tiene red ni endpoints. La suite de D14 contra servidores locales reales es de la feature 6 (FOLLOW-UP) |
| E2E opción-al-menos-una-vez | No aplica | No hay UI (features 7 y 8) |
| Smoke de ruta | No aplica | No hay rutas |
| Mutación | **Aplica** | D17: `pnpm --filter @franca/engine mutate` sin supervivientes |

### Plan de Ejecución

Correspondencia con las fases estándar: 1 Backend Core = fases 1-2 de `tasks.md` (arreglo del estado y piezas puras); 2 Backend API = fase 3 (ejecutor, sesión, contrato público y golden); 3 Tests backend = cada fase lleva los suyos, más la fase 5 (verificación QA); 4-5 Frontend y sus tests: **no aplican** (no hay UI hasta las features 7 y 8). La fase 4 (suite de conformidad) es contrato hacia la feature 6. Detalle, ficheros y gates en `tasks.md`.

| Fase | Agente | Ficheros | Gate |
|---|---|---|---|
| 1. Arreglo de la profundidad del estado | `popi:backend-developer` | modificar `src/state.ts`, `tests/unit/state.test.ts`, `tests/scenarios/robustness-adversarial.test.ts`; crear `scripts/mutate.mjs`, `tests/mutations.json`; script `mutate` en `package.json` | escenarios de D13 verdes; `mutate` mata `state-depth`; suite existente verde |
| 2. Piezas puras de http | `popi:backend-developer` | crear `src/http/*.ts`, `tests/unit/http-*.test.ts`; modificar `src/constants.ts` (sin tocar aún `SESSION_ERROR_CODES`), `src/types.ts`, `src/template.ts`, `src/input/parsers/url.ts` (solo `export`), `tests/unit/template.test.ts`, `tests/static-guard.test.ts`, `tests/mutations.json` | unit e hipótesis verdes; `mutate` sin supervivientes en las mutaciones de módulos puros |
| 3. Ejecutor, sesión, contrato y golden | `popi:backend-developer` | crear `src/nodes/http.ts`, `tests/helpers/http-host.ts`, `tests/scenarios/http-*.test.ts`, `tests/fixtures/http-response-map.json`, 4 golden; modificar `src/{constants,index,run,session}.ts`, `src/nodes/{index,types}.ts`, tests de D18, `README.md`, wiki | todos los escenarios con su `it`; golden solo añadidos; `mutate` sin supervivientes; `pnpm check` |
| 4. Catálogo de conformidad del host | `popi:backend-developer` | crear `src/conformance/*`, `tests/conformance.test.ts`; modificar `package.json` (`exports`), `tsdown.config.ts`, `tests/exports.test.ts` | cada caso ligado a su escenario y cada escenario a un caso; `build` deja `dist/conformance.mjs` y `.d.mts`; `pnpm check` |
| 5. Verificación | `popi:qa-tester` (modo verificación de spec) | sin código de producto | matriz escenario → test; `mutate` completo; alcance del diff; secuencia de CI; `openspec validate --strict` |

Recomendación: **`apply normal`**. La fase 2 es buena candidata a **bucle aislado** (`popi:loop`): espacio de comportamiento grande (URL, cabeceras, punteros) con oráculos mecánicos (WHATWG, `encodeURIComponent`, RFC 6901) y sin decisiones abiertas. La elección es del usuario.

## Risks / Trade-offs

- [Un autor deja el host en una plantilla y un usuario elige el destino] → la codificación impide añadir el esquema y `/ ? # @ :`, el host bloquea destinos internos y ata cada secreto a su origen exacto; aviso del validador como FOLLOW-UP (tarea 6.5).
- [El host de la feature 6 no cumple el contrato (redirecciones, DNS, tamaño, timeout total)] → catálogo ejecutable (D14); la feature 6 no se cierra sin pasarlo y sin demostrar con mutantes de su host que cada caso detecta su violación (tarea 6.1).
- [El catálogo no se ha ejecutado contra ningún host antes de la feature 6] → aceptado por decisión del orquestador: un doble con la forma que imaginamos no lo validaría de verdad. Lo que sí se comprueba aquí es su ligadura a la spec y su lógica de `call.ts`.
- [El arnés de la suite no encaja con el diseño de la feature 6] → el catálogo es lo estable; el arnés se ajusta por cambio de spec en esa feature.
- [Un host que no resuelve nunca bloquea la operación] → MUST de timeout por intento en el host, comprobado por `servidor-a-medias`; el motor no puede medir tiempo sin romper el determinismo.
- [WHATWG, IDNA y `Default_Ignorable_Code_Point` dependen de la versión de Node] → `engines` ≥ 22; tests diferenciales contra el runtime detectan cambios al actualizar Node; se anota en la wiki.
- [Persistir flujos en `jsonb` (feature 6) reordena las claves] → `jsonb` no conserva el orden de las claves, así que cabeceras y body podrían cambiar de orden entre lo que el autor escribió y lo que se ejecuta. Semánticamente da igual para JSON y para cabeceras distintas; si el orden importa, la feature 6 guarda el flujo como `json` o texto (FOLLOW-UP).
- [Undici y similares recortan los espacios de los extremos de un valor de cabecera] → `" x"` puede llegar como `"x"`; inofensivo (RFC 9110 los ignora), documentado en el README.
- [`POST`/`PATCH` sin reintento tras un 5xx o un timeout pierden un lead que se podría haber reintentado] → decisión aprobada (no duplicar); `Idempotency-Key` del host como FOLLOW-UP.
- [El script de mutación deja `src/` mutado si se mata el proceso] → copia de cada original en `.mutate-backup/` antes de mutar; la siguiente ejecución la restaura antes de nada. Sin git, porque los ficheros nuevos no están versionados.
- [Golden con peticiones grandes] → los cuatro golden usan cuerpos pequeños; los bordes de tamaño se prueban en unit y escenarios.

## Migration Plan

Sin consumidores ni datos persistidos: no hay migración. El estado sigue en `stateVersion` 1 (el arreglo de D13 solo **acepta** estados que antes se rechazaban). Rollback = revertir el PR; no hay ficheros fuera de `packages/engine` salvo la wiki.

## Open Questions

Ninguna. La que quedaba (exigir que el origen de la `url` sea literal) la resolvió el orquestador: se mantiene la conducta aprobada y el validador avisará de marcadores en el esquema (`http{{s}}://`), en el host o pegados a él (`api.example.com{{v}}`) como FOLLOW-UP (tarea 6.5).
