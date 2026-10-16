# Tasks: motor base de ejecución de flujos (`engine-base`)

Fases secuenciales; cada una empieza cuando la anterior pasa su gate. Comportamiento en `specs/flow-engine/spec.md`; cómo, en `design.md` (D1-D10). Cada `#### Scenario` de la spec tiene un `it` con el mismo título.

## 1. Andamiaje del paquete — dueño: `popi:backend-developer`

- [x] 1.1 Crear `packages/engine/package.json`, `tsconfig.json` y `tsdown.config.ts` según D1 (scripts `build`, `dev` con `--no-clean`, `typecheck`, `test`; dependencia `@franca/spec: workspace:*`) más `src/constants.ts` (constantes y arrays de códigos de D2, incluidos `MAX_RENDERED_LENGTH` y `value_too_large`), un `src/index.ts` que solo los reexporta y `tests/exports.test.ts`, que comprueba sus valores exactos importando desde `../src/index.js` (Vitest 4 sale con código 1 si no hay tests; no se usa `--passWithNoTests`); verificar que `pnpm install` solo modifica `pnpm-lock.yaml` fuera de `packages/engine/` (`git status`)
- [x] 1.2 Crear `packages/engine/README.md` (qué es, API de D2 en una tabla, que necesita `@franca/spec` compilado si se ejecuta sin turbo, que los rechazos son valores y las promesas rechazadas son defectos); verificar que no contiene secretos, PII ni nombres de clientes
- [x] 1.3 Registrar el paquete en la configuración de agentes (D1): en `.claude/popi.json`, añadir `packages/engine/src/**` a `verify.srcGlobs`, `packages/engine/tests/golden/**` a `protectedFixtures.patterns` y ampliar `protectedFixtures.howToUpdate` con "golden del motor: `pnpm --filter @franca/engine test -u` y revisar el diff"; en `CLAUDE.md`, añadir la fila de `@franca/engine` (`packages/engine`, TypeScript puro sin IO, tsdown, Vitest) a la tabla de stack; verificar que `.claude/popi.json` sigue siendo JSON válido (`node -e "JSON.parse(require('fs').readFileSync('.claude/popi.json','utf8'))"`) y que `git diff` de ambos ficheros solo contiene esas líneas
- [x] 1.4 Gate: `pnpm --filter @franca/engine build` genera `dist/index.mjs` y `dist/index.d.mts`, y `pnpm check` termina en verde con `@franca/engine#typecheck` y `@franca/engine#test` en la salida de turbo, sin cambios en `turbo.json` ni en `.github/workflows/ci.yml`

## 2. Núcleo puro — dueño: `popi:backend-developer`

- [x] 2.1 `src/types.ts` con exactamente los nombres y tipos de D2; verificar con `pnpm --filter @franca/engine typecheck`
- [x] 2.2 `src/json.ts` (`toJsonForm` para el requisito "Forma JSON del flujo", que devuelve `undefined` si `stringify` no produce nada, `checkJsonValue` estricto con detección de ciclos y objetos planos, `deepEqual`) con `tests/unit/json.test.ts`: cada no-JSON de la tabla de D2 (`NaN`, `±Infinity`, `undefined`, función, símbolo, bigint, `Date`, `Map`, array disperso, ciclo) rechazado; `-0` → `0`; claves `__proto__` conservadas como propias
- [x] 2.3 `src/template.ts` (`renderTemplate` con `TEMPLATE_VAR` copiado literalmente de `packages/spec/src/validate.ts:38` y corte incremental por `MAX_RENDERED_LENGTH` con `ValueTooLargeError`; `textOf`) con `tests/unit/template.test.ts`: escenarios de "Sustitución de plantillas", "Forma textual de los valores" y "Plantillas en una pasada y como texto plano", más 16384 admitido, 16385 rechazado y un marcador repetido con un valor grande que se rechaza sin construir la cadena completa
- [x] 2.4 `src/variables.ts` (`VariableStore` sobre `Map`, init desde defaults y contacto según D5) con `tests/unit/variables.test.ts`: precedencia contacto/default, `null` inyectado, claves ajenas ignoradas, variables de sesión no inyectables, nombres `constructor`/`__proto__`
- [x] 2.5 `src/predicates.ts` (`readNumber`, `OPERATORS` para todos los `rule.op` salvo `matches`, `evaluatePredicate` con cortocircuito, `InvalidRuleError`) con `tests/unit/predicates.test.ts`: tabla operador × tipo de valor (string, number, boolean, array, objeto, sin valor) que cubre cada escenario de los requisitos "Lectura numérica", `eq`/`neq`, orden, `contains`/`startsWith`, `isSet`/`isEmpty`, `all`/`any` y "Falta value"
- [x] 2.6 Gate: `pnpm --filter @franca/engine test` y `typecheck` en verde

