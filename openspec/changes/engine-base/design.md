# Design: motor base de ejecución de flujos (`engine-base`)

**Fecha**: 2026-10-16 · **Rama**: `feat/engine-base` · Motivación y alcance en `proposal.md`; comportamiento en `specs/flow-engine/spec.md` (manda sobre este documento).

## Context

- No existe ningún motor. `@franca/spec` (`packages/spec`) aporta los tipos generados (`src/types.ts`), `validateFlow`, `targets`, `schema` y `SPEC_VERSION`; su cadena es ESM + tsdown (`.mjs`/`.d.mts`) + `tsc --noEmit` + Vitest, sin script `lint`.
- `pnpm-workspace.yaml` ya incluye `packages/*`; `turbo.json` define `build`/`typecheck`/`test` con `dependsOn: ["^build"]`; `pnpm check` = `turbo run lint typecheck test`; la CI ejecuta `lint`, `typecheck`, `build`, `test`, `test:e2e` y `validate` por turbo.
- Node 22 (`engines`), TypeScript 6, Vitest 4, tsdown 0.23.

### Auditoría de la spec contra el código fusionado

Hechos comprobados ejecutando `packages/spec/dist` con Node 22.23 (no leyendo documentos):

| Lo que decía o se podía suponer | Lo que dice el código | Dónde se corrige |
|---|---|---|
| `validateFlow` deja el flujo "limpio" | Devuelve **la misma referencia** (`flow: input as Flow`); no copia ni normaliza | Diseño: el motor trabaja sobre una copia JSON propia (D4) |
| `default` es un valor JSON | `variable.default` es `{}` en el esquema: ajv acepta `Infinity`, instancias de `Date` o funciones; `JSON.parse("1e400")` produce `Infinity` | Spec: requisito nuevo "Forma JSON del flujo"; diseño D4 |
| Los números del flujo son finitos | En campos tipados (`set.value`, `typingDelayMs`) ajv rechaza `Infinity`/`NaN` (strictNumbers); solo `default`, `rule.value` y `http.body` (esquema `{}`) aceptan cualquier cosa | D4 cubre los tres |
| `rule.value` es literal (spec) | `templateVars` del validador recorre también `rule.value`: `"{{zz}}"` en un `value` exige declarar `zz` | No bloquea (el motor no lo expande). FOLLOW-UP en `packages/spec` |
| `alt` es plantilla (spec) | En el esquema `alt` es `string`, no `template`, pero el validador ya comprueba sus `{{var}}` | Coherente; anotar en RFC-0001 (FOLLOW-UP de la proposal) |
| Marcador `{{nombre}}` con forma de `varName` | `TEMPLATE_VAR` (`packages/spec/src/validate.ts:38`) no limita a 64 caracteres; como los nombres declarados sí lo están, un marcador más largo hace el flujo inválido | El motor copia `TEMPLATE_VAR` literalmente (D6): misma gramática por construcción |
| `node.type` puede faltar (tipos generados con `type?:`) | `NodeBase.type: string` ∩ `type?: 'message'` da `type: 'message'` obligatorio; el estrechamiento por `node.type` funciona (lo usa `validate.ts`) | Sin cambio |
| Nombres de variable arbitrarios | `varName` admite `__proto__` y `constructor`; `o['__proto__'] = v` no crea propiedad propia | Spec: escenario añadido; diseño D5 (Map + `Object.fromEntries`/`Object.hasOwn`) |
| Regex del autor con `RegExp` nativo | `/^(a+)+$/u.test("a"×26 + "!")` tarda 1,3 s en este portátil; cada carácter más lo duplica | Spec: tres requisitos nuevos de `matches` y "Reglas que no se pueden evaluar" ampliado; diseño D8 |
| Las plantillas solo sustituyen texto acotado | Un `set` `a = "{{a}}{{a}}"` en un ciclo duplica el texto hasta `RangeError: Invalid string length` (~28 asignaciones, 40 ms; comprobado en la revisión) | Spec: requisito nuevo "Tamaño máximo de un texto renderizado" (`value_too_large`); diseño D6 |
| Los ejemplos se importan como `@franca/spec/examples/*` | `exports` de `@franca/spec` solo publica `.` y `./flow.schema.json` | Tests leen `../../spec/examples/` por ruta relativa (cero ficheros ajenos) |

## Goals / Non-Goals

**Goals:**
- Paquete `@franca/engine` con la misma cadena que `@franca/spec` y recogido por `pnpm check` y la CI sin tocarlos.
- Contrato TypeScript estable (firmas, eventos, estado versionado, códigos) que las features 2-4 amplían de forma **aditiva**.
- Módulos puros, cada uno testeable por separado; ejecutor por tipo de nodo con tabla exhaustiva comprobada por el compilador y por un test de paridad contra `flow.schema.json`.
- `matches` sin ReDoS y determinista.

**Non-Goals (de diseño, además de los de la proposal):**
- Ninguna dependencia de runtime aparte de `@franca/spec`; ningún motor de regex de terceros.
- Ninguna caché ni estado de módulo (ni de regex compiladas ni de flujos validados): cada operación es autocontenida.
- No se exponen las piezas internas (plantillas, predicados, regex) en la API pública; las features 2-4 las importan desde dentro del paquete.
- No se define todavía la forma de `input`, ni las interfaces `HttpClient`/`LlmClient` (solo su sitio).

## Decisions

