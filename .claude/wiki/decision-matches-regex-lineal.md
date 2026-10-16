---
name: decision-matches-regex-lineal
description: Por qué el operador matches del motor usa una Pike VM propia con átomos nativos y no RegExp nativo, timeout ni RE2
metadata:
  type: project
  enforcement: packages/engine/tests/unit/regex-match.test.ts, packages/engine/tests/unit/regex-adversarial.test.ts, packages/engine/tests/unit/input-hypotheses.test.ts, packages/engine/tests/static-guard.test.ts
---

# `matches` se evalúa con un motor lineal propio, nunca con el `RegExp` nativo

**Decisión (2026-10-16, `engine-base`):** el patrón de `matches` lo escribe el autor del flujo y el texto lo aporta el usuario. `packages/engine/src/regex/` lo evalúa con una simulación Thompson/Pike (O(n·m), sin retroceso). El `RegExp` nativo solo **compila** el patrón para validar la sintaxis y prueba cada átomo sobre **un** code point.

**Qué se descartó y por qué:**
- `RegExp` nativo con límite de longitud: `/^(a+)+$/u` tarda ~1,3 s con 26 caracteres y se duplica por carácter; un límite que lo evite rompe casos legítimos y no cubre los polinómicos (`\d*\d*\d*x`).
- Heurística de "construcciones peligrosas": incompleta (`(a|a)*b` pasa).
- Timeout (worker, `vm`): rompe el determinismo del motor, que no debe depender de la velocidad de la máquina.
- Port de RE2 en JS: dependencia nueva y semántica distinta de ECMAScript (`.`, `\s`, `\p{Script=…}`).

**Consecuencias que no se ven en el código:**
- La linealidad depende de acotar las **instrucciones emitidas**, no solo los átomos: una alternativa vacía emite split+jump y un `*` emite split+jump aunque su contenido pese 0. Con la métrica antigua, `(?:(?:(?:|){1000}){1000}){1000}a` agotaba el heap antes de evaluar nada. `patternSize` cuenta lo que se emite y el invariante `instrucciones ≤ 2·tamaño + 1` (m ≤ 2001) se comprueba por test en cada patrón aceptado; quien toque el compilador debe mantenerlo.
- Un contador `{n,m}` se lee acotado a `MAX_SAFE_INTEGER`: con 309 cifras `Number()` da `Infinity`, que significaría «sin tope».
- Se rechazan referencias, lookarounds, modificadores en línea y nombres de grupo repetidos aunque el V8 del host ya los rechace (Node 22) o los admita en el futuro: así el resultado no depende de la versión.
- `\p{…}` depende de la versión de Unicode del V8 del host: un carácter añadido a Unicode puede clasificarse distinto entre versiones de Node. Se acepta (Node ≥ 22).
- El oráculo diferencial contra el nativo no es fiable en un caso: V8 prueba `\B` entre las dos mitades de un par sustituto aunque el modo `u` lo prohíbe (`/\B/u.test('a😀b')` da `true`). El motor sigue la spec (`false`) y el diferencial salta esos casos.
- La reutilización ya existe: `validation.pattern` del nodo `input` usa este mismo matcher (`src/input/validation.ts`), con la misma cota; la respuesta se limita antes a 4096 unidades (`MAX_INPUT_LENGTH`) para que el coste siga acotado.
