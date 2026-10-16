---
name: harness-stop-hook-y-mutate
description: El Stop hook lanza pnpm check al terminar un turno y, si mutate está reescribiendo src/, compila dist/ mutado; el candado y los huérfanos de Vitest
metadata:
  type: project
  enforcement: packages/engine/tests/guard-mutate.test.ts, packages/engine/tests/mutate-script-orphans.test.ts
---

# El Stop hook y `mutate` no pueden solaparse

**Qué pasó (`engine-llm`, 2026-10-17):** `mutate` reescribe un fichero de `src/` por cada mutación y lo restaura al terminar. El Stop hook del plugin popi ejecuta `pnpm check` al acabar un turno; si coincide con una mutación, `turbo` compila `packages/engine` con el `src/` mutado y deja un `dist/` falso. Los paquetes que dependen de él (`@franca/llm-anthropic` importa `@franca/engine` desde `dist/`) dan entonces veredictos falsos: una mutación «sobrevive» o «muere» por el `dist/` y no por sus tests.

**Cómo se evita:**
- `scripts/guard-mutate.mjs` (raíz) sale con error «mutación en curso» si existe `packages/*/.mutate-backup/`. Es el primer paso de los scripts `check` y `build` del `package.json` raíz. No se puso como tarea previa de `turbo` porque turbo no tiene un hook global antes de `build` sin añadir una tarea a cada paquete; `check` y `build` cubren el camino del Stop hook y de la CI. Quien ejecute `turbo run` o el `build` de un paquete a mano se salta el candado.
- `mutate.mjs` crea `.mutate-backup/` (el candado) antes de la línea base, no en la primera mutación: así un `check` que arranque durante la línea base también se detiene. Un `check` que ya estaba en marcha antes de lanzar `mutate` no se entera: no lances `mutate` con otro `check` corriendo. Si `mutate` muere con SIGKILL el candado se queda (con `src/` mutado): vuelve a lanzar `mutate` en ese paquete, que restaura y lo quita.
- El envoltorio `packages/llm-anthropic/scripts/mutate.mjs` recompila `@franca/engine` antes de su línea base.
- Tras cualquier mutación del motor, recompila `packages/engine` antes de confiar en su `dist/` (y compara su hash con una compilación limpia).

**Huérfanos de Vitest:** un mutante con un bucle infinito agota el tiempo; matar solo al proceso de Vitest dejaba a sus workers (pool `forks`) girando al 100 % de CPU con el padre 1. `mutate.mjs` lanza Vitest con `detached` y mata el grupo entero con `process.kill(-pid, 'SIGKILL')`, también en `SIGINT`/`SIGTERM` (con `detached`, Ctrl-C ya no llega a Vitest) y al cerrarse. En Windows no hay grupos y solo se mata el proceso.

No ejecutes `mutate` mientras otro proceso de test o de compilación corre.
