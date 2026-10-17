# Reglas de desarrollo — índice y nivel de enforcement

Las reglas en `.claude/rules/**` se cargan por contexto en sesiones de Claude Code. **No son enforcement**: el modelo puede ignorarlas y otras herramientas (Cursor, Codex, OpenCode, CI, humanos con git plano) no las ven. La garantía real vive en tests, hooks y CI. Por eso cada regla declara su **nivel**:

- **enforced-invariant** — el contenido lo respalda un test, hook o job de CI. La regla *apunta* al invariante mecánico; no lo sustituye.
- **pointer** — describe un patrón y **apunta a la fuente** (no cita valores que derivan del código). Patrón "lee la fuente".
- **advisory** — guía de juicio o estilo, sin respaldo mecánico. Recomendación, no invariante.

> Regla de oro: una regla con MUST/SHALL cuya violación sería un bug o un incidente de seguridad necesita respaldo mecánico, o se reclasifica a `advisory`. **Un MUST sin enforcement es un deseo.**

| Regla | Nivel | Respaldo mecánico / fuente |
|-------|-------|----------------------------|
| `always/git-commits.md` | advisory (formato) / enforced (push a protegidas) | hook `guard_bash` del plugin popi + `.githooks/pre-push` |
| `always/code-conventions.md` | advisory | oxlint (api) y ESLint (web) cubren parte |
| `always/bugfix-workflow.md` | advisory | nudge `check_testing_pyramid` |
| `always/spec-first.md` | advisory | disciplina de flujo; verify/archive reconcilia después |
| `always/testing-pyramid.md` | pointer | nudge no bloqueante `check_testing_pyramid` |
| `always/knowledge-wiki.md` | advisory (frontera) + enforced (formato) | `scripts/wiki-lint.mjs`; nudge `check_wiki_coverage`; workflow `meta-layer.yml` |
| `always/lecciones-equipo.md` | advisory | lecciones aprendidas; sin respaldo mecánico |
| `always/gotchas.md` | pointer | apunta a código real |
| `backend/architecture.md` | pointer | `apps/api/src/flows/` como referencia; e2e en `apps/api/test/` |
| `backend/routes-and-errors.md` | advisory | e2e por endpoint |
| `frontend/architecture.md` | advisory | ESLint (`apps/web/eslint.config.mjs`), la guarda estática, la paridad y la cobertura de la spec en Vitest (`pnpm check`) y los E2E de Playwright (`pnpm test:e2e`) |
| `spec/flow-spec.md` | enforced-invariant | `packages/spec/tests/validate.test.ts`, `pnpm validate` en CI |

Pendientes cuando existan: auth (`backend/auth-patterns.md`, `frontend/auth-gates.md`) y analítica (`frontend/analytics.md`) de las skills `popi:stack-nestjs` / `popi:stack-nextjs`.

**Invariantes realmente enforced en este repo:**
- Hooks del plugin popi: `guard_bash` (push a `main`, lectura de secretos por shell, escritura por shell de `packages/spec/src/types.ts`) y `guard_files` (secretos y fichero generado).
- `.githooks/pre-push`: bloquea push a `main`, secret-scan con gitleaks si está instalado y `pnpm check`.
- CI (`.github/workflows/ci.yml`): lint, typecheck, build, test, test:e2e y validación de los flujos de ejemplo.
