# Design: nodo `input` en el motor (`engine-input`)

**Fecha**: 2026-10-16 · **Rama**: `feat/engine-input` · Motivación y alcance en `proposal.md`; comportamiento en `specs/flow-engine/spec.md` (manda sobre este documento). Parte del contrato de `engine-base` (`openspec/changes/archive/2026-10-16-engine-base/design.md`, D2, D3, D8 y D9), que esta feature amplía de forma aditiva.

## Context

- `packages/engine` (feature 1) ejecuta `message`, `set`, `jump`, `condition` y `end`; `input`, `http` y `llm` van a `executeUnsupported` (`src/nodes/index.ts`). `continueSession` (`src/session.ts`) ya comprueba flujo → estado → `flowId`/nodo, y siempre acaba en `session_not_active`.
- El bucle (`src/run.ts`) solo conoce `next`, `end` y `fail`; `StepOutcome` (`src/nodes/types.ts`) anuncia `{ kind: 'wait' }` para esta feature. `parseState` (`src/state.ts`) solo admite `ended` y `failed`.
- Piezas reutilizables: `renderContent` (`src/nodes/message.ts`), `renderTemplate` + `ValueTooLargeError` + `textOf` (`src/template.ts`), `compilePattern` (`src/regex/compile.ts`) y `runProgram(program, text, stats?)` (`src/regex/match.ts`), `VariableStore` (`src/variables.ts`).
- `@franca/spec`: `InputNode` generado (`inputType` con 8 valores, `validation.{pattern,min,max,retryMessage,maxRetries}`, `choices[].{id,label,value,imageUrl,next}`, `multiple`, `next`), `validateFlow` con la regla gemela «en selección única, cada opción necesita next» (`src/validate.ts:239-245`).

### Auditoría de la spec contra el código fusionado

Hechos comprobados ejecutando Node 22.23 y leyendo el código fusionado, no documentos:

| Lo que decía o se podía suponer | Lo que dice el código / el runtime | Dónde se corrige |
|---|---|---|
| Acotar la respuesta a 4096 unidades acota el valor guardado y el texto sobre el que corre `pattern` | `new URL('https://e.co/' + '中'.repeat(4083)).href.length` = 36760: el percent-encoding multiplica hasta ×9. Una URL así supera `MAX_RENDERED_LENGTH` (16384) en cuanto se renderiza `{{web}}` y el matcher correría sobre 36760 code points | **Spec**: requisito nuevo «Tamaño máximo del valor guardado» (forma textual ≤ 4096; si no, `invalid_format`); escenario «URL que crece al serializarse». D6 |
| El parser WHATWG valida lo que el usuario escribió | `new URL('https://exa\nmple.com').href` = `https://example.com/`: quita tabuladores y saltos de línea interiores y los controles C0 finales, y codifica los espacios (`/a b` → `/a%20b`) | **Spec**: requisito nuevo «Espacios y controles en una url» (→ `invalid_format`). D6 |
| «Host con al menos un punto» descarta lo que no es un dominio | El punto lo pone el serializador: `600123456` → `35.197.40.64`, `12345` → `0.0.48.57`, `1.5` → `1.0.0.5`, `2130706433`/`127.1`/`0x7f.1` → `127.0.0.1`; `[::1]` y `a.b` también pasarían | **Spec**: requisito nuevo «Host de una url»: el `hostname` serializado cumple la regla del dominio del email (excluye IPv4/IPv6 y `a.b`, deja pasar `xn--…`). D6 |
| Quitar tab/LF/CR basta para que lo guardado sea lo escrito | Además de esos tres, el parser elimina en silencio del host 270 code points (medido barriendo todo Unicode): U+00AD, U+034F, U+180B-U+180D, U+180F, U+200B, U+2060, U+2064, U+FE00-U+FE0F, U+FEFF, U+1BCA0-U+1BCA3 y U+E0100-U+E01EF, todos dentro de `Default_Ignorable_Code_Point`; un sustituto suelto se convierte en U+FFFD | **Spec**: «Espacios y controles en una url» rechaza también `Default_Ignorable_Code_Point` y sustitutos sueltos. D6 |
| Un texto del usuario se puede guardar en cualquier almacén JSON | `jsonb` de Postgres (feature 6) rechaza `\u0000` y los sustitutos sueltos | **Spec**: requisito nuevo «Caracteres que no se pueden guardar» (`invalid_format`). D6 |
| `Number()` de un decimal aceptado da ese número | Redondea con más de 15 cifras significativas (`1234567890123456789` → `1234567890123456800`), da `0` por subdesbordamiento (`0,` + 400 ceros + `1`), pierde precisión en subnormales (< 2⁻¹⁰²² ≈ 2,2·10⁻³⁰⁸) y da `Infinity` por desbordamiento | **Spec**: requisito nuevo «Números que no se pueden guardar exactamente» (> 15 cifras significativas o fuera del rango normal → `invalid_format`). D6 |
| `retryMessage` es contenido como `prompt` | En el esquema es `template` (un string), no `content` | D4: el reintento emite `[{kind: 'text', text}]` |
| `placeholder` está acotado | `maxLength: 120` en el flujo, pero renderizado puede llegar a 16384 | Ya en la spec («Tamaño máximo de los textos de un input») |
| `min`/`max` son enteros | Son `number` cualquiera. Son finitos porque el motor valida la forma JSON (`toJsonForm`): `NaN` e `Infinity` pasan a `null`, que el esquema rechaza en un campo `number` | D6: comparación inclusiva con el valor tal cual (`min: 1.5` en `text` exige 2 code points) |
| Basta con `min > max` para detectar límites imposibles | `max` 0 en `text` (toda respuesta tiene ≥ 1 code point), `min` mayor que 4096 en `text` (la respuesta tiene como mucho 4096 unidades, luego ≤ 4096 code points) o `max` 0 en múltiple (la vacía es `required`), y `min` mayor que el número de opciones, tampoco se pueden cumplir | **Spec**: «Validación que no se puede aplicar» los incluye; escenario «Límites que ninguna respuesta puede cumplir». D7 |
| «Espacios en blanco» de la spec | `trim()` quita también NBSP, BOM y U+2003 (medido) | D6: «espacio en blanco» = lo que quita `String.prototype.trim`; **spec**: «Tipo phone» lo dice explícitamente (escenario con NBSP) |
| «Sin distinguir mayúsculas» es trivial | `toLocaleLowerCase` depende del locale del host; `'Sİ'.toLowerCase()` da 3 unidades (i + punto combinante) | D6: solo `toLowerCase` (independiente del locale); la guarda estática prohíbe `toLocale*`, `localeCompare` e `Intl` |
| Un array del host es un array | `new Proxy([...], {})` pasa `Array.isArray` y tiene `Array.prototype`; un objeto `{0: 'a', length: 1}` no lo pasa | D3: `choices` exige `Array.isArray`; la lectura no depende de que sea un array «de verdad» y un test con `Proxy` cuenta las lecturas (D10) |
| `node.next` existe en selección múltiple | Solo lo exige el esquema fuera de `choice`; hoy valida un `choice` múltiple sin `next` | Regla semántica nueva en `@franca/spec` (D9): es la hipótesis que hace seguro `node.next!` en D4 |
| La spec fija cuándo se comprueba la validación respecto al renderizado | Solo decía «antes de emitir su prompt»; renderizar puede fallar con `value_too_large` | **Spec**: requisito nuevo «Momento de la comprobación de la validación» (`invalid_validation` gana a `value_too_large`; `invalid_input` gana a `invalid_validation`). D4 |
| «Toma el valor del estado (en sus variables o en sus valores de contacto)» | Ambiguo si la variable cambió de ámbito entre versiones del flujo | **Spec**: «Variables al reanudar» busca solo en la parte de su ámbito actual; fijar la versión del flujo por sesión es de la feature 6 (FOLLOW-UP 6.7 de `tasks.md`). D8 |
| `continueSession` comprueba el tipo del nodo | Solo comprueba que el nodo exista | D5: `state_mismatch` si espera en un nodo que no es `input` |
| Tests de la feature 1 que asumen que ninguna sesión espera | `tests/examples.test.ts` (termina en `ended` o `unsupported_node`), `tests/properties.test.ts` («todos los estados … se rechazan por inactivos»), `tests/parity.test.ts` (conjunto exacto de códigos), `tests/exports.test.ts` (lista exacta) y los escenarios «Ejemplo de captación de leads» y «Estado tras un fallo» | Se actualizan porque la spec los modifica (D11), no en silencio |
| Los golden afectados | Solo `examples-captacion-leads.json` y `examples-captacion-leads-con-contacto.json` llegan a un `input`; `faq-ia` falla antes en el `llm` y ningún fixture tiene `input` | D11: el diff de la regrabación solo puede tocar esos dos ficheros existentes |
| El estado «de la versión anterior» existe en algún sitio | Solo en el golden que se va a regrabar | D11: copiarlo a `tests/legacy/` **antes** de regrabar |

