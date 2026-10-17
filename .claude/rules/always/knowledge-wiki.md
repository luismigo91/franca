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
- [ajv con allErrors es cuadrático](../../wiki/gotcha-ajv-allerrors-cuadratico.md) — por qué validateFlow valida por piezas, con presupuesto de detalle, tope de issues y collapse lineal
- [json-schema-to-typescript y las tuplas](../../wiki/gotcha-json-schema-to-typescript-tuplas.md) — ignoreMinAndMaxItems, no maxItems -1
- [new URL de WHATWG normaliza en silencio](../../wiki/gotcha-url-whatwg-normaliza.md) — por qué url (input y http) rechaza controles, invisibles, % en el host e IPs antes de parsear
- [Variables llamadas __proto__ o constructor](../../wiki/gotcha-variables-nombre-proto.md) — por qué el motor usa Map y Object.fromEntries
- [Prisma no modela la colación](../../wiki/gotcha-prisma-no-modela-colacion.md) — el COLLATE "C" de flows.id y flow_versions.flow_id va a mano en la migración; vale para el flow_id de tablas futuras
- [Turbo filtra variables de entorno](../../wiki/gotcha-turbo-filtra-variables-de-entorno.md) — por qué DATABASE_URL, HOST y PORT van en passThroughEnv
- [jsonb reordena las claves](../../wiki/gotcha-jsonb-reordena-claves.md) — por qué el flujo se guarda como text con un único JSON.stringify
- [query_timeout de pg duplica la espera](../../wiki/gotcha-pg-query-timeout-duplica-con-rollback.md) — por qué query_timeout es 4 s (el ROLLBACK sobre una conexión muda espera otro) y statement_timeout 3,5 s: un servidor mudo acaba en 8 s y no en 16 s
- [node:http sobre un socket propio](../../wiki/gotcha-node-http-createconnection-y-proxy.md) — agent false ignora createConnection, keep-alive y chunked por defecto, el 101 cierra sin response y NODE_USE_ENV_PROXY desvía globalAgent y fetch
- [Next escucha antes de cargar la config](../../wiki/gotcha-next-escucha-antes-de-cargar-la-config.md) — por qué FRANCA_API_URL la valida el lanzador y no next.config
- [type=email recorta el valor](../../wiki/gotcha-input-email-recorta-el-valor.md) — por qué las preguntas de texto del chat usan type=text con inputMode
- [Cache Components: Activity y prerender](../../wiki/gotcha-cache-components-activity-y-prerender.md) — un GET sin connection() se prerenderiza y Activity conserva rutas y DOM
- [next dev fuera de la frontera](../../wiki/gotcha-next-dev-fuera-de-la-frontera.md) — recursos de desarrollo antes de proxy.ts, inspector y DNS rebinding; por qué el preload y no un guardián, y --inspect desaconsejado
- [El SDK de Anthropic lee el entorno](../../wiki/gotcha-sdk-anthropic-lee-el-entorno.md) — ANTHROPIC_CUSTOM_HEADERS pisa x-api-key y apiKey/defaultHeaders no lo impiden; por qué la API pasa por una puerta de salida que reconstruye URL y cabeceras

### Decisiones
- [JSON Schema como fuente de verdad](../../wiki/decision-esquema-json-fuente-de-verdad.md) — por qué no Zod ni tipos TS a mano en packages/spec
- [Un intento por llamada http](../../wiki/decision-http-un-intento-por-llamada.md) — por qué el host ejecuta un intento, el motor decide los reintentos y POST/PATCH no se reintentan tras un posible envío
- [Coste y reintentos del llm en el adaptador](../../wiki/decision-llm-coste-y-reintentos-en-el-adaptador.md) — por qué el proveedor calcula el coste, el motor solo aplica el tope de parada y los reintentos son del SDK; lo facturado puede superar lo contabilizado
- [matches con regex lineal propia](../../wiki/decision-matches-regex-lineal.md) — por qué no RegExp nativo, timeout ni RE2 en packages/engine
- [Política de la salida http](../../wiki/decision-salida-http-politica.md) — secretos en variables con origen exacto, resolución mezclada bloqueada entera, http:// solo hacia pares permitidos y nada registrado de una llamada; límites (NAT64 de operador, fecha de IANA)
- [Frontera local de la web](../../wiki/decision-frontera-local-de-la-web.md) — proxy en el servidor y no lista de orígenes; Host en bruto más Origin, sin Server Actions ni marcos, ocho operaciones y fetch en modo cors
- [Filtro de URLs sobre lo parseado](../../wiki/decision-filtro-de-urls-sobre-lo-parseado.md) — href y no el texto, sin next/image (SSRF) ni Referer, iframe sin allow-same-origin
- [Reclamar, motor sin transacción, aplicar](../../wiki/decision-reclamacion-fuera-de-transaccion.md) — testigo, epoch del contacto, orden de bloqueos contacto -> conversación y los límites aceptados (COMMIT incierto sin If-Match, entrada reclamada antes de caducar)

### Dominio
- [Rechazos deliberados de input](../../wiki/domain-input-rechazos-deliberados.md) — por qué 1.500, más de 15 cifras o agotar reintentos se rechazan a propósito
- [Solo el nodo llm puede saltar a sí mismo](../../wiki/domain-llm-puede-saltar-a-si-mismo.md) — solo con next, no con onExhausted; el motor conserva turnos y coste en el autosalto
- [Flujos sin secretos](../../wiki/domain-flujos-sin-secretos.md) — secretos y proveedores por nombre, variables pii; la spec avisa, la API rechaza el literal (heurística) y el motor no ve el valor
- [Contacto compartido entre flujos](../../wiki/domain-contacto-compartido-entre-flujos.md) — scope contact compartido por nombre en la instalación, solo se guarda lo que un avance cambió, el default no se guarda y la vista se fija al crear

### Harness e infra
- [La red del test de la salida http](../../wiki/harness-red-del-test-http.md) — sin 127.0.0.2 en macOS: pares y puertos virtuales, la costura solo sustituye resolutor y abridor, canario y mutante de salto
- [El Stop hook y mutate no pueden solaparse](../../wiki/harness-stop-hook-y-mutate.md) — pnpm check compilaba dist/ con un src/ mutado; candado guard-mutate y grupo de procesos de Vitest
- [Falsos positivos de las guardas de entorno](../../wiki/harness-guard-env-falsos-positivos.md) — el deny de settings.json y guard_bash bloquean también el fichero de ejemplo y textos
