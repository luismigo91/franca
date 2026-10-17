---
name: gotcha-pg-query-timeout-duplica-con-rollback
description: Tras un query_timeout de pg el ROLLBACK de la transacción espera otro sobre la conexión muda (2 x); por eso query_timeout es 4 s y statement_timeout 3,5 s, y un servidor mudo acaba en 8 s
metadata:
  type: project
  enforcement: apps/api/test/database-stalls.e2e-spec.ts
---

# `query_timeout` de `pg` no libera la conexión: el `ROLLBACK` espera otro

**Qué pasó (`api-flows`, 2026-10-17):** el diseño ponía `query_timeout` 8 s en el adaptador para que una consulta que no contesta acabara en 503 antes de los 10 s del contrato. Medido, tardaba **16 s**: con `query_timeout` 1,5 s, una transacción interactiva con `FOR UPDATE` bloqueado falla a los 3 s. La ronda 2 de QA lo midió también con un proxy TCP que enmudece a mitad de una transacción: PUT y publicar, 16 s.

**Causa real:** `query_timeout` solo hace que `pg` rechace la promesa en el cliente (`Query read timeout`); la conexión sigue ocupada. Prisma envía el `ROLLBACK` de la transacción interactiva como una consulta más (el `rollback()` del adaptador solo libera el cliente), por esa misma conexión, y se encola detrás: si el servidor está mudo, espera otro `query_timeout`. El peor caso es 2 x `query_timeout`.

**Cómo está resuelto** (`apps/api/src/prisma/limits.ts`, `prisma.service.ts`):
- `query_timeout` **4 s**: el peor caso (consulta + `ROLLBACK`) es 8 s, con margen bajo los 10 s. Medido con el proxy: ~8,1 s.
- `statement_timeout` **3,5 s**, siempre menor que `query_timeout`: ante una espera de bloqueo aborta Postgres (SQLSTATE `57014`, `P2010`), la conexión queda sana y el `ROLLBACK` es inmediato (~3,6 s en total). Lo clasifica `isDatabaseUnavailable` (`src/prisma/database-errors.ts`).
- Alternativa descartada: conservar 8 s y destruir la conexión tras el corte (un `Client` de `pg` propio que llame a `stream.destroy()`): sin cambiar la spec, pero engancha con el interior de `pg` y el `ROLLBACK` fallaría con otro error sin clasificar.

**Al tocar los tiempos:** `2 x DATABASE_QUERY_TIMEOUT_MS` debe seguir siendo menor que 10 s, `DATABASE_STATEMENT_TIMEOUT_MS` menor que `DATABASE_QUERY_TIMEOUT_MS` y este menor que `TRANSACTION_TIMEOUT_MS`. Los listados no usan `$transaction([...])`: su `timeout` por defecto de Prisma (5 s) caduca con `P2028` (un 500, a propósito) antes que el corte de la base.

Enforcement: «Postgres que enmudece a mitad de una transacción» y «Tabla de flujos retenida» de `apps/api/test/database-stalls.e2e-spec.ts`, y «Bloqueo que no se suelta» de `apps/api/test/database-unavailable.e2e-spec.ts` (503 en menos de 10 s).