## Goals / Non-Goals

**Goals:**
- `input` ejecutable y `continueSession` con camino feliz, sin cambiar las firmas públicas ni `stateVersion`.
- Conversión y validación por `inputType` como funciones puras, sin dependencias y sin expresiones regulares nativas sobre el texto del usuario.
- Cada garantía de coste o tamaño con un test que pruebe **la hipótesis** de la que depende, no solo la cota (D10).

**Non-Goals (de diseño, además de los de la proposal):**
- Ninguna dependencia nueva (ni validadores de email/teléfono/URL ni librerías de fechas).
- Ninguna caché de patrones compilados entre operaciones: cada operación compila lo que usa, como `matches`.
- No se exponen las piezas internas (parsers, lector de la entrada) en la API pública.
- No se toca `apps/api` ni `apps/web`.

## Decisions

### D1. Contrato público: cambios aditivos

```ts
// ---- constantes (constants.ts)
export const MAX_INPUT_LENGTH = 4096; // unidades de código UTF-16 de una respuesta de texto
export const SESSION_ERROR_CODES = [
  'unsupported_node', 'invalid_rule', 'step_limit_exceeded', 'value_too_large',
  'invalid_validation', 'retries_exhausted',
] as const;
export const REJECTION_CODES = [
  'invalid_flow', 'invalid_contact', 'invalid_state', 'state_mismatch', 'session_not_active',
  'invalid_input',
] as const;
export const INVALID_ANSWER_REASONS = ['too_long', 'required', 'invalid_format', 'out_of_range', 'pattern_mismatch'] as const;
export type InvalidAnswerReason = (typeof INVALID_ANSWER_REASONS)[number];

// ---- tipos (types.ts)
import type { InputNode } from '@franca/spec';
export type InputType = InputNode['inputType'];          // derivado de @franca/spec, nunca redefinido

/** Entrada del usuario que acepta continueSession. El motor la comprueba siempre: llega como unknown. */
export type UserInput = { text: string } | { choice: string } | { choices: string[] };

export interface EngineChoice { id: string; label: string; imageUrl?: string }
interface EngineInputEventBase {
  type: 'input';
  nodeId: string;
  attempt: number;                       // 1 la primera vez que se pregunta
  reason: InvalidAnswerReason | null;    // motivo del rechazo anterior; null si no lo hubo
  placeholder?: string;                  // solo si el flujo lo define; renderizado
}
export interface EngineTextInputEvent extends EngineInputEventBase { inputType: Exclude<InputType, 'choice'> }
export interface EngineChoiceInputEvent extends EngineInputEventBase { inputType: 'choice'; multiple: boolean; choices: EngineChoice[] }
export type EngineInputEvent = EngineTextInputEvent | EngineChoiceInputEvent;
export type EngineEvent = EngineMessageEvent | EngineInputEvent | EngineEndEvent | EngineErrorEvent;

export type SessionStatus = 'ended' | 'failed' | 'waiting';
export interface SessionState {
  /* … campos de engine-base sin cambios … */
  /** Solo si status === 'waiting': número de intento de la pregunta pendiente (entero ≥ 1). */
  attempt?: number;
}
```

Razones:
- **`ContinueSessionRequest.input` sigue siendo `unknown`**: el motor la valida siempre (spec «Forma de la entrada del usuario») y en la feature 6 llega de HTTP sin tipar. `UserInput` se exporta para que el host construya la entrada con tipos, no para prometer que el motor confía en ellos.
- **`EngineInputEvent` como unión discriminada por `inputType`**: la feature 7 obtiene `choices` y `multiple` tipados tras `if (e.inputType === 'choice')`, y el compilador impide construir un evento de texto con opciones. El orden de claves al construirlo es fijo (`type, nodeId, inputType, attempt, reason, placeholder?, multiple?, choices?`) para que los golden sean estables.
- **`InputType` derivado de `@franca/spec`** (regla de `openspec/config.yaml`): si el esquema añade un tipo y se regeneran los tipos, `tsc` falla en la tabla `PARSERS` (D6).
- **`INVALID_ANSWER_REASONS` exportado** con el mismo patrón que los códigos: el host puede iterarlo y el test de paridad comprueba que todo `reason` emitido está en la lista.
- **`attempt` opcional en `SessionState`** y no una unión discriminada: los estados `ended`/`failed` quedan **byte a byte** como en la feature 1 (sin churn en sus golden) y el tipo sigue siendo legible por quien ya lo usaba. La invariante «presente si y solo si `waiting`» la garantiza `buildState` y la comprueba `parseState`.
- **No se exporta `DEFAULT_MAX_RETRIES`** (3): es un `default` del esquema; el motor lo copia internamente y un test de paridad lo compara con `schema.$defs.inputNode.properties.validation.properties.maxRetries.default` (también `locale` → `"es"` y `multiple` → `false`).
- **Lo que rompe**: un `switch` exhaustivo sobre `SessionStatus`, `EngineEvent['type']`, `SessionErrorCode` o `RejectionCode` deja de compilar. No hay consumidores (proposal), así que se acepta.

