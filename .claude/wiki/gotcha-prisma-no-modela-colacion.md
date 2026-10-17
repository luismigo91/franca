---
name: gotcha-prisma-no-modela-colacion
description: Prisma no modela ni conserva la colación de una columna; el COLLATE "C" de flows.id y flow_versions.flow_id vive a mano en el SQL de la migración
metadata:
  type: project
  enforcement: apps/api/test/database.e2e-spec.ts
---

# La colación `C` va a mano en la migración

**Qué hay:** `flows.id` y `flow_versions.flow_id` (`apps/api/prisma/migrations/*_init/migration.sql`) llevan `COLLATE "C"` para que el desempate del listado («`id` ascendente por código de carácter») no dependa de la colación de la base: con una `en_US.utf8` de glibc, `ab` va antes que `a-c` porque ignora `-` y `_` en el primer nivel. Las dos columnas deben coincidir para que la clave foránea compare igual.

**La trampa:** `schema.prisma` no puede expresar la colación de una columna, y `prisma migrate diff --from-config-datasource --to-schema … --exit-code` dice «No difference detected» con y sin ella (medido). Si alguien regenera la migración inicial desde cero, o escribe la tabla de otra feature sin acordarse, la colación desaparece sin que falle ni `migrate` ni el chequeo de deriva del arnés e2e.

**Dos precisiones medidas con `postgres:18.6-alpine`:**
- La imagen alpine usa musl y su orden por defecto ya es el de código de carácter (`'ab' < 'a-c'` es falso), así que el test de orden de `database.e2e-spec.ts` pasaría también sin `COLLATE`. Lo que protege la columna es el test que lee `information_schema.columns.collation_name`; el de orden documenta el efecto buscado.
- Vale para el `flow_id` de **cualquier tabla futura** que referencie `flows.id`, como la de sesiones de la feature 6: `COLLATE "C"` a mano en su migración.

Enforcement: el test de columnas de `apps/api/test/database.e2e-spec.ts` (falla si falta `C`; validado quitando el `COLLATE` de la migración).