### D1. Paquete `packages/engine` con la cadena de `@franca/spec`

`package.json` (nuevo):

```json
{
  "name": "@franca/engine",
  "version": "0.1.0",
  "description": "Motor de ejecución de flujos de Franca: puro, determinista y sin IO",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch --no-clean",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@franca/spec": "workspace:*" },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsdown": "^0.23.1",
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

- `tsdown.config.ts`: igual que el de la spec con `entry: ['src/index.ts']` (sin CLI), `format: 'esm'`, `platform: 'node'`, `dts: true`, `clean: true`. `@franca/spec` queda externo por ser dependencia.
- `tsconfig.json`: copia del de la spec (`nodenext`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `types: ["node"]`, `include: ["src", "tests"]`). `@types/node` solo lo necesitan los tests (leen ficheros); que `src/` no use Node lo garantiza el test de guarda estática (D10), no el tsconfig, para no mantener dos configuraciones.
- `dev` lleva `--no-clean` desde el primer día: en cuanto `apps/api` importe el motor (feature 6) se reproduciría [[gotcha-spec-watch-borra-dist]].
- **Sin script `lint`**, igual que la spec: `turbo run lint` lo omite. Añadir lint a los paquetes es una decisión transversal (FOLLOW-UP), no de esta feature.
- **Turbo y CI sin cambios**: `^build` construye `@franca/spec` antes del `typecheck`/`test`/`build` del motor porque es dependencia de workspace; `pnpm check` y los pasos `typecheck`/`build`/`test` de la CI lo recogen al existir los scripts. El paquete no define `validate` ni `test:e2e`.
- **Ficheros ajenos que cambian: 3, cada uno por decisión explícita.**
  - `pnpm-lock.yaml`, regenerado por `pnpm install` (nuevo importer). Obligatorio: la CI usa `--frozen-lockfile`.
  - `.claude/popi.json`: `packages/engine/src/**` en `verify.srcGlobs` (si no, el Stop hook no ve cambios del motor) y `packages/engine/tests/golden/**` en `protectedFixtures.patterns`, con `howToUpdate` ampliado con "`pnpm --filter @franca/engine test -u` y revisar el diff". Sin esto, los golden serían baselines sin protección contra el auto-bless.
  - `CLAUDE.md`: fila de `@franca/engine` en la tabla de stack, para que los agentes de las features 2-8 sepan que existe y dónde vive.
  - Nada más: ni `turbo.json`, ni la CI, ni `packages/spec`, ni las apps.
- Alternativa descartada: código del motor dentro de `@franca/spec`. Mezcla formato y ejecución, y obligaría a la web a cargar el motor para validar.

### D2. API pública (contrato del paquete)

Es el puente con las features 6 (persiste), 7 (pinta) y 2-4 (amplían). Cambiarla es un cambio de spec.

```ts
// ---- valores
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Valor de una variable con valor. "Sin valor" se representa por ausencia (o null donde se indica). */
export type VariableValue = Exclude<JsonValue, null>;

// ---- constantes
export const STATE_VERSION = 1;
export const MAX_STEPS_PER_ADVANCE = 200;
export const DEFAULT_TYPING_DELAY_MS = 600;
export const MAX_PATTERN_SIZE = 1000;
export const MAX_RENDERED_LENGTH = 16384; // unidades de código UTF-16
export const MAX_NESTING_DEPTH = 1000;    // niveles de array/objeto de flujo, contacto y estado
export const MAX_PATTERN_DEPTH = 100;     // grupos anidados en un patrón de matches

export const SESSION_ERROR_CODES = ['unsupported_node', 'invalid_rule', 'step_limit_exceeded', 'value_too_large'] as const;
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];
export const REJECTION_CODES = ['invalid_flow', 'invalid_contact', 'invalid_state', 'state_mismatch', 'session_not_active'] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

// ---- eventos
export type RenderedContentItem =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video' | 'audio' | 'embed'; url: string; alt?: string };
export interface EngineMessageEvent { type: 'message'; nodeId: string; content: RenderedContentItem[]; typingDelayMs: number }
export interface EngineEndEvent { type: 'end'; nodeId: string; outcome: string | null }
export interface EngineErrorEvent { type: 'error'; nodeId: string; code: SessionErrorCode; message: string }
export type EngineEvent = EngineMessageEvent | EngineEndEvent | EngineErrorEvent;

// ---- estado
export type SessionStatus = 'ended' | 'failed';
export interface SessionError { code: SessionErrorCode; nodeId: string }
export interface SessionState {
  stateVersion: typeof STATE_VERSION;
  flowId: string;
  status: SessionStatus;
  /** Nodo en el que se detuvo la sesión: el end, el que falló o el que habría sido el paso 201. */
  nodeId: string;
  /** Variables de sesión con valor (las sin valor no aparecen), en orden de declaración. */
  variables: Record<string, VariableValue>;
  /** Todas las variables de contacto declaradas, null si no tienen valor, en orden de declaración. */
  contact: Record<string, VariableValue | null>;
  outcome: string | null;   // solo si status === 'ended'
  error: SessionError | null; // solo si status === 'failed'
}

// ---- resultados
export interface SessionResult { ok: true; status: SessionStatus; events: EngineEvent[]; state: SessionState }
export type Rejection =
  | { ok: false; code: 'invalid_flow'; message: string; issues: FlowIssue[] }   // FlowIssue de @franca/spec
  | { ok: false; code: Exclude<RejectionCode, 'invalid_flow'>; message: string };