Ejemplo (arranque de `captacion-leads`, JSON válido; el golden lo congela):

```json
{
  "ok": true,
  "status": "waiting",
  "events": [
    { "type": "message", "nodeId": "bienvenida", "content": [{ "kind": "text", "text": "¡Hola! Te hago tres preguntas y te paso con la persona adecuada." }], "typingDelayMs": 600 },
    { "type": "message", "nodeId": "pedir-nombre", "content": [{ "kind": "text", "text": "¿Cómo te llamas?" }], "typingDelayMs": 600 },
    { "type": "input", "nodeId": "pedir-nombre", "inputType": "text", "attempt": 1, "reason": null }
  ],
  "state": {
    "stateVersion": 1, "flowId": "captacion-leads", "status": "waiting", "nodeId": "pedir-nombre",
    "variables": {}, "contact": { "email": null }, "outcome": null, "error": null, "attempt": 1
  }
}
```

Evento de opciones (`pedir-tamano`):

```json
{ "type": "input", "nodeId": "pedir-tamano", "inputType": "choice", "attempt": 1, "reason": null, "multiple": false,
  "choices": [{ "id": "pequena", "label": "1 a 10" }, { "id": "mediana", "label": "11 a 50" }, { "id": "grande", "label": "Más de 50" }] }
```

Rechazo de entrada (no contiene la entrada; el `message` solo describe la forma esperada, que es dato del flujo):

```json
{ "ok": false, "code": "invalid_input", "message": "la entrada debe ser {\"choice\": id} con el id de una opción del nodo" }
```

Tabla de códigos nuevos (se suman a la de D2 de `engine-base`; el `message` exacto lo fija la implementación y lo congelan los golden):

| Código | Tipo | Cuándo | `nodeId` |
|---|---|---|---|
| `invalid_input` | rechazo | la sesión espera y `input` no tiene la forma del nodo, nombra un id desconocido o repite uno | — |
| `invalid_validation` | error de sesión | `validation.pattern` de un input que no es `choice` no compila en el subconjunto de `matches` (inválido, no admitido, demasiado grande o anidado), o `min > max` en `text`, `number` o `choice` múltiple; al llegar o al continuar | el input |
| `retries_exhausted` | error de sesión | respuesta inválida con `attempt > maxRetries` | el input |
| `value_too_large` (ampliado) | error de sesión | también `prompt`, `retryMessage`, `placeholder`, `label` e `imageUrl` | el input |
| `session_not_active` (cambia) | rechazo | ahora `status !== 'waiting'` | — |
| `state_mismatch` (ampliado) | rechazo | también si el estado espera en un nodo que ya no es `input` | — |

| `reason` | Comprobación (en este orden) |
|---|---|
| `too_long` | `text.length > MAX_INPUT_LENGTH`, sobre el texto **sin recortar** |
| `required` | texto vacío tras `trim()`, o `choices: []` |
| `invalid_format` | U+0000 o un sustituto suelto en el texto recortado, o el conversor del tipo devuelve «no es de este tipo» (incluidos los límites de exactitud de `number`, el host y los caracteres invisibles de `url` y su serialización > 4096) |
| `out_of_range` | `min`/`max` (code points en `text`, valor en `number`, número de opciones en `choice` múltiple) |
| `pattern_mismatch` | el patrón no casa con `textOf(valor convertido)` |

### D2. Estado `waiting` y `stateVersion: 1`

- **Qué guarda**: lo de siempre (`flowId`, `nodeId` del input, `variables`, `contact`) más `attempt`. `outcome` y `error` son `null`. **No** guarda la configuración del nodo, el tipo, la respuesta ni el `reason`: al continuar, el motor relee el nodo del flujo recibido (puede ser otra versión, spec «Flujo cambiado mientras se espera») y el `reason` solo vive en el evento.
- **Por qué no sube `STATE_VERSION`**: el cambio es aditivo y legible por el mismo código. Todo estado que produjo la feature 1 (`ended`/`failed`) sigue siendo válido sin tocarlo (escenario «Estado de la versión anterior»), y un estado `waiting` solo puede producirlo esta versión. Subir a 2 obligaría a `parseState` a aceptar dos versiones para describir exactamente el mismo formato. Un motor antiguo que reciba un estado `waiting` lo rechaza con `invalid_state`, que es lo correcto (no sabe continuarlo) y no tiene consumidores.
- **`parseState`** (cambios):
  - `status` ∈ `ended | failed | waiting`.
  - `waiting` ⇒ `outcome === null`, `error === null` (estricto: un objeto de error, aunque esté bien formado, invalida) y `attempt` con `Number.isInteger(attempt) && attempt >= 1` (rechaza 0, -1, 1.5, `"2"` y su ausencia).
  - `ended`/`failed` ⇒ `attempt`, si viene, se ignora como cualquier campo extra (coherente con el test «campos extra … se aceptan y se ignoran» de la feature 1) y no aparece en el estado parseado.
  - Un `attempt` enorme pero entero (manipulado, o porque el flujo bajó `maxRetries`) es válido: la siguiente respuesta inválida agota los reintentos (`attempt > maxRetries`), así que nunca se emite un `attempt + 1` mayor que `maxRetries + 1` ≤ 11.
- **`buildState`** recibe `attempt` solo en la parada `wait` y lo escribe al final (`… outcome, error, attempt`), así que los golden `ended`/`failed` no cambian.

### D3. Lectura de la entrada (`src/input/user-input.ts`)

```ts
export type ParsedInput =
  | { kind: 'text'; text: string }
  | { kind: 'choice'; option: number }        // índice en node.choices
  | { kind: 'choices'; options: number[] };    // índices sin repetir, ordenados (orden del flujo)

/** @returns La entrada leída, o null si no tiene la forma que pide el nodo (→ invalid_input). */
export function readUserInput(node: InputNode, input: unknown): ParsedInput | null;
```

