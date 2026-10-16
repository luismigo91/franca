---
name: gotcha-spec-watch-borra-dist
description: Con limpieza activada, tsdown --watch borraba dist/ de @franca/spec mientras Nest compilaba y la API arrancaba rota
metadata:
  type: project
  enforcement: none — el arreglo es el flag --no-clean del script dev; un test de arranque concurrente cuesta más de lo que protege
---

# `pnpm dev` arrancaba la API con "Cannot find module '@franca/spec'"

**Qué pasó:** 2026-10-16, al conectar la API con la spec. `pnpm build` y los tests pasaban, pero `pnpm dev` dejaba a Nest en watch con `TS2307: Cannot find module '@franca/spec'`.

**Causa real:** turbo compila la spec (`^build`) y después arranca a la vez los `dev` de todos los paquetes. El de la spec (`tsdown --watch`) tenía `clean: true` (`packages/spec/tsdown.config.ts`) y vaciaba `dist/` al arrancar, justo cuando `nest start --watch` resolvía `@franca/spec` → `dist/index.d.mts`.

**Cómo se evita:** el script `dev` de `packages/spec/package.json` es `tsdown --watch --no-clean`. El `build` sí limpia. No quites el flag; si hace falta limpiar en dev, para la API primero.

Relacionado: [[decision-esquema-json-fuente-de-verdad]].