## 3. `matches` lineal — dueño: `popi:backend-developer`

- [x] 3.1 `src/regex/parse.ts`: AST del subconjunto de la spec y motivo de rechazo para referencias, lookarounds, `(?` no admitidos y nombres repetidos comparados tras decodificar sus escapes (`(?<a>x)(?<\u0061>y)` es repetido); `tests/unit/regex-parse.test.ts` con un caso por construcción admitida y por rechazada
- [x] 3.2 `src/regex/compile.ts`: tamaño calculado sobre el AST antes de expandir (definición de la spec) y programa NFA; tests de tamaño con `a{1000}` (admitido), `a{1001}` y `(a{40}){40}` (rechazados) y de que `(a{1000}){1000}` se rechaza sin construir el programa
- [x] 3.3 `src/regex/match.ts`: Pike VM booleana con átomos delegados a `RegExp` nativo sobre un code point (D8) y contador interno de trabajo; `tests/unit/regex-match.test.ts` verifica:
  - diferencial contra `new RegExp(p, 'u').test(s)` con PRNG de semilla fija, ≥ 5000 casos y textos ≤ 12 caracteres, con un alfabeto pequeño (p. ej. `a`, `b` y un carácter no ASCII) compartido por el generador de patrones y el de textos, y una aserción de que al menos el 20 % de los casos da `true` y al menos el 20 % da `false` (el test falla si el diferencial es vacuo);
  - corpus curado: emoji, `\p{L}`, `\b`, perezosos, grupos anidados y con nombre, y bucles que casan vacío y aserciones bajo cuantificador: `(?:\b)*`, `(a|)*`, `(?:^|a)+`, `(?:$)*`;
  - generador de patrones fuera del subconjunto (referencias, lookahead, lookbehind, modificadores en línea, nombres repetidos incluso con escapes distintos) que afirma que todos se rechazan;
  - invariante "si el parser acepta, el nativo compila" sobre todos los patrones generados;
  - cota de trabajo ≤ (n+1)·m
- [x] 3.4 Conectar `matches` en `OPERATORS` (value no string, sintaxis inválida, no admitida y tamaño → `InvalidRuleError`) y cubrir en `tests/unit/predicates.test.ts` los escenarios de los requisitos "Operador matches", "Evaluación de matches en tiempo lineal" (dentro del timeout por defecto de Vitest), "Construcciones admitidas en matches", "Tamaño máximo del patrón de matches" y los de `matches` de "Reglas que no se pueden evaluar"
- [x] 3.5 Gate: `pnpm --filter @franca/engine test` en verde y ninguna llamada a `.test`/`.exec`/`.match` del patrón completo del autor en `src/regex/` ni en `src/predicates.ts` (revisión con `grep`)

## 4. Sesión, nodos y API pública — dueño: `popi:backend-developer`

- [x] 4.1 `src/nodes/*` (`message`, `set`, `jump`, `condition`, `end`, `unsupported`; `message`, `end` y `set` convierten `ValueTooLargeError` en `value_too_large`) y la tabla `EXECUTORS` tipada como en D3; verificar con `typecheck` que quitar una entrada de la tabla rompe la compilación
- [x] 4.2 `src/state.ts` (`buildState`, `parseState`) con `tests/unit/state.test.ts`: `{}`, versión desconocida, cada campo con tipo erróneo, incoherencias `status`/`outcome`/`error` y valores no JSON → `null`
- [x] 4.3 `src/run.ts` (bucle con límite de 200 comprobado antes de mirar el tipo, despacho, resultado) y `src/session.ts` (`startSession`, `continueSession` con el orden de comprobaciones de la spec; validan `toJsonForm(flow)`); exportar desde `src/index.ts` solo lo de D2 y ampliar `tests/exports.test.ts` para que la lista de exports en runtime sea exactamente la de D2
- [x] 4.4 Fixtures en `tests/fixtures/*.json` y constructores en `tests/helpers/flows.ts`, con `tests/fixtures.test.ts` que comprueba que todo fixture pasa `validateFlow`
- [x] 4.5 `tests/scenarios/*.test.ts`: un `it` por cada `#### Scenario` restante de la spec (validación, forma JSON, arranque, contacto, estado, eventos, retardo con temporizadores simulados, nodos, tamaño máximo de un texto renderizado, límite de pasos, no soportados con los dos ejemplos de `packages/spec/examples/`, determinismo, privacidad, continuar)
- [x] 4.6 `tests/examples.test.ts`: para cada fichero de `packages/spec/examples/` (por ruta relativa), arrancar no se rechaza y termina en `ended` o en `unsupported_node`
- [x] 4.7 `tests/golden.test.ts` con `toMatchFileSnapshot` en `tests/golden/` para cada fixture y ejemplo; verificar que los ficheros generados coinciden con el ejemplo de resultado de `design.md` D2 para `captacion-leads`
- [x] 4.8 `tests/parity.test.ts`: nodos de `schema` = claves de `EXECUTORS`, `rule.op` = claves de `OPERATORS` y códigos emitidos ∈ arrays de códigos
- [x] 4.9 `tests/properties.test.ts`: determinismo, entradas congeladas y sin cambios, ida y vuelta JSON de cada estado, ningún método de `console` llamado (sesiones que terminan, fallan y se rechazan); y `tests/static-guard.test.ts` con los tokens prohibidos de D10
- [x] 4.10 Añadir a la wiki (`/popi:wiki add`, con su línea en el índice) `decision-matches-regex-lineal` (por qué no `RegExp` nativo ni timeout ni RE2) (incluida la dependencia de `\p{…}` con la versión de Unicode del V8 del host) y `gotcha-variables-nombre-proto` (por qué `Map` y `Object.fromEntries`), con `metadata.enforcement` apuntando a sus tests; verificar con `pnpm wiki:lint`
- [x] 4.11 Gate: `pnpm check` en verde

