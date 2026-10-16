# @franca/spec — borrador v0

Spec de flujos de Franca (RFC-0001, borrador): el formato JSON que comparten el editor (`apps/web`) y el backend (`apps/api`).

- `flow.schema.json`: JSON Schema 2020-12 de un flujo. Es la fuente de verdad.
- `src/types.ts`: tipos TypeScript generados desde el esquema (`Flow`, `Node`, `MessageNode`, `LlmNode`…). No se editan a mano.
- `src/validate.ts`: `validateFlow()`, que valida forma (esquema, con ajv) y semántica (referencias, variables, alcanzabilidad).
- `examples/`: captación de leads y FAQ con IA con escalado a humano.
- `tests/invalid/`: flujos rotos a propósito para comprobar el validador.

## Uso

```ts
import { validateFlow, type Flow } from '@franca/spec';

const result = validateFlow(json);
if (!result.valid) {
  for (const issue of result.issues) console.log(issue.layer, issue.path, issue.nodeId, issue.message);
}
```

Cada `issue` trae `layer` (`shape` o `semantic`), `path` (JSON Pointer dentro del flujo), `nodeId` si afecta a un nodo, y `message`. Las reglas semánticas solo se evalúan si la forma es correcta.

Desde la terminal:

```
pnpm build
node dist/cli.mjs examples/*.json tests/invalid/*.json
```

## Cambiar el esquema

1. Edita `flow.schema.json`.
2. `pnpm generate` para regenerar `src/types.ts`. Un test falla si se te olvida.
3. Si la regla no se puede expresar en el esquema, añádela en `semanticIssues()` de `src/validate.ts` con su test.
