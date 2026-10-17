# @franca/api

API de Franca: guarda, versiona y valida flujos conversacionales, y conversa con los publicados (el estado del motor, la transcripción y los valores de contacto viven en Postgres). NestJS 12 (ESM), Prisma 7 y Postgres. El formato de flujo y su validador son de `@franca/spec`; la API no redefine ninguno.

Solo escucha en bucle local y todavía no tiene autenticación. La lista de endpoints está en el [README raíz](../../README.md) y el contrato, con sus escenarios, en [`openspec/specs/flows-api/spec.md`](../../openspec/specs/flows-api/spec.md) y [`openspec/specs/conversations-api/spec.md`](../../openspec/specs/conversations-api/spec.md).

## Arrancar

```bash
docker compose up -d                                   # Postgres local, desde la raíz del repo
export DATABASE_URL=postgresql://franca@127.0.0.1:5432/franca
pnpm --filter @franca/api db:migrate                   # aplica las migraciones
pnpm dev                                               # api en :3001 (con la web)
```

Con Postgres parado la API arranca igual: el CRUD y las conversaciones responden 503 `database_unavailable` y `POST /flows/validate` sigue funcionando.

## Variables de entorno

| Variable | Por defecto | Notas |
|---|---|---|
| `DATABASE_URL` | obligatoria | Cadena de conexión a Postgres |
| `HOST` | `127.0.0.1` | Solo `127.0.0.1` o `::1` mientras no haya autenticación |
| `PORT` | `3001` | `0` elige un puerto libre |
| `FRANCA_ANTHROPIC_API_KEY` | sin definir | Clave de Claude del proveedor `principal` de los nodos `llm`. Sin ella (o vacía) la API arranca y esos nodos terminan en `llm_not_configured`, con un aviso en el registro. Las variables `ANTHROPIC_*` de la shell (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`) se ignoran: las peticiones llevan solo esta clave y van solo a `api.anthropic.com` |
| `FRANCA_CONVERSATION_COST_LIMIT_USD` | `0.5` | Presupuesto de coste `llm` por conversación, en dólares (de 0, excluido, a 1000). Un valor inválido, también vacío, impide arrancar |
| `FRANCA_SECRET_<NOMBRE>` | sin definir | Valor completo de la cabecera del secreto `<NOMBRE>` (p. ej. `Bearer …`) de los nodos `http`: de 1 a 8192 caracteres ASCII visibles, espacios o tabuladores, sin blancos en los extremos. Solo existe si `FRANCA_HTTP_SECRET_ORIGINS` lo nombra; una variable suelta se ignora (la línea de arranque lo dice). Un nombre listado en `FRANCA_HTTP_SECRET_ORIGINS` sin su variable, o con ella vacía o no válida, impide arrancar; el mensaje nombra la variable, nunca el valor |
| `FRANCA_HTTP_SECRET_ORIGINS` | ninguno | Entradas `NOMBRE=origen` separadas por comas y sin espacios. El origen se escribe exactamente como su serialización WHATWG (`https://crm.example.com`, sin `/` final ni puerto por defecto) y es el único al que viaja ese secreto. Un nombre puede repetirse con otros orígenes; una entrada vacía o mal escrita impide arrancar |
| `FRANCA_HTTP_ALLOWED_DESTINATIONS` | ninguno | Pares `dirección:puerto` separados por comas (IPv4, o IPv6 entre corchetes) que la salida http permite aunque no sean unicast global, también con `http://`. Una entrada vacía o mal escrita impide arrancar |
| `FRANCA_HTTP_LOCAL_NAMES` | ninguno | Entradas `nombre=dirección` separadas por comas y sin espacios. `nombre` es un host de la `url` de un nodo `http` escrito en minúsculas y terminado en `.test`; `dirección`, una IPv4 de `127.0.0.0/8` sin ceros a la izquierda o `[::1]`. La salida http resuelve ese nombre a esas direcciones (en el orden escrito, sin preguntar al DNS), pero **no salta** `FRANCA_HTTP_ALLOWED_DESTINATIONS`: el par debe estar permitido. Una entrada vacía o mal escrita impide arrancar. Existe para la demo local |
| `NODE_EXTRA_CA_CERTS` | sin definir | La lee Node: las autoridades TLS extra de la máquina (p. ej. una CA corporativa) también las acepta la salida http. `NODE_TLS_REJECT_UNAUTHORIZED` y las variables de proxy (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NODE_USE_ENV_PROXY`) **no** cambian nada en la salida http |

Los nodos `http` de las conversaciones salen por la salida http de la API (secretos por origen exacto, solo destinos unicast global o permitidos, `http://` solo hacia pares permitidos, sin proxy del entorno y sin registrar nada de la llamada). El contrato y sus escenarios están en [`openspec/specs/http-host/spec.md`](../../openspec/specs/http-host/spec.md).

## Demo local (`demo/`)

`apps/api/demo/` tiene las herramientas de `pnpm dev:demo` desde la raíz del repo: un CRM simulado en `127.0.0.1:4010` (`crm.mjs`), la copia local de `captacion-leads` (`captacion-leads-local.json`), la semilla (`seed.mjs`, también `pnpm demo:seed`) y el arranque (`dev-demo.mjs`), que fija la configuración de la salida http y lo para todo con una señal. Son módulos `.mjs` con JSDoc (`apps/api/demo/tsconfig.json` los comprueba con `checkJs`), fuera de `src/`: no se compilan en `dist/` ni forman parte de la API. La receta de arranque está en el [README raíz](../../README.md#demo-local).

## Tests

```bash
pnpm --filter @franca/api test       # unit (Vitest), sin base de datos
pnpm --filter @franca/api test:e2e   # e2e con supertest; necesita Postgres y DATABASE_URL
```

Los e2e crean su propia base `franca_e2e_*` y la borran al terminar. La verificación canónica del repo es `pnpm check`.