- **Objeto plano** = `typeof input === 'object'`, no `null`, no array, prototipo `Object.prototype` o `null` (mismo criterio que el contacto). **Una sola propiedad** = `Reflect.ownKeys(input).length === 1` (cuenta también símbolos y no enumerables) y esa clave es `text`, `choice` o `choices` según el nodo.
- **Cada propiedad se lee una sola vez** a una variable local: un getter o un `Proxy` del host no puede devolver valores distintos entre la comprobación y el uso.
- **Sin recursión ni copia de la entrada**: no se llama a `cloneJsonStrict` ni a `exceedsDepth`. `{text: x}` con `x` anidado 100 000 niveles se rechaza en `typeof x !== 'string'`.
- **`choices` exige `Array.isArray`**: `{choices: "a"}`, `{choices: {0: "a", length: 1}}` o cualquier objeto tipo array se rechazan con `invalid_input`. Un `Proxy` de array pasa (es un array para el lenguaje) y por eso el coste no puede depender de la longitud que declare.
- **`choices` cuesta O(número de opciones del nodo), no O(longitud del array**): se lee `length` una vez y, si supera `node.choices.length`, se rechaza sin recorrerlo (por el principio del palomar, un array más largo que las opciones tiene necesariamente un id repetido o desconocido, así que es exactamente la regla de la spec). Después se recorre con índice (un hueco da `undefined` → no es string → rechazo). Ids → índice con un `Map` construido del nodo.
- `choice`/`choices` comparan por igualdad estricta de string; los ids del flujo cumplen `^[a-z][a-z0-9_-]{0,63}$`, pero el `Map` hace que la forma del id recibido dé igual.
- Alternativa descartada: validar la entrada con `cloneJsonStrict` y después mirar su forma. Recorre y copia una estructura arbitraria del host para acabar mirando una sola propiedad, y su coste depende del tamaño de lo que mande el cliente.

### D4. El nodo `input` en el bucle (`src/nodes/input.ts`, `src/run.ts`)

`StepOutcome` gana `{ kind: 'wait'; attempt: number }`. El bucle lo traduce en un resultado `waiting` con el `nodeId` actual y el estado con `attempt`; no añade eventos (el ejecutor ya emitió el `input`, que así es el último).

```ts
/** Llegada: comprueba la validación, renderiza todo, emite message + input (attempt 1) y espera. */
export const executeInput: NodeExecutor<'input'>;

/** Respuesta: el primer paso de una continuación. */
export function resumeInput(node: InputNode, ctx: StepContext, pending: { attempt: number; input: ParsedInput; language: string }): StepOutcome;

// run.ts: firma ampliada, retrocompatible para startSession
export async function run(flow: Flow, vars: VariableStore, startNodeId: string, host: EngineHost,
  firstStep?: (ctx: StepContext) => StepOutcome | Promise<StepOutcome>): Promise<SessionResult>;
```

- **Llegada (`executeInput`)**, en este orden: (1) `prepareRules(node)` (D7) → `fail invalid_validation`; (2) renderizar `prompt` (`renderContent`), `placeholder`, y cada `label`/`imageUrl` — todo **antes** de emitir, dentro de un `try` que convierte `ValueTooLargeError` en `value_too_large` (nada de ese nodo llega a emitirse); (3) emitir `message` y `input` con `attempt` 1 y `reason` `null`; (4) `wait`. Preguntar no toca `ctx.vars`. Volver a un input por un ciclo es una llegada nueva: `attempt` 1.
- **Respuesta (`resumeInput`)**:
  1. `prepareRules(node)` → `fail invalid_validation` (después del `invalid_input`, que ya se resolvió fuera, como pide la spec).
  2. Selección única: guarda `value ?? id` y devuelve `next` de la opción (el validador garantiza que existe).
  3. Texto: `checkTextAnswer`; múltiple: `checkChoices` (D6).
  4. Válida: `ctx.vars.set(node.variable, valor)` y `next` del nodo (`node.next!`, garantizado por el esquema fuera de `choice` y por la regla nueva de D9 en `choice` múltiple).
  5. Inválida y `attempt > maxRetries` (`maxRetries ?? 3`): `fail retries_exhausted`, sin renderizar nada. La variable no se tocó en ningún paso.
  6. Inválida con reintentos: renderiza `retryMessage` como `[{kind: 'text', text}]` (o el `prompt` si no hay), `placeholder` y opciones, todo antes de emitir (→ `value_too_large`); emite `message` + `input` con `attempt + 1` y el `reason`; `wait` con `attempt + 1`.
- **Límite de pasos**: `run` cuenta el `firstStep` como el paso 1 (spec «Al continuar cuenta el input»); el límite se sigue comprobando antes de cada nodo siguiente, así que un `input` en el puesto 201 falla con `step_limit_exceeded` sin `message` ni `input`.
- **El idioma** (`(flow.locale ?? 'es').split('-')[0]`) lo calcula `continueSession` y viaja en `pending`: solo lo usa `boolean` y así `StepContext` no cambia.
- `EXECUTORS.input` pasa de `executeUnsupported` a `executeInput`; `http` y `llm` siguen igual.
- Alternativas descartadas: (a) un ejecutor `input` con «modo respuesta» leyendo un campo de `StepContext`: mezcla dos operaciones distintas en una firma y obliga a que todos los ejecutores vean la entrada del usuario; (b) procesar la respuesta en `session.ts` y llamar después a `run` desde el `next`: duplicaría el manejo de `fail`/`wait`/eventos fuera del bucle y el input no contaría como paso.

### D5. `continueSession` (`src/session.ts`)

Orden exacto de la spec:

1. `checkFlow` → `invalid_flow`.
2. `parseState` → `invalid_state`.
3. `flowId` distinto, nodo ausente o (`waiting` y el nodo no es `input`) → `state_mismatch`.
4. `status !== 'waiting'` → `session_not_active`.
5. `readUserInput(node, request.input)` → `invalid_input`.
6. `restoreVariableStore(flow.variables, state)` (D8).
7. `run(flow, vars, node.id, host, (ctx) => resumeInput(node, ctx, { attempt, input, language }))`.

Un rechazo devuelve `{ ok, code, message }` sin `events` ni `state`, y nunca toca lo recibido (no se muta nada: el estado parseado es una copia y la entrada solo se lee).

### D6. Conversores y comprobación de la respuesta (`src/input/`)

```
src/input/
  user-input.ts        readUserInput (D3)
  validation.ts        prepareRules (D7)
  answer.ts            checkTextAnswer, checkChoices, countCodePoints
  parsers/
    index.ts           PARSERS: { [K in Exclude<InputType, 'choice'>]: TextParser }
    text.ts email.ts phone.ts number.ts url.ts date.ts boolean.ts
    domain.ts          isDomainName: la regla del dominio del email, compartida con el host de url
    chars.ts           isAsciiDigit, isAsciiAlnum, isBlank (= c.trim() === ''), isControl, hasUnstorable, isDefaultIgnorable
```

