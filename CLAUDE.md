# Franca

> Generado por `/popi:setup` el 2026-10-16. Manual del proyecto para agentes: resumen, stack, comandos, convenciones y gotchas. Mantenlo corto; el detalle vive en `.claude/rules/`, `.claude/wiki/` y `docs/`.

## Qué es

Flujos conversacionales declarativos: mensajes, preguntas, condiciones, llamadas HTTP y pasos con LLM acotados, descritos en JSON y validados contra una spec pública (RFC-0001, borrador v0). El formato es el contrato entre el editor (`apps/web`) y el backend que guarda y ejecuta flujos (`apps/api`).

Marca de cara al usuario: **Franca**. Repo público con licencia MIT: nada de secretos, PII ni nombres de clientes en el código, los commits o la wiki.

## Stack y estructura

Monorepo pnpm workspaces + Turborepo, Node 22+.

| Paquete | Ruta | Stack | Puerto |
|---|---|---|---|
| `@franca/api` | `apps/api` | NestJS 12 (ESM), Prisma 7 + Postgres, Vitest, oxlint — skill `popi:stack-nestjs` | 3001 |
| `@franca/web` | `apps/web` | Next.js 16 App Router, React 19, Tailwind 4, ESLint, Vitest y Playwright — skill `popi:stack-nextjs`. Escucha solo en `127.0.0.1:3000` | 3000 |
| `@franca/spec` | `packages/spec` | JSON Schema 2020-12 + tipos generados + validador (ajv), tsdown, Vitest | — |
| `@franca/engine` | `packages/engine` | TypeScript puro sin IO (motor de ejecución de flujos), tsdown, Vitest | — |
| `@franca/llm-anthropic` | `packages/llm-anthropic` | Proveedor de Claude para el nodo `llm` (SDK oficial de Anthropic y zod), tsdown, Vitest | — |

Las apps importan `@franca/spec` compilado (`dist/`); turbo lo construye antes (`^build`). Decisiones de diseño en `docs/rfcs/`.

## Comandos

| Acción | Comando |
|---|---|
| Arrancar en local | `pnpm dev` |
| Demo local sin Internet ni credenciales (CRM simulado + `captacion-leads-local` en el chat) | `pnpm install`, `docker compose up -d`, `pnpm --filter @franca/api db:migrate` (con `DATABASE_URL` exportada) y `pnpm dev:demo`; después, `http://localhost:3000` → «Captación de leads (local)». Necesita Postgres, `DATABASE_URL` y los puertos 3000, 3001 y 4010 libres. `pnpm demo:seed` repite la siembra. `pnpm dev` no cambia |
| Verificación canónica (lint + typecheck + tests) | `pnpm check` |
| Postgres local (para `dev` y `test:e2e`) | `docker compose up -d` (parar: `docker compose stop`; borrar datos: `docker compose down -v`) |
| Migraciones de la api | `pnpm --filter @franca/api db:migrate` (aplicar) · `db:migrate:dev --create-only` (escribir una nueva; revisa el SQL) |
| Tests | `pnpm test` (unit) · `pnpm test:e2e` (api y web, **serializados**; **necesita Postgres, `DATABASE_URL`, Chromium instalado y el puerto 3000 libre**: para `pnpm dev` antes) · `pnpm validate` (ejemplos de la spec) |
| Tests de la web | `pnpm --filter @franca/web test` (Vitest, sin red ni API) · `pnpm --filter @franca/web exec playwright install chromium` (una vez) · `pnpm --filter @franca/web mutate` (mutación, a mano) |
| Regenerar tipos de la spec | `pnpm --filter @franca/spec generate` |
| Test en vivo del adaptador de Claude (opcional, gasta céntimos, nunca en CI) | `FRANCA_LIVE_ANTHROPIC=1 pnpm --filter @franca/llm-anthropic test:live` |
| Lint de la wiki | `pnpm wiki:lint` |

`pnpm check` es el **veredicto canónico**: se ejecuta en local (pre-push), en el Stop hook y su equivalente en CI. **No necesita Postgres ni `DATABASE_URL`** (lint, typecheck y unit); `test:e2e` sí. Informa solo de checks realmente ejecutados; nunca describas como pasado un check que no corriste.

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
- El cliente de Prisma se genera en `apps/api/src/generated/prisma` (ignorado por git): turbo lo regenera con `db:generate` antes de compilar, lintar y testear. Si una app sin turbo falla con `Cannot find module '../generated/prisma/client.js'`, ejecuta `pnpm --filter @franca/api db:generate`.
- Next.js 16 rompe APIs anteriores: lee `apps/web/node_modules/next/dist/docs/` antes de asumir.
- El formato de flujo vive solo en `@franca/spec`; ni la api ni la web redefinen tipos o reglas de validación.

## Variables de entorno

Solo nombres; los valores viven en ficheros de entorno locales que nunca se leen, copian ni versionan.

