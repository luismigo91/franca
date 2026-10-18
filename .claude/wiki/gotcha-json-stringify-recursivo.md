---
name: gotcha-json-stringify-recursivo
description: JSON.parse es iterativo y JSON.stringify lanza RangeError con el anidamiento que cabe en 1 MiB; por eso la web reenvía el texto del flujo y el editor usa flowText
metadata:
  type: project
  enforcement: apps/web/src/server/bff/editor-handlers.test.ts, apps/web/src/lib/editor/flow-text.test.ts
---

# `JSON.stringify` no aguanta lo que `JSON.parse` sí

**Medido (Node 22.23, `web-editor`, 2026-10-18).** `JSON.parse` de un texto de 1 MB con 500 000 niveles funciona (es iterativo). `JSON.stringify` del mismo valor lanza `RangeError`: en esa versión serializa 5000 niveles y lanza a los 10 000, y 100 000 niveles caben en unos 200 KB, muy por debajo del cuerpo máximo de 1 MiB.

**Consecuencias en la web:**
- `readFlowBody` (`apps/web/src/server/bff/request.ts`) reenvía `JSON.stringify(valor)` solo si `exceedsFlowDepth` es falso (≤ 1000 niveles, el máximo del validador). Si no, reenvía el texto recibido tal cual y la API responde 400 `invalid_flow`. Reserializar sin esa guarda daba un 500 con un cuerpo válido para `JSON.parse`.
- El editor nunca guarda un borrador de más de 1000 niveles: «Editar como JSON», `request.body` y los predicados miden la profundidad del flujo resultante **antes** de serializar y rechazan el texto (`DEPTH_ERROR`). Por eso `flowText` es un `JSON.stringify` sin caso nulo.
- Un test que quiera matar el mutante `stringifyWithoutDepthGuard` tiene que usar 100 000 niveles: con 1001 o 5000 Node serializa sin lanzar y el mutante sobrevive.

Relacionado: [[gotcha-ajv-allerrors-cuadratico]] (el validador sí es lineal y acotado).
