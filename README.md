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
pnpm dev        # api en :3001 y web en :3000 (chat de prueba en / y editor de flujos en /flujos)
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm validate   # valida los flujos de ejemplo contra la spec
```

Una sola app: `pnpm --filter @franca/api dev`.

### Demo local

Para ver un flujo llegar a su final feliz en el chat sin Internet ni credenciales reales, desde un clon limpio:

```
pnpm install
docker compose up -d
export DATABASE_URL=postgresql://franca@127.0.0.1:5432/franca
pnpm --filter @franca/api db:migrate
pnpm dev:demo
```

`pnpm dev:demo` arranca un CRM simulado en `127.0.0.1:4010` y lo mismo que `pnpm dev` (la API en `:3001` y la web en `:3000`), siembra la copia local de `captacion-leads` y, cuando escribe «Lista», se abre `http://localhost:3000` y se prueba **Captación de leads (local)** (también puedes abrir `http://localhost:3000/flujos`, editarla, publicarla y probarla desde el editor): al responder el nombre, el email y el tamaño de empresa, el flujo envía el lead al CRM simulado y termina en su final feliz. El CRM escribe una línea por petición en la terminal. Necesita los puertos 3000, 3001 y 4010 libres, y Ctrl+C lo para todo.

- **Qué fija la demo.** Solo para esa ejecución, la salida http de la API recibe `FRANCA_HTTP_LOCAL_NAMES`, `FRANCA_HTTP_ALLOWED_DESTINATIONS`, `FRANCA_HTTP_SECRET_ORIGINS` y `FRANCA_SECRET_CRM_TOKEN` (un token aleatorio nuevo que no se escribe en ninguna parte). Si tu shell ya define alguna, la demo no arranca y las nombra: usa `unset` o `pnpm dev`. `pnpm dev` no cambia.
- **Sin Claude.** La demo arranca la API sin `FRANCA_ANTHROPIC_API_KEY`, aunque la shell la tenga: los flujos con nodos `llm` (por ejemplo `faq-ia`) terminan en `llm_not_configured`.
- **`pnpm demo:seed`** repite la siembra (es idempotente) y dice qué hizo. Si el borrador de `captacion-leads-local` ya no es la copia (por ejemplo, porque el repositorio la actualizó), responde que no lo ha tocado. Para ponerlo al día, sustituye el borrador por `apps/api/demo/captacion-leads-local.json` (`PUT` con `If-Match`) o, si no hay nada que conservar, `docker compose down -v` y las migraciones otra vez.
- **Id reservado.** Si borras `captacion-leads-local` con `DELETE`, la API no deja reutilizar su `id`. Solo se recupera borrando la base de datos local con `docker compose down -v`, que borra todos los flujos y conversaciones.
- **Puertos ocupados.** Si algo ya escucha en el 3000 o en el de la API (por ejemplo, otro `pnpm dev` abierto), la demo no arranca y lo dice. Páralo antes de repetir.
- **Si se mató la demo con `kill -9`**, turbo, la API y la web quedan en marcha y la siguiente ejecución se negará a arrancar. Recupera con `lsof -nP -iTCP:3001 -sTCP:LISTEN` (pid de la API), `ps -o pgid= -p <pid>` y `kill -INT -<pgid>`; con `lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:4010 -sTCP:LISTEN` vacío, ya puedes repetir.
- **Sin migraciones.** Si la semilla dice que la API respondió 500, aplica `pnpm --filter @franca/api db:migrate` y repítela.

## API

Guarda y valida flujos en Postgres y conversa con los publicados (conversaciones, transcripción y valores de contacto). Solo atiende desde la propia máquina (`127.0.0.1` o `::1`) y todavía no tiene autenticación. Arranque, variables y tests en [`apps/api/README.md`](apps/api/README.md); el contrato completo, en [`openspec/specs/flows-api/spec.md`](openspec/specs/flows-api/spec.md) (flujos) y [`openspec/specs/conversations-api/spec.md`](openspec/specs/conversations-api/spec.md) (conversaciones).

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
| `POST /conversations` | Crea una conversación fijada a la última versión publicada (o a `version`) y la ejecuta hasta la primera parada: 201 con `{ conversation, events }`, `Location` y `ETag`; `contactId` opcional |
| `GET /conversations` | Lista conversaciones (`flowId`, `status`, `limit`, `offset`), sin `pendingInput` |
| `GET /conversations/:id` | El recurso conversación (estado, `pendingInput`, coste, caducidad), con `ETag` (la revisión) |
| `POST /conversations/:id/inputs` | Envía `{ input }` y continúa: 200 con `{ conversation, events }`; `If-Match` opcional; una entrada a la vez (409 `conversation_busy`) |
| `GET /conversations/:id/transcript` | Entradas del usuario y eventos del motor, paginado (`limit`, `offset`) |
| `DELETE /conversations/:id` | Borra la conversación, su estado y su transcripción (204) |
| `DELETE /contacts/:contactId` | Borra los valores guardados de un contacto y todas sus conversaciones (204) |

Los errores tienen la forma `{ message, error }` y se ramifica por `error`. Los principales: 400 `invalid_flow` (con `issues`), 400 `literal_credential`, 404 `flow_not_found`, 409 `flow_already_exists` o `flow_id_reserved`, 412 `revision_mismatch`, 413 `payload_too_large` (cuerpo de más de 1 MiB), 428 `precondition_required` y 503 `database_unavailable`. De las conversaciones: 400 `invalid_request` o `invalid_input`, 404 `conversation_not_found`, 409 `flow_not_published`, `flow_version_invalid`, `conversation_busy`, `conversation_not_active` o `conversation_expired`, 413 con 64 KiB como máximo en las dos rutas `POST`. Los `warnings` informan de cosas que no impiden guardar, como una variable en el origen de una URL.

## Estado

Borrador v0 (`specVersion: "0.1"`). La spec puede cambiar sin compatibilidad hacia atrás hasta la 1.0.

## Licencia

[MIT](LICENSE)