## 5. Verificación — dueño: `popi:qa-tester` (modo verificación de spec)

- [x] 5.1 Matriz escenario → test: cada `#### Scenario` de `specs/flow-engine/spec.md` tiene un `it` con su título; listar los que falten y devolverlos a la fase 4
- [x] 5.2 Validar cada test negativo rompiendo el código temporalmente y viendo que falla: escritura en consola, mutación del flujo o del contacto, aliasing de un `default` json con el estado, un valor de variable en un mensaje de error, quitar el corte por `MAX_RENDERED_LENGTH` (el escenario de duplicación debe fallar), un `Date` en `src/` (guarda estática), ejecución del patrón completo con `RegExp` nativo (el test de retroceso catastrófico debe colgarse o agotar el timeout); revertir y dejar constancia en el informe
- [x] 5.3 Revisar que el diff solo añade `packages/engine/**` y cambia `pnpm-lock.yaml`, `.claude/popi.json`, `CLAUDE.md`, los artefactos de `openspec/changes/engine-base/` y la wiki (`.claude/wiki/` y su índice) (`git diff --stat main...`)
- [x] 5.4 Gate: ejecutar en local la secuencia de la CI (`pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e && pnpm validate`) y `openspec validate engine-base --strict`; informar solo de lo ejecutado

## 6. Seguimiento (no bloquea verify/archive)

- [ ] 6.1 FOLLOW-UP: reglas semánticas en `packages/spec` para regex de `matches` inválida, no admitida o demasiado grande, `value` ausente en operadores que lo necesitan y `default` incompatible o no JSON; el subconjunto de regex tendría que vivir en `@franca/spec` (o un paquete común) porque la spec no puede depender del motor
- [ ] 6.2 FOLLOW-UP: que `templateVars` del validador no trate `rule.value` como plantilla (hoy exige declarar las variables de un `value` literal como `"{{zz}}"`)
- [ ] 6.3 FOLLOW-UP: anotar en RFC-0001 (cuando exista su texto) que los strings de `set` son plantillas, `rule.value` es literal, `alt` es plantilla, el subconjunto lineal de `matches` y la forma JSON del flujo
- [ ] 6.4 FOLLOW-UP (features 2, 3 y 6): límite de longitud del texto que entra desde fuera: respuesta de `input` (2), valores que mapea `http` desde la respuesta (3) y valores de contacto que inyecta el host (6)
- [ ] 6.5 FOLLOW-UP (feature 6): versión del flujo en el estado o junto a él y bloqueo optimista para que dos `continueSession` concurrentes sobre el mismo estado no se apliquen ambas; tope de CPU por avance en el host (worker o timeout fuera del motor)
- [ ] 6.6 FOLLOW-UP (feature 7): filtrar esquemas de URL peligrosos (`javascript:`, `data:` según el tipo) en `url` de image/video/audio/embed antes de pintarlas, y no mostrar al usuario final el `message` de los eventos `error` (es para el autor y el host)
- [ ] 6.7 FOLLOW-UP: exportar `TEMPLATE_VAR` desde `@franca/spec` para que el motor lo importe en vez de copiarlo
- [ ] 6.8 FOLLOW-UP: script `lint` para los paquetes (`spec` y `engine`) y valorar mutación sobre `predicates` y `regex` cuando el motor tenga los ocho nodos
- [ ] 6.9 FOLLOW-UP: regla semántica en `@franca/spec` para variables con el mismo `name` (el validador las acepta, también con distinto `scope`, y el motor se queda con la primera declaración)

## Workflow follow-up

- Revisión adversarial del diseño (`popi:architecture-reviewer`) antes de implementar.
- Verificar y archivar el cambio en la misma rama antes del merge (`/opsx:archive`).
