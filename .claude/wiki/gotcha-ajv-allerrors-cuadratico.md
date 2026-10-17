---
name: gotcha-ajv-allerrors-cuadratico
description: ajv con allErrors es cuadrático en arrays anchos con elementos que fallan, y collapse comparaba cada error con cada ruta oneOf; por eso validateFlow valida por piezas con un validador rápido y un presupuesto de detalle
metadata:
  type: project
  enforcement: packages/spec/tests/shape-cost.test.ts, packages/spec/tests/collapse.test.ts
---

# `allErrors` no escala con el tamaño de lo que falla

**Qué pasó (`api-flows`, 2026-10-17):** al exponer `validateFlow` en una API con cuerpos de hasta 1 MiB se midió que un flujo **inválido** tardaba de segundos a minutos: N nodos `{}` → 1000: 172 ms, 4000: 3 s; 16 000 / 64 000 / 256 000 predicados `{}` en un `when` → 0,49 s / 8,4 s / 259 s; la raíz con 50 000 / 200 000 variables `{"x": 1}` → 2,7 s / 59 s. Con `allErrors: false` los mismos datos tardan 0 ms.

**Causa real:** son dos costes cuadráticos distintos.
- ajv con `allErrors` sobre un array ancho de elementos que fallan (en la raíz o dentro de un nodo) es cuadrático por sí solo.
- El `collapse` de `validate.ts` comparaba cada error con cada ruta `oneOf` (errores × rutas).

**Cómo se evita** (`packages/spec/src/shape.ts`): la forma se revisa por piezas (la raíz sin `nodes`, derivada del esquema al cargar, y cada nodo contra la definición de su tipo) con un validador `fast` (`allErrors: false`); solo si la pieza falla **y** es pequeña (`SHAPE_DETAIL_MAX_CHARS`) y cabe en el presupuesto (`SHAPE_DETAIL_BUDGET_CHARS`) se revalida con `detailed` para dar todos sus errores. `collapse` usa un `Set` de rutas `oneOf` y sube por los antecesores. Además, `validateFlow` deja de revisar nodos cuando ya no cabe ningún issue en el tope de 100.

**Lo que se pierde a propósito:** un nodo de más de 8192 caracteres con errores da un solo issue, y una vez gastado el presupuesto cada pieza con errores da uno. Un flujo normal mal escrito conserva todo el detalle (`tests/validate.test.ts` no cambió).

**Otro coste que se descubrió igual:** `templateVars`/`predicateVars` usaban `flatMap` recursivo y copiaban en cada nivel todo lo de debajo (un `body` de 990 niveles con 200 000 marcadores tardaba 1,9 s siendo válido); ahora recorren con pila y un `Set` por nodo.

Relacionado: [[gotcha-ajv-errores-oneof]].