export type AdvanceResult = SessionResult | Rejection;

// ---- operaciones
export interface StartSessionRequest { flow: unknown; contact?: unknown }
export interface ContinueSessionRequest { flow: unknown; state: unknown; input: unknown }
/** Capacidades que inyecta el host. Vacía en esta feature; ver D9. */
export interface EngineHost {}

export function startSession(request: StartSessionRequest, host?: EngineHost): Promise<AdvanceResult>;
export function continueSession(request: ContinueSessionRequest, host?: EngineHost): Promise<AdvanceResult>;
```

Razones:
- **Rechazo como valor, no como excepción.** `ok: false` es un hecho del contrato (el host lo mapeará a 4xx en la feature 6); una promesa rechazada queda reservada a defectos del motor (y a flujos construidos en memoria que no se pueden serializar, ver riesgos). Mismo patrón que `validateFlow` (resultado, no throw). `ok` significa "operación aceptada", no "sesión con éxito": una sesión `failed` es `ok: true`.
- **`flow`, `contact` y `state` como `unknown`**: el motor los valida siempre (spec), y en la feature 6 llegan de base de datos sin tipar. Tipar `flow: Flow` obligaría a casts y prometería algo que el motor comprueba de todos modos.
- **Datos y capacidades separados**: `request` es serializable; `host` lleva funciones (features 3-4). Así el segundo argumento puede crecer sin tocar el primero.
- **Códigos como arrays `as const`** de los que se deriva el tipo: el host puede iterarlos y hay un test de paridad que comprueba que todo código emitido está en su lista.
- **Nombres `Engine*Event`**: `MessageEvent`/`ErrorEvent` chocan con globales del DOM en `apps/web`.
- **`message` de errores y rechazos**: texto en español para personas; el contrato estable es `code` (y `nodeId`). No incluyen valores (spec), y para `invalid_contact` solo nombran la clave si es una variable declarada del flujo: una clave ajena puede ser cualquier cosa que mande el host.
- **Omitido / null / vacío** en la entrada: `contact` omitido, `null` o `{}` → sin valores inyectados; un valor `null` dentro → usa el `default`. `input` se acepta y se ignora en esta feature (siempre se rechaza antes por `session_not_active`).

Ejemplo de resultado (arranque de `captacion-leads`, JSON válido reutilizable como golden):

```json
{
  "ok": true,
  "status": "failed",
  "events": [
    {
      "type": "message",
      "nodeId": "bienvenida",
      "content": [{ "kind": "text", "text": "¡Hola! Te hago tres preguntas y te paso con la persona adecuada." }],
      "typingDelayMs": 600
    },
    { "type": "error", "nodeId": "pedir-nombre", "code": "unsupported_node", "message": "el nodo de tipo input aún no está soportado" }
  ],
  "state": {
    "stateVersion": 1,
    "flowId": "captacion-leads",
    "status": "failed",
    "nodeId": "pedir-nombre",
    "variables": {},
    "contact": { "email": null },
    "outcome": null,
    "error": { "code": "unsupported_node", "nodeId": "pedir-nombre" }
  }
}
```

Ejemplo de rechazo:

```json
{ "ok": false, "code": "invalid_flow", "message": "el flujo no es válido", "issues": [{ "layer": "shape", "path": "", "message": "falta la propiedad obligatoria 'start'" }] }
```

Tabla de códigos (el `message` exacto lo fija la implementación y lo congelan los golden):

| Código | Tipo | Cuándo | `nodeId` |
|---|---|---|---|
| `invalid_flow` | rechazo | `validateFlow` no da `valid` (con `issues` íntegros), o el flujo supera `MAX_NESTING_DEPTH` (un issue `shape`, `path` `""`) | — |
| `invalid_contact` | rechazo | `contact` no es objeto plano, o supera `MAX_NESTING_DEPTH`, o algún valor no es JSON (`NaN`, `±Infinity`, `undefined`, función, símbolo, bigint, instancia no plana, array disperso, ciclo) | — |
| `invalid_state` | rechazo | `state` no cumple la forma de `SessionState`, supera `MAX_NESTING_DEPTH` o su `stateVersion` no es conocida | — |
| `state_mismatch` | rechazo | `state.flowId !== flow.id` o `state.nodeId` no existe en el flujo | — |
| `session_not_active` | rechazo | `state.status` no es activo (en esta feature, siempre) | — |
| `unsupported_node` | error de sesión | se alcanza `input`, `http` o `llm` | el nodo |
| `invalid_rule` | error de sesión | regla evaluada sin `value`, o `matches` con value no string, regex inválida, no admitida o demasiado grande o demasiado anidada | el `condition` |
| `step_limit_exceeded` | error de sesión | se iba a ejecutar el nodo 201 del avance | ese nodo |
| `value_too_large` | error de sesión | una plantilla (`text`, `url`, `alt` o string de `set`) renderiza más de `MAX_RENDERED_LENGTH` unidades de código | el nodo que renderiza |

### D3. Estructura de módulos

```
packages/engine/src/
  index.ts              exports públicos (solo D2)
  types.ts              tipos públicos de D2
  constants.ts          constantes y arrays de códigos
  session.ts            startSession / continueSession: validación, inicialización, rechazos
  run.ts                bucle de avance: contador de pasos, despacho, construcción del resultado
  state.ts              buildState (store → SessionState), parseState (unknown → SessionState | null)
  variables.ts          VariableStore (Map) + init desde defaults y contacto
  json.ts               toJsonForm (forma JSON del flujo), checkJsonValue (estricto, contacto/estado), deepEqual
  template.ts           renderTemplate, textOf
  predicates.ts         evaluatePredicate, evaluateRule, readNumber, tabla OPERATORS (uno por rule.op)
  nodes/
    index.ts            EXECUTORS: tabla exhaustiva tipo de nodo → ejecutor
    message.ts  set.ts  jump.ts  condition.ts  end.ts  unsupported.ts
  regex/
    parse.ts            patrón → AST del subconjunto admitido, o motivo de rechazo
    compile.ts          tamaño (antes de expandir) y programa NFA
    match.ts            simulación Pike VM, booleana, O(n·m)
