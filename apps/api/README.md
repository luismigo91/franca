# @franca/api

API de Franca: guarda, versiona y valida flujos conversacionales. NestJS 12 (ESM), Prisma 7 y Postgres. El formato de flujo y su validador son de `@franca/spec`; la API no redefine ninguno.

Solo escucha en bucle local y todavía no tiene autenticación. La lista de endpoints está en el [README raíz](../../README.md) y el contrato, con sus escenarios, en [`openspec/specs/flows-api/spec.md`](../../openspec/specs/flows-api/spec.md).

## Arrancar

```bash
docker compose up -d                                   # Postgres local, desde la raíz del repo
export DATABASE_URL=postgresql://franca@127.0.0.1:5432/franca
pnpm --filter @franca/api db:migrate                   # aplica las migraciones
pnpm dev                                               # api en :3001 (con la web)
```

Con Postgres parado la API arranca igual: el CRUD responde 503 `database_unavailable` y `POST /flows/validate` sigue funcionando.

## Variables de entorno

| Variable | Por defecto | Notas |
|---|---|---|
| `DATABASE_URL` | obligatoria | Cadena de conexión a Postgres |
| `HOST` | `127.0.0.1` | Solo `127.0.0.1` o `::1` mientras no haya autenticación |
| `PORT` | `3001` | `0` elige un puerto libre |

## Tests

```bash
pnpm --filter @franca/api test       # unit (Vitest), sin base de datos
pnpm --filter @franca/api test:e2e   # e2e con supertest; necesita Postgres y DATABASE_URL
```

Los e2e crean su propia base `franca_e2e_*` y la borran al terminar. La verificación canónica del repo es `pnpm check`.
