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
- [ajv y los errores de oneOf](../../wiki/gotcha-ajv-errores-oneof.md) — por qué validate.ts revalida cada nodo contra la definición de su tipo
- [json-schema-to-typescript y las tuplas](../../wiki/gotcha-json-schema-to-typescript-tuplas.md) — ignoreMinAndMaxItems, no maxItems -1
- [new URL de WHATWG normaliza en silencio](../../wiki/gotcha-url-whatwg-normaliza.md) — por qué url (input y http) rechaza controles, invisibles, % en el host e IPs antes de parsear
- [Variables llamadas __proto__ o constructor](../../wiki/gotcha-variables-nombre-proto.md) — por qué el motor usa Map y Object.fromEntries

### Decisiones
- [JSON Schema como fuente de verdad](../../wiki/decision-esquema-json-fuente-de-verdad.md) — por qué no Zod ni tipos TS a mano en packages/spec
- [Un intento por llamada http](../../wiki/decision-http-un-intento-por-llamada.md) — por qué el host ejecuta un intento, el motor decide los reintentos y POST/PATCH no se reintentan tras un posible envío
- [matches con regex lineal propia](../../wiki/decision-matches-regex-lineal.md) — por qué no RegExp nativo, timeout ni RE2 en packages/engine

### Dominio
- [Rechazos deliberados de input](../../wiki/domain-input-rechazos-deliberados.md) — por qué 1.500, más de 15 cifras o agotar reintentos se rechazan a propósito
- [Solo el nodo llm puede saltar a sí mismo](../../wiki/domain-llm-puede-saltar-a-si-mismo.md) — no es un descuido; maxTurns y onExhausted lo acotan
- [Flujos sin secretos](../../wiki/domain-flujos-sin-secretos.md) — secretos y proveedores por nombre, variables pii; implicaciones para api, editor y motor

### Harness e infra
- [Falsos positivos de las guardas de entorno](../../wiki/harness-guard-env-falsos-positivos.md) — el deny de settings.json y guard_bash bloquean también el fichero de ejemplo y textos