```

Contratos internos (exportados entre módulos, no desde `index.ts`):

```ts
type StepOutcome =
  | { kind: 'next'; nodeId: string }
  | { kind: 'end'; outcome: string | null }
  | { kind: 'fail'; code: SessionErrorCode; message: string };
  // feature 2 añade: | { kind: 'wait' }

interface StepContext {
  readonly vars: VariableStore;              // copia de trabajo de esta operación
  readonly typingDelayMs: number;
  readonly host: EngineHost;
  emit(event: EngineEvent): void;
}

type NodeOfType<K extends Node['type']> = Extract<Node, { type: K }>;
type NodeExecutor<K extends Node['type']> = (node: NodeOfType<K>, ctx: StepContext) => StepOutcome | Promise<StepOutcome>;
export const EXECUTORS: { [K in Node['type']]: NodeExecutor<K> };  // input/http/llm → unsupported
```

- La tabla mapeada obliga a tener un ejecutor por cada tipo de `Node` de `@franca/spec`: si el esquema añade un tipo y se regeneran los tipos, `tsc` falla en el motor. El test de paridad (plan de verificación) cubre lo mismo en runtime contra `schema`.
- `OPERATORS: { [K in Rule['op']]: (variable: VariableValue | undefined, rule: Rule) => boolean }` con el mismo efecto para los operadores.
- Las funciones de `template`, `predicates`, `json` y `regex` no conocen sesiones ni eventos: entradas → salida. Los ejecutores son finos (recorren el nodo y llaman a esas funciones).
- `invalid_rule` se señala con una clase interna `InvalidRuleError` (no exportada) que lanza `evaluateRule` y que **solo** captura `condition.ts`, convirtiéndola en `fail`. Del mismo modo, `renderTemplate` lanza `ValueTooLargeError`, que capturan `message.ts`, `end.ts` y `set.ts`. Cualquier otra excepción es un defecto y se propaga. Así el cortocircuito de `all`/`any` y el orden de reglas evitan errores de forma natural (escenarios de la spec) sin propagar resultados a mano por la recursión.
- Alternativa descartada: un `switch` gigante en `run.ts`. Impide testear cada nodo y obliga a abrir el mismo fichero en las features 2, 3 y 4.

### D4. El motor trabaja sobre la forma JSON del flujo

Cada operación hace primero `toJsonForm(flow)` = semántica de `JSON.parse(JSON.stringify(flow))` (con `undefined` si `stringify` no produce nada) y después **valida y ejecuta esa copia privada**: `validateFlow(toJsonForm(flow))`.

- Garantiza en un solo mecanismo: no mutar el flujo (incluido congelado), no compartir objetos entre `state` y flujo (escenario "Un default json se copia"), estado JSON puro (`Infinity`→`null`, `-0`→`0`, `Date`→su `toJSON`, `undefined`→ausente) y que `rule.value: undefined` en un flujo de memoria equivalga a "sin la propiedad `value`".
- **Se valida la forma JSON, no el original.** Alternativa descartada: validar el original y ejecutar la copia. Un objeto construido en memoria con un `toJSON` propio o heredado (instancias de clase, `Date`) tiene una forma JSON distinta del original, y entonces lo validado y lo ejecutado divergirían en los dos sentidos: un original válido cuya copia no lo es, o al revés. Validando la copia, el validador juzga exactamente lo que se ejecuta y lo que el host persistiría (la feature 6 guarda JSON). Para un flujo que llega como JSON, que es el caso real, ambas formas son idénticas y `issues` coincide con `validateFlow(flujo).issues` (escenarios de la spec). Coste: un `stringify` + `parse` por operación, del mismo orden que la validación.
- Coste O(tamaño del flujo), el mismo orden que la validación que ya se hace en cada operación.
- `contact` y `state` **no** se normalizan sino que se comprueban (`checkJsonValue`, estricto, detecta ciclos con la pila de ancestros) y se copian: son datos del host y la spec exige rechazarlos (`invalid_contact`/`invalid_state`). Objeto plano = prototipo `Object.prototype` o `null`; claves propias enumerables de tipo string.
- Alternativa descartada: rechazar con `invalid_flow` un `default` no JSON. Contradice "issues = los del validador" y sería una regla semántica que pertenece a `packages/spec` (FOLLOW-UP de la proposal).

### D4b. Límites de profundidad deterministas

`validateFlow` (ajv), `JSON.stringify` y el clonado son recursivos: con datos hostiles desbordan la pila (medido: ~1500 niveles de predicados, ~2500 de JSON en contacto, 100 000 en un `default`) y el resultado dependería de la pila libre y del JIT. Capturar `RangeError` no sirve como contrato, así que se fija un límite explícito:

- `MAX_NESTING_DEPTH` = 1000 niveles de array/objeto. Un flujo real anida del orden de 10 (≈ 450 predicados `all`/`any` anidados caben, cada uno ocupa 2 niveles); 1000 deja un margen de ×100 y queda bien por debajo de lo que la pila soporta en ajv (un flujo de ~1000 predicados, ≈ 2000 niveles, aún se valida). Se mide con `exceedsDepth` (`json.ts`): recorrido **iterativo** con pila explícita, que sigue `Object.keys` (no `length`, para que un array disperso enorme no cueste) y recuerda la mayor profundidad con la que visitó cada objeto (un grafo compartido no es exponencial y un ciclo sube hasta el límite y se rechaza).
- Se aplica **antes** de cualquier operación recursiva: al flujo antes de `toJsonForm` (→ `invalid_flow`, un issue `shape` con `path` `""`), al contacto antes de copiarlo (→ `invalid_contact`) y al estado dentro de `cloneJsonStrict`, que lo protege en todos sus usos (→ `invalid_state`). Se mide la estructura recibida; un `toJSON` propio que devuelva algo más profundo es un defecto del host (como los ciclos con `bigint`) y no se cubre.
- `MAX_PATTERN_DEPTH` = 100 grupos anidados en un patrón de `matches`, contados por un barrido iterativo (`regex/parse.ts`) que salta escapes y clases, **antes** del precheck nativo y del parser. Ningún patrón real anida más de unos pocos grupos. El `catch` de `RangeError` en `compilePattern` queda solo como red de seguridad; ya no define el resultado.

### D5. Variables: `Map` interno, objetos de estado sin prototipo trampa

- `VariableStore` = `Map<string, VariableValue>` + mapa de ámbito por nombre declarado. Leer/escribir nunca toca propiedades de objeto, así que `constructor`, `toString` o `__proto__` son nombres normales.
- Los `Record` del estado se construyen con `Object.fromEntries` (crea propiedades propias, también `__proto__`) en orden de declaración; al leer `contact`/`state` se usa `Object.entries`/`Object.hasOwn`.
- `set` con `null` → `delete`; string → `renderTemplate`; number/boolean → tal cual. El store de trabajo es propio de la operación: nada externo se muta.
- Init: para cada variable declarada, `default` de la forma JSON (si no es `null`/ausente); si es `contact` y el host inyectó un valor no `null`, gana ese.

### D6. Plantillas y forma textual

- `renderTemplate(template, lookup)` recorre los marcadores con la regex `TEMPLATE_VAR` copiada literalmente de `packages/spec/src/validate.ts:38` (`/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`, con un comentario que apunta a su origen): una sola pasada por construcción (el texto insertado no se reexamina). Lo demás queda literal.
- **Tamaño máximo del renderizado (`MAX_RENDERED_LENGTH` = 16384 unidades de código UTF-16).** `renderTemplate` acumula los trozos y su longitud y lanza `ValueTooLargeError` **en cuanto** la suma supera el límite, sin construir la cadena completa (un `{{a}}` repetido mil veces con `a` grande no llega a reservar memoria). Razones del valor:
  - Corta el crecimiento exponencial (`a = "{{a}}{{a}}"`): todo string que crea el motor queda acotado, sea cual sea el ciclo.
  - Es cuatro veces el límite habitual de un mensaje en plataformas de chat (4096) y sobra para cualquier texto, URL o resumen razonable de un flujo; un literal mayor no es un mensaje de chat.
  - Acota el trabajo: cada `matches` sobre un string creado por el motor cuesta como mucho 16384 × 1000 pasos de VM, y cada `message` emite como mucho `items × 16384` caracteres.
  - Se cuenta en unidades de código (`string.length`) y no en code points ni bytes: es O(1), determinista y la misma medida que usarán el cliente y la base de datos al truncar.
- **Sin tope de tamaño total del estado.** Con este límite, lo que el motor escribe en el estado está acotado por `variables declaradas × 16384` más lo que ya traían el flujo (`default`) y el host (contacto). Lo primero lo fija el autor y lo segundo lo controla el host: acotar el contacto entrante es de quien lo inyecta (FOLLOW-UP de las features 2, 3 y 6), y la feature 6 puede dimensionar la fila con esa cota. Un segundo límite sobre el estado serializado obligaría a serializar en cada paso o a llevar contabilidad incremental, para un caso que ya está cerrado.
- `textOf`: string tal cual; number con `JSON.stringify` (sin `locale`, `-0` ya normalizado); boolean `"true"`/`"false"`; array/objeto `JSON.stringify` compacto en orden de inserción; sin valor `""`.
- Se copia `TEMPLATE_VAR` en vez de importarlo porque `@franca/spec` no lo exporta y exportarlo abriría `packages/spec` sin necesidad. Al ser la misma expresión, no hace falta test de paridad de gramática; exportarlo desde la spec queda como FOLLOW-UP.

### D7. Predicados

- `readNumber(v)`: number → v; string → `trim()` y la gramática JSON `/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/`, y solo si `Number(...)` es finito (`"1e400"` no se lee como número, coherente con D4).
- `eq` (y `neq` = `!eq`), orden, `contains`/`startsWith`, `isSet`/`isEmpty`: implementación literal de las tablas de la spec. `deepEqual` estricto sin coerción para arrays/objetos (orden de claves irrelevante, orden de arrays relevante). Un elemento `null` dentro de un array cuenta como "sin valor" al aplicar `eq` en `contains` (coherente con "null equivale a sin valor").
- Orden de cadenas con `<`/`>` de JS (unidades de código, sin `localeCompare`).
- Falta de `value`: `rule.value === undefined` (tras D4 equivale a no tener la propiedad) en cualquier operador salvo `isSet`/`isEmpty` → `InvalidRuleError`.

### D8. `matches` sin ReDoS: motor lineal propio en TypeScript puro

Opciones evaluadas:

| Opción | Veredicto | Por qué |
|---|---|---|
| Límite de longitud del texto y/o del patrón con `RegExp` nativo | Descartada | El retroceso exponencial muerde con 26 caracteres (medido: 1,3 s); un límite que lo evite rompe casos legítimos y no cubre los polinómicos (`\d*\d*\d*x`) |
| Rechazar construcciones "peligrosas" (heurística tipo star-height) | Descartada | Incompleta por naturaleza: `(a\|a)*b` o cuantificadores adyacentes solapados pasan el filtro y siguen siendo exponenciales/polinómicos |
| Timeout (worker, `vm`) | Descartada | Introduce IO/plataforma y, sobre todo, **rompe el determinismo**: el resultado dependería de la velocidad de la máquina |
| Dependencia de motor lineal en JS (port de RE2) | Descartada | Dependencia nueva que ningún requisito exige y semántica distinta de ECMAScript (`.`, `\s`, `\p{Script=…}`), lo que obligaría a redefinir el operador igualmente |
| **Motor lineal propio (Thompson/Pike VM) con átomos delegados al `RegExp` nativo** | **Elegida** | Lineal y determinista; sin dependencias; semántica de caracteres idéntica a ECMAScript |

Cómo funciona:
1. `value` debe ser string; `new RegExp(value, 'u')` se **compila** (nunca se ejecuta contra el texto) solo para validar la sintaxis ECMAScript: si lanza → `invalid_rule`.
2. `regex/parse.ts` recorre el patrón (ya sabido válido en modo `u`, donde no hay sintaxis Annex B) y construye el AST del subconjunto de la spec. Rechaza con motivo: `\1`…`\9` y `\k<…>`, `(?=`, `(?!`, `(?<=`, `(?<!`, cualquier otro `(?` que no sea `(?:` o `(?<nombre>`, y nombres de grupo repetidos, comparados **tras decodificar** sus escapes (`(?<a>)` y `(?<\u0061>)` son el mismo nombre). Los rechazamos nosotros para que el resultado no dependa de si una versión futura de V8 los admite. Invariante: si el parser acepta un patrón, `new RegExp(patrón, 'u')` compila.
3. Cada átomo de carácter (literal, `.`, escape, clase `[...]`, `\p{…}`) se guarda como el **trozo de fuente** y se prueba con `new RegExp('^(?:' + trozo + ')$', 'u').test(unCodePoint)`: ejecución nativa solo sobre un code point, coste constante, y semántica exacta de ECMAScript sin reimplementar clases ni tablas Unicode. `^`, `$` (sin `m`: inicio/fin de la entrada) y `\b`/`\B` (palabra ASCII, como en modo `u` sin `i`) los evalúa la VM.
4. `regex/compile.ts` calcula el **tamaño sobre el AST antes de expandir** (definición de la spec: átomos y aserciones; `{n}`/`{n,m}` multiplican por n o m, `{n,}` por `max(n,1)`, `*`/`+`/`?` por 1) y aborta si supera `MAX_PATTERN_SIZE` = 1000; así `(a{1000}){1000}` nunca llega a construirse. Después emite el programa (`CHAR`, `SPLIT`, `JMP`, `ASSERT`, `MATCH`).
5. `regex/match.ts`: simulación Pike VM booleana sobre los code points del texto (iteración con `for…of`, igual que el modo `u`), búsqueda no anclada añadiendo un hilo en cada posición, cierre-ε con conjunto de visitados por posición (resuelve bucles vacíos como `(a*)*`), memo por paso del resultado de cada átomo. Coste O((n+1)·m) con m ≤ 1000. Termina en cuanto un hilo llega a `MATCH`. Los cuantificadores perezosos se compilan como los voraces: para un resultado booleano la existencia de coincidencia no depende del orden.
6. Sin caché de módulo: se compila en cada evaluación (patrones pequeños, el límite de pasos acota las evaluaciones por avance). `matches` no ejecuta jamás el patrón completo con el motor nativo.

Por qué la cota es 1000 y no hay un límite de texto propio de `matches`: con m ≤ 1000 el coste es lineal en el texto, la misma garantía que `contains`. Los strings que crea el motor (`set`) ya están acotados por `MAX_RENDERED_LENGTH` (D6); los que llegan de fuera (contacto en esta feature; `input` y `http` en las features 2 y 3) los acota quien los introduce (FOLLOW-UP en `tasks.md`). El peor caso de un avance es finito y determinista (200 nodos × 16384 × 1000 pasos sobre strings del motor), pero puede costar segundos con un flujo hostil: aislar la ejecución con un tope de CPU es del host (FOLLOW-UP de la feature 6), donde un timeout no rompe el determinismo del motor.

Reutilización prevista: `validation.pattern` del nodo `input` (feature 2) enfrenta también un patrón del autor a texto del usuario y debe usar este mismo matcher.

Cambio de comportamiento observable → spec actualizada: requisitos nuevos "Evaluación de matches en tiempo lineal", "Construcciones admitidas en matches" y "Tamaño máximo del patrón de matches", y "Reglas que no se pueden evaluar" ampliado con el escenario "Construcción no admitida en matches".

### D9. Sitios de extensión para las features 2-4 (sin implementarlos)

- **`input` (feature 2)**: `SessionStatus` gana `'waiting'`; `StepOutcome` gana `{ kind: 'wait' }` y el bucle lo traduce en `status: 'waiting'` con `nodeId` del `input`; `continueSession` ya hace las cuatro comprobaciones en el orden de la spec y solo le falta, tras `session_not_active` (que pasará a ser `status !== 'waiting'`), aplicar `input` al nodo pendiente y llamar al mismo `run` desde su salida. Los cambios de `SessionState` que necesite (reintentos, forma de `input`) los decide esa feature: si son aditivos y legibles por este código, `STATE_VERSION` puede seguir en 1; si no, sube a 2 y `parseState` acepta ambas. También decide qué hacer al reanudar con variables que ya no existen en el flujo.
- **`http` (feature 3) y `llm` (feature 4)**: sustituyen su entrada de `EXECUTORS` por un ejecutor asíncrono que usa `ctx.host.http` / `ctx.host.llm`, miembros **opcionales** que se añadirán a `EngineHost` (cambio aditivo). El motor resuelve plantillas y pasa las cabeceras secretas **por nombre**; el host resuelve el valor y nunca vuelve al estado ni a los eventos ([[domain-flujos-sin-secretos]]). Qué pasa si falta la capacidad lo decide cada feature. El contador de turnos de `llm` debe contar los autosaltos ([[domain-llm-puede-saltar-a-si-mismo]]).
- Las operaciones ya son `async` y el bucle hace `await` de cada ejecutor; los síncronos no cuestan nada observable.

### D10. Determinismo y ausencia de efectos, comprobados

- Nada de `Date`, `Math.random`, `performance`, `process`, `console`, temporizadores, `fetch`, `crypto`, `globalThis` ni imports `node:` en `src/`. Lo vigila un test de guarda estática que lee `src/**/*.ts`, quita comentarios y busca esos tokens (más barato que añadir un linter solo para esto).
- Sin estado de módulo mutable: dos operaciones no se influyen.
- Orden de salida determinista: eventos en orden de ejecución; claves del estado en orden de declaración.

### Plan de verificación por capas

| Capa | Veredicto | Cómo |
|---|---|---|
| Unit | **Aplica** | Un fichero por módulo: `json` (checkJsonValue con cada tipo no JSON, ciclos, `-0`), `template`, `predicates` (tabla operador × tipo de valor, incluida sin valor y coerciones), `variables`, `state` (parseState con cada campo roto), `regex/*` |
| Escenarios de la spec | **Aplica** | Cada `#### Scenario` → un `it` con el mismo título, agrupados por requisito en `tests/scenarios/*.test.ts`, contra flujos que pasan `validateFlow` (fixtures JSON en `tests/fixtures/` y constructores en `tests/helpers/flows.ts` para cadenas de 199/200 nodos) |
| Ejemplos reales | **Aplica** | `packages/spec/examples/*.json` (leídos por ruta relativa): expectativas exactas para los dos actuales y, para cualquier ejemplo futuro, la invariante "no se rechaza y termina en `ended` o en `unsupported_node`" |
| Golden / contractual | **Aplica** | Transcripción `{status, events, state}` de cada fixture y ejemplo con `toMatchFileSnapshot` en `tests/golden/`. Se regraban con `pnpm --filter @franca/engine test -u` y revisión del diff; en CI Vitest no escribe snapshots nuevos |
| Paridad | **Aplica** | Tipos de nodo de `schema.$defs.node.oneOf` = claves de `EXECUTORS`; `schema.$defs.rule.properties.op.enum` = claves de `OPERATORS`; todo código emitido ∈ `SESSION_ERROR_CODES`/`REJECTION_CODES`. (La gramática de marcadores no necesita paridad: es la misma regex, D6) |
| Diferencial de regex | **Aplica** | Oráculo `new RegExp(p, 'u').test(s)` sobre patrones generados del subconjunto y textos de ≤ 12 caracteres (donde el nativo es seguro), con PRNG con semilla fija (sin dependencia de property-testing). No vacuo: alfabeto pequeño compartido por el generador de patrones y el de textos, y proporción mínima exigida de resultados `true` y `false`. Corpus curado: emoji, `\p{L}`, `\b`, perezosos, grupos anidados y con nombre, y bucles que casan vacío y aserciones bajo cuantificador (`(?:\b)*`, `(a\|)*`, `(?:^\|a)+`, `(?:$)*`). Negativo: patrones generados fuera del subconjunto (referencias, lookarounds, modificadores, nombres repetidos incluso escritos con escapes distintos) se rechazan; invariante "si el parser acepta, el nativo compila" |
| Propiedades | **Aplica** | Determinismo (dos ejecuciones `toEqual` en todos los fixtures); entradas congeladas en profundidad y comparadas con un `structuredClone` previo; ida y vuelta JSON de todo estado producido; espías en todos los métodos de `console`; temporizadores simulados y detenidos; cota de trabajo del matcher ≤ (n+1)·m con un contador interno (determinista, sin medir tiempos) |
| Integración HTTP | No aplica | No hay endpoints (features 5-6) |
| E2E opción-al-menos-una-vez | No aplica | No hay UI (feature 7) |
| Smoke de ruta | No aplica | No hay rutas |
| Mutación | No aplica ahora | Sin herramienta en el repo (FOLLOW-UP de la proposal). Sustituto: los tests negativos (no consola, no mutación, no aliasing, no valores en errores, guarda estática) se validan rompiendo temporalmente el código y viendo que fallan |

### Plan de Ejecución

Correspondencia con las fases estándar: 1 Backend Core = fases 1-3 de `tasks.md` (paquete, módulos puros, regex); 2 Backend API = fase 4 (sesión, ejecutores, exports públicos); 3 Tests backend = fase 5 (verificación QA); 4-5 Frontend y sus tests: **no aplican** (no hay UI hasta la feature 7). Cada fase lleva sus propios tests. Detalle, ficheros y gates en `tasks.md`.

| Fase | Agente | Ficheros | Gate |
|---|---|---|---|
| 1. Andamiaje | `popi:backend-developer` | crear `packages/engine/{package.json,tsconfig.json,tsdown.config.ts,README.md,src/index.ts,src/constants.ts,tests/exports.test.ts}`; modificar `pnpm-lock.yaml` (generado), `.claude/popi.json` y `CLAUDE.md` | `pnpm install`, `pnpm --filter @franca/engine build` deja `dist/index.mjs` y `dist/index.d.mts`; `pnpm check` verde con el test de exports ejecutado |
| 2. Núcleo puro | `popi:backend-developer` | `src/{types,json,template,variables,predicates}.ts` + `tests/unit/*` | tests unit verdes; `typecheck` |
| 3. Regex lineal | `popi:backend-developer` | `src/regex/*`, operador `matches` + `tests/unit/regex-*` | diferencial y escenarios de `matches` verdes |
| 4. Sesión y nodos | `popi:backend-developer` | `src/{session,run,state}.ts`, `src/nodes/*`, `src/index.ts` + `tests/{scenarios,golden,fixtures,helpers}/*`, paridad, propiedades, guarda | todos los escenarios de la spec con su `it`; `pnpm check` verde |
| 5. Verificación | `popi:qa-tester` (modo verificación de spec) | sin código de producto | matriz escenario → test; tests negativos validados por mutación manual; `pnpm check` + secuencia de CI |

Recomendación: **`apply normal`** para todo el cambio. Si el usuario quiere, la fase 3 es buena candidata a **bucle aislado** (`popi:loop`): espacio de comportamiento grande pero con oráculo mecánico (el `RegExp` nativo en textos cortos) y sin decisiones abiertas. La elección es del usuario.

## Risks / Trade-offs

- [Motor de regex propio = código delicado] → oráculo diferencial contra el nativo, corpus curado, escenarios de la spec y cota de trabajo comprobada; el subconjunto es pequeño y los átomos los evalúa V8.
- [Autores con regex legítimas que usan lookahead o referencias] → `invalid_rule` explícito con mensaje que nombra la construcción; ningún flujo existente usa `matches` (comprobado en `examples/`). Cuando llegue la regla de validador (FOLLOW-UP) el editor lo avisará antes de publicar.
- [La sintaxis aceptada depende del V8 del host] → se rechazan explícitamente las extensiones posteriores a Node 22 que conocemos (modificadores `(?i:)`, nombres repetidos); `engines` fija Node ≥ 22.
- [El texto de `message` cambia y rompe golden] → el contrato es `code`; los golden se regraban con comando explícito y diff revisado.
- [Flujo construido en memoria con ciclos o `bigint` en cualquier campo] → `toJsonForm` lanza antes de validar y la promesa se rechaza (defecto del host, no rechazo de contrato): los flujos reales llegan como JSON. Documentado en el README del paquete.
- [Recursión profunda en predicados, valores o patrones muy anidados] → límites explícitos y deterministas (D4b).
- [Validar en cada operación cuesta] → O(tamaño del flujo) con ajv ya compilado en `@franca/spec`; la spec lo exige. Se acepta.
- [`pnpm --filter @franca/engine test` sin turbo falla si `@franca/spec` no está compilado] → mismo gotcha que las apps (ya en `gotchas.md`); el README del paquete lo dice.
- [Los hooks de popi no verían `packages/engine/src/**` ni protegerían los golden] → la tarea 1.4 los añade a `.claude/popi.json` (D1).
- [Un flujo legítimo con un texto de más de 16384 unidades de código falla con `value_too_large`] → error explícito con `nodeId`, no un fallo silencioso; el valor deja un margen de 4× sobre los mensajes de chat habituales.
- [`\p{…}` depende de la versión de Unicode del V8 del host] → un mismo patrón puede clasificar distinto un carácter recién añadido a Unicode entre versiones de Node. Se acepta (Node fijado a ≥ 22) y se anota en la ficha de wiki de la tarea 4.10.
- [Coste de un avance con un flujo hostil] → finito y determinista, pero puede ser de segundos; el tope de CPU es del host (FOLLOW-UP de la feature 6).

## Migration Plan

Paquete nuevo sin consumidores: no hay migración ni despliegue. Rollback = revertir el PR (el único fichero ajeno es `pnpm-lock.yaml`, regenerable).

## Open Questions

Ninguna que cambie la spec, el enfoque o las tareas.
