---
paths:
  - "packages/spec/**"
---

# Spec de flujos (`packages/spec`)

> **Enforcement tier: enforced-invariant** (tipos al día, ejemplos válidos, flujos rotos que fallan) + **advisory** (compatibilidad). Respaldo: `packages/spec/tests/validate.test.ts`, `pnpm validate` en CI.

- **`flow.schema.json` es la fuente de verdad** del formato. Tipos (`src/types.ts`) generados con `pnpm --filter @franca/spec generate`; nunca a mano. Por qué: [[decision-esquema-json-fuente-de-verdad]].
- Validación en dos capas (`src/validate.ts`): `shape` (ajv contra el esquema) y `semantic` (lo que el esquema no expresa: saltos a nodos inexistentes, variables no declaradas, alcanzabilidad, un `end` alcanzable). Si una regla cabe en el esquema, va al esquema.
- Toda regla semántica nueva lleva su test en `tests/validate.test.ts`, mutando un ejemplo de `examples/`. Todo ejemplo nuevo debe validar (lo comprueba el test).
- Mensajes de `issue` en español, sin repetir el id del nodo (va en `nodeId`), y `path` apuntando al campo exacto.
- Cambiar el esquema es un cambio de contrato: `specVersion` es `"0.1"` y hasta la 1.0 se admiten roturas, pero se anotan en `docs/rfcs/`.