- `DATABASE_URL` (api, obligatoria): cadena de conexión a Postgres. Con `docker compose up -d`, la del servicio `postgres` (usuario y base `franca`, sin contraseña, `127.0.0.1:5432`). La leen `pnpm dev` y `pnpm test:e2e` del entorno de la shell; el fichero de ejemplo de variables lo crea una persona.
- `HOST` (api, por defecto `127.0.0.1`): solo admite `127.0.0.1` y `::1` mientras la api no tenga autenticación; cualquier otro valor, también vacío, impide arrancar.
- `PORT` (api, por defecto 3001; `0` elige un puerto libre)
- `FRANCA_API_URL` (web, opcional): dirección de la API (por defecto `http://127.0.0.1:3001`). Solo `http://` hacia `127.0.0.1`, `[::1]` o `localhost`, con puerto opcional y sin ruta, consulta, usuario ni contraseña; un valor inválido, también vacío, impide arrancar (el lanzador `apps/web/scripts/local-only.mjs` lo valida antes de `next`)
- `FRANCA_ANTHROPIC_API_KEY` (api, opcional): clave de Claude del proveedor `principal` de los nodos `llm` de las conversaciones. Sin ella, o vacía, la API arranca y cada nodo `llm` falla con `llm_not_configured` (queda un aviso en el registro). La API **ignora** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` y `ANTHROPIC_CUSTOM_HEADERS` (las del SDK): sus peticiones llevan solo esta clave y van solo a `api.anthropic.com`. Solo `pnpm dev` la recibe (turbo `passThroughEnv`), nunca los e2e
- `FRANCA_CONVERSATION_COST_LIMIT_USD` (api, opcional): presupuesto de coste `llm` por conversación en dólares (decimal de 0, excluido, a 1000, con dígitos y como mucho un punto; por defecto `0.5`); un valor inválido, también vacío, impide arrancar
- `FRANCA_SECRET_<NOMBRE>` (api, opcional): valor completo de la cabecera del secreto `<NOMBRE>` (p. ej. `Bearer …`) de los nodos `http`: de 1 a 8192 caracteres ASCII visibles, espacios o tabuladores, sin blancos en los extremos. Un secreto solo existe si `FRANCA_HTTP_SECRET_ORIGINS` lo nombra; una variable suelta se ignora y la línea de arranque lo dice. Un nombre listado en `FRANCA_HTTP_SECRET_ORIGINS` sin su variable (o con ella vacía), o un valor no válido, impide arrancar (el mensaje nombra la variable, nunca el valor)
- `FRANCA_HTTP_SECRET_ORIGINS` (api, opcional): entradas `NOMBRE=origen` separadas por comas y sin espacios; el origen, escrito exactamente como su serialización WHATWG (`https://crm.example.com`, sin `/` final ni puerto por defecto), es el único al que viaja ese secreto. Un nombre puede repetirse con otros orígenes; una entrada vacía o mal escrita impide arrancar
- `FRANCA_HTTP_ALLOWED_DESTINATIONS` (api, opcional): pares `dirección:puerto` separados por comas (IPv4 o IPv6 entre corchetes) que la salida http permite aunque no sean unicast global, también con `http://`. Vacía o ausente, ninguno; una entrada vacía o mal escrita impide arrancar
- `FRANCA_HTTP_LOCAL_NAMES` (api, opcional): entradas `nombre=dirección` separadas por comas y sin espacios. El nombre es un host de la `url` de un nodo `http` escrito en minúsculas y terminado en `.test` (RFC 6761); la dirección es una IPv4 de `127.0.0.0/8` en decimal sin ceros a la izquierda, o `[::1]`. Un nombre puede repetirse. La salida http lo resuelve a esas direcciones sin preguntar al DNS, pero **no salta** `FRANCA_HTTP_ALLOWED_DESTINATIONS`: sin el par permitido, la llamada se bloquea. Vacía o ausente, no hay nombres; una entrada vacía o mal escrita impide arrancar. La fija `pnpm dev:demo` (`crm.franca.test=127.0.0.1`) y es un error definirla en la shell antes
- `NODE_EXTRA_CA_CERTS` (la lee Node, opcional): autoridades TLS extra de la máquina (una CA corporativa) que también acepta la salida http. `NODE_TLS_REJECT_UNAUTHORIZED` y las variables de proxy (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NODE_USE_ENV_PROXY`) **no** cambian nada en la salida http
- `FRANCA_POSTGRES_PORT` (opcional): puerto local del contenedor de Postgres de `docker-compose.yml` (por defecto 5432)
- `ANTHROPIC_API_KEY` (la lee el SDK de Anthropic en el cliente por defecto de `@franca/llm-anthropic`; solo para el test en vivo, exportada en la shell)
- `FRANCA_LIVE_ANTHROPIC` (`1` activa el test en vivo del adaptador; con `CI` exige además `FRANCA_LIVE_ANTHROPIC_CI=1`)
