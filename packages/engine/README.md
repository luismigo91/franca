# @franca/engine

Motor de ejecución de flujos de Franca. TypeScript puro: sin IO, sin reloj, sin aleatoriedad y sin escribir en consola. Con el mismo flujo y las mismas entradas devuelve siempre el mismo resultado. Comportamiento en `openspec/changes/engine-base/specs/flow-engine/spec.md`; decisiones en `design.md` de ese mismo cambio.

Ejecuta flujos del formato de [`@franca/spec`](../spec): mensajes, `set`, `jump`, `condition` y `end`. Los nodos `input`, `http` y `llm` aún no están soportados: la sesión falla con `unsupported_node`.

## API

| Export | Qué es |
|---|---|
| `startSession(request, host?)` | Arranca una sesión con `{ flow, contact? }` y la ejecuta hasta que termina o falla. |
| `continueSession(request, host?)` | Recibe `{ flow, state, input }`. En esta versión siempre se rechaza (`session_not_active` si el estado es válido). |
| `STATE_VERSION`, `MAX_STEPS_PER_ADVANCE`, `DEFAULT_TYPING_DELAY_MS`, `MAX_PATTERN_SIZE`, `MAX_RENDERED_LENGTH`, `MAX_NESTING_DEPTH`, `MAX_PATTERN_DEPTH` | Constantes del contrato. |
| `SESSION_ERROR_CODES` | `unsupported_node`, `invalid_rule`, `step_limit_exceeded`, `value_too_large`. |
| `REJECTION_CODES` | `invalid_flow`, `invalid_contact`, `invalid_state`, `state_mismatch`, `session_not_active`. |
| Tipos | `JsonValue`, `VariableValue`, `EngineEvent` (y sus variantes), `SessionState`, `SessionResult`, `Rejection`, `AdvanceResult`, `EngineHost`, etc. |

## Contrato

- `flow`, `contact` y `state` llegan como `unknown` y se validan en cada operación. El flujo se valida y se ejecuta en su forma JSON (`JSON.parse(JSON.stringify(flow))`).
- Un rechazo es un valor (`{ ok: false, code, message }`), no una excepción. Una sesión que falla es `ok: true` con `status: 'failed'`.
- Una promesa rechazada es un defecto del motor, o un flujo construido en memoria que no se puede serializar (ciclos, `bigint`). Los flujos reales llegan como JSON.
- El estado es JSON puro y el host lo trata como opaco, salvo `status`, `outcome`, `error` y `contact`.
- La salida es texto plano: el cliente no debe interpretarla como HTML ni Markdown. El motor no espera `typingDelayMs`: lo aplica el cliente.
- Los mensajes de error no incluyen valores de variables ni de contacto.

## Desarrollo

```sh
pnpm --filter @franca/engine test       # Vitest (sin --watch)
pnpm --filter @franca/engine typecheck
pnpm --filter @franca/engine build      # dist/index.mjs + dist/index.d.mts
```

Depende de `@franca/spec` compilado (`dist/`). Con turbo (`pnpm check`, `pnpm build`) se construye antes; si ejecutas los scripts del paquete sin turbo y falla `Cannot find module '@franca/spec'`, ejecuta antes `pnpm --filter @franca/spec build`.

Los golden de `tests/golden/` se regraban con `pnpm --filter @franca/engine test -u` y se revisa el diff; no se editan a mano.
