---
name: gotcha-jsonb-reordena-claves
description: jsonb reordena y deduplica las claves de un objeto y rechaza U+0000; por eso el flujo se guarda como text con el resultado de JSON.stringify
metadata:
  type: project
  enforcement: apps/api/test/database.e2e-spec.ts, apps/api/test/flows-crud.e2e-spec.ts
---

# El flujo se guarda como `text`, no como `jsonb`

**La trampa:** la columna natural para un documento JSON es `jsonb`, y Prisma lo expone como `Json`. Pero `jsonb` **reordena** las claves (por longitud y luego alfabéticamente), **deduplica** las repetidas y **rechaza** `\u0000`. El orden de las claves de un flujo importa: el motor envía las cabeceras de un nodo `http` en el orden en que están escritas (`X-B`, `X-A`, `Authorization`), y la spec de la API exige devolver «la forma JSON guardada, propiedad a propiedad y en el mismo orden». `json` conserva el texto, pero a través del tipo `Json` de Prisma el valor pasa por una (de)serialización en JS sin control del texto exacto.

**Cómo está resuelto** (`apps/api/prisma/schema.prisma`): `flows.draft` y `flow_versions.definition` son `text` con el resultado de **un único** `JSON.stringify` sobre lo que dio `JSON.parse` del cuerpo (`inspectFlowBody`). Así lo validado es exactamente lo guardado, la comparación «sin cambios» es igualdad de cadenas, y el texto es UTF-8 válido sin NUL. El `name` se guarda aparte como literal JSON (`name_json`), porque un `name` con U+0000 o un sustituto suelto rompería un `INSERT` en una columna `text`.

**Qué se pierde:** ninguna consulta puede mirar dentro del flujo en SQL (ningún requisito lo pide). Si alguna feature futura lo necesita, se añade una columna derivada, no se cambia el tipo de estas.

Enforcement: `apps/api/test/database.e2e-spec.ts` comprueba los tipos de columna (ninguna es `json`/`jsonb`) y el escenario «Orden de las cabeceras» de `apps/api/test/flows-crud.e2e-spec.ts` lee el texto crudo de las respuestas; lo mismo hace «Claves con nombre de Object en el body» con `__proto__` y claves numéricas.
