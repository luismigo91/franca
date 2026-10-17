# @franca/spec — borrador v0

Spec de flujos de Franca (RFC-0001, borrador): el formato JSON que comparten el editor (`apps/web`) y el backend (`apps/api`).

- `flow.schema.json`: JSON Schema 2020-12 de un flujo. Es la fuente de verdad.
- `src/types.ts`: tipos TypeScript generados desde el esquema (`Flow`, `Node`, `MessageNode`, `LlmNode`…). No se editan a mano.
- `src/validate.ts`: `validateFlow()`, que valida forma (esquema, con ajv; `src/shape.ts`) y semántica (referencias, variables, alcanzabilidad) y calcula los avisos (`src/warnings.ts`).
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

### Avisos (`warnings`)

El resultado lleva siempre `warnings`: avisos `{code, path, nodeId?, message}` que no cambian `valid` ni `issues` y que se calculan cuando la forma es correcta (con errores de forma es `[]`). `FLOW_WARNING_CODES` es la lista cerrada de códigos:

- `url_template_in_origin`: la `url` de un `http` tiene un marcador `{{nombre}}` en el origen (esquema, host o puerto), así que un valor puede cambiar el destino de la petición.
- `credential_header_not_secret`: una cabecera de credenciales (`Authorization`, `Proxy-Authorization`, `Cookie`, `X-Api-Key`, `Api-Key`, `X-Auth-Token`) se construye con variables en vez de una referencia `{"secret": "NOMBRE"}`.
- `credential_header_literal`: esa misma cabecera lleva un texto escrito en el flujo, sin marcadores.
- `too_many_warnings`: solo lo añade `capWarnings`, nunca `validateFlow`.

`validateFlow` devuelve **todos** los avisos: quien decide (la API rechaza `credential_header_literal`) necesita la lista completa. Para mostrarlos, `capWarnings(warnings)` deja los 100 primeros (`MAX_FLOW_WARNINGS`) y un aviso final `too_many_warnings`.

### Profundidad, tope y coste

- **Profundidad**: un valor con más de 1000 niveles de arrays y objetos (`MAX_FLOW_DEPTH`, la misma medida que el motor) se rechaza antes de cualquier otra comprobación, con un único issue de forma en la raíz y sin lanzar. `exceedsFlowDepth(value)` es esa comprobación, iterativa.
- **Tope de issues**: `issues` tiene como mucho 100 (`MAX_FLOW_ISSUES`). Si hay más, los 100 primeros y un issue final con `code: "too_many_issues"` (el único con `code`).
- **Coste acotado**: el tiempo crece de forma lineal con el tamaño del flujo, sea válido o no. La forma se revisa por piezas (la raíz sin `nodes` y cada nodo contra la definición de su tipo) y solo da todos los errores de una pieza si su texto JSON tiene como mucho 8192 caracteres y las piezas detalladas suman como mucho 65536; si no, da uno por pieza. Deja de revisar nodos cuando ya no cabe ningún issue en el tope. Lo comprueban `tests/shape-cost.test.ts` y `tests/issue-cap.test.ts`.

Desde la terminal:

```
pnpm build
node dist/cli.mjs examples/*.json tests/invalid/*.json
```

## Cambiar el esquema

1. Edita `flow.schema.json`.
2. `pnpm generate` para regenerar `src/types.ts`. Un test falla si se te olvida.
3. Si la regla no se puede expresar en el esquema, añádela en `semanticIssues()` de `src/validate.ts` con su test.
