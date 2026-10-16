# Wiki de conocimiento (`.claude/wiki/`) — frontera + índice

> **Enforcement tier: advisory (frontera) + enforced (formato).** El FORMATO lo comprueba `scripts/wiki-lint.mjs` (`/popi:wiki lint`, Stop hook y CI): frontmatter válido, línea en este índice y `metadata.enforcement` en todo `gotcha-*` nuevo o modificado. Formato completo: `.claude/wiki/README.md`.
>
> **Este fichero SÍ se auto-carga en contexto** (como todo `.claude/rules/**`). Por eso el **índice de abajo** es la vía fiable por la que Claude "ve" la wiki cada sesión. Los ficheros de hecho viven en `.claude/wiki/` y se leen **bajo demanda**. **Al añadir o renombrar un hecho, actualiza su línea aquí.**

`.claude/wiki/` es la base de conocimiento **tácito** del proyecto: lo que **no puedes grep-ear**. La escribe y la lee Claude; está versionada en git.

## Frontera anti-deriva (qué va y qué NO)

- **SÍ va:** por qué se decidió X, gotchas, callejones sin salida, trampas cross-cutting, invariantes no obvios, decisiones de dominio que parecen bugs.
- **NO va:** valores o estructura que derivan del código, comportamiento canónico (specs), docs de humanos (`docs/`), estado de un cambio en vuelo, información personal.

## Split por tipo

`type: project` / `type: reference` → `.claude/wiki/` (repo, compartido). `type: user` / `type: feedback` → `~/.claude` (personal, nunca al repo).

## Índice de la wiki

**Antes de ponerte a trabajar en algo, revisa este índice.** Si hay un hecho cuyo gancho toca tu tarea, **abre ese fichero y léelo antes de actuar**. No hace falta leerlos todos; solo el relevante.

### Gotchas
- [tsdown --watch borra dist/ de la spec](../../wiki/gotcha-spec-watch-borra-dist.md) — por qué el dev de @franca/spec lleva --no-clean

### Decisiones
- [JSON Schema como fuente de verdad](../../wiki/decision-esquema-json-fuente-de-verdad.md) — por qué no Zod ni tipos TS a mano en packages/spec

### Dominio
<!-- - [Título](../../wiki/domain-slug.md) — gancho corto -->

### Harness e infra
<!-- - [Título](../../wiki/harness-slug.md) — gancho corto -->
