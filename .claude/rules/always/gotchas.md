# Gotchas del proyecto

> **Enforcement tier: pointer.** Cada gotcha apunta a código real y, si es posible, al test/hook que impide que vuelva a morder. Los gotchas con historia detrás van a la wiki (`.claude/wiki/gotcha-*.md`); aquí solo la lista corta que hay que tener siempre en la cabeza.

- **`packages/spec/src/types.ts` es generado.** Se cambia editando `packages/spec/flow.schema.json` y ejecutando `pnpm --filter @franca/spec generate`. Enforced: test "tipos" en `packages/spec/tests/validate.test.ts` + `protectedFixtures` en `.claude/popi.json`.
- **Las apps consumen `@franca/spec` desde `dist/`, no desde `src/`.** Hay que compilarla antes: turbo lo hace con `dependsOn: ["^build"]` (`turbo.json`). Si ejecutas una app sin turbo y falla `Cannot find module '@franca/spec'`, falta `pnpm --filter @franca/spec build`.
- **El `dev` de la spec usa `tsdown --watch --no-clean`.** Con limpieza, borra `dist/` justo cuando Nest compila y la API arranca rota → [[gotcha-spec-watch-borra-dist]].
- **`apps/api` es ESM (`"type": "module"`).** Los imports relativos llevan extensión `.js` (`./flows/flows.module.js`), aunque el fichero sea `.ts`.
- **Next.js 16 tiene cambios incompatibles.** Antes de usar una API de Next, lee la guía en `apps/web/node_modules/next/dist/docs/` (lo avisa `apps/web/AGENTS.md`).
- **Validar un flujo no es un error HTTP.** `POST /flows/validate` responde siempre 200 y el resultado va en `valid`/`issues` (`apps/api/src/flows/flows.controller.ts`).
- **Las reglas semánticas solo corren si la forma es correcta** (`validateFlow` en `packages/spec/src/validate.ts`). Un flujo con errores de forma no informa todavía de sus errores semánticos.
