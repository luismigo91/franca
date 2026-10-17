# Franca

Flujos conversacionales declarativos: mensajes, preguntas, condiciones, llamadas HTTP y pasos con LLM acotados, descritos en JSON y validados contra una spec pública.

## Estructura

Monorepo con pnpm workspaces y Turborepo.

```
franca/
├── apps/
│   ├── api/           # @franca/api: backend NestJS (puerto 3001)
│   └── web/           # @franca/web: frontend Next.js, App Router + Tailwind (puerto 3000)
├── packages/
│   └── spec/          # @franca/spec: esquema JSON de flujos, tipos TS, validador y ejemplos
├── docs/
│   └── rfcs/          # decisiones de diseño (RFC-0001: flujos v0)
└── .github/workflows/ # CI
```

Las aplicaciones van en `apps/` y el código compartido en `packages/`, publicado como `@franca/<nombre>`.

## Desarrollo

Requisitos: Node 22+, pnpm y Docker (Postgres para la API).

```
pnpm install
docker compose up -d   # Postgres local; ver apps/api/README.md para DATABASE_URL
pnpm dev        # api en :3001 y web en :3000
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm validate   # valida los flujos de ejemplo contra la spec
```

Una sola app: `pnpm --filter @franca/api dev`.

## API

Guarda y valida flujos en Postgres. Solo atiende desde la propia máquina (`127.0.0.1` o `::1`) y todavía no tiene autenticación. Arranque, variables y tests en [`apps/api/README.md`](apps/api/README.md); el contrato completo, en `openspec/changes/api-flows/specs/`.

| Endpoint | Qué hace |
|---|---|
| `POST /flows/validate` | Valida un flujo sin guardarlo: 200 con `{ valid, issues, warnings }` aunque el flujo sea inválido |
| `POST /flows` | Crea un flujo: 201 con `Location` y `ETag` |
| `GET /flows` | Lista resúmenes (`limit`, `offset`, `published`) |
| `GET /flows/:id` | Borrador y `warnings`, con `ETag` (la revisión) |
| `PUT /flows/:id` | Sustituye el borrador; exige `If-Match` con la revisión (o `*`) |
| `POST /flows/:id/versions` | Publica el borrador: 201 si es una versión nueva, 200 si es idéntico a la última |
| `GET /flows/:id/versions`, `GET /flows/:id/versions/:n` | Historial y versión publicada (inmutable) |
| `DELETE /flows/:id` | Borrado lógico: el `id` queda reservado (204) |

Los errores tienen la forma `{ message, error }` y se ramifica por `error`. Los principales: 400 `invalid_flow` (con `issues`), 400 `literal_credential`, 404 `flow_not_found`, 409 `flow_already_exists` o `flow_id_reserved`, 412 `revision_mismatch`, 413 `payload_too_large` (cuerpo de más de 1 MiB), 428 `precondition_required` y 503 `database_unavailable`. Los `warnings` informan de cosas que no impiden guardar, como una variable en el origen de una URL.

## Estado

Borrador v0 (`specVersion: "0.1"`). La spec puede cambiar sin compatibilidad hacia atrás hasta la 1.0.

## Licencia

[MIT](LICENSE)
