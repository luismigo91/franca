---
name: gotcha-ajv-errores-oneof
description: ajv con allErrors devuelve los errores de todas las ramas de un oneOf y da schemaPath relativos a la definición referenciada
metadata:
  type: project
  enforcement: packages/spec/tests/validate.test.ts
---

# Un nodo mal formado produce errores de las ocho ramas de `node`

**Qué pasó:** 2026-10-16, al portar el validador de Python a TypeScript. `#/$defs/node` es un `oneOf` de ocho tipos. Con `allErrors: true`, un `message` con una propiedad de más devolvía, además del error útil, los de las otras siete ramas ("falta `prompt`", "`type` debe ser `input`"…). El `jsonschema` de Python, en cambio, daba un único error de `oneOf`.

**Causa real:** ajv no sabe qué rama "quería" el autor; informa de todas. Además, dentro de un `$ref` el `schemaPath` del error es relativo a la definición referenciada (`#/else/not`), no al esquema raíz, así que no se pueden agrupar los errores por la ruta del `oneOf`.

**Cómo se evita** (`packages/spec/src/validate.ts`):
- `shapeIssues` detecta qué nodos fallan y los revalida contra la definición de su `type` (`nodeShapeIssues`), igual que hacía `validate.py`.
- `collapse` sustituye cualquier otro `oneOf` fallido (contenidos, predicados, cabeceras) por un único error y descarta los `if`.
- El mensaje del `not` de `inputNode` se reconoce por `schemaPath === '#/else/not'`. Si se añade otro `not` al esquema, hay que distinguirlos.

Lo protegen los tests de "forma" de `packages/spec/tests/validate.test.ts`, en particular "da errores solo del tipo del nodo, no de las otras ramas".

Relacionado: [[decision-esquema-json-fuente-de-verdad]].
