---
paths:
  - "apps/api/src/**"
---

# Backend — rutas, validación y errores

> **Enforcement tier: advisory.** Sin respaldo mecánico salvo los e2e de cada endpoint.

- **Rutas**: específicas antes que genéricas con parámetro (`/flows/validate` antes que `/flows/:id`). Sin prefijo de versión todavía; decidirlo antes del primer consumidor externo.
- **DTOs**: cuando un endpoint reciba algo que no sea un flujo, usar `ValidationPipe({ whitelist: true, transform: true })` + class-validator. Los flujos no pasan por DTOs: se validan con `validateFlow` de `@franca/spec`.
  - **Excepción: parámetros de consulta** (`limit`, `offset`, `published`). Los valida `apps/api/src/flows/list-query.ts`, un parser puro, y no un `ValidationPipe`: exigiría dos dependencias nuevas (class-validator y class-transformer), su error tiene otra forma (`{message: [...], error: "Bad Request", statusCode}`, no el `{message, error}` del contrato) y no rechaza parámetros repetidos sin más código. Motivo completo en `openspec/changes/archive/2026-10-17-api-flows/design.md`, D6.
  - **Excepción: cuerpos de las conversaciones** (`POST /conversations` y `POST /conversations/:id/inputs`). Los valida `apps/api/src/conversations/conversation-body.ts`, un parser puro, por las mismas razones y porque el contrato pide ignorar propiedades desconocidas (un `state` del cliente incluido) y tratar `null` como omitido, lo que `whitelist` no hace. Los límites de cuerpo son por ruta (`src/http/body-limits.ts`: 64 KiB en esas dos, 1 MiB en el resto) porque el cuerpo se lee antes del router. Motivo completo en `openspec/changes/api-conversations/design.md`, D13.
- **Errores**: `ApiException` (`apps/api/src/http/api-error.ts`) con `error` de la lista cerrada `API_ERROR_CODES`; el cuerpo es exactamente `{ message, error }` más los campos de su código. El cliente ramifica por `error`, no por el texto. `ApiExceptionFilter` captura todo (las excepciones de Nest sin código propio se traducen y lo inesperado es un 500 `internal_error` sin detalle).
- **Un resultado de validación no es un error**: endpoints que *comprueban* algo responden 200 con el veredicto (`{ valid, issues }`); los que *guardan o ejecutan* un flujo inválido responden 400 con los `issues`.