```ts
/** @returns el valor convertido, o undefined si el texto (ya recortado y no vacío) no es de este tipo. */
export type TextParser = (text: string, language: string) => VariableValue | undefined;

export type AnswerCheck = { ok: true; value: VariableValue } | { ok: false; reason: InvalidAnswerReason };
export function checkTextAnswer(raw: string, inputType: Exclude<InputType, 'choice'>, language: string,
  rules: AnswerRules, stats?: MatchStats): AnswerCheck;
export function checkChoices(node: InputNode, options: readonly number[], rules: AnswerRules): AnswerCheck;
```

`checkTextAnswer`: `raw.length > MAX_INPUT_LENGTH` → `too_long` (lo primero; O(1)); `t = raw.trim()`, vacío → `required`; `hasUnstorable(t)` (U+0000 o un sustituto suelto, un solo recorrido) o `PARSERS[tipo](t, language)` sin valor → `invalid_format`; `min`/`max` → `out_of_range`; `rules.program && !runProgram(rules.program, textOf(valor), stats)` → `pattern_mismatch`. `stats` es el mismo contador opcional de `matchPattern` y solo lo pasan los tests.

**Sin expresiones regulares nativas sobre el texto del usuario en `src/input/`.** Los conversores son escáneres de una sola pasada sobre unidades de código con predicados de carácter. Por qué: una regex del motor sobre texto del usuario reabre el problema de D8 de `engine-base` (retroceso) y su linealidad dependería de una revisión a ojo de cada expresión. Un bucle es lineal por construcción y la guarda estática (D10) lo hace cumplir. **Única excepción**, igual que los átomos del matcher: `isDefaultIgnorable` en `chars.ts` prueba `/^\p{Default_Ignorable_Code_Point}$/u` sobre **un** code point, porque la tabla de esa propiedad Unicode solo la tiene el runtime y copiarla a mano envejecería con cada versión de Unicode.

