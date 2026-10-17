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

## Tests

```bash
pnpm --filter @franca/api test       # unit (Vitest), sin base de datos
pnpm --filter @franca/api test:e2e   # e2e con supertest; necesita Postgres y DATABASE_URL
```

Los e2e crean su propia base `franca_e2e_*` y la borran al terminar. La verificación canónica del repo es `pnpm check`.
