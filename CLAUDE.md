# Franca

> Generado por `/popi:setup` el 2026-10-16. Manual del proyecto para agentes: resumen, stack, comandos, convenciones y gotchas. Mantenlo corto; el detalle vive en `.claude/rules/`, `.claude/wiki/` y `docs/`.

## Qué es

Flujos conversacionales declarativos: mensajes, preguntas, condiciones, llamadas HTTP y pasos con LLM acotados, descritos en JSON y validados contra una spec pública (RFC-0001, borrador v0). El formato es el contrato entre el editor (`apps/web`) y el backend que guarda y ejecuta flujos (`apps/api`).

Marca de cara al usuario: **Franca**. Repo público con licencia MIT: nada de secretos, PII ni nombres de clientes en el código, los commits o la wiki.

## Stack y estructura

Monorepo pnpm workspaces + Turborepo, Node 22+.

| Paquete | Ruta | Stack | Puerto |
|---|---|---|---|
| `@franca/api` | `apps/api` | NestJS 12 (ESM), Vitest, oxlint — skill `popi:stack-nestjs` | 3001 |
| `@franca/web` | `apps/web` | Next.js 16 App Router, React 19, Tailwind 4, ESLint — skill `popi:stack-nextjs` | 3000 |
| `@franca/spec` | `packages/spec` | JSON Schema 2020-12 + tipos generados + validador (ajv), tsdown, Vitest | — |
| `@franca/engine` | `packages/engine` | TypeScript puro sin IO (motor de ejecución de flujos), tsdown, Vitest | — |
| `@franca/llm-anthropic` | `packages/llm-anthropic` | Proveedor de Claude para el nodo `llm` (SDK oficial de Anthropic y zod), tsdown, Vitest | — |

Las apps importan `@franca/spec` compilado (`dist/`); turbo lo construye antes (`^build`). Decisiones de diseño en `docs/rfcs/`.

## Comandos

| Acción | Comando |
|---|---|
| Arrancar en local | `pnpm dev` |
| Verificación canónica (lint + typecheck + tests) | `pnpm check` |
| Tests | `pnpm test` (unit) · `pnpm test:e2e` (api) · `pnpm validate` (ejemplos de la spec) |
| Regenerar tipos de la spec | `pnpm --filter @franca/spec generate` |
| Test en vivo del adaptador de Claude (opcional, gasta céntimos, nunca en CI) | `FRANCA_LIVE_ANTHROPIC=1 pnpm --filter @franca/llm-anthropic test:live` |
| Lint de la wiki | `pnpm wiki:lint` |

`pnpm check` es el **veredicto canónico**: se ejecuta en local (pre-push), en el Stop hook y su equivalente en CI. Informa solo de checks realmente ejecutados; nunca describas como pasado un check que no corriste.

## Ramas y PRs

- Una sola rama larga: `main` (integración y producción a la vez). Las ramas de trabajo salen de `main` y vuelven por PR (`gh pr create --base main`).
- Push directo a `main` bloqueado por hook y por `.githooks/pre-push`.
- **Nunca** crear rama, hacer push, abrir PR ni mergear sin petición explícita del usuario. Un "vale" a una pregunta compuesta no autoriza un merge.
- Conventional commits (`.claude/rules/always/git-commits.md`); `git add` de rutas explícitas (nunca `-A`).

## Flujo de trabajo con agentes

Pipeline por roles del plugin popi (`/popi:feature`): `product-analyst` → **aprobación humana** → `architect` → `architecture-reviewer` → **aprobación humana** → `backend-developer` → `qa-tester` → `frontend-developer` → `qa-tester` → verificación final. Un especialista activo cada vez; los especialistas no crean ramas, no hacen push ni aprueban su propio trabajo.

- Decisiones de **comportamiento** van primero a la spec (`.claude/rules/always/spec-first.md`, "test del usuario"). Ojo: "spec" aquí son las specs funcionales de features en `openspec/`; el formato de flujo es otra cosa (`packages/spec`).
- Specs funcionales con OpenSpec en `openspec/` (`openspec/config.yaml`): `/opsx:propose` → `/opsx:apply` → `/opsx:archive`. Plantilla de contenido en `/popi:spec`.
- Verificación antes de dar algo por hecho: `/popi:verify`.

## Wiki de conocimiento tácito

`.claude/wiki/` guarda lo que **no se puede grep-ear**: por qué se decidió algo, gotchas, callejones sin salida. Su índice se auto-carga desde `.claude/rules/always/knowledge-wiki.md`: **léelo antes de tocar un área**. Formato y frontera en `.claude/wiki/README.md`; alta con `/popi:wiki add`.

## Gotchas del proyecto

Lista completa en `.claude/rules/always/gotchas.md`. Los imprescindibles:

- `packages/spec/src/types.ts` es generado: se cambia el esquema y se regenera.
- `apps/api` es ESM: imports relativos con `.js`.
- Next.js 16 rompe APIs anteriores: lee `apps/web/node_modules/next/dist/docs/` antes de asumir.
- El formato de flujo vive solo en `@franca/spec`; ni la api ni la web redefinen tipos o reglas de validación.

## Variables de entorno

Solo nombres; los valores viven en ficheros de entorno locales que nunca se leen, copian ni versionan.

- `PORT` (api, por defecto 3001)
- `ANTHROPIC_API_KEY` (la lee el SDK de Anthropic en el cliente por defecto de `@franca/llm-anthropic`; solo para el test en vivo, exportada en la shell)
- `FRANCA_LIVE_ANTHROPIC` (`1` activa el test en vivo del adaptador; con `CI` exige además `FRANCA_LIVE_ANTHROPIC_CI=1`)