| Tipo | Conversor | Notas |
|---|---|---|
| `text` | identidad (el texto recortado) | sin normalizar Unicode: se guarda lo escrito; U+0000 y los sustitutos sueltos ya se rechazaron con `hasUnstorable` |
| `email` | un único `@`; parte local con la clase WHATWG `[A-Za-z0-9.!#$%&'*+/=?^_\`{\|}~-]`, 1-64; dominio con `isDomainName` (partido por `.` con `split` de string, ≥ 2 etiquetas `[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?`, la última ≥ 2 y no solo dígitos); total ≤ 254 | dominio a minúsculas ASCII; WHATWG admite puntos consecutivos en la parte local (`a..b@x.com`): se acepta, es la gramática elegida |
| `phone` | `+` opcional solo en la posición 0; resto dígitos ASCII, `isBlank`, `-`, `.`, `(`, `)`; 7-15 dígitos | devuelve `+`? + dígitos; no se comprueba que los paréntesis emparejen (laxo, como dice la spec) |
| `number` | `[+-]? dígitos+ ([.,] dígitos+)?` escaneado; ambiguo si la parte entera tiene 1-3 dígitos, no empieza por `0` y hay exactamente 3 decimales; cifras significativas = de la primera a la última cifra distinta de cero de `entero + decimales`, como mucho 15 | si todas las cifras son 0 → `0`; si no, `v = Number(signo + entero + '.' + decimales)` y se exige `Number.isFinite(v) && Math.abs(v) >= 2 ** -1022` (fuera de subnormales y sin subdesbordamiento a 0). Con ≤ 15 cifras significativas en el rango normal, un double reproduce el decimal (DBL_DIG = 15), así que lo guardado es lo escrito |
| `url` | (1) cualquier `isBlank`, control (U+0000-U+001F, U+007F) o `isDefaultIgnorable` → inválido, recorriendo por code points (los sustitutos sueltos y U+0000 ya los rechazó `hasUnstorable` en `checkTextAnswer`); (2) `%` en el host (desde tras `scheme://`, o desde el principio, hasta el primer `/`, `?`, `#` o `\`) → inválido; (3) `explicitScheme`: si el texto empieza por una letra y sigue una secuencia de letras, dígitos, `+`, `-` o `.` hasta el primer `://` (RFC 3986), ese es el esquema: `http`/`https` (sin distinguir mayúsculas) → tal cual; otro → inválido; si no hay esquema al principio, aunque aparezca `://` más adelante (`example.com/?u=http://y.com`), `https://` + texto; (4) `new URL()` en `try`; (5) `protocol` `http:`/`https:`, `isDomainName(hostname)`, `username` y `password` vacíos, `href.length ≤ MAX_INPUT_LENGTH` | `URL` es el parser WHATWG del runtime: sin dependencia. `hostname` ya viene en minúsculas y en `xn--…`, así que la regla del email deja pasar IDN y excluye IPv4 (última etiqueta numérica), IPv6 (corchetes), `a.b` y el punto final. Se guarda `href` |
| `date` | longitud 10, `-` en 4 y 7, dígitos en el resto; año 1-9999, mes 1-12, día ≤ días del mes con la regla gregoriana (`y%4==0 && (y%100!=0 \|\| y%400==0)`) | aritmética pura: la guarda estática prohíbe `Date` |
| `boolean` | `t.normalize('NFC').toLowerCase()`; `true`/`false` siempre; `es`: `sí`/`si` → true, `no` → false; `en`: `yes`/`y` → true, `no`/`n` → false | tabla de palabras en un `Map` por idioma; solo `toLowerCase` (independiente del locale del host) |

- `min`/`max`: inclusivos y con el número tal cual (pueden ser fraccionarios o negativos). `text` cuenta code points del texto recortado (`for…of`, un sustituto suelto cuenta 1); `number`, el valor; `choice` múltiple, `options.length`.
- **`checkChoices`**: vacía → `required`; `min`/`max` sobre el número → `out_of_range`; valor = `options` (ya ordenados) → `value ?? id`. Sin `pattern`.
- **Invariante de tamaño** (spec «Tamaño máximo del valor guardado»): `textOf(valor).length ≤ MAX_INPUT_LENGTH` para todo tipo distinto de `choice`. Se cumple porque `text` y `email` no crecen, `phone`, `date` y `boolean` encogen o son constantes, `number` tiene ≤ 15 cifras significativas (su `JSON.stringify` cabe en ~24 caracteres) y `url` lo comprueba explícitamente. Es la hipótesis de dos garantías (D10): el matcher corre sobre ≤ 4096 code points, y renderizar `{{variable}}` deja ≥ 12288 unidades de margen hasta `MAX_RENDERED_LENGTH`.
- Alternativas descartadas: `libphonenumber-js` (dependencia y tablas de numeración que la proposal excluye), validadores de email de terceros (gramáticas distintas de WHATWG), `Date.parse` (depende de la implementación y está prohibido por la guarda), `Intl.NumberFormat` para parsear números locales (no parsea; y depende del host).

### D7. `validation.pattern` con el matcher lineal y su cota

```ts
export interface AnswerRules { readonly min?: number; readonly max?: number; readonly program: Program | null }
export type RulesCheck = { ok: true; rules: AnswerRules } | { ok: false; message: string };
/** Sin pattern, min ni max en choice única; sin pattern en choice múltiple; min/max solo en text, number y choice múltiple; falla si los límites son imposibles. */
export function prepareRules(node: InputNode): RulesCheck;
```

- `program = compilePattern(pattern)` — el mismo parser, el mismo límite `MAX_PATTERN_SIZE` (1000 → ≤ 2001 instrucciones), la misma `MAX_PATTERN_DEPTH` y el mismo subconjunto que `matches`. Un `PatternError` se convierte en `{ ok: false, message: 'la validación del nodo no se puede aplicar: ' + error.message }` (el mensaje de `PatternError` nombra la causa, nunca el texto). Límites imposibles en un tipo donde se aplican → mensaje fijo por caso: `min > max` (ambos definidos); `max < 1` o `min > MAX_INPUT_LENGTH` en `text` (toda respuesta válida tiene entre 1 y 4096 code points) y `max < 1` en múltiple (la vacía es `required`); `min > choices.length` en múltiple. En `number` cualquier `max` es alcanzable (también negativo).
- Se compila una vez por operación (al llegar y al continuar) y el programa se reutiliza para la respuesta: sin caché de módulo (non-goal de `engine-base`).
- **Coste**: `runProgram` es O((n+1)·m) con m ≤ 2001 y n ≤ 4096 code points por el invariante de D6, es decir ≤ 4097 × 2001 ≈ 8,2 M visitas por respuesta en el peor caso; el `too_long` previo impide que un texto de un millón de caracteres llegue al matcher.
- `pattern` es literal (no se renderiza). Alternativa descartada: renderizarlo como plantilla. Abriría inyección de regex desde variables y el validador ya no podría juzgarlo (FOLLOW-UP de la proposal).

### D8. Variables al reanudar (`src/variables.ts`)

`restoreVariableStore(declared, state)`: para cada primera declaración (mismo `firstDeclarations` que el arranque), busca el valor solo en la parte del estado de su ámbito actual (`state.variables` o `state.contact`) con `Object.hasOwn`; ausente o `null` → sin valor. Una variable que cambia de ámbito entre versiones del flujo pierde su valor: lo evita la versión del flujo fijada por sesión (feature 6, FOLLOW-UP 6.7 de `tasks.md`), no una búsqueda cruzada que tendría que decidir qué parte gana si ambas tienen valor. No mira `default`. Lo no declarado no entra en el almacén y por tanto no sale en el estado. Los valores ya vienen copiados por `parseState` (`cloneJsonStrict`), así que el almacén no comparte referencias con lo recibido. Mismo `Map` que en la feature 1: `__proto__` y `constructor` siguen siendo nombres normales ([[gotcha-variables-nombre-proto]]).

### D9. Regla semántica en `@franca/spec`

En `semanticIssues` (`packages/spec/src/validate.ts`), dentro del bloque `n.type === 'input' && n.inputType === 'choice' && n.choices` que ya contiene la regla de la selección única:

```ts
if (n.multiple && !n.next) add(path, 'en selección múltiple, el nodo necesita next', n.id);
```

- `path` = `/nodes/<i>` (el `next` que falta no tiene puntero propio), mensaje sin el id del nodo y `nodeId` en su campo (reglas de `.claude/rules/spec/flow-spec.md`).
- Test en `packages/spec/tests/validate.test.ts` mutando `captacion-leads`: `multiple: true` sin `next` → exactamente `['semantic /nodes/3 en selección múltiple, el nodo necesita next']`; con `next: 'marcar-pyme'` → válido. El test existente «no exige next por opción en selección múltiple» ya pone `next` y no cambia.
- **No es una regla de esquema** porque un `if/then` sobre `multiple` dentro del `if/then` de `inputType` complica los errores de `oneOf` ([[gotcha-ajv-errores-oneof]]) y la regla gemela ya vive en la capa semántica.
- **Publicación**: no cambian `flow.schema.json`, `src/types.ts` ni `exports`; el test «tipos» sigue verde y no hay que regenerar. `apps/api` (`POST /flows/validate`) empieza a informar de este issue sin tocarla, porque importa `validateFlow`. Turbo reconstruye `@franca/spec` antes del motor (`^build`). Solo invalida flujos que ya no eran ejecutables; ningún ejemplo cambia (`pnpm validate`).
- **Ficheros ajenos al motor que abre el diseño: 2** (`packages/spec/src/validate.ts` y su test), por decisión explícita de la proposal. Ninguno en `apps/`, `turbo.json`, la CI ni `.claude/popi.json`.

### D10. Garantías de coste y tamaño, y el test que prueba cada hipótesis

En la feature 1, la cota de `patternSize` estaba bien pero su hipótesis (que el tamaño contaba lo emitido) no lo estaba, y solo la revisión lo vio. Aquí cada garantía tiene un test sobre su hipótesis:

| Garantía | Hipótesis de la que depende | Test que prueba la hipótesis (no la cota) |
|---|---|---|
| El matcher cuesta ≤ (4096+1)·m por respuesta | (a) `too_long` se mide antes de recortar o recorrer el texto | Unit: 4097 espacios → `too_long`, no `required`; `"Ana"` rodeado de espacios hasta 4097 → `too_long`; 10⁶ `"a"` con `^(a+)+$` → `too_long` |
| | (b) la forma textual del valor convertido ≤ 4096 en todos los tipos | Tests dirigidos al límite: url con `href` de 4094 (aceptada) y de 4100 (rechazada) unidades (escenario «URL que crece al serializarse») y url de 4096 unidades de `中` en la ruta (rechazada); `text` de 4096 unidades aceptado con `textOf` de 4096; `number` de 4096 cifras (`0…01`) con `textOf` `"1"`. Se validan quitando temporalmente la comprobación de `href.length` en `url.ts`: los de url deben fallar |
| | (c) el programa del patrón tiene ≤ 2001 instrucciones | Se reutiliza `expectProgramBound` de la feature 1 sobre los patrones de los tests de `input`; y un test a nivel de `checkTextAnswer` con `stats`: para cada tipo, el texto aceptado más largo posible, evaluado con un patrón de 1000 de tamaño, da `stats.work ≤ (MAX_INPUT_LENGTH + 1) · stats.instructions` (mide el camino real, no `matchPattern` aislado) |
| Leer la entrada cuesta O(opciones del nodo) y no recursa | `readUserInput` no recorre más allá de `node.choices.length` ni baja por valores anidados | Unit con `Proxy` contador: `{choices: proxy}` que dice tener `length` 2³²−1 → `null` con ≤ 1 lectura; `{text: proxy}` → `null` sin ninguna lectura del proxy; objeto con getter `text` → se lee exactamente una vez. Escenario «Entrada muy anidada» (100 000 niveles) |
| Un valor guardado se puede renderizar sin `value_too_large` (margen 4×) | Mismo invariante (b) | Los de (b), más un escenario de integración: URL de 4094 unidades guardada y renderizada en un `message` `"{{web}}"` |
| El motor es determinista también con entradas | Ningún conversor depende del locale del host, del reloj ni de `Intl` | Guarda estática ampliada: prohíbe `Intl`, `toLocale…` y `localeCompare` en `src/` (y el `Date` existente); en `src/input/` además `RegExp`, `.exec(`, `.match(`, `.matchAll(`, `.search(`, una regex literal como primer argumento de `replace`/`replaceAll`/`split`, y `.test(` salvo la única llamada de `chars.ts` (lista exacta, como la de `regex/`). Se valida añadiendo temporalmente un `toLocaleLowerCase` |
| `attempt` acotado (≤ `maxRetries + 1` ≤ 11 en estados del motor) | El reintento solo se emite si `attempt ≤ maxRetries` | Propiedad sobre todas las conversaciones del golden: todo `attempt` emitido ≤ `maxRetries + 1`; escenarios «Tres reintentos por defecto» y «Sin reintentos» |
| Lo guardado no cambia lo escrito (url y number) | En `url`, el parser no quita ni sustituye contenido en silencio (invisibles, controles, sustitutos, `%` en el host que decodificaría invisibles) y solo canonicaliza sin cambiar el recurso: mapeo IDNA de ancho completo y del punto ideográfico, minúsculas del host, `\` → `/`, segmentos `.`/`..`, puerto por defecto y percent-decoding fuera del host. En `number`, `Number()` no redondea | Escenarios «Caracteres invisibles y sustitutos sueltos», «Invisibles codificados en el host», «Direcciones IP y hosts sin dominio», «Cifras significativas» y «Desbordamiento y subdesbordamiento»; se validan quitando temporalmente `isDefaultIgnorable` y el límite de 15 cifras |
| `node.next!` nunca es `undefined` al responder | Esquema fuera de `choice` + regla de D9 en múltiple | Escenario «Múltiple sin next»: el motor rechaza con `invalid_flow`, así que el ejecutor nunca ve ese nodo |

### D11. Golden, fixtures y tests de la feature 1

- **Estado de la versión anterior**: antes de regrabar, copiar el `state` de `tests/golden/examples-captacion-leads.json` (tal como está en `main`) a `tests/legacy/estado-v1-captacion-leads.json`. Fuera de `tests/fixtures/`, porque `fixtures.test.ts` valida como flujo todo JSON de esa carpeta. Lo usan el escenario «Estado de la versión anterior» y un unit de `parseState`.
- **Regrabación** con el comando oficial (`pnpm --filter @franca/engine test -u`, `protectedFixtures` de `.claude/popi.json`). Gate de revisión: `git diff --stat packages/engine/tests/golden/` solo modifica `examples-captacion-leads.json` y `examples-captacion-leads-con-contacto.json` (de `failed/unsupported_node` en `pedir-nombre` a `waiting` con el `message` del prompt y el `input`, y el `attempt` en el estado) y solo añade ficheros nuevos; el resto debe salir intacto. Se lee el diff de los dos modificados línea a línea contra el ejemplo de D1.
- **Golden nuevos** (conversaciones: array de resultados, cada paso continúa desde el último estado aceptado; helper `tests/helpers/conversation.ts`):
  - `conversacion-captacion-leads`: arranque, `{text: " Ana "}`, `{text: "ana@"}`, `{text: "ana@example.com"}`, `{choice: "grande"}` (termina en `unsupported_node` en `enviar-crm`).
  - `conversacion-captacion-leads-agotada`: arranque, nombre, un rechazo `invalid_input` (`{choice: "x"}`) en `pedir-email` y tres emails inválidos (`retries_exhausted`): congela el rechazo y el agotamiento.
  - `conversacion-seleccion-multiple`, con el fixture `tests/fixtures/seleccion-multiple.json` (múltiple con `min`/`max`, `retryMessage` con plantilla y un `end` que renderiza la variable): `{choices: []}` (reintento `required`) y una selección válida en desorden.
  - Nada más: el resto de tipos y motivos lo cubren los unit y los escenarios, que fallan con un mensaje más preciso que un diff de golden.
- **Tests de la feature 1 que cambian porque la spec los modifica**: «Ejemplo de captación de leads» y «Estado tras un fallo» (ahora desde `pedir-tamano` y `enviar-crm`); `examples.test.ts` (añade `waiting` a la invariante y un recorrido completo de cada ejemplo con respuestas canónicas por tipo: no se rechaza y acaba en `ended` o `failed` en ≤ 50 operaciones); `properties.test.ts` (un estado `waiting` continuado con `null` da `invalid_input`; uno `ended`/`failed`, `session_not_active`); `parity.test.ts` y `exports.test.ts` (listas ampliadas). Ningún otro test existente se toca: si alguno falla, es una regresión.

### Plan de verificación por capas

| Capa | Veredicto | Cómo |
|---|---|---|
| Unit | **Aplica** | Un fichero por conversor (`tests/unit/input-<tipo>.test.ts`) con tablas `it.each` de válidos (con su valor exacto) e inválidos, incluidos bordes: longitudes 64/65 y 254/255 en email, 6/7/15/16 dígitos en phone, 29-02 en bisiestos y seculares (1900, 2000), `0001`/`9999`/`0000`, `1.500`/`0,500`/`1234.567`, dígitos no ASCII (`١٢`), emoji en `text`, NBSP y U+202F en phone, NFC combinante y `İ` en boolean, IDN, IPv4 en todas sus formas, IPv6, punto final, `Default_Ignorable_Code_Point` y percent-encoding en url; 15/16 cifras significativas, subnormales y ceros en number; U+0000 y sustitutos sueltos en todos los tipos. `answer.test.ts` (orden de comprobación y cada `reason`, code points en `min`/`max`, `stats`); `user-input.test.ts` (formas, ids, objetos tipo array, `Proxy` contador); `validation.test.ts` (qué se aplica por tipo, `PatternError` y cada límite imposible); `state.test.ts` y `variables.test.ts` ampliados |
| Escenarios de la spec | **Aplica** | Un `it` por cada `#### Scenario` del delta con su mismo título, agrupados por requisito en `tests/scenarios/input-*.test.ts` y en los ficheros existentes para los requisitos MODIFIED, contra flujos que pasan `validateFlow` (helper `input()` en `tests/helpers/flows.ts`) |
| Ejemplo completo | **Aplica** | `captacion-leads` hasta `enviar-crm` (escenario «Conversación completa del ejemplo» + golden), por las dos ramas (`grande` → `empresa`, `pequena` → `pyme`) |
| Golden / contractual | **Aplica** | D11; en CI Vitest no escribe snapshots nuevos |
| Paridad | **Aplica** | `inputType` del esquema = claves de `PARSERS` + `choice`; `default` de `maxRetries`, `locale` y `multiple` = constantes del motor; todo código y todo `reason` emitidos ∈ sus listas y cada elemento de las listas se emite al menos una vez |
| Propiedades | **Aplica** | Sobre todas las conversaciones del golden y los ejemplos: determinismo (dos ejecuciones `toEqual`); **ida y vuelta por JSON entre pausas** (continuar con `JSON.parse(JSON.stringify(state))` da el mismo resultado que con el objeto); flujo, estado y entrada congelados en profundidad y sin cambios; un solo evento terminal (`end`/`error`/`input`) y siempre el último; `attempt ≤ maxRetries + 1`; **no fuga**: respuestas inválidas y rechazos con un marcador único (`ZQXJ…`) que no aparece en ningún evento, estado ni rechazo serializados, y una válida que solo aparece en su variable (y en lo que la plantilla del autor renderice); espías en todos los métodos de `console` incluidas sesiones que esperan, reintentan y se rechazan |
| Hipótesis de coste y tamaño | **Aplica** | Tabla de D10, cada una validada rompiendo temporalmente su hipótesis |
| Validador (`packages/spec`) | **Aplica** | D9 |
| Regresión de la feature 1 | **Aplica** | Toda la suite existente en verde sin tocar más tests que los de D11; diferencial de regex intacto |
| Integración HTTP | No aplica | No hay endpoints (features 5 y 6) |
| E2E opción-al-menos-una-vez | No aplica | No hay UI (feature 7) |
| Smoke de ruta | No aplica | No hay rutas |
| Mutación | No aplica ahora | Sin herramienta (FOLLOW-UP 6.8 de `engine-base`). Sustituto: cada test negativo y cada test de hipótesis de D10 se valida rompiendo el código a mano y viendo que falla |

### Plan de Ejecución

Correspondencia con las fases estándar: 1 Backend Core = fases 1-3 de `tasks.md` (regla del validador, contrato y estado, conversores); 2 Backend API = fase 4 (ejecutor, sesión, golden); 3 Tests backend = fase 5 (verificación QA); 4-5 Frontend y sus tests: **no aplican** (no hay UI hasta la feature 7). Cada fase lleva sus propios tests. Detalle, ficheros y gates en `tasks.md`.

| Fase | Agente | Ficheros | Gate |
|---|---|---|---|
| 1. Regla del validador | `popi:backend-developer` | modificar `packages/spec/src/validate.ts`, `packages/spec/tests/validate.test.ts` | `pnpm --filter @franca/spec test`, `build` y `validate` en verde |
| 2. Contrato y estado | `popi:backend-developer` | modificar `packages/engine/src/{constants,types,index,state,variables}.ts` (sin tocar aún los arrays de códigos), `src/nodes/types.ts`, `tests/{exports.test.ts,unit/state.test.ts,unit/variables.test.ts}`; crear `tests/legacy/estado-v1-captacion-leads.json` | `typecheck` y `test` del motor en verde, `parity.test.ts` incluido |
| 3. Conversores y respuesta | `popi:backend-developer` | crear `packages/engine/src/input/**`, `tests/unit/input-*.test.ts`, `tests/unit/{answer,user-input,validation}.test.ts`; modificar `tests/static-guard.test.ts` | unit verdes; tests de hipótesis de D10 validados rompiendo el código |
| 4. Ejecutor, sesión y golden | `popi:backend-developer` | crear `src/nodes/input.ts`, `tests/scenarios/input-*.test.ts`, `tests/helpers/conversation.ts`, `tests/fixtures/seleccion-multiple.json`, tres golden nuevos; modificar `src/{constants,run,session}.ts` (códigos nuevos, a la vez que `parity.test.ts`), `src/nodes/index.ts`, los tests de D11, `README.md` del paquete, la wiki | todos los escenarios con su `it`; diff de golden revisado; `pnpm check` verde |
| 5. Verificación | `popi:qa-tester` (modo verificación de spec) | sin código de producto | matriz escenario → test; negativos e hipótesis validados por mutación manual; alcance del diff; secuencia de CI |

Recomendación: **`apply normal`**. La fase 3 es buena candidata a **bucle aislado** (`popi:loop`): espacio de comportamiento grande (siete conversores con muchos bordes), oráculo mecánico (las tablas de la spec y del diseño) y sin decisiones abiertas. La elección es del usuario.

## Risks / Trade-offs

- [El parser `URL` y `normalize` dependen de la versión de Node (IDNA, tablas Unicode)] → como `\p{…}` en `matches`: `engines` fija Node ≥ 22; se anota en la wiki. Un host con otro Node podría clasificar distinto un dominio IDN raro.
- [Un usuario con un teléfono de 16 dígitos, un número con 3 decimales y parte entera corta o con más de 15 cifras significativas, o una URL con una IP tiene que reformular] → reintento con `invalid_format`, nunca un valor equivocado (decisiones de producto aprobadas).
- [`Default_Ignorable_Code_Point` rechaza también U+200D (ZWJ), así que una URL con un emoji compuesto en la ruta es inválida] → caso raro en un chat; a cambio no hay que mantener la lista exacta de lo que el parser quita, que es un subconjunto medido de esa propiedad.
- [Cambiar `SessionStatus` y `EngineEvent` rompe `switch` exhaustivos] → no hay consumidores; README y tipos lo documentan.
- [Las tablas de conversores son el sitio con más bordes] → unit por tipo, tests dirigidos al límite del invariante de tamaño validados por mutación y fase 3 apta para bucle aislado.
- [Regrabar golden puede consagrar una regresión] → comando explícito, gate de `git diff --stat` (solo 2 modificados) y lectura del diff contra el ejemplo de D1.
- [La regla nueva del validador invalida flujos guardados] → solo los que no se podían ejecutar; no hay flujos persistidos todavía (feature 6).
- [Coste de una respuesta con un patrón hostil] → ≤ 4097 × 2001 visitas de la VM, determinista; el tope de CPU sigue siendo del host (FOLLOW-UP 6.5 de `engine-base`).

## Migration Plan

Sin consumidores ni datos persistidos: no hay migración. Los estados `ended`/`failed` de la feature 1 siguen siendo válidos. Rollback = revertir el PR; los únicos ficheros fuera del motor son la regla del validador y su test.

## Open Questions

Ninguna que cambie la spec, el enfoque o las tareas. Las preguntas abiertas de la proposal están resueltas por el orquestador (reintentos agotados → `retries_exhausted`; `1.500`/`1,500` se rechazan; el evento `input` no da pistas de validación; límites de `date` y booleanos en otros idiomas como FOLLOW-UP).
