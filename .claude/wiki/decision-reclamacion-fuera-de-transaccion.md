---
name: decision-reclamacion-fuera-de-transaccion
description: Por qué una entrada reclama la conversación con un testigo, ejecuta el motor sin transacción y aplica después; el orden de bloqueos contacto -> conversación, el epoch del contacto y los límites del patrón
metadata:
  type: project
  enforcement: apps/api/test/conversations-concurrency.e2e-spec.ts
---

# Reclamar -> motor sin transacción -> aplicar

**Decisión (`api-conversations`, D4 y D7):** enviar una entrada son tres pasos. (1) *Reclamar*: transacción de milisegundos con `SELECT … FOR UPDATE` sobre la conversación; si pasa 404 -> 412 -> 409 caducada o terminada -> 409 `conversation_busy`, pone un testigo (UUID) y el instante. (2) *Ejecutar el motor* sin transacción ni conexión retenida. (3) *Aplicar*: otra transacción corta que descarta todo si la fila no existe (404) o si el testigo no es el propio o la reclamación ya caducó (409), y si no escribe estado, transcripción, coste y valores de contacto y libera la reclamación en el mismo `UPDATE`.

**Por qué no una sola transacción:** una transacción interactiva caduca a los 10 s (`P2028`, un 500) y retiene una conexión del pool; un avance con turnos `llm` dura hasta ~150 s. **Por qué un testigo y no comparar `revision`:** dos reclamaciones sucesivas de la misma revisión (la primera caducada, `CLAIM_TTL_MS` 300 s) se distinguen, y un resultado tardío nunca se aplica aunque nadie haya vuelto a reclamar.

**Orden fijo de bloqueos: contacto -> conversación** (y, al crear, contacto -> flujo). «Aplicar» bloquea el contacto antes que la conversación; `DELETE /contacts` bloquea el contacto y, por la cascada, sus conversaciones; reclamar y `DELETE /conversations` solo bloquean la conversación. Si «aplicar» bloqueara la conversación primero, la cascada de un borrado de contacto y la comprobación de la clave foránea al escribir `contact_values` (que toma `FOR KEY SHARE` sobre el contacto) formarían un ciclo y Postgres abortaría una con `40P01` (un 500).

**El `epoch` del contacto** detecta que un contacto se borró (y se pudo volver a crear) durante una creación con turnos `llm` que aún no tiene fila: al insertar se bloquea el contacto y su `epoch` debe ser el leído; si no, la creación se descarta con 404 `conversation_not_found`.

**Límites aceptados (documentados, no resueltos):**
- *`COMMIT` incierto*: si la conexión se corta después de que Postgres confirme y antes de que llegue la respuesta, la API responde 503 aunque el avance quedó aplicado y la reclamación liberada. Un cliente que repite **sin** `If-Match` aplica la entrada otra vez sobre el estado nuevo (contestaría a la pregunta siguiente); con `If-Match` recibe 412 y relee. Por eso el chat debe enviar siempre `If-Match`. Resolverlo del todo exige claves de idempotencia (non-goal).
- *Caducidad y reclamación*: la caducidad se comprueba al reclamar, no al aplicar. Una entrada reclamada antes de `expiresAt` se aplica aunque su avance termine después (hasta ~150 s) y renueva el plazo: la entrada llegó antes.
- Un fallo **al aplicar** no libera la reclamación (no se sabe si el `COMMIT` llegó); caduca sola a los 300 s. Un rechazo del motor o un error antes de aplicar sí la libera.
- Una API reiniciada a mitad de un avance deja la reclamación huérfana hasta 300 s (`conversation_busy`).

Relacionado: [[gotcha-pg-query-timeout-duplica-con-rollback]] (tiempos de cada paso).

Enforcement: `apps/api/test/conversations-concurrency.e2e-spec.ts` (dos entradas a la vez, reclamación caducada, resultado tardío, borrar un contacto mientras se aplica con barrera) y la suite de conformidad `apps/api/test/conversations-conformance.e2e-spec.ts`.
