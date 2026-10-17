---
name: gotcha-pg-query-timeout-duplica-con-rollback
description: Con solo query_timeout de pg, una consulta que espera un bloqueo de fila tarda el doble en fallar (el ROLLBACK espera otro timeout); statement_timeout del servidor evita la espera doble
metadata:
  type: project
  enforcement: apps/api/test/database-unavailable.e2e-spec.ts
---

# `query_timeout` de `pg` no libera la conexión

**Qué pasó (`api-flows`, 2026-10-17):** el diseño ponía `query_timeout` 8 s en el adaptador para que una consulta que espera un bloqueo de fila (otra transacción con `SELECT … FOR UPDATE` sin terminar) acabara en 503 antes de los 10 s del contrato. Medido, tardaba **16 s**: con `query_timeout` 1,5 s, una transacción interactiva con `FOR UPDATE` bloqueado falla a los 3 s.

**Causa real:** `query_timeout` solo hace que `pg` rechace la promesa en el cliente. En el servidor la sentencia sigue esperando el bloqueo y la conexión sigue ocupada; Prisma intenta entonces el `ROLLBACK` de la transacción por esa misma conexión, que se encola detrás y espera otro `query_timeout`.

**Cómo está resuelto** (`apps/api/src/prisma/limits.ts`, `prisma.service.ts`): además de `query_timeout` 8 s (el corte del cliente, para un servidor que deja de contestar), el adaptador fija `statement_timeout` 7,5 s en el servidor. Postgres aborta la sentencia con SQLSTATE `57014`, la conexión queda libre, el `ROLLBACK` es inmediato y la petición acaba en ~7,5 s. Prisma lo entrega como `P2010` con `meta.driverAdapterError.cause.originalCode` `57014`, y `isDatabaseUnavailable` (`src/prisma/database-errors.ts`) lo clasifica como 503.

**Lo que sigue sin cubrir:** un servidor que deja de contestar **a mitad de una consulta** (no en la conexión, que corta a los 5 s) sigue tardando ~16 s: el cliente corta a los 8 s y el `ROLLBACK` espera otros 8 s sobre una conexión muerta. No es un escenario de la spec.

Enforcement: «Bloqueo que no se suelta» de `apps/api/test/database-unavailable.e2e-spec.ts` (503 en menos de 10 s con una fila bloqueada por otra conexión).
