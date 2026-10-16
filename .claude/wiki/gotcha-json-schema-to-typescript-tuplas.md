---
name: gotcha-json-schema-to-typescript-tuplas
description: maxItems -1 no evita que json-schema-to-typescript genere tuplas por minItems; hace falta ignoreMinAndMaxItems
metadata:
  type: project
  enforcement: none — es una opción del generador en packages/spec/scripts/types.mjs; un test sobre la forma de los tipos generados cuesta más de lo que protege
---

# `minItems: 1` genera tuplas `[X, ...X[]]` en los tipos

**Qué pasó:** 2026-10-16, al generar `packages/spec/src/types.ts`. Con las opciones por defecto, cada array con `minItems: 1` del esquema (`nodes`, `content`, `choices`, `rules`…) salía como `[Node, ...Node[]]`, muy incómodo para el editor (no se puede asignar un `Node[]` normal). La documentación sugiere que `maxItems: -1` lo desactiva, pero no lo hace.

**Cómo se evita:** `packages/spec/scripts/types.mjs` pasa `ignoreMinAndMaxItems: true`. La restricción `minItems` sigue en el esquema y la comprueba el validador; los tipos solo dicen `Node[]`.

Relacionado: [[decision-esquema-json-fuente-de-verdad]].
