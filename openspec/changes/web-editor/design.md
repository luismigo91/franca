# Design: editor visual de flujos (`web-editor`)

**Fecha**: 2026-10-18 · **Rama**: `feat/web-editor` · Motivación y alcance en `proposal.md`. El comportamiento está en `specs/web-editor/spec.md` (44 requisitos y 78 escenarios) y en el delta de `specs/web-chat/spec.md` (3 requisitos modificados, 1 escenario nuevo). La spec manda sobre este documento.

Antes de este diseño se corrigió la spec en `4ced695` (`spec:`), con dos cambios que **el usuario tiene que aprobar o revertir** (ver «Open Questions»):
- En el inspector, `position` es de solo lectura, como `type` (D8).
- Vaciar el último campo de un objeto o una lista opcionales quita también el contenedor (D5).

**Revisión 3**, tras la segunda ronda de `popi:architecture-reviewer` (tres bloqueantes):
- `nodeTargets` solo da saltos con `id` de texto, la clave de una opción usa su índice si su `id` no es texto, y la identidad de salidas y conexiones es el `pointer` (D10).
- `asText` para todo valor del flujo que se pinta, y las listas con elementos que no son objetos pasan enteras a JSON libre (D8, D10).
- Delta `eff3d08` (`spec:`): «Posiciones de los nodos» y «Sin cambios que guardar» quedan coherentes con `0520b08`.
- No bloqueantes: la casilla reescribe el valor por defecto solo si estaba escrito (D5), y la guarda estática cierra `import *` e `import()` de `@franca/spec` (D21).

**Revisión 2**, tras el FAIL de `popi:architecture-reviewer`:
- **B1.** `targets()` de `@franca/spec` lanza `TypeError` con nodos de forma inválida (medido: `{"id":"a","type":"condition"}`, `rules: 5`, `rules: [null]`, `choices: "x"` y `choices: [null]`). Es alcanzable con «Añadir nodo» (una condición sin `rules`) y con «Editar como JSON». Ahora todo el editor pasa por un adaptador, `node-targets.ts` (D10).
- **B2.** El criterio de ficheros modificados no contaba `src/server/api/operations.test.ts` ni `e2e/support/admin.ts`. Pasan a ser 18, y se detallan los cambios de la guarda estática (D21, «Ficheros»).
- **No bloqueantes aplicados** (los resolvió el orquestador):
  - Un JSON que pasaría de 1000 niveles se rechaza al aplicarlo, y desaparece `draftText: null` (D5).
  - Los tests de profundidad usan 100 000 niveles: Node serializa 5000 y lanza a 10 000 (D2, D21).
  - Cinco escenarios pasan de E2E a Vitest (D22).
  - Conectar desde el inspector fija las posiciones (delta `0520b08`, D11, D12).
  - Al desmarcar una casilla vuelve el valor por defecto que estaba escrito en el último guardado (D5).
  - La altura de los nodos se fija por CSS (D10).
  - Publicar llega a la API con `Content-Length: 0` (D2).
  - Los diálogos se cierran al ocultarse la ruta y antes de navegar (D15).
  - La línea provisional del arrastre no recibe eventos de puntero y Escape se escucha en `window` (D12).
  - Sin Ctrl/⌘ + rueda para ampliar (D9).

**Delta `0520b08`** (`spec:`, decisión del orquestador):
- Elegir el destino de una salida en el inspector (también «ninguno») fija las posiciones, como arrastrar. Escenario nuevo: «Conectar desde el inspector no mueve los nodos».
- No se aplica un JSON con el que el flujo anidaría más de 1000 niveles.

Resuelve las preguntas técnicas 12-17 de la propuesta: validación local síncrona sin Web Worker ni agrupación (D6), ajv con `Function` y una CSP que no restringe scripts, fijado con test y mutante (D7), sin `issues` de la API (D2), rutas propias `/api/editor/flows/**` (D1, D2), lienzo propio en DOM y SVG sin dependencia nueva, con diseño automático por capas (D9-D12), y relectura al mostrarse con `<Activity>` (D15).

## Context

Medido el 2026-10-18 sobre `main` + la rama (`bda1209`), Node 22.23.3, Next 16.4.2:

- **La web hoy** (`web-chat`, archivado): frontera en `src/proxy.ts` → `checkFrontier` (`src/server/frontier.ts`), ocho funciones en `src/server/api/operations.ts` sobre `transport.ts` (`node:http`, socket propio, `method: 'GET' | 'POST' | 'DELETE'`), manejadores sin Next en `src/server/bff/handlers.ts`, lectura de cuerpos en `request.ts` (`readJsonBody` con tope de 1 MiB, `readIfMatch` con `^"[0-9]{1,10}"$`), saneado en `responses.ts` (los errores salen como `{error}` y, en un 412, `currentRevision`), un único cliente del navegador en `src/lib/web-client.ts` y URLs en `src/config/endpoints.ts`. `isFlowId` ya existe en `src/server/ids.ts` con el patrón de `@franca/spec`.
- **La API de flujos** (`apps/api/src/flows/`): `POST /flows` → 201 `FlowResource`; `GET /flows?limit&offset[&published]` → `Page<FlowSummary>` por `updatedAt` desc e `id` asc; `GET /flows/:id` → `FlowResource` (`{id, name, revision, latestVersion, unpublishedChanges, createdAt, updatedAt, flow, warnings}`); `PUT /flows/:id` con `If-Match` **obligatorio** (428 sin él) → 200, y un texto idéntico no escribe nada ni sube la revisión; `POST /flows/:id/versions` y `DELETE /flows/:id` con `If-Match` **opcional**; publicar no cambia `revision` ni `updated_at`. El 412 lleva `currentRevision`. `matchesIfMatch` acepta `*`. Sin cuerpo, publicar y borrar no pasan por el tipo de medio (`json-body.ts`: un cuerpo vacío es «ausente»). Límite de cuerpo 1 048 576 bytes.
- **`@franca/spec`**: `validateFlow` (sin IO, lineal y acotado: 100 issues, profundidad 1000), `targets(node)` (`key`, `pointer`, `id`), `exceedsFlowDepth`, `capWarnings`, `schema`. `dist/` solo importa `ajv/dist/2020.js`. El esquema va dentro del *bundle*. `shape.ts` compila **al importar** dos instancias de ajv (`fast` y `detailed`), cada una con el esquema completo y la raíz.
- **El esquema** (`flow.schema.json`): `position` (`{x, y}` numéricos) está en `nodeBase`. Hay `default` en `locale`, `variables`, `settings.*`, `variable.scope`, `variable.pii`, `validation.maxRetries`, `multiple`, `timeoutMs`, `retries`, `slots[].required` y `maxTurns`.

### Mediciones hechas para este diseño

| Qué | Resultado | Cómo |
|---|---|---|
| ¿Turbopack empaqueta `validateFlow` para el navegador? | **Sí.** Un *chunk* de 144 402 bytes (41 723 en gzip) con ajv y el esquema. No aparece en la carga de `/`: solo en la ruta que lo importa | Página de sonda temporal `'use client'` con `validateFlow`, `next build` real, y búsqueda del *chunk*. La sonda se borró y se recompiló sin ella |
| ¿Usa `new Function`? | **Sí**: `Function(\`${self}\`, \`${scope}\`, sourceCode)` en `ajv/dist/compile/index.js:89`, una vez en el *chunk* | `grep` en el *chunk* de Turbopack y en el *bundle* de `rolldown` (145 213 bytes, 41 514 en gzip) |
| Importar y compilar | 60 ms una vez, al cargar el *chunk* | Node 22 (V8), portátil |
| `validateFlow` sobre los ejemplos | 0,09 ms de media (2,6 ms la primera) | Ídem |
| `validateFlow` sobre ~1 MiB | 5000 nodos `message` (1 076 770 bytes): 12-20 ms. 1000 nodos con textos de 900 caracteres: 2,5 ms. 10 nodos de 100 KB: 0,2 ms. `JSON.stringify` de 1 MiB: 1-2 ms. `targets` de 5000 nodos: 0,4 ms | Ídem. Medido en el portátil, solo como orden de magnitud (`lecciones-equipo`): se repite en el *runner* (FOLLOW-UP 7.2) |
| `JSON.parse` y `JSON.stringify` con anidamiento profundo | `JSON.parse` de 1 MB con 500 000 niveles **funciona** (es iterativo). `JSON.stringify` del mismo valor lanza **`RangeError`** | `node -e` |

### Auditoría de la spec contra el código fusionado

| Lo que decía la spec o se suponía | Lo que dice el código (medido) | Dónde se resuelve |
|---|---|---|
| El listado del editor es «`GET /flows` sin `published`» | `GET /api/flows` de la web ya existe y fija `published=true` («Flujos publicados» de `web-chat`) | D1: rutas propias bajo `/api/editor/flows` |
| «Publicar y borrar con `If-Match`» | En la API es **opcional** en los dos (`checkOptionalIfMatch`) y acepta `*` | D2: la web lo **exige** al navegador (428 si falta, 400 si no es `"<n>"`, también con `*`), como en las entradas del chat |
| `targets(node)` vale para cualquier nodo del borrador | Lanza `TypeError` si el nodo no tiene la forma mínima (`node.rules.forEach`, `(node.choices ?? []).forEach`, `c.next`): una condición sin `rules` o con `rules` que no es una lista de objetos, y un `input` con `choices` que no es una lista de objetos. `validateFlow` solo lo llama con la forma ya validada | D10: el adaptador `node-targets.ts` |
| El servidor de la web «envía a la API el texto JSON» del cuerpo | `JSON.stringify` lanza `RangeError` con un anidamiento que cabe en 1 MiB (en Node 22.23: 5000 niveles se serializan, 10 000 lanzan; 100 000 niveles ocupan 200 KB), y `JSON.parse` no | D2: `JSON.stringify` solo si `exceedsFlowDepth` es falso (≤ 1000 niveles); si no, se reenvía el texto recibido y la API responde 400 `invalid_flow`. Lo mismo en el navegador (D5) |
| Publicar sin cuerpo | Node añade `Content-Length: 0` a un `POST` sin cuerpo (y no a un `DELETE`), medido. La API lo trata como cuerpo ausente (`json-body.ts`) | D2: los tests de cabeceras exactas lo esperan |
| Los tests existentes aceptan operaciones nuevas | `operations.test.ts` exige exactamente las ocho exportaciones y `Object.keys(API_OPERATIONS).length === 8`. La guarda estática exige 7 ficheros de ruta y al menos 13 manejadores. `e2e/support/admin.ts` no lee ni un flujo ni sus versiones | D21 y «Ficheros»: se actualizan como cambios deliberados |
| `transport.ts` envía cualquier operación | `TransportRequest.method` es `'GET' \| 'POST' \| 'DELETE'` | D2: se añade `'PUT'` (una línea) |
| Los errores del editor «sin `issues`» | `toWebResponse` ya reduce todo error a `{error}` (+ `currentRevision`) | D2: sin caso nuevo; un test y el mutante `forwardIssues` lo fijan |
| `rejectedByFrontier` vale para cualquier mutación | Responde `conversation_not_found` fijo cuando la decisión trae cuerpo | D2: devuelve el cuerpo de la decisión (`flow_not_found` en las rutas del editor) |
| `validateFlow` «en el navegador» | Compila con `Function` al importar el módulo. La CSP de la web es solo `frame-ancestors 'none'` | D7 |
| «Probar» abre la conversación del chat | `useStartConversation` y `startConversation` ya hacen `POST /conversations` con `{"flowId"}` (contacto `''`) y el traspaso del primer avance | D14: se reutilizan tal cual |
| La lista vacía del chat «enlaza con `/flujos`» | `ListState` solo admite `emptyText: string` | D20: pasa a `ReactNode` |
| Volver a `/flujos/<id>` vuelve a leer | Next oculta la ruta con `<Activity>` y conserva estado y DOM (`preserving-ui-state.md`) | D15 |
| Salir por un enlace pide confirmación | `<Link onNavigate>` existe en Next 16 y permite `preventDefault()` en la navegación del cliente (`link.md`) | D15 |
| Un `GET` de ruta se lee en cada petición | Con Cache Components hace falta `await connection()` (guarda estática existente) | D1: las tres rutas nuevas la llevan |
| La API guarda y devuelve el texto tal cual | `FlowResource.flow` es `JSON.parse(draft)`, y `JSON.stringify(JSON.parse(t)) === t` cuando `t` salió de `JSON.stringify` (orden de claves, enteros primero y `__proto__` propio incluidos) | D4: «sin cambios» es igualdad del texto del navegador con el último guardado, sin normalizar |

No queda ninguna contradicción de producto abierta. Las dos aclaraciones conductuales van en `4ced695`.

## Goals / Non-Goals

**Goals**
- Los 78 escenarios de `web-editor` y el nuevo de `web-chat` con un test con su título exacto (D24).
- Cero ficheros en `apps/api/`, `packages/`, `turbo.json`, el *lockfile* y la CI. **Sin dependencias nuevas.**
- La frontera sigue auditable en los mismos cuatro ficheros (`proxy.ts`, `frontier.ts`, `operations.ts` y `transport.ts`), ahora con catorce operaciones.
- Todo lo combinatorio (campos, renombrado, salidas, soltar, diseño automático, guardar) en lógica pura con Vitest y mutantes; en E2E, cada opción de UI al menos una vez.

**Non-Goals** (los de la propuesta, más):
- Virtualizar el lienzo o garantizar fluidez con miles de nodos (la propuesta lo deja fuera).
- Web Worker, *debounce* o validación incremental (D6).
- Una CSP completa (D7) y ajv *standalone* (cambiaría `packages/spec`).
- Atajos de teclado más allá de las flechas, Intro y Escape.
- Tests de componentes con DOM simulado (jsdom), como en `web-chat`.

## Decisions

### D1. Páginas sin datos, pantallas cliente y rutas propias del editor

- `src/app/flujos/page.tsx` (Server Component, `metadata.title: 'Flujos'`) pinta `<FlowsScreen/>`.
- `src/app/flujos/[flowId]/page.tsx` mete en `<Suspense fallback={<EditorLoading/>}>` un Server Component que hace `await params`. Si `isFlowId(flowId)` es falso (`No Vale`, `../conversations`), pinta `<EditorNotFound/>` sin llamar a nada. Si no, pinta `<EditorScreen key={flowId} flowId={flowId}/>`. Título `'Editor de flujos'`: con la plantilla del *layout* son «Flujos · Franca» y «Editor de flujos · Franca».

Es el mismo patrón que el chat (D1 de `web-chat`): el editor es estado vivo del cliente, hay un solo camino de lectura (el mismo de «Cargar el guardado» y «Descartar cambios») y ninguna carga RSC ni HTML lleva datos de la instalación, así que ni el *prerender*, ni la caché del *router*, ni `<Activity>` pueden servir un flujo viejo.

**Rutas de la web (pregunta 15)**: todas bajo `/api/editor/flows`:

| Fichero | Exporta |
|---|---|
| `src/app/api/editor/flows/route.ts` | `GET` (lista) y `POST` (crear) |
| `src/app/api/editor/flows/[flowId]/route.ts` | `GET`, `PUT` y `DELETE` |
| `src/app/api/editor/flows/[flowId]/versions/route.ts` | `POST` (publicar) |

Cada manejador es una línea: `await connection()` y su función de `handlers.ts`. Un método no exportado da el 405 de Next sin cuerpo (el cliente lo lee como `unknown`). Otra ruta de `/api/editor/*` cae en el comodín `/api/[...rest]` (404 `not_found`).

Descartado:
- **`/api/flows` para todo, como la API**: `GET /api/flows` ya es la lista de publicados. Otra lista en la misma ruta haría que el navegador eligiera el filtro (`?todos`), y la spec lo prohíbe. Además, mezclaría en un fichero del chat una operación del editor.
- **Server Actions**: prohibidas por la guarda estática (frontera de `web-chat`).
- **Leer el flujo en el Server Component**: duplica el camino de lectura y mete el flujo en la carga RSC, que `<Activity>` conserva.

Con un prefijo propio, la frontera valida el id con una regla (D2), el registro tiene plantillas distintas y ningún fichero de ruta del chat cambia.

### D2. Seis operaciones nuevas en la frontera

**`src/server/api/operations.ts`** pasa de ocho a **catorce** funciones, con rutas fijas y argumentos ya validados:

| Función | Método y ruta de la API | Cuerpo | `If-Match` | Plazo |
|---|---|---|---|---|
| `listFlows(offset)` | `GET /flows?limit=20&offset=N` | — | — | 15 s |
| `getFlow(flowId)` | `GET /flows/:flowId` | — | — | 15 s |
| `createFlow(body)` | `POST /flows` | texto JSON | — | 15 s |
| `updateFlow(flowId, body, ifMatch)` | `PUT /flows/:flowId` | texto JSON | sí | 15 s |
| `publishFlow(flowId, ifMatch)` | `POST /flows/:flowId/versions` | — | sí | 15 s |
| `deleteFlow(flowId, ifMatch)` | `DELETE /flows/:flowId` | — | sí | 15 s |

Las rutas salen de `API_OPERATIONS` (`src/config/endpoints.ts`). El nombre `listFlows` no choca con `listPublishedFlows`. `transport.ts` solo cambia el tipo del método (`'PUT'`), así que las cabeceras siguen construidas desde cero: `Host` de `FRANCA_API_URL`, `Connection: close` y, con cuerpo, `Content-Type: application/json` y `Content-Length`, más `If-Match` donde va. Nada del navegador.

**Frontera** (`checkFrontier`, paso nuevo después del de conversaciones): si `pathname` empieza por `/api/editor/flows/`, su segmento siguiente, decodificado con `decodeURIComponent` (un error cuenta como inválido), tiene que cumplir `isFlowId`. Si no, `404 {"error":"flow_not_found"}` con las cabeceras de seguridad. Es la misma defensa que con las conversaciones, por si Next resolviera `%2F` de otra manera. `Host` y `Origin` no cambian: las cuatro mutaciones nuevas son `POST`, `PUT` o `DELETE`, así que ya exigen `Origin: http://<Host>`.

**Manejadores** (`src/server/bff/handlers.ts`, mismo fichero, la misma función `respond` con su registro de plantilla, estado y código):

| Manejador | Orden de comprobación |
|---|---|
| `handleListEditorFlows` | `offset` (400 `invalid_query`) → `listFlows` |
| `handleCreateFlow` | frontera (403/404) → cuerpo de flujo → `createFlow` |
| `handleGetFlow` | id (404 `flow_not_found`) → `getFlow` |
| `handleUpdateFlow` | frontera → id → `If-Match` (428/400) → cuerpo de flujo → `updateFlow` |
| `handlePublishFlow` | frontera → id → `If-Match` → `publishFlow`. No lee el cuerpo |
| `handleDeleteFlow` | frontera → id → `If-Match` → `deleteFlow` (respuesta `'delete'`: 204 sin cuerpo). No lee el cuerpo |

Las cuatro mutaciones vuelven a pasar por `checkFrontier` (defensa en profundidad, como las tres del chat). `rejectedByFrontier` devuelve el cuerpo de la decisión (`flow_not_found` o `conversation_not_found`) en vez de uno fijo. Plantillas nuevas de registro: `/api/editor/flows`, `/api/editor/flows/[flowId]` y `/api/editor/flows/[flowId]/versions`.

**Cuerpo de flujo** (`request.ts`, `readFlowBody`): `readJsonBody` se parte en `readJsonText` (lee como mucho 1 MiB, UTF-8 estricto, y devuelve `{text, value}`) y `readJsonBody`, que la usa sin cambiar su contrato. Después:
- Si `value` no es un objeto (`null`, un array, un escalar), `400 invalid_request`.
- Si `exceedsFlowDepth(value)` es falso (≤ 1000 niveles), se reenvía `JSON.stringify(value)`: el texto JSON de la spec. Con el texto del navegador es el mismo byte a byte.
- Si es verdadero, se reenvía `text` tal cual, sin serializar (ver la auditoría: `JSON.stringify` lanzaría `RangeError`). La API responde 400 `invalid_flow` y el navegador recibe `{"error":"invalid_flow"}`.
- Más de 1 048 576 bytes (declarados o leídos): `413 payload_too_large`. No es JSON o está vacío: `400 invalid_json`.

Publicar y borrar van sin cuerpo y sin `Content-Type`. Node añade `Content-Length: 0` al `POST` de publicar (no al `DELETE`), y los tests de cabeceras exactas lo esperan así.

**Respuestas** (pregunta 14): sin caso nuevo en `responses.ts`. Los 2xx pasan con su estado y su JSON (`'json'`), el 204 de borrar como 204 (`'delete'`) y los errores como `{error}` más `currentRevision` en el 412. **No** se reenvían `issues` ni `warnings`: el editor tiene el mismo veredicto en local, y reenviarlos obligaría a sanear su forma (`layer`, `path`, `nodeId`, `message`) con otro mutante. Lo fijan un test con el cuerpo `MARCA-ISSUE` y el mutante `forwardIssues`.

Descartado:
- **Reenviar siempre el texto recibido**: la spec define el texto JSON como `JSON.stringify` del valor, y un cuerpo con espacios llegaría distinto.
- **Responder `invalid_request` a un cuerpo demasiado profundo**: la spec reserva ese código para lo que no es un objeto.
- **Un fichero de manejadores aparte**: obligaría a exportar `respond` y `rejectedByFrontier` y a cambiar la guarda de importadores de `operations.ts`. Al mismo coste, `handlers.ts` sigue siendo el único sitio.

### D3. Cliente del navegador del editor

En `src/lib/web-client.ts`, el único sitio con `fetch` (ESLint):
- `RequestOptions.method` admite `'PUT'`.
- `createEditorClient(fetchImpl)` y `export const editorClient` con seis llamadas, `credentials: 'same-origin'`, modo `cors` (sin `mode:`), `cache: 'no-store'` y el plazo de lectura de 30 s.
- La lectura por estado es la de D9 de `web-chat`: un 204 es éxito, un 4xx/5xx sin cuerpo es `unknown` y solo un `fetch` rechazado es `network_error`.

```ts
interface EditorClient {
  listFlows(offset: number, signal?: AbortSignal): Promise<ClientResult<Page<FlowSummary>>>;
  getFlow(flowId: string, signal?: AbortSignal): Promise<ClientResult<FlowResource>>;
  createFlow(text: string): Promise<ClientResult<FlowResource>>;                      // 201
  updateFlow(flowId: string, text: string, revision: number): Promise<ClientResult<FlowResource>>; // If-Match: "<revision>"
  publishFlow(flowId: string, revision: number): Promise<ClientResult<VersionResource>>;            // 201 o 200: `status` los distingue
  deleteFlow(flowId: string, revision: number): Promise<ClientResult<null>>;                         // 204
}
```

`FlowResource` y `VersionResource` (y sus lectores `readFlowResource` y `readVersionResource`) viven en `src/lib/editor/api-types.ts`. Comprueban los campos que usa el editor y que `flow` sea un objeto, y **no** validan el flujo: lo hace `validateFlow`. `FlowSummary`, `Page` y sus lectores se reutilizan de `src/lib/chat/api-types.ts` sin cambios. `ChatErrorCode` ya contiene todos los códigos del editor (`flow_already_exists`, `flow_id_reserved`, `invalid_flow`, `literal_credential`, `revision_mismatch`…).

### D4. Modelo de estado: `EditorSession`, el borrador como JSON y sin normalizar

`src/lib/editor/editor-session.ts` es una clase sin React con `subscribe`/`getSnapshot` (`useSyncExternalStore` en `src/hooks/use-editor-session.ts`), como `ConversationSession`. Recibe el cliente como dependencia. La instantánea es inmutable:

```ts
interface EditorSnapshot {
  phase: 'loading' | 'not_found' | 'load_error' | 'ready';
  loadError: ChatErrorCode | null;
  saved: { text: string; revision: number; name: string; latestVersion: number | null; unpublishedChanges: boolean } | null;
  draft: FlowDoc | null;        // la fuente de verdad: el valor JSON del flujo tal como lo devolvió la API, editado
  draftText: string;            // JSON.stringify(draft): el borrador nunca supera la profundidad (D5)
  dirty: boolean;               // draftText !== saved.text
  verdict: FlowValidationResult | null;   // validateFlow(draft), en cada cambio (D6)
  positions: ReadonlyMap<string, { x: number; y: number }>; // las del flujo más las del diseño automático (D11)
  selection: { kind: 'node'; id: string } | { kind: 'flow' } | null;
  busy: null | 'saving' | 'publishing' | 'deleting' | 'reloading';
  notice: EditorNotice | null;  // conflicto, guardado sin confirmar, flujo borrado fuera, error de una acción o motivo local
  announcement: { seq: number; text: string } | null; // para la región de estado (D17)
}
```

- **Fuente de verdad**: `draft`, el objeto que dio `JSON.parse` de la respuesta (`FlowDoc = Record<string, unknown>`), no un modelo propio. Cada edición es una función pura `(draft) → draft` sobre JSON (D5). No hay copia del flujo en otra forma, así que nada se reordena, rellena ni redondea al abrir.
- **Sin cambios**: `dirty` compara `draftText` con `saved.text`. `saved.text` es `flowText(resource.flow)` de la última lectura o del último 200. Deshacer a mano vuelve a dar el mismo texto (escenario «Cambio deshecho a mano»). No se compara por identidad de objetos (mutante `dirtyByIdentity`).
- **Abrir no escribe nada**: `open()` guarda `draft = resource.flow` y calcula `positions` aparte. El diseño automático nunca entra en `draft` hasta mover, añadir o conectar arrastrando (mutante `persistAutoLayout`).
- **Ediciones** (`edit(change)`): son síncronas. Aplican la función, recalculan `draftText`, `dirty`, `verdict` y `positions`, y notifican. Pueden devolver un error de campo (renombrar a un id ocupado, JSON que no es un objeto) sin cambiar nada. Se puede editar mientras se guarda: el 200 actualiza `saved` con lo **enviado**, y lo escrito después sigue como cambio sin guardar.
- **Época**: `reset()` (D15) incrementa un contador y aborta las lecturas en curso. Una respuesta que llega con una época vieja se ignora (mutante `ignoreEpoch`).
- **Una acción a la vez**: con `busy` distinto de `null`, guardar, publicar, borrar, descartar y recargar no hacen nada. Es la defensa del doble clic, no el `disabled`. Los botones usan `aria-disabled` para que el foco no caiga a `body`.
- Las acciones devuelven un resultado (`SaveOutcome`, `PublishOutcome`…) con el que la pantalla decide el foco y la navegación. La sesión no navega ni mueve el foco: el proveedor provee y el consumidor decide.

Descartado:
- **Un modelo propio (nodos y aristas) que se serializa al guardar**: cada ida y vuelta es una ocasión de reordenar o rellenar, y eso crea revisiones de más (`flows-api`, «Guardar sin cambios»).
- **Estado en un `useReducer` de la pantalla**: no se prueba sin React, y el chat ya demostró el patrón de clase con instantánea.
- **Una librería de estado** (Zustand, Redux): ningún requisito la pide.

### D5. Editar sobre el JSON: reglas de los campos

`src/lib/editor/json-edit.ts` (puro) tiene `getIn`, `setIn` y `removeIn` sobre rutas de JSON Pointer, con copia por la ruta y el resto compartido:

- **Conserva el sitio**: `setIn` de una clave que existe la sustituye en su posición (se reconstruye con `Object.entries`/`Object.fromEntries`). Una clave nueva va al final. Mutante `reorderOnEdit`.
- **`__proto__`, `constructor` y claves numéricas** son claves propias normales: nunca `obj[key] = value`, siempre `Object.fromEntries` o *spread* ([[gotcha-variables-nombre-proto]]). Lo prueba un test con una cabecera `__proto__` y un `body` con claves `"10"` y `"a"`, comparando el texto.
- **Profundidad** (delta `0520b08`): el borrador nunca pasa de 1000 niveles. El de la API está validado, y las únicas entradas de JSON escrito a mano son «Editar como JSON», `request.body`, los predicados y el modo JSON de un valor. Todas comprueban `exceedsFlowDepth(flujo resultante)` **antes** de aplicar. Si lo supera, el campo dice «El JSON anida demasiados niveles: el máximo es 1000.», conserva el texto y no cambia nada (mutante `skipDepthCheckOnApply`). Por eso `flowText` (`src/lib/editor/flow-text.ts`) es un `JSON.stringify` sin caso nulo y ningún `RangeError` llega a la interfaz. «Crear desde JSON» no aplica nada: `validateFlow` da el problema de profundidad y no se envía.

`src/lib/editor/fields.ts` traduce lo que escribe un campo a una escritura en el JSON (requisito «Campos sobre el JSON del flujo»):

| Campo | Escribe |
|---|---|
| Texto (también plantillas) | El texto tal cual, en cada pulsación, sin recortar. Vacío en uno **opcional**: quita la propiedad. Vacío en uno obligatorio (`name`, `url`, `goal`): `""`, que el validador señala |
| Numérico | Si el texto cumple `^-?[0-9]+(\.[0-9]+)?$`, `Number(texto)`. Si no, el texto (`abc`) para que lo señale el validador. Vacío en uno opcional: quita la propiedad. El campo conserva lo escrito mientras tiene el foco (`1.50` no salta a `1.5`). Mutante `parseLooseNumber` |
| Lista cerrada (`enum`) | El valor elegido. Si es opcional, tiene la opción «(por defecto: X)» o «(ninguno)», que quita la propiedad. Las opciones salen de `schema.$defs…enum`, no se copian |
| Sí/no con `default` | Casilla. Al volver al `default` del esquema (`pii` desmarcado, `required` marcado), quita la propiedad, **salvo** que el último guardado tuviera esa propiedad escrita **con el valor por defecto** en la misma ruta: entonces la vuelve a escribir con el valor por defecto, en su sitio (`"pii": false` marcado y desmarcado deja el texto como estaba). Con un guardado con `"pii": true`, desmarcar quita la propiedad: el valor por defecto no estaba escrito. Nunca escribe un `default` que no estuviera. Mutantes `writeDefaults` y `forgetSavedDefault`; el test de este último cubre los dos casos. Si la ruta cambió (se borró un elemento anterior de la lista), el caso degrada a quitar la propiedad, que significa lo mismo |
| Salto | Selector con «(ninguno)», que quita la propiedad, y los nodos en el orden de `nodes`. Un salto roto aparece como «`<id>` (no existe)» elegido |
| Valor (`value` de `set`, de opción y de regla, y `default`) | Modo (texto, número, sí/no, nulo, JSON, y «(ninguno)» si es opcional, según los tipos que admite el esquema) y su valor. JSON: si no se puede parsear, el campo lo dice, conserva el texto y no escribe nada |
| JSON libre (`request.body`, predicado con `all`/`any`) | Igual que el modo JSON. Vacío en `body`: quita la propiedad |

- **Contenedores opcionales vacíos** (delta `4ced695`): si al quitar una propiedad o un elemento queda vacío un objeto o una lista **opcionales** del esquema (`settings`, `validation`, `request.headers`, `variables`, `responseMap`, `slots` y el `content` de un `end`), se quita también. Los obligatorios (`content` de un `message`, `rules`, `assignments`, `choices` de una selección) se quedan `[]` y el validador los señala. Mutante `keepEmptyContainers`.
- **Plantillas de elementos nuevos**, solo con lo obligatorio: variable `{name: "", type: "string"}`, opción `{id: "opcion-<n>", label: ""}`, regla `{when: {variable: "", op: "eq"}}`, asignación `{variable: "", value: ""}`, `responseMap` `{variable: "", pointer: ""}`, `slot` `{variable: "", description: ""}` y contenido `{kind: "text", text: ""}`. Cambiar el `kind` de un contenido de texto a multimedia sustituye el elemento en su sitio por `{kind, url: ""}`, y al revés por `{kind: "text", text: ""}`. Entre tipos multimedia solo cambia `kind`.
- **Cabeceras**: cada fila tiene nombre, modo («Texto» o «Secreto») y valor. «Secreto» escribe `{"secret": "<NOMBRE>"}` y su campo pide **el nombre** («Nombre del secreto, en mayúsculas»), nunca un valor. Pasar de secreto a texto escribe `""` en su sitio. Una cabecera nueva se escribe con un mini formulario (nombre, modo, valor y «Añadir cabecera»), que la añade al final. Así nunca hay una clave a medias en el JSON. Renombrar una cabecera la cambia en su sitio, y un nombre repetido lo indica el campo sin cambiar nada.

### D6. Validación en vivo: síncrona, en el navegador y sin agrupar (pregunta 12)

`EditorSession.edit` llama a `validateFlow(draft)` en la misma pila del cambio y guarda el veredicto en la instantánea. No hay *debounce*, Web Worker, `useDeferredValue` ni llamada a la API. «Guardar» decide con ese mismo veredicto, siempre al día.

Coste (medido, ver Context): 0,09 ms con los ejemplos y 12-20 ms con un flujo de 5000 nodos y 1 MiB, más 1-2 ms de `JSON.stringify`. Un cambio de los ejemplos se ve en el siguiente *frame*, y el requisito es menos de 1 s. Con 1 MiB, el coste de validar es menor que el de pintar 5000 nodos, que la propuesta deja sin objetivo de fluidez.

- La lista muestra `verdict.issues` (ya acotados a 100 por `validateFlow`) y `capWarnings(verdict.warnings)`. Las decisiones (`credential_header_literal` al guardar) usan la lista **completa**, como la API.
- Con algún issue de `layer: 'shape'`, la lista avisa: «Hay problemas de forma: el resto de comprobaciones llegará al corregirlos.» Es [[gotcha-ajv-errores-oneof]] y la regla de `validateFlow`, que no corre la semántica sin forma correcta.
- `src/lib/editor/issues-view.ts` (puro) agrupa por `nodeId` para las marcas del lienzo y por `path` para los campos. Un campo muestra debajo, enlazados con `aria-describedby`, los problemas y avisos cuyo `path` empieza por su puntero. Así se ven los avisos de credenciales en su cabecera.

Descartado:
- **Web Worker**: copiar 1 MiB al *worker* (*structured clone*) en cada cambio cuesta lo mismo que validar. Además, el veredicto llegaría tarde y desordenado («Guardar» necesitaría esperarlo), los tests necesitarían un *worker* y la CSP le afecta igual (`Function` también en el *worker*).
- **Agrupar pulsaciones** (*debounce* de 200-300 ms): cumpliría el segundo, pero mete temporizadores en la sesión y en los tests, y deja un veredicto viejo justo cuando se pulsa «Guardar». No hace falta con lo medido.
- **`POST /flows/validate`**: la spec lo prohíbe («Validar no llama a la API»).

Si en el *runner* un cambio con el flujo de 1 MiB pasa de 100 ms (FOLLOW-UP 7.2), el siguiente paso es `useDeferredValue` para el lienzo y la lista, sin tocar la sesión.

### D7. ajv y la CSP (pregunta 13)

`validateFlow` compila sus validadores con `Function` al cargar el módulo (medido). Hoy funciona porque la CSP de la web es solo `frame-ancestors 'none'` (`securityHeaders`, D24 de `web-chat`).

**Decisión**: no se precompila. Queda fijado con tres cosas:
1. **Test** en `src/server/frontier-editor.test.ts`: «la CSP no restringe scripts: el validador del editor compila con Function». La cabecera no tiene `script-src` ni `default-src`, y es exactamente `frame-ancestors 'none'`.
2. **Mutante** `scriptSrcWithoutEval`: añade `; script-src 'self'` a la CSP y debe morir con ese test.
3. **E2E**: cualquier escenario de validación en vivo («Error al dejar un nodo sin conectar») falla con una CSP que lo impida.

El fallo no sería silencioso: si `Function` estuviera prohibido, la carga del *chunk* del editor lanzaría `EvalError`, `error.tsx` mostraría «Algo ha fallado» y la consola tendría el error, que los E2E rechazan.

**Solo el editor carga ajv**: la guarda estática prohíbe importar código de `@franca/spec` (sin `import type`) desde el navegador fuera de `src/lib/editor/**` (D21). El *chunk* de 144 KB solo lo carga `/flujos` y `/flujos/<id>` (medido: `/` no lo carga).

Descartado:
- **ajv *standalone* precompilado en la web**: exige reimplementar `validateFlow` (piezas, presupuesto, mensajes) en `apps/web` contra los validadores generados. Viola «el formato vive solo en `@franca/spec`».
- **Precompilarlo en `packages/spec`**: es cambiar `packages/` (fuera de alcance según la propuesta). Si algún día llega una CSP con `script-src`, ese es el camino, con su propio cambio (FOLLOW-UP 7.4).
- **`'unsafe-eval'` explícito**: no hay `script-src` que lo necesite. Añadir una directiva solo para permitir algo que hoy no está prohibido es más superficie.

### D8. Inspector y panel del flujo por descriptores con paridad al esquema

`src/lib/editor/node-fields.ts` describe, sin React, el formulario de cada tipo y del flujo: una lista de campos por tipo con su clave y su clase (`id`, `readonly`, `text`, `template`, `number`, `integer`, `enum`, `boolean`, `target`, `content`, `value`, `json`, `predicate`, `headers`, `object` con sus campos y `list` con los campos de cada elemento y su plantilla). `inspector-field.tsx` pinta cada clase. Así se cubren los ocho tipos sin ocho formularios a mano.

| Tipo | Campos (además de `id`, `type` y `position` de solo lectura, y `title`) |
|---|---|
| `message` | `content`, `next` |
| `input` | `inputType`, `variable`, `prompt`, `placeholder`, `validation` (`pattern`, `min`, `max`, `retryMessage`, `maxRetries`), `choices` (`id`, `label`, `value`, `imageUrl`, `next`), `multiple`, `next` |
| `condition` | `rules` (`when`: regla `variable`/`op`/`value` o JSON con `all`/`any`; `next`), `else` |
| `set` | `assignments` (`variable`, `value`), `next` |
| `http` | `request` (`method`, `url`, `headers`, `body`), `timeoutMs`, `retries`, `responseMap` (`variable`, `pointer`), `next`, `onError` |
| `llm` | `provider` (texto: un nombre), `model`, `system`, `goal`, `slots` (`variable`, `description`, `required`), `maxTurns`, `costCapUsd`, `temperature`, `next`, `onExhausted` |
| `jump` | `target` |
| `end` | `content`, `outcome` |
| Flujo | `specVersion` e `id` (solo lectura), `name`, `description`, `locale`, `settings` (`typingDelayMs`, `sessionTimeoutMinutes`), `start` (selector sin «ninguno»), `variables` (`name`, `type`, `scope`, `pii`, `description`, `default`) |

- **Paridad** (`node-fields.test.ts`): por cada definición de nodo del esquema (`$defs.node.oneOf`), el conjunto de claves de su descriptor es igual a `nodeBase.properties` ∪ `<tipo>Node.properties` sin `type`, y lo mismo en cada objeto y elemento de lista anidados, en la raíz del flujo y en `variable`. La clase de cada campo es compatible con el esquema (`integer` con `"type": "integer"`, `enum` con su lista…). Si el esquema añade una propiedad, el test falla hasta que el editor la cubra.
- **`position` de solo lectura** (delta `4ced695`): se muestra «x, y» o «automática» y se cambia moviendo el nodo o con «Editar como JSON». Como campo editable chocaba con «Mover un nodo» (enteros, y fijar todas las posiciones a la vez) y con la regla de los campos numéricos.
- **Valores que el formulario no sabe editar** (p. ej. `content` que no es una lista tras «Editar como JSON», o un tipo desconocido): el campo pasa a JSON libre con una nota. Lo mismo con una lista cuyos elementos no son todos objetos (`rules: [null]`, `choices: [null]`, `assignments: [5]`): la lista **entera** pasa a JSON libre con la nota «Esta lista tiene elementos que el formulario no edita: corrígela como JSON.», en vez de pintar filas sobre valores que no son objetos. Un tipo de nodo desconocido muestra solo `id`, `type` y «Usa «Editar como JSON» para este nodo».
- `choices` y `multiple` se muestran con `inputType` `choice` o si ya existen. El resto de campos se muestran siempre.
- **Renombrar** (`id`): el campo tiene su propio texto y aplica el cambio al perder el foco o con Intro, si es válido (`rename.ts`, que recorre los saltos con `nodeTargets`, D10). Mientras se escribe, dice si el id no cumple el patrón o ya lo tiene otro nodo, y no cambia nada hasta que es válido.

### D9. Lienzo propio en DOM y SVG, sin librería (pregunta 16)

El lienzo es un componente propio (`src/components/editor/canvas/`). Una zona con desplazamiento nativo (`overflow: auto`, `tabIndex={0}`, `aria-label="Lienzo del flujo"`) contiene un «mundo» de tamaño `límites × zoom`, y dentro una capa con `transform: scale(zoom)` y `transform-origin: 0 0` con:
- un `<svg aria-hidden="true">` con las conexiones;
- un `<div>` por nodo, en el orden de `nodes`, con posición absoluta.

**Desplazar**: las barras y la rueda del propio navegador, más arrastrar el fondo con el ratón. **Ampliar**: «Reducir», «Ampliar» y «Tamaño real» (0,5 a 2, por pasos de ×1,25). No hay Ctrl/⌘ + rueda: bastan los botones. «Llevar el lienzo hasta un nodo» es `scrollIntoView({block: 'center', inline: 'center'})` del nodo dentro de la zona.

| | Lienzo propio (elegido) | React Flow (`@xyflow/react` 12) |
|---|---|---|
| Tamaño | ~0 KB de dependencias, unos 600-800 líneas propias | ~45-50 KB en gzip con `zustand`, `d3-zoom`, `d3-drag` y su CSS |
| Licencia | — | MIT |
| Teclado y lector de pantalla | El nodo es un botón con el nombre de la spec; las flechas mueven 10 unidades; las salidas no reciben el foco. Todo bajo control | Teclado propio (flechas de 5 en 5 y su `aria-live` en inglés) que hay que desactivar y rehacer, y aristas y asas enfocables que hay que apagar |
| Reglas de la spec | Soltar en vacío, Escape, propio nodo y autosalto de `llm`, y la marca «Soltar aquí» con texto, en una función pura (D12) | `isValidConnection`, `onConnectEnd` y estado de conexión: posible, pero repartido en *callbacks* de la librería |
| Diseño automático | El mismo módulo puro (D11) | No trae: habría que añadir `dagre` o `elkjs`, o el mismo módulo |
| Red y React 19 / Next 16 | Sin peticiones. Componentes cliente normales | Sin peticiones. Compatible, pero una dependencia más que alinear en cada versión de React |
| Versión fija ≥ 2 semanas | No aplica | Habría que fijar una en el *lockfile* y revisarla |

**Por qué propio**: la v0 tiene decenas de nodos, ningún requisito pide *minimap*, agrupar, multiselección ni ajuste a rejilla, y casi todo lo que aporta una librería (teclado, ARIA, conexiones) habría que rehacerlo o apagarlo para cumplir la spec. La zona con desplazamiento nativo da gratis «se desplaza», el teclado del navegador en la zona y `scrollIntoView`.

Descartado también:
- **`<canvas>` 2D**: el texto no es accesible ni se puede seleccionar, y los E2E no tendrían elementos que mirar.
- **Todo en SVG** (nodos incluidos): el texto con ajuste de línea y el foco son peor que en HTML.

### D10. Salidas, conexiones y geometría

**Salidas** (`src/lib/editor/outputs.ts`, `nodeOutputs(node)`): una por cada salto que usa el motor según el tipo (requisito «Salidas de cada tipo de nodo»), cada una con `key` (el nombre de su campo, como en `targets`), `pointer` (dentro del nodo) e `id` (destino o `null`):
- `message`, `set` e `input` que no es de selección única: `next`.
- `input` con `inputType: "choice"` y sin `multiple: true`: `choices[<id>].next` por cada opción (puntero `/choices/<i>/next`), también sin `next`.
- `condition`: `rules[<i>].next` y `else`. `http`: `next` y `onError`. `llm`: `next` y `onExhausted`. `jump`: `target`. `end` y un tipo desconocido: ninguna.
- En selección múltiple, **no** hay salidas por opción (`resumeInput` las ignora). Mutante `multipleChoiceOutputs`.

**Saltos de un nodo cualquiera** (`src/lib/editor/node-targets.ts`, revisión 2, B1): `nodeTargets(node)` es la única puerta del editor a `targets` de `@franca/spec`. Lo llaman `outputs`, `canvas-model`, `layout` y `rename`. Antes de llamarlo comprueba la estructura mínima que `targets` recorre sin protección:
- en `condition`, `rules` es una lista y cada elemento es un objeto;
- en `input`, `choices` falta o es una lista de objetos.

Si se cumple, llama a `targets(node)`; si no, recorre lo que se puede leer sin lanzar (los campos `next`, `else`, `onError`, `onExhausted` y `target`, y los `rules[i].next` y `choices[i].next` de los elementos que son objetos). **En los dos caminos** el resultado se filtra igual (revisión 3, medido en `dist`):
- **Solo saltos con `id` de tipo texto.** `targets` empuja `rules[i].next` sin mirarlo: la plantilla de regla nueva (`{when: {variable: "", op: "eq"}}`, sin `next`) daría una conexión rota hacia `undefined`, y `rules: [{next: 5}]` una hacia `5`. Un salto que no es texto no es una conexión: el validador ya lo señala en su campo.
- **La clave de una opción** es `choices[<id>].next` si su `id` es texto, y `choices[<índice>].next` si no lo es. `targets` daría `choices[[object Object]].next`.
- La `key` es solo la etiqueta visible. Como dos opciones pueden repetir `id`, la identidad de una salida o de una conexión es su **`pointer`**, que es único dentro del nodo. Las `key` de React de las salidas y las conexiones son `<índice del nodo>:<pointer>`, nunca la `key` del salto ni el `id` del nodo.

`nodeOutputs` también es defensivo: una condición sin `rules` válidas tiene solo `else`, y un `input` con `choices` que no es una lista no tiene salidas de opción. Lo prueban, en `node-targets.test.ts`, `canvas-model.test.ts` y `layout.test.ts`:
- las ocho plantillas de «Añadir nodo» pasadas por `canvasModel` y `autoLayout`;
- nodos mal formados (`rules` ausente, `5` o `[null]`; `choices` `"x"` o `[null]`; `type` desconocido) sin lanzar, en `canvasModel`, `autoLayout`, `renameNode` y `nodeOutputs`;
- en `canvas-model.test.ts`:
  - una condición con la plantilla de regla añadida no tiene conexión para esa regla (solo su salida vacía);
  - `rules: [{next: 5}]` no da ninguna conexión;
  - dos opciones con el mismo `id` dan dos salidas y dos conexiones con `pointer` distintos;
  - una opción con `id` `{}` da la etiqueta `choices[0].next`.

  Mutante `keepNonTextTargetIds` (quita el filtro de `id` de texto).

Mutante `callTargetsDirect` (llama a `targets` sin la comprobación). La guarda estática exige que solo `node-targets.ts` importe `targets`. El hallazgo va a la wiki (`gotcha-targets-asume-forma-valida`, fase 6). Un E2E añade una condición y comprueba que el lienzo la pinta con su salida `else` y la lista dice que le faltan `rules` (D22). `validateFlow` sigue llamando a `targets` por su cuenta, solo con la forma ya validada.

**Conexiones** (`src/lib/editor/canvas-model.ts`): una por cada salto de `nodeTargets(node)`, sin reimplementar `targets`. Si el destino no existe, la conexión es rota. Cada una sale de la fila de su salida (por `pointer`). Si no hay salida para ese puntero (opciones con `next` en una selección múltiple), sale del borde del nodo.

**Geometría** (`src/lib/editor/canvas-geometry.ts`, constantes enteras): ancho 208, cabecera 64 (id, tipo en español y `title`, con puntos suspensivos), 24 por salida y separaciones de 96 en horizontal y 40 en vertical. `nodeSize(node)` lo usan el diseño automático y el CSS. El nodo tiene `width` y `height` **fijos** desde `nodeSize`, con `overflow: hidden`, y cada texto (id, tipo, `title` y nombre de salida) va en una línea recortada con puntos suspensivos (`truncate`). El texto completo está en el nombre accesible y en el inspector. Así el pintado nunca pasa de la caja que el diseño automático cree que ocupa. Lo prueban `canvas-node.test.tsx` (el estilo lleva el alto y el ancho de `nodeSize` y `overflow-hidden`, también con un `title` de 120 caracteres) y el E2E «Abrir sin posiciones no cambia el flujo» (la `boundingBox` de cada nodo no pasa de `nodeSize × zoom`, y ninguna se solapa con otra).

**Pintado**:
- La salida es una fila con su nombre en el nodo y un punto en el borde derecho (`<span data-output="<key>" data-pointer="<pointer>" aria-hidden="true">`, sin `tabIndex`). Los E2E la buscan por `data-output`, que es único en los flujos de los escenarios.
- La conexión es una curva desde ese punto hasta el borde izquierdo del destino, y un lazo si apunta al propio nodo (`next` de un `llm`).
- Una conexión rota es discontinua y acaba en una marca con el texto «`<id>` no existe».
- Atributos para los tests: `data-edge-from`, `data-edge-key`, `data-edge-pointer`, `data-edge-to` y `data-broken`.

**Texto de los valores del flujo** (revisión 3, medido: un `title` `{"es":"Saludo"}` o un `type` objeto escritos con «Editar como JSON» dan «Objects are not valid as a React child» y `error.tsx`). Una sola función, `asText(value)` (`src/lib/editor/as-text.ts`, pura), convierte para pintar:
- un texto, tal cual;
- cualquier otro valor (`{}`, `[]`, `5`, `null`, `true`), con `JSON.stringify(value)`. Es seguro porque el borrador nunca pasa de 1000 niveles (D5). `undefined` da `""`.

La usan todos los sitios donde un valor del flujo llega a la interfaz como texto:
- en el nodo: `id`, tipo (la etiqueta de `NODE_TYPE_LABELS` si `type` es uno de los ocho; si no, `asText(type)`), `title` y su nombre accesible;
- los nombres de las salidas;
- la marca de conexión rota;
- la lista de problemas (`nodeId` y la parte del flujo);
- las opciones del selector de salto y de `start`.

Los campos del inspector no la necesitan: un valor con un tipo que su clase no edita pasa a JSON libre (D8). Lo prueban:
- `as-text.test.ts`;
- `canvas-node.test.tsx`, con `title` `{}`, `[]`, `5` y `null`, y `type` `{}`, sin lanzar y con el texto JSON visible;
- `problems-list.test.tsx`.

Mutante `renderRawTitle` (el nodo pinta `node.title` sin `asText`), que muere con `canvas-node.test.tsx`.

**Nodo**: `<div role="button" tabIndex={0} data-node-id aria-pressed={seleccionado}>`. Lleva visibles el id, el tipo (`NODE_TYPE_LABELS`: Mensaje, Pregunta, Condición, Asignación, Llamada HTTP, Paso con LLM, Salto y Fin), el `title`, la marca «Inicio» y, si los hay, «N problemas» o «N avisos» con texto. Su nombre accesible es «`<id>`, `<tipo>`[, inicio], N problemas | sin problemas». Los textos son nodos de texto de React (sin `dangerouslySetInnerHTML`, ya prohibido por ESLint).

### D11. Diseño automático y posiciones

`autoLayout(flow)` (`src/lib/editor/layout.ts`, puro y determinista) devuelve la posición entera de cada nodo **sin** `position` válida:
1. **Capas**: búsqueda en anchura desde `start`, siguiendo `nodeTargets` en su orden y solo hacia nodos que existen (el primero que llega gana). Los nodos no alcanzados se recorren en el orden de `nodes`: cada uno empieza su propia búsqueda en la capa siguiente a la última usada.
2. **Columnas**: la capa `L` va en `x = origen.x + L × (ancho + 96)`. El origen es la `position` de `start` si la tiene (redondeada), o `(0, 0)`.
3. **Filas**: dentro de la capa, en el orden de descubrimiento, desde `origen.y` hacia abajo. Un nodo que choca con otro ya colocado o con uno con `position` (con un margen de 40) baja hasta debajo de él. Mutante `skipOverlapCheck`.
4. Los nodos con `position` no se mueven y ocupan su sitio.

El coste es lineal más las comprobaciones contra los nodos con `position` de la misma franja. Los tests:
- dos llamadas dan lo mismo;
- ningún par de cajas se solapa (también con posiciones existentes en medio);
- `bienvenida` de `captacion-leads` se queda en `{0, 0}`;
- es estable ante un cambio de texto.

**Fijar posiciones** (`src/lib/editor/positions.ts`):
- `fixPositions(flow, positions)` añade `position` (enteros) **al final** de cada nodo que no la tiene, con la posición en que se ve.
- `moveNode(flow, id, dx, dy, positions)` primero fija todas y después escribe la del nodo movido, redondeada, en su sitio (mutante `fixOnlyMovedNode`).
- Lo usan:
  - mover con el ratón (al soltar);
  - mover con las flechas (10 unidades por pulsación);
  - «Añadir nodo» (fija todas y crea el nuevo con su `position` en el centro de la zona visible);
  - conectar una salida, arrastrando **o eligiendo su destino en el selector del inspector**, también «(ninguno)» (delta `0520b08`). Los dos caminos usan `connectOutput(flow, positions, nodeId, pointer, destino)` = `setTarget(fixPositions(flow, positions), …)`, así que dan el mismo JSON, posiciones incluidas. Mutante `inspectorTargetWithoutFix`.
- El resto de ediciones (textos, renombrar, borrar un nodo, «Editar como JSON») no fijan posiciones. Borrar un nodo o cambiar saltos por JSON puede recolocar los nodos que siguen sin `position`, como dice la spec.
- Un nodo con una `position` inválida (escrita a mano) se pinta en la automática y no se toca hasta moverlo.

**Mundo**: los límites son el mínimo y el máximo de las posiciones mostradas, con margen. Mientras se arrastra un nodo, los límites quedan congelados. Al soltar, si el origen del mundo cambia, la zona corrige su `scrollLeft`/`scrollTop` en la misma diferencia, para que nada salte bajo el puntero.

### D12. Arrastrar: mover nodos y crear conexiones, con el soltar en un módulo puro

Con Pointer Events y `setPointerCapture`, en `src/components/editor/canvas/use-canvas-drag.ts`:

- **Mover**: `pointerdown` en el cuerpo del nodo. Mientras dura, el nodo se pinta desplazado en el estado local, sin tocar el flujo. Al soltar, si se movió más de 3 px, `session.edit(moveNode(…, dx/zoom, dy/zoom))`, una sola escritura. Si no, es un clic y selecciona. Escape o `pointercancel` lo cancelan.
- **Conectar**: `pointerdown` en el punto de una salida. Una línea provisional sigue al puntero. Ella y su `<svg>` llevan `pointer-events: none`, así que `elementFromPoint` nunca la devuelve en lugar del nodo de debajo. En cada `pointermove`, el nodo bajo el puntero es `document.elementFromPoint(x, y)?.closest('[data-node-id]')`, solo si está dentro de la zona del lienzo. Mientras dura, cada nodo lleva `data-drop="allowed"` o `"denied"`, según `canDropOn`:
  - Uno permitido muestra un borde discontinuo y el texto «Soltar aquí».
  - El prohibido (el propio nodo, salvo en el `next` de un `llm`) se atenúa y muestra «No se puede soltar aquí».

  Así la diferencia no es solo el color. Al soltar, `resolveDrop` decide.

`src/lib/editor/drop.ts` (puro):

```ts
type DropResult = { kind: 'none' } | { kind: 'reject'; reason: 'self' } | { kind: 'connect'; flow: FlowDoc };
function canDropOn(flow, sourceId, outputPointer, targetId): boolean;
function resolveDrop(input: { flow; positions; sourceId; outputPointer; targetId: string | null; cancelled: boolean }): DropResult;
```

- `cancelled` (Escape, `pointercancel`) o `targetId === null` (vacío o fuera del lienzo): `none` y el flujo no cambia (mutante `clearOnEmptyDrop`).
- `targetId === sourceId`: `reject` salvo que el nodo sea `llm` y la salida `next` (mutantes `allowSelfDrop` y `allowLlmExhaustedSelf`). La pantalla anuncia «Un nodo no puede saltar a sí mismo.» en la región de estado y no cambia nada.
- Si no: `connect` con `connectOutput(flow, positions, sourceId, outputPointer, targetId)`. Es la **misma** función que usa el selector del inspector (D11; escenario «El arrastre y el inspector dan el mismo flujo»). La salida que ya tenía destino se sustituye en su sitio.

**Escape** se escucha en `window` (`keydown`, añadido al empezar el arrastre y quitado al terminarlo), no en el nodo ni en la salida, que no tienen el foco. Cancela mover y conectar.

Las salidas no reciben el foco. La vía del teclado es el selector de cada salto en el inspector (requisito «Crear conexiones arrastrando»).

### D13. Guardar, conflicto, respuesta perdida y errores

`save()`:
1. **Barreras locales** (`src/lib/editor/save-gate.ts`, puro), en este orden. Si alguna salta, no se envía nada y la pantalla muestra su motivo y lleva el foco a la lista de problemas:
   1. `!dirty`: «No hay cambios que guardar.»
   2. `!verdict.valid`: «Corrige los problemas antes de guardar.» (mutante `saveInvalid`).
   3. Algún `credential_header_literal` en la lista completa: «Hay una credencial escrita en una cabecera: usa un secreto.» (mutante `skipLiteralCredentialCheck`).
   4. Los bytes UTF-8 de `draftText` (`TextEncoder`) pasan de 1 048 576: «El flujo supera el tamaño máximo de 1 MiB.» (mutante `countCharsNotBytes`). El tope es `MAX_FLOW_BYTES` (`src/lib/editor/limits.ts`), con paridad contra el número de la spec (D21).
2. `PUT` con el texto `sent = draftText` e `If-Match: "<saved.revision>"`.
3. Resultado:

| Resultado | Qué hace |
|---|---|
| 200 | `saved = {text: flowText(body.flow), revision: body.revision, …}`, anuncia «Guardado. Revisión N.» y el foco se queda en «Guardar» |
| 412 `revision_mismatch` | Conserva los cambios. Aviso «El flujo ha cambiado en otra pestaña o fuera del editor.» con «Cargar el guardado» y, si llegó `currentRevision`, «Guardar encima». `saveOver()` repite el `PUT` con el texto **actual** e `If-Match: "<currentRevision>"`, **nunca** `*` (mutante `ifMatchStar`). Otro 412 vuelve a mostrar el aviso con la revisión nueva |
| `network_error`, `api_unreachable`, `invalid_api_response` o cualquier 5xx | **Releer antes de nada** con `getFlow`. Si `flowText(leído.flow) === sent`, da el guardado por hecho con la revisión leída (anuncio de guardado). Si no, o si la lectura falla, conserva los cambios y dice «No consta que se hayan guardado los cambios. Siguen en el editor.» (con `database_unavailable`: «La base de datos de Franca no está disponible: no consta que se hayan guardado los cambios.»). `saved` no cambia. **Nunca** reenvía (mutantes `resendOnLoss` y `trustLostWithoutCompare`) |
| 404 `flow_not_found` | «El flujo se ha borrado fuera del editor. Usa «Ver JSON» para copiar lo que has editado.» Los cambios se quedan |
| 400 `invalid_flow` | «La API de Franca considera que el flujo no es válido.» |
| 400 `literal_credential` | «La API de Franca no guarda credenciales escritas: usa un secreto.» |
| 413 `payload_too_large` | «El flujo supera el tamaño máximo de 1 MiB.» |
| Cualquier otro (`flow_id_mismatch`, `precondition_required`, `unknown`…) | «No se ha podido guardar el flujo.» |

Ningún texto lleva el `message` de la API (no llega al navegador, D2). Releer y comparar el texto, y no reenviar con el mismo `If-Match`, sigue a «Respuesta perdida» del chat: reenviar daría un 412 falso si el primero se aplicó.

### D14. Publicar, Probar, Descartar, Ver JSON y Borrar flujo

- **Publicar** (`publish()`):
  - Con `dirty`: «Guarda los cambios antes de publicar.», sin enviar nada (`checkPublishable` de `save-gate.ts`; mutante `publishWithChanges`).
  - Si no, `POST …/versions` con `If-Match: "<saved.revision>"`.
  - 201: «Publicada la versión N.»; 200: «La versión N ya tiene este borrador.». Los dos ponen `latestVersion = N` y `unpublishedChanges = false` (publicar no cambia `revision`).
  - 412: «El flujo ha cambiado fuera del editor.» con «Cargar el guardado».
  - El resto de códigos, como en D13 (sin releer: publicar no tiene el escenario de respuesta perdida, y repetirlo sobre el mismo borrador da 200), con su genérico «No se ha podido publicar el flujo.» y «No se puede conectar con la API de Franca.» para la conexión.
- **Probar**: `useStartConversation` y `startConversation` del chat tal cual, con contacto `''` (cuerpo `{"flowId"}`). El botón está siempre en el orden del foco, con `aria-disabled` cuando no se puede, y al pulsarlo decide `checkTryable` (`save-gate.ts`, puro, sobre la instantánea):
  - sin versión: «Publica el flujo antes de probarlo.»;
  - con `dirty`: «Guarda los cambios antes de probar.»;
  - si se puede, crea la conversación y navega.

  Sin `dirty` y con `unpublishedChanges`, una nota enlazada con `aria-describedby` dice «Se probará la versión N, no el borrador.». Los errores usan `errorCopy('start', code)` («Errores al empezar» de `web-chat`).
- **Descartar cambios** y **Cargar el guardado** (`reloadSaved()`): «Descartar cambios» pide confirmación antes. Las dos vuelven a leer con `getFlow` y sustituyen `draft` y `saved`. Si la lectura falla, conservan los cambios con el aviso de conexión. Con 404, el aviso de flujo borrado fuera.
- **Ver JSON**: un `<dialog>` modal con un `<textarea readOnly>` con `draftText` (lo que se enviaría al guardar, sin formatear; siempre existe, D5) y «Copiar» (`navigator.clipboard.writeText`, anuncia «Copiado.»).
- **Borrar flujo**: confirmación «El identificador «`<id>`» queda reservado para siempre: no se podrá crear otro flujo con él. Las versiones publicadas y sus conversaciones se conservan.».
  - 204: navega a `/flujos`.
  - 404: navega a `/flujos`.
  - 412: el aviso de cambio fuera con «Cargar el guardado».
  - El resto: «No se ha podido borrar el flujo.» o el de conexión.
- Todas las confirmaciones usan `ConfirmDialog` (`<dialog>` nativo con `showModal`, como `DeleteConversationDialog`), que gestiona el foco y Escape.

### D15. Salir con cambios y `<Activity>` (pregunta 17)

`useEditorSession(flowId)`:
- crea la sesión una vez (`useState(() => new EditorSession(…))`);
- llama a `open()` en un `useEffect`, que corre al montar **y** al volver a mostrarse;
- llama a `reset()` en el *cleanup* de un `useLayoutEffect`, que corre **antes** de que `<Activity>` oculte la ruta.

`reset()` aborta, incrementa la época, vuelve a `loading` y suelta el borrador. Así, al volver a `/flujos/<id>` no se ve ni un instante el estado anterior y no se recupera nada de la visita anterior. Es el patrón de `use-paged-list.ts` y de `preserving-ui-state.md`. En `StrictMode`, el doble montaje hace `reset` + `open` dos veces, sin efectos (la época descarta la primera lectura).

**Confirmación al salir con cambios**:
- **Enlaces de la web** del editor (`GuardedLink`, sobre `<Link>`): `onNavigate` con `dirty` llama a `event.preventDefault()` y abre `ConfirmDialog` («Hay cambios sin guardar. Si sales, se pierden.», «Salir» / «Seguir editando»). «Salir» hace `router.push(href)`. `onNavigate` solo corre en navegaciones del cliente, así que abrir en otra pestaña no pregunta. La cabecera del editor (enlaces a «Chat de prueba» y «Flujos») solo usa `GuardedLink`.
- **Recargar o cerrar**: un `beforeunload` con `preventDefault()` registrado en un efecto solo mientras `dirty` (`use-unsaved-guard.ts`). Al ocultarse la ruta, el efecto se limpia y deja de preguntar.
- Las navegaciones del propio editor (tras borrar, y «Probar», que solo va sin `dirty`) no pasan por la confirmación.
- La flecha «atrás» del navegador no pregunta: la spec habla de enlaces, recargar y cerrar. Con `<Activity>`, atrás oculta el editor, `reset()` descarta los cambios y no hay confirmación. Es una pérdida aceptada en la v0 y queda escrita en la ficha `decision-editor-lienzo-y-validacion` (fase 6). Interceptar `popstate` del *router* de Next no tiene API estable.

**Diálogos y `<Activity>`**: un `<dialog>` modal abierto en una ruta oculta seguiría en la capa superior del documento y bloquearía la ruta visible. Por eso:
- cada `<dialog>` del editor y de `/flujos` (`ConfirmDialog`, «Ver JSON», «Editar como JSON» y «Nuevo flujo») se cierra con `close()` en el *cleanup* de un `useLayoutEffect`, y el menú de «Añadir nodo» se pliega igual;
- toda navegación del editor (`router.push` tras crear, borrar, «Salir» de `GuardedLink` y «Probar») cierra antes los diálogos abiertos.

`FlowsScreen` reutiliza `usePagedList`, que ya relee al mostrarse y vuelve a `loading` al ocultarse. El diálogo «Nuevo flujo» se cierra y se vacía al ocultarse.

Descartado:
- **`key={bfcacheId}`**: Next lo presenta como herramienta de migración, y además restauraría el estado viejo con atrás/adelante, que es justo lo que no se quiere.
- **`window.confirm` en `onNavigate`**: funcionaría, pero los demás avisos del editor y del chat son `<dialog>` propios y en español.

### D16. Crear un flujo: vacío o desde JSON

`NewFlowDialog` (`<dialog>` modal) tiene dos modos, «Vacío» y «Desde JSON» (radio):
- **Vacío**: campos «Identificador» y «Nombre». `emptyFlow(id, nombre)` (`node-templates.ts`) construye `{"specVersion":"0.1","id":<id>,"name":<nombre>,"start":"inicio","nodes":[{"id":"inicio","type":"end"}]}` en ese orden de claves y lo valida con `validateFlow`. Un issue en `/id` va al campo del identificador («El identificador empieza por una letra minúscula y solo admite minúsculas, números, - y _, hasta 64 caracteres.») y uno en `/name`, al del nombre. El primero recibe el foco y no se envía nada.
- **Desde JSON**: un `<textarea>`. Si no es JSON: «El texto no es JSON.» Si `validateFlow` no lo da por válido: «El flujo no es válido:» y la lista de sus issues (mensaje y ruta). Con un `credential_header_literal`: el aviso de credencial. Si es válido, envía `JSON.stringify(valor)` (el texto JSON de la spec).
- **Envío**: `editorClient.createFlow(texto)`.
  - 201: `router.push('/flujos/<id>')`, y el editor vuelve a leer (D15).
  - 409 `flow_already_exists`: en el campo del identificador, «Ya existe un flujo con ese identificador.».
  - 409 `flow_id_reserved`: en el campo del identificador, «Ese identificador perteneció a un flujo borrado y no se puede reutilizar.».
  - En los dos 409, el diálogo sigue abierto con lo escrito. En el modo JSON, el aviso va sobre el `<textarea>`.
  - El resto, un aviso en el diálogo («No se ha podido crear el flujo.», conexión o base de datos).
- `<form noValidate>` sin `action` ni `method`, con `preventDefault()` siempre (guarda estática de `web-chat`).

### D17. Accesibilidad, foco y teclado

- **Orden del foco**: cabecera (enlaces, nombre, revisión, estado), barra de acciones, lienzo (la zona y después cada nodo en el orden de `nodes`), y después el panel: problemas, inspector o panel del flujo.
- **Teclado en un nodo**: flechas para moverlo 10 unidades (con `preventDefault` para que no desplacen la zona), e Intro o Espacio para seleccionarlo (el inspector se abre y el foco se queda en el nodo). Todo lo demás se hace con los campos del inspector y del panel. «Añadir nodo» es un botón con `aria-expanded` que muestra los ocho tipos como botones. Escape lo cierra y devuelve el foco.
- **Región de estado**: un `<p role="status">` fijo en la pantalla del editor. Anuncia el resultado de guardar y publicar, «Copiado.», el rechazo del autosalto y el número de problemas cuando cambia («3 problemas y 1 aviso», «Sin problemas»). Los errores de acción van en un `Notice` con `role="alert"`.
- **Foco tras cada acción** (requisito «El foco no se pierde en el editor»):

| Acción | Foco |
|---|---|
| Guardar, Publicar, Probar con aviso, Copiar | El botón pulsado (`aria-disabled` mientras dura, nunca `disabled`) |
| Guardar con una barrera local | El título de la lista de problemas (`<h2 tabIndex={-1}>`) |
| Añadir nodo | El nodo nuevo en el lienzo |
| Borrar nodo (confirmado) | La zona del lienzo |
| Aplicar el JSON de un nodo | El botón «Editar como JSON» (el `<dialog>` devuelve el foco a quien lo abrió). Con un error, el `<textarea>` |
| Elegir un problema | El título del inspector, o el del panel del flujo si no tiene `nodeId`, tras seleccionar y `scrollIntoView` |
| Crear con error | El campo culpable |
| Descartar o Cargar el guardado | El título del editor |

- Cada campo tiene `<label>` y cada botón un nombre propio, p. ej. «Borrar nodo pedir-email».

### D18. Pantallas, estados y diseño

No hay `brand-design` en el repo: se usan Tailwind 4 con la paleta neutra de `globals.css`, `Button`, `Notice`, la fuente del sistema y el modo oscuro existente. La revisión de interfaz se hace con la skill `web-design-guidelines` en la fase de QA, como en el chat.

| Pantalla / bloque | loading | empty | error | success |
|---|---|---|---|---|
| `/flujos` | «Cargando flujos…» (`ListState`) | «Todavía no hay flujos.» y «Nuevo flujo» | Texto según el código, sin el de la API, y «Reintentar» | Lista con `name`, `id`, «Versión N» o «Sin publicar» y «Cambios sin publicar» si `unpublishedChanges` (el dato de la API tal cual), enlace al editor y «Ver más» |
| Nuevo flujo | «Creando…» en el botón | — | En el campo culpable o como aviso del diálogo | Navega |
| `/flujos/<id>` | «Cargando flujo…» | — | «Flujo no encontrado» con enlace a `/flujos`; conexión o base de datos con «Reintentar» | Cabecera (`name`, `id`, «Revisión N», «Versión N» o «Sin publicar», «Cambios sin publicar»), acciones, lienzo y panel |
| Lista de problemas | — | «Sin problemas.» | — | Botones «`<nodo o parte>`: `<mensaje>`», avisos marcados «Aviso», y la nota de forma si hay issues de forma |
| Inspector | — | Sin nada seleccionado, el panel del flujo | — | Campos del tipo |

**Composición**: en `lg`, dos columnas (`grid-cols-[minmax(0,1fr)_26rem]`): el lienzo con altura `calc(100dvh - cabecera)` y el panel con su propio desplazamiento. Por debajo, el lienzo mide `60dvh` (mínimo 16 rem) y el panel va debajo, en el orden del DOM. La barra de acciones se reparte en varias líneas (`flex-wrap`). Los ids, nombres y URLs llevan `overflow-wrap: anywhere` y todos los contenedores, `min-w-0`. Así, a 320 px la página no se desplaza en horizontal: solo la zona del lienzo, que es contenido en dos dimensiones.

### D19. Privacidad y direcciones que no se cargan

- Nada del flujo en el navegador fuera de la memoria de la pestaña. ESLint ya prohíbe `localStorage`, `sessionStorage`, `indexedDB`, `caches` y `document.cookie` en `src/`.
- El servidor de la web no registra cuerpos ni rutas reales: `log.ts` escribe la plantilla, el estado y el código, y solo en 5xx.
- **URLs del flujo como texto**: en el inspector, `url`, `imageUrl` y la `url` de `http` son `<input type="text">` y no se cargan, enlazan ni incrustan. El lienzo no pinta contenido multimedia. La guarda estática prohíbe en `src/components/editor/**` los elementos `<img`, `<video`, `<audio`, `<iframe`, `<embed`, `<object`, `<source`, `<picture` y `<a `, y que un `href=` no venga de `WEB_PAGES`. ESLint prohíbe `next/image` también ahí. El mutante `loadFlowUrls` (un `<img src={url}>` en el campo de contenido) muere con `content-field.test.tsx`.
- **Secretos**: el editor solo escribe y muestra nombres (`{"secret": "NOMBRE"}`, `provider`). No hay ningún campo que pida un valor.

### D20. Contacto con el chat (delta de `web-chat`)

- `home-screen.tsx`: un enlace «Editor de flujos» (`/flujos`) en la cabecera del inicio.
- `copy.ts`: `noFlows` pasa a «Todavía no hay flujos publicados. Publica uno desde el editor de flujos.», con un enlace «Ir al editor de flujos» a `/flujos`.
- `list-state.tsx`: `emptyText: ReactNode`.
- `e2e/home.e2e.ts`: el escenario «Sin flujos publicados» comprueba el texto y el enlace, y se añade «Enlace al editor desde el inicio».

Es la fase 1.1: con ella, `pnpm check` vuelve a verde en la rama (hoy está en rojo porque `spec-coverage` exige ese título, ver la propuesta).

### D21. Tests en `pnpm check`

- **Unit puros** (`src/lib/editor/*.test.ts`):
  - `json-edit` (orden, `__proto__`, claves numéricas);
  - `flow-text`;
  - `node-targets` (B1: la forma mínima, los saltos legibles de nodos mal formados y que nada lanza);
  - `fields` (cada fila de D5, los contenedores vacíos y la casilla con el `default` escrito en el último guardado);
  - `node-fields` (paridad con el esquema);
  - `node-templates` (los ocho, `<tipo>-<n>` con el menor `n` libre, y el JSON exacto de «Añadir un mensaje»);
  - `node-ops`:
    - borrar sin tocar saltos;
    - JSON de nodo con y sin cambio de `id`, y cambio de `type`;
    - un JSON de 100 000 niveles rechazado antes de serializar, sin `RangeError`;
    - `connectOutput` con y sin `fixPositions` (mutante `inspectorTargetWithoutFix`);
  - `rename`: todas las clases de saltos, `start`, patrón, duplicado y nodos mal formados;
  - `outputs`, `canvas-model` y `layout`, también con las ocho plantillas de «Añadir nodo» y nodos mal formados (D10);
  - `drop`, `positions`, `issues-view` y `save-gate` (con `checkSavable`, `checkPublishable` y `checkTryable`);
  - `editor-session`, con un cliente falso: todas las filas de D13 y D14, la época, `dirty` y los cinco escenarios de D22 que se prueban aquí;
  - `copy` (cada código con escenario tiene su texto, y ninguno contiene `@franca/`).
- **Golden pequeño** (en `node-templates.test.ts` y `fields.test.ts`): el texto exacto de «Crear un flujo vacío», «Añadir un mensaje», «Editar un campo no reordena el nodo» y «Mover un nodo guarda su posición» (sobre la posición pintada por `autoLayout`). Son literales en el test, no ficheros regrabables.
- **Marcado** (`renderToStaticMarkup`):
  - `canvas-node.test.tsx`: nombre accesible, marca «Inicio» y de problemas con texto, `<b>` como texto, ninguna salida enfocable, el alto y el ancho fijos de `nodeSize` con `overflow-hidden`, y `title` y `type` que no son texto pintados con `asText` (D10);
  - `content-field.test.tsx`: una URL solo en un `value`, sin `img`, `video`, `audio`, `iframe` ni `a`;
  - `problems-list.test.tsx`.
- **Integración** (`src/server/bff/editor-handlers.test.ts`, contra la API simulada de `tests/helpers/fake-api.ts`):
  - método, ruta, consulta, cabeceras y bytes exactos de las seis operaciones (publicar con `Content-Length: 0` y sin `Content-Type`, borrar sin `Content-Length`);
  - `If-Match` ausente → 428, y `*`, `W/"1"` o `1` → 400, sin llamar;
  - ids inválidos → 404 sin llamar;
  - la frontera repetida (403 sin llamar);
  - 413, `invalid_json` e `invalid_request` (incluido el escenario «Cuerpo de un flujo demasiado grande»);
  - un cuerpo poco profundo con espacios no canónicos llega a la API serializado de nuevo (sin esos espacios);
  - un cuerpo de **100 000 niveles** (unos 200 KB) con espacios no canónicos llega a la API **exactamente** como se recibió, y la web no responde 500. Con 1001 o 5000 niveles el test no serviría: Node los serializa sin lanzar, y el mutante `stringifyWithoutDepthGuard` sobreviviría;
  - errores sin `message`, `issues` ni `warnings`, y `currentRevision`;
  - el 204;
  - la lista sin `published`;
  - registro sin datos.

  Las respuestas de la API simulada se copian de la real (`tests/helpers/real-flow-shapes.ts`, medidas con `curl -i` en la fase 2) y las compara con la real `e2e/editor-api-shapes.e2e.ts`.
- **Frontera**: `src/server/frontier-editor.test.ts` (el segmento de `/api/editor/flows/` con `%2F`, mayúsculas y `%` mal formado, y la CSP de D7) y `src/lib/web-client-editor.test.ts` (las seis llamadas con un `fetch` falso: método, URL, `If-Match`, cuerpo y lectura por estado).
- **Guarda estática** (`tests/static-guard.test.ts`):
  - `operations.ts` exporta **exactamente** estas catorce funciones, por nombre. El test se llama ahora «…exporta exactamente catorce funciones»;
  - el recuento de ficheros de ruta pasa de 7 a **10** (`expect(routes.length).toBe(10)`) y el mínimo de manejadores de 13 a **19** (los seis nuevos: `GET` y `POST` de la lista, `GET`, `PUT` y `DELETE` de un flujo, y `POST` de versiones). Los dos son cambios deliberados de este diseño;
  - `@franca/spec` sin `import type` (y `@franca/spec/flow.schema.json`) solo desde `src/lib/editor/**` y `src/server/**` en el código del navegador;
  - las prohibiciones de D19 en `src/components/editor/**`;
  - solo `src/lib/editor/node-targets.ts` llega a `targets` de `@franca/spec` (B1). Fuera de `src/server/**`, la guarda rechaza también `import * as … from '@franca/spec'`, `import('@franca/spec')` dinámico y cualquier importación con nombre que incluya `targets` (también `targets as x`). Cada una, con su control (un caso prohibido que la guarda detecta).

  Las demás reglas (`connection()`, sin `'use server'`, sin `mode:`, formularios) ya cubren las rutas y componentes nuevos.
- **Paridad** (`tests/editor-parity.test.ts`):
  - `MAX_FLOW_BYTES` es el número de «Guardar el borrador» en la spec efectiva (`1 048 576`);
  - `NODE_TYPE_LABELS` tiene exactamente los tipos de `$defs.node.oneOf`.

  `openspec/**` ya está en los `inputs` de `@franca/web#test` de turbo: no hace falta tocar `turbo.json`.
- **`src/server/api/operations.test.ts`** (modificado): «exporta exactamente las catorce operaciones», con la lista de nombres y `Object.keys(API_OPERATIONS).length === 14`. El método y la ruta de las seis nuevas se prueban en `editor-handlers.test.ts`, para no tocar los casos existentes.

### D22. E2E con Playwright

La misma pila única (D20 de `web-chat`): API real con Postgres, API simulada delante y `next start`, un *worker* en serie y la base vaciada entre tests. Los flujos de partida salen de `e2e/fixtures/flows/` y `packages/spec/examples/`, y se crean con `Admin` contra la API real. No hay *fixtures* nuevos.

**Leer el estado en la API real** (B2): se **amplía `e2e/support/admin.ts`**, la única ayuda «directamente en la API» de los E2E, con dos métodos:
- `flow(flowId)`: `GET /flows/:id`, que espera 200 y devuelve el recurso; un 404 se comprueba con `call` (`expectStatus`).
- `versions(flowId)`: `GET /flows/:id/versions?limit=100`, que devuelve la página.

Lo necesitan «Guardar un cambio», «Publicar sin cambios desde el editor», «Dos pestañas editan el mismo flujo», «Borrar un flujo cambiado fuera», «Flujo cambiado fuera del editor» y «Borrar un flujo desde el editor». Se descarta que `e2e/support/editor.ts` lea la API con su propio `fetch`: serían dos clientes de prueba de la misma API con dos formas de fallar.

`e2e/support/editor.ts` (nuevo):
- `openEditor(page, id)` y `node(page, id)`;
- `edges(page)`, que lee `data-edge-*`;
- `dragOutput(page, from, key, destino | 'vacío' | 'fuera' | 'escape')`, con `mouse.down`, `move` en 8 pasos, `Escape` opcional y `up`;
- `lastRequest(stack, método, ruta)` y `bodyOf(request)`;
- `forwardThenCut(stack)`: un guion de la API simulada que reenvía la petición a la API real con `node:http` y destruye el *socket* hacia la web sin responder.

| Fichero | Escenarios | Contra |
|---|---|---|
| `editor-list.e2e.ts` | 11 (lista, estados, crear vacío y desde JSON, id en uso) | API real; «API parada en el editor» con la simulada parada |
| `editor-open.e2e.ts` | 5 (abrir, estados, URLs sin cargar) | Real salvo «Flujo que no existe en el editor» |
| `editor-canvas.e2e.ts` | 8 más «cada clase de salida se conecta arrastrando» | Real |
| `editor-inspector.e2e.ts` | 13 (con «Conectar desde el inspector no mueve los nodos») más «añadir una condición no rompe el lienzo» (B1) | Real |
| `editor-save.e2e.ts` | 10 | Real salvo «Validar no llama a la API» y «Guardado con respuesta perdida» |
| `editor-publish.e2e.ts` | 9 (publicar, probar, ver JSON, borrar) | Real |
| `editor-frontier.e2e.ts` | 7 (recorrido, ids, `Origin`/`Host`, cabeceras, error sin mensaje, privacidad) | Servidor real de la web; peticiones en bruto donde no hace falta navegador |
| `editor-accessibility.e2e.ts` | 3 (teclado, foco, 320 px) | Real |
| `editor-api-shapes.e2e.ts` | Forma de `real-flow-shapes.ts` frente a la API real (sin escenario) | Real |

- **Cada clase de salida arrastrada al menos una vez**:
  - `next` («Sustituir una conexión arrastrando»);
  - `else` («El arrastre y el inspector dan el mismo flujo»);
  - `onError` («Conectar arrastrando no mueve los nodos»);
  - `next` de `llm` sobre sí mismo («Un llm que vuelve a sí mismo»);
  - `choices[<id>].next`, `rules[<i>].next`, `onExhausted` y `target` en el test sin escenario «cada clase de salida se conecta arrastrando».

  Soltar en vacío, Escape y el propio nodo tienen su escenario. El resto de combinaciones (destino ya conectado, salida vacía, selección múltiple, autosalto por `onExhausted`) va en `drop.test.ts`.
- **«Recargar con cambios»**: se observa el `dialog` de tipo `beforeunload` de Playwright al recargar con `page.reload()` después de escribir (activación del usuario). Si Chromium sin cabeza no lo emitiera, el escenario pasa a comprobar que `beforeunload` queda cancelado (`dispatchEvent` con `cancelable`) y la recarga real queda como verificación manual de la fase 6, con ese motivo en el test.
- **Cinco escenarios pasan a Vitest** (`editor-session.test.ts`, con el cliente falso; no bloqueante de la revisión). Su THEN es una decisión de la sesión o de una barrera, no del navegador:
  - «JSON de un nodo roto»: el error y el borrador idéntico. Que el campo conserva el texto lo da el diálogo, cuyo texto es local.
  - «Publicar con cambios sin guardar»: `checkPublishable` y ninguna llamada al cliente falso.
  - «Probar sin versión publicada»: `checkTryable` da «Publica el flujo antes de probarlo.» y no se llama al `start` falso.
  - «Cambio deshecho a mano»: `dirty` falso y ninguna llamada.
  - «Flujo de más de 1 MiB»: un flujo válido de 1 040 000 bytes con un texto de 10 000 caracteres añadido da `too_large`, y no hay ninguna llamada.

  El aviso de las barreras en pantalla lo ejerce «No se guarda un flujo inválido», que usa el mismo componente.
- **«añadir una condición no rompe el lienzo»** (sin escenario, B1): en `hola`, «Añadir nodo» → condición. El lienzo pinta `condition-1` con su salida `else`, la lista dice que le falta `rules` y la consola sigue limpia.
- **Portapapeles**: `context.grantPermissions(['clipboard-read', 'clipboard-write'])` y `navigator.clipboard.readText()`.
- **Consola limpia** y **navegador sin Internet**: las *fixtures* de `e2e/support/test.ts`. «El editor no carga direcciones del flujo» comprueba `external` vacío.

**Coste en la CI**: 66 escenarios de navegador más tres de apoyo. Con unos 3 s de media (abrir, unas interacciones y comprobar; dos pestañas algo más), son unos **3,5 minutos más** de `test:e2e`, en serie con los del chat. Se mide en el *runner*, nunca en el portátil, y se anota en el PR (FOLLOW-UP 7.1). El umbral de recorte es del **job de E2E de la web completo** (`pnpm --filter @franca/web test:e2e`: chat, editor y el `@lento` de 150 s). Si en el *runner* pasa de 12 minutos, el primer recorte es juntar en un mismo test las páginas de inspector que comparten flujo, sin perder títulos (cada escenario sigue en su `test`, con un `beforeAll` común).

### D23. Mutación

Los mutantes nuevos se añaden a `tests/mutations.json`. Todos mueren con Vitest y se ejecutan a mano (`pnpm --filter @franca/web mutate`), con el resultado en el gate de la fase 3:

| Mutante | Fichero | Lo mata |
|---|---|---|
| `reorderOnEdit` (sustituir = quitar y añadir al final) | `src/lib/editor/json-edit.ts` | `fields.test.ts` |
| `writeDefaults` (la casilla escribe el `default`) | `src/lib/editor/fields.ts` | `fields.test.ts` |
| `keepEmptyContainers` | `src/lib/editor/fields.ts` | `fields.test.ts` |
| `parseLooseNumber` (`Number(texto)` sin la expresión) | `src/lib/editor/fields.ts` | `fields.test.ts` |
| `forgetSavedDefault` (desmarcar quita la propiedad aunque estuviera escrita en el último guardado) | `src/lib/editor/fields.ts` | `fields.test.ts` |
| `callTargetsDirect` (llama a `targets` sin comprobar la forma mínima) | `src/lib/editor/node-targets.ts` | `node-targets.test.ts`, `canvas-model.test.ts` y `layout.test.ts` |
| `keepNonTextTargetIds` (quita el filtro de `id` de texto) | `src/lib/editor/node-targets.ts` | `canvas-model.test.ts` |
| `renderRawTitle` | `src/components/editor/canvas/canvas-node.tsx` | `canvas-node.test.tsx` |
| `skipDepthCheckOnApply` | `src/lib/editor/node-ops.ts` | `node-ops.test.ts` |
| `inspectorTargetWithoutFix` (el selector del inspector no fija posiciones) | `src/lib/editor/node-ops.ts` | `node-ops.test.ts` |
| `persistAutoLayout` (abrir fija las posiciones) | `src/lib/editor/editor-session.ts` | `editor-session.test.ts` |
| `fixOnlyMovedNode` | `src/lib/editor/positions.ts` | `positions.test.ts` |
| `skipOverlapCheck` | `src/lib/editor/layout.ts` | `layout.test.ts` |
| `skipRenameReferences`, `allowDuplicateRename` | `src/lib/editor/rename.ts` | `rename.test.ts` |
| `multipleChoiceOutputs` | `src/lib/editor/outputs.ts` | `outputs.test.ts` |
| `allowSelfDrop`, `allowLlmExhaustedSelf`, `clearOnEmptyDrop` | `src/lib/editor/drop.ts` | `drop.test.ts` |
| `dirtyByIdentity`, `ifMatchStar`, `resendOnLoss`, `trustLostWithoutCompare`, `ignoreEpoch`, `publishWithChanges` | `src/lib/editor/editor-session.ts` | `editor-session.test.ts` |
| `saveInvalid`, `skipLiteralCredentialCheck`, `countCharsNotBytes` | `src/lib/editor/save-gate.ts` | `save-gate.test.ts` y `editor-session.test.ts` |
| `loadFlowUrls` | `src/components/editor/inspector/content-field.tsx` | `content-field.test.tsx` |
| `forwardIssues` (el error lleva `issues`) | `src/server/bff/responses.ts` | `editor-handlers.test.ts` |
| `genericFlowPassthrough` (ruta de la API desde la del navegador) | `src/server/api/operations.ts` | `editor-handlers.test.ts` |
| `editorListPublished` | `src/config/endpoints.ts` | `editor-handlers.test.ts` |
| `unvalidatedFlowId` | `src/server/ids.ts` | `ids.test.ts` y `editor-handlers.test.ts` |
| `skipFlowSegmentCheck` | `src/server/frontier.ts` | `frontier-editor.test.ts` |
| `scriptSrcWithoutEval` | `src/server/frontier.ts` | `frontier-editor.test.ts` |
| `skipEditorFrontierRecheck`, `optionalIfMatchOnEditor` | `src/server/bff/handlers.ts` | `editor-handlers.test.ts` |
| `acceptNonObjectFlowBody`, `stringifyWithoutDepthGuard` | `src/server/bff/request.ts` | `editor-handlers.test.ts` |

Son 39 nuevos, más los 29 del chat. **`storeDraftInBrowser` de la propuesta no es mutante**: en Node, `sessionStorage` no existe y el mutante moriría por un `ReferenceError`, no por un test que lo vigile. Lo cubren ESLint (`no-restricted-globals`, validado a mano una vez) y el E2E «Marcas fuera de los registros del editor». Los demás tests negativos («no recibe ningún `PUT`», «no contiene», paridad) se validan **una vez a mano**, provocando el caso prohibido y viendo que fallan (`testing-pyramid.md`), como en el chat.

### D24. Cobertura de escenarios

`tests/spec-coverage.test.ts` recorre dos capacidades con sus mínimos: `web-chat` (los suyos, con el escenario nuevo) y `web-editor` (44 requisitos y 78 escenarios), cada una leída con `effectiveSpec`. Exige títulos únicos **entre las dos** (el buscador es global) y un `it('<título>'`/`test('<título>'` exacto en `src/**/*.test.{ts,tsx}`, `tests/**/*.test.ts` o `e2e/**/*.e2e.ts`. La extensión entra al final de la fase 5. Desde la fase 1 están los títulos de Vitest, y en la 5 los de E2E.

Ningún escenario queda solo como verificación manual (ver el caso límite de «Recargar con cambios» en D22).

## Contrato: navegador ↔ servidor de la web ↔ API

**Base URLs**: el navegador usa rutas relativas (`WEB_ENDPOINTS`). El servidor de la web usa `FRANCA_API_URL` (por defecto `http://127.0.0.1:3001`). **Auth**: no hay. La frontera es la de `web-chat`. **Comunes a todas las rutas nuevas**:
- `Host` local (si no, 403 sin cuerpo).
- En `POST`, `PUT` y `DELETE`, `Origin: http://<Host>` (si no, 403 sin cuerpo y sin `Access-Control-Allow-*`).
- JSON `application/json; charset=utf-8`, `Cache-Control: no-store` y las cabeceras de seguridad.
- Errores `{"error": "<código>"}` (+ `currentRevision` en un 412), nunca `message`, `issues` ni `warnings`.

| Ruta de la web | Operación de la API | Cuerpo navegador → web | Cuerpo web → API | `If-Match` |
|---|---|---|---|---|
| `GET /api/editor/flows?offset=N` | `GET /flows?limit=20&offset=N` | — | — | — |
| `POST /api/editor/flows` | `POST /flows` | Texto JSON del flujo (≤ 1 MiB) | `JSON.stringify(valor)` (o el texto recibido si supera la profundidad) | — |
| `GET /api/editor/flows/:flowId` | `GET /flows/:flowId` | — | — | — |
| `PUT /api/editor/flows/:flowId` | `PUT /flows/:flowId` | Texto JSON del flujo | Ídem | Obligatorio `"<n>"`, se reenvía |
| `POST /api/editor/flows/:flowId/versions` | `POST /flows/:flowId/versions` | Ninguno (se ignora si llega) | Ninguno | Obligatorio, se reenvía |
| `DELETE /api/editor/flows/:flowId` | `DELETE /flows/:flowId` | Ninguno | Ninguno | Obligatorio, se reenvía |

`offset` por defecto es 0. El navegador no elige `limit` ni `published`. Cabeceras hacia la API: `Host` (el de `FRANCA_API_URL`), `Connection: close` y, con cuerpo, `Content-Type: application/json` y `Content-Length`, más `If-Match` en las tres de la tabla. Nada más.

**Respuestas 2xx** (pasan sin tocar):

| Ruta | Estado | Cuerpo | Campos que usa el editor |
|---|---|---|---|
| `GET /api/editor/flows` | 200 | `Page<FlowSummary>` | `items[].id`, `name`, `latestVersion`, `unpublishedChanges`, `total`, `offset` |
| `POST /api/editor/flows` | 201 | `FlowResource` | `id` (para navegar) |
| `GET /api/editor/flows/:flowId` | 200 | `FlowResource` | `name`, `revision`, `latestVersion`, `unpublishedChanges`, `flow` |
| `PUT /api/editor/flows/:flowId` | 200 | `FlowResource` | Ídem |
| `POST …/versions` | 201 (nueva) o 200 (ya existía) | `VersionResource` | `version` y el estado |
| `DELETE …` | 204 | Sin cuerpo | El estado |

`createdAt`, `updatedAt`, `warnings` y el `flow` de `VersionResource` pasan sin uso: son de la API, la web no los genera y el editor recalcula los avisos. Reducirlos sería un caso nuevo de saneado sin requisito.

Ejemplos (JSON válido, reutilizable en tests):

```json
{"items":[{"id":"hola","name":"Hola","revision":1,"latestVersion":null,"unpublishedChanges":true,"createdAt":"2026-10-18T10:00:00.000Z","updatedAt":"2026-10-18T10:00:00.000Z"}],"total":1,"limit":20,"offset":0}
```

```json
{"id":"hola","name":"Hola","revision":2,"latestVersion":null,"unpublishedChanges":true,"createdAt":"2026-10-18T10:00:00.000Z","updatedAt":"2026-10-18T10:05:00.000Z","flow":{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end"}]},"warnings":[]}
```

```json
{"flowId":"hola","version":1,"name":"Hola","publishedAt":"2026-10-18T10:06:00.000Z","flow":{"specVersion":"0.1","id":"hola","name":"Hola","start":"fin","nodes":[{"id":"fin","type":"end"}]},"warnings":[]}
```

Errores: `{"error":"revision_mismatch","currentRevision":2}` · `{"error":"flow_already_exists"}` · `{"error":"invalid_flow"}` · `{"error":"api_unreachable"}`.

**Errores y su texto en el editor** (`src/lib/editor/copy.ts`; los de la frontera y el transporte, como en el chat):

| HTTP | `error` | Origen | Crear | Abrir | Guardar | Publicar | Borrar |
|---|---|---|---|---|---|---|---|
| 403 | — | Frontera | Genérico (la web no lo provoca) | — | Genérico | Genérico | Genérico |
| 404 | `flow_not_found` | Frontera, ruta o API | — | «Flujo no encontrado» | «Se ha borrado fuera del editor…» + «Ver JSON» | Ídem | Navega a `/flujos` |
| 409 | `flow_already_exists` / `flow_id_reserved` | API | En el campo del identificador | — | — | — | — |
| 412 | `revision_mismatch` | API | — | — | Conflicto con «Cargar el guardado» y «Guardar encima» | «Ha cambiado fuera del editor» + «Cargar el guardado» | Ídem |
| 428 / 400 | `precondition_required` / `invalid_request` | Ruta | Genérico | — | Genérico | Genérico | Genérico |
| 400 | `invalid_json` / `invalid_request` | Ruta | Genérico | — | Genérico | — | — |
| 400 | `invalid_flow` | API | «La API de Franca considera que el flujo no es válido.» | — | Ídem | Ídem (borrador) | — |
| 400 | `literal_credential` | API | «… no guarda credenciales escritas…» | — | Ídem | Ídem | — |
| 413 | `payload_too_large` | Ruta o API | «El flujo supera el tamaño máximo de 1 MiB.» | — | Ídem | — | — |
| 503 | `database_unavailable` | API | «La base de datos de Franca no está disponible.» | Ídem + «Reintentar» | Relee; si no consta, la variante de base de datos | Ídem | Ídem |
| 502 | `api_unreachable` / `invalid_api_response` | Web | «No se puede conectar con la API de Franca.» / genérico | Ídem + «Reintentar» | Relee (D13) | Conexión / genérico | Ídem |
| — | `network_error` | Navegador | Conexión | Conexión + «Reintentar» | Relee (D13) | Conexión | Conexión |
| cualquiera | otro o `unknown` | — | Genérico | Genérico + «Reintentar» | Genérico (5xx: relee) | Genérico | Genérico |

**Concurrencia**: cada escritura lleva el `If-Match` de la revisión leída o guardada por última vez, y la web nunca reenvía. «Guardar encima» usa la `currentRevision` recibida, así que un tercer cambio entre medias vuelve a dar 412. Dos pulsaciones seguidas de una acción: `busy` las descarta (D4).

## Ficheros

**Nuevos en `apps/web`**:

| Ruta | Qué tiene |
|---|---|
| `src/app/flujos/page.tsx`, `src/app/flujos/[flowId]/page.tsx` | Páginas (D1) |
| `src/app/api/editor/flows/route.ts`, `…/[flowId]/route.ts`, `…/[flowId]/versions/route.ts` | Rutas de la web (D1, D2) |
| `src/lib/editor/json-edit.ts`, `flow-text.ts`, `node-targets.ts`, `as-text.ts`, `fields.ts`, `node-fields.ts`, `node-types.ts`, `node-templates.ts`, `node-ops.ts`, `rename.ts`, `outputs.ts`, `canvas-geometry.ts`, `canvas-model.ts`, `layout.ts`, `positions.ts`, `drop.ts`, `issues-view.ts`, `save-gate.ts`, `limits.ts`, `api-types.ts`, `copy.ts`, `editor-session.ts` (+ un `*.test.ts` por cada uno con lógica) | Núcleo puro (D4-D14) |
| `src/hooks/use-editor-session.ts`, `use-unsaved-guard.ts` | Adaptadores de React (D15) |
| `src/components/editor/flows-screen.tsx`, `editor-flow-list.tsx`, `new-flow-dialog.tsx`, `editor-screen.tsx`, `editor-header.tsx`, `editor-actions.tsx`, `add-node-menu.tsx`, `problems-list.tsx`, `flow-panel.tsx`, `confirm-dialog.tsx`, `flow-json-dialog.tsx`, `node-json-dialog.tsx`, `guarded-link.tsx`, `editor-loading.tsx`, `editor-not-found.tsx` | Pantallas y piezas |
| `src/components/editor/canvas/flow-canvas.tsx`, `canvas-node.tsx`, `canvas-edges.tsx`, `zoom-controls.tsx`, `use-canvas-drag.ts` | Lienzo (D9-D12) |
| `src/components/editor/inspector/node-inspector.tsx`, `inspector-field.tsx`, `text-field.tsx`, `number-field.tsx`, `enum-field.tsx`, `boolean-field.tsx`, `target-field.tsx`, `value-field.tsx`, `json-field.tsx`, `predicate-field.tsx`, `content-field.tsx`, `headers-field.tsx`, `list-field.tsx`, `id-field.tsx` (+ `content-field.test.tsx`, `canvas-node.test.tsx`, `problems-list.test.tsx`) | Inspector y panel por descriptores (D8) |
| `src/server/bff/editor-handlers.test.ts`, `src/server/frontier-editor.test.ts`, `src/lib/web-client-editor.test.ts` | Tests de la frontera y del cliente (D21) |
| `tests/editor-parity.test.ts`, `tests/helpers/real-flow-shapes.ts` | Paridad y respuestas reales (D21) |
| `e2e/editor-{list,open,canvas,inspector,save,publish,frontier,accessibility,api-shapes}.e2e.ts`, `e2e/support/editor.ts` | E2E (D22) |

**Modificados en `apps/web`** (cada uno es el contacto mínimo, con su porqué; la regla de convivir sin retocar no llega a cero porque la frontera y el cliente son únicos por diseño):

| Fichero | Cambio |
|---|---|
| `src/config/endpoints.ts` | `WEB_ENDPOINTS` y `API_OPERATIONS` de las seis operaciones, y `WEB_PAGES.flows`/`flowEditor`: única fuente de URLs |
| `src/server/api/operations.ts` | Seis funciones: única puerta hacia la API |
| `src/server/api/transport.ts` | `'PUT'` en el tipo del método (una línea) |
| `src/server/bff/handlers.ts` | Seis manejadores y tres plantillas; `rejectedByFrontier` devuelve el cuerpo de la decisión |
| `src/server/bff/request.ts` | `readJsonText` y `readFlowBody` (`readJsonBody` conserva su contrato) |
| `src/server/frontier.ts` | El paso del segmento de `/api/editor/flows/` |
| `src/lib/web-client.ts` | `'PUT'`, `createEditorClient` y `editorClient`: único `fetch` del navegador |
| `src/lib/chat/copy.ts`, `src/components/chat/home-screen.tsx`, `src/components/chat/list-state.tsx` | Delta de `web-chat` (D20) |
| `eslint.config.mjs` | `next/image` prohibido también en `src/components/editor/**` |
| `src/server/api/operations.test.ts` | «Exporta exactamente las catorce operaciones» y `API_OPERATIONS` con 14 claves. Hoy exige las ocho y fallaría con cualquier operación nueva (B2) |
| `tests/static-guard.test.ts`, `tests/spec-coverage.test.ts`, `tests/mutations.json` | Catorce operaciones por nombre, rutas de 7 a 10 y manejadores de ≥ 13 a ≥ 19, reglas nuevas, capacidad `web-editor` y mutantes |
| `e2e/home.e2e.ts` | «Sin flujos publicados» y «Enlace al editor desde el inicio» |
| `e2e/support/admin.ts` | `flow(flowId)` y `versions(flowId)`: leer en la API real lo que comprueban seis escenarios (D22, B2) |
| `README.md` (de la web) | El editor: rutas, cómo se prueba |

`src/lib/chat/api-types.ts`, los *hooks* del chat, `responses.ts`, `limits.ts`, `next.config.ts`, `package.json` y `tsconfig.json` **no cambian**.

**Fuera de `apps/web`**:

| Fichero | Cambio |
|---|---|
| `openspec/changes/web-editor/**` | Este cambio |
| `.claude/rules/frontend/architecture.md` | «Catorce operaciones fijas», `/api/editor/flows` y el editor en `src/lib/editor/` |
| `.claude/rules/always/gotchas.md` | Tres líneas: `JSON.stringify` recursivo, `targets()` con nodos de forma inválida y la CSP sin `script-src` mientras el editor valide con ajv |
| `.claude/rules/always/knowledge-wiki.md`, `.claude/wiki/gotcha-json-stringify-recursivo.md` (nuevo), `.claude/wiki/gotcha-targets-asume-forma-valida.md` (nuevo), `.claude/wiki/decision-editor-lienzo-y-validacion.md` (nuevo, con el límite de atrás del navegador), `.claude/wiki/decision-frontera-local-de-la-web.md` | Hechos no derivables (fase 6) |
| `CLAUDE.md` | La ruta del editor en «Qué es» y en la fila de la web |
| `README.md` (raíz) | `/flujos` en el recorrido local |

**Cero ficheros en `apps/api/`, `packages/`, `turbo.json`, `pnpm-lock.yaml` y `.github/`.**

**Criterio que hace fallar el PR** (gate 6.5): estos dos comandos no imprimen nada.

```bash
git diff --name-only main...HEAD -- apps/api packages turbo.json pnpm-lock.yaml .github apps/web/package.json
git diff --name-only main...HEAD | grep -v -E '^(apps/web/|openspec/|\.claude/wiki/|\.claude/rules/(always/(gotchas|knowledge-wiki)|frontend/architecture)\.md$|CLAUDE\.md$|README\.md$)'
```

Además, `git diff --name-only --diff-filter=M main...HEAD -- apps/web` lista exactamente los 18 ficheros de la tabla «Modificados». Uno más exige una decisión escrita aquí antes del PR.

## Coherencia (checklist)

- [x] Cada campo de respuesta que lee el editor está en la tabla de 2xx. Los que pasan sin uso son de la API, con su porqué.
- [x] Cada llamada del navegador tiene su ruta de la web, cada ruta su operación, y cada operación su función en `operations.ts`. El comodín no llama a nada. «Probar» usa la operación del chat.
- [x] Tipos y validación de flujo desde `@franca/spec` (`validateFlow`, `targets` a través de `nodeTargets`, `exceedsFlowDepth`, `capWarnings`, `schema`). Las listas del formulario salen del esquema en ejecución, y los descriptores tienen paridad con él. La web solo declara las formas de los recursos de la API (`api-types.ts`), y las comprueba `editor-api-shapes.e2e.ts`.
- [x] Cada error de la API tiene manejo en cada contexto, aunque sea el genérico. La lista espejada de códigos ya tiene paridad, y no hay códigos nuevos.
- [x] Permisos: no hay usuarios. `Host` y `Origin` en toda mutación nueva (`proxy.ts` y la defensa en profundidad), y ids validados en la frontera, la ruta y la página.
- [x] Constantes espejadas con paridad: `MAX_FLOW_BYTES` frente a la spec, `NODE_TYPE_LABELS` y los descriptores frente al esquema, y `API_ERROR_CODES` (la existente).
- [x] Convivencia: cero ficheros de `apps/api` y `packages/`. En `apps/web`, solo los de la tabla «Modificados», cada uno con su porqué, y el criterio del *diff* lo hace cumplir.
- [x] MVP: ni dependencias, ni servicios, ni almacenamiento nuevos. Cada módulo responde a un requisito (tabla «Escenario → test»).

## Plan de verificación por capas

- **Unit (aplica)**: el núcleo puro de `src/lib/editor/` (D21). Lo combinatorio vive aquí: campos, renombrado, salidas, soltar, diseño automático, guardar y la sesión.
- **Golden/contractual (aplica, pequeño)**: el texto exacto que genera el editor en cuatro casos (D21). Es lo que guarda y compara la API. Son literales en tests, no *baselines* regrabables.
- **Paridad (aplica)**: descriptores y etiquetas frente al esquema, `MAX_FLOW_BYTES` frente a la spec y la paridad de códigos existente.
- **Integración HTTP (aplica)**:
  - En `pnpm check`: manejadores, operaciones y transporte contra la API simulada, con respuestas copiadas de la real.
  - En `test:e2e`: `next start` real para `Host`, `Origin`, `%2F`, cabeceras y el recorrido.
- **E2E opción-al-menos-una-vez (aplica)**: cada tipo de nodo en el inspector, cada clase de campo editada al menos una vez, cada clase de salida arrastrada, cada acción y cada error con escenario (D22).
- **Smoke de ruta (aplica)**: `/flujos`, `/flujos/<id>` existente, no válido e inexistente, y el 403 con un `Host` ajeno («Host ajeno en el editor»).
- **Mutación (aplica, manual)**: los 39 mutantes de D23.
- **Cobertura de la spec (aplica)**: D24.

### Escenario → test (título exacto)

| Fichero | Escenarios | Capa |
|---|---|---|
| `src/lib/editor/canvas-model.test.ts` | Conexiones de captacion-leads | Unit |
| `src/lib/editor/outputs.test.ts` | Salidas de los nodos de los ejemplos | Unit |
| `src/lib/editor/drop.test.ts` | Conectar una salida vacía arrastrando | Unit |
| `src/lib/editor/fields.test.ts` | Editar un campo no reordena el nodo · Vaciar un campo opcional | Unit (golden) |
| `src/lib/editor/rename.test.ts` | Renombrar un nodo | Unit |
| `src/lib/editor/editor-session.test.ts` | JSON de un nodo roto · Publicar con cambios sin guardar · Probar sin versión publicada · Cambio deshecho a mano · Flujo de más de 1 MiB | Unit (cliente falso) |
| `src/server/bff/editor-handlers.test.ts` | Cuerpo de un flujo demasiado grande | Integración |
| `e2e/editor-list.e2e.ts` | Del editor al chat · Borradores y publicados en la lista · Más de una página en el editor · Sin flujos en el editor · API parada en el editor · Crear un flujo vacío · Identificador no admitido · Importar un ejemplo · JSON pegado que no es un flujo válido · Id repetido en el editor · Id reservado en el editor | E2E |
| `e2e/editor-open.e2e.ts` | Abrir captacion-leads · Flujo cambiado fuera del editor · Flujo que no existe en el editor · API parada al abrir un flujo · El editor no carga direcciones del flujo | E2E |
| `e2e/editor-canvas.e2e.ts` | Abrir sin posiciones no cambia el flujo · Mover un nodo guarda su posición · Sustituir una conexión arrastrando · Soltar una conexión en vacío · El arrastre y el inspector dan el mismo flujo · Conectar arrastrando no mueve los nodos · Soltar sobre el propio nodo · Un llm que vuelve a sí mismo | E2E |
| `e2e/editor-inspector.e2e.ts` | Conectar desde el inspector no mueve los nodos · Declarar una variable personal · Los ocho tipos en el inspector · Regla de una condición · Número escrito con letras · Cabecera con un secreto · Token pegado en una cabecera · Añadir un mensaje · Renombrar al id de otro nodo · Borrar un nodo con saltos hacia él · Aplicar el JSON de un nodo · Error al dejar un nodo sin conectar · Del problema al nodo | E2E |
| `e2e/editor-save.e2e.ts` | Validar no llama a la API · Guardar un cambio · No se guarda un flujo inválido · Dos pestañas editan el mismo flujo · Cargar el guardado tras un conflicto · Guardado con respuesta perdida · Flujo borrado mientras se edita · Descartar cambios · Salir con cambios sin guardar · Recargar con cambios | E2E |
| `e2e/editor-publish.e2e.ts` | Publicar un flujo desde el editor · Publicar sin cambios desde el editor · Publicar tras mover un nodo · Publicar un borrador cambiado fuera · Probar tras publicar · Probar con cambios sin publicar · Ver y copiar el JSON · Borrar un flujo desde el editor · Borrar un flujo cambiado fuera | E2E |
| `e2e/editor-frontier.e2e.ts` | Recorrido del editor · Id de flujo con una ruta dentro · Otra web intenta guardar un flujo · Host ajeno en el editor · Cabeceras de un guardado · Error de la API sin su mensaje · Marcas fuera de los registros del editor | E2E |
| `e2e/editor-accessibility.e2e.ts` | Crear un flujo solo con teclado · El foco tras añadir y borrar un nodo · Editor en pantalla estrecha | E2E |
| `e2e/home.e2e.ts` (`web-chat`) | Enlace al editor desde el inicio (nuevo) · Sin flujos publicados (comprueba el enlace) | E2E |

Son 12 en Vitest y 66 en Playwright: los 78, uno por escenario. Además hay tres E2E de apoyo sin escenario: «cada clase de salida se conecta arrastrando», «añadir una condición no rompe el lienzo» y la forma real de `editor-api-shapes.e2e.ts`.

**Por qué siete escenarios van en Vitest aunque su THEN diga «la API recibe»**: el texto que recibe la API es `draftText` byte a byte. Lo demuestran una vez, de punta a punta, «Guardar un cambio», «Cabeceras de un guardado» y el test de integración de bytes exactos. Lo que distingue esos siete escenarios es la transformación del JSON, que es pura, y su golden la fija sin navegador. La UI de cada clase de campo se ejerce igualmente en otro E2E:
- texto, en «Declarar una variable personal» y «Regla de una condición»;
- número, en «Número escrito con letras»;
- renombrar, en «Renombrar al id de otro nodo»;
- salto, en «El arrastre y el inspector dan el mismo flujo» y «Conectar desde el inspector no mueve los nodos».

Los otros cinco que van a `editor-session.test.ts` se explican en D22.

## Plan de ejecución

Detalle, ficheros exactos y gates en `tasks.md`. Resumen:

| Fase | Dueño | Qué | Gate |
|---|---|---|---|
| 1. Núcleo puro y contacto con el chat | `popi:frontend-developer` | D20 primero (`pnpm check` vuelve a verde), después `src/lib/editor/` con sus tests | `pnpm check`, `openspec validate --strict`, *diff* vacío en `apps/api packages` |
| 2. Frontera y servidor de la web | `popi:frontend-developer` | D2, D3, rutas, guarda estática, respuestas reales medidas con `curl -i` | `pnpm check` y `curl` a `next start` contra la API real |
| 3. QA del núcleo y la frontera | `popi:qa-tester` (unit, integración y mutación) | Mutantes de D23, negativos validados a mano, revisión de los dobles frente a lo real | `pnpm --filter @franca/web mutate` sin supervivientes |
| 4. Pantallas | `popi:frontend-developer` | Páginas, *hooks*, componentes, lienzo e inspector; marcado; verificación en el navegador | `pnpm check` y `/popi:verify frontend` con consola y red limpias |
| 5. E2E y cobertura | `popi:qa-tester` (E2E) | Los 66 E2E de escenario y los tres de apoyo, la forma real, `spec-coverage` con `web-editor` y la revisión `web-design-guidelines` | `pnpm test:e2e` en verde y tiempo anotado |
| 6. Docs y cierre | `popi:frontend-developer` | Reglas, wiki, `CLAUDE.md`, README, criterio del *diff* | Lint de la wiki, `openspec validate`, *diff* |

**Modo recomendado: `apply normal`**, fase a fase con sus gates. El espacio de comportamiento es grande y visual (lienzo, foco, arrastre, 320 px) y necesita verificación en el navegador. Un `bucle aislado` (`popi:loop`) solo encaja en la fase 3, cuyo espacio es cerrado (una lista de mutantes y un veredicto mecánico). La elección es del usuario.

## Risks / Trade-offs

- **R1. Rendimiento con flujos grandes.** Validar 1 MiB cuesta 12-20 ms en el portátil (D6). Pintar 5000 nodos sin virtualizar es lo caro, y no tiene objetivo de fluidez (propuesta). **Medida**: en el *runner*, el tiempo de un cambio de texto en el escenario «Flujo de más de 1 MiB» (*trace* de Playwright) y el de abrir un flujo de 5000 nodos generado (FOLLOW-UP 7.2). Si un cambio pasa de 100 ms, `useDeferredValue` en el lienzo y la lista. Si abrir pasa de 3 s, virtualizar por la ventana visible, con su propio cambio.
- **R2. Una CSP futura con `script-src`** rompería el editor (D7). **Medida**: test y mutante `scriptSrcWithoutEval`. Si llega, ajv *standalone* en `packages/spec` (FOLLOW-UP 7.4).
- **R3. Arrastre frágil en Playwright.** **Medida**: la decisión es pura (`drop.ts`) y está probada en Vitest. En E2E, el gesto es `mouse` con pasos y coordenadas de `boundingBox`, y cada clase de salida se arrastra una vez. Con `retries: 0`, una inestabilidad se ve en el primer PR.
- **R4. `beforeunload` sin cabeza** (D22). **Medida**: el E2E escucha el `dialog`. Si Chromium sin cabeza no lo emite, el *fallback* está escrito en el test y la recarga real queda en la verificación manual 6.4.
- **R5. Revisiones de más por normalizar.** **Medida**: el borrador es el JSON recibido sin tocar (D4), y lo vigilan el golden, «Abrir sin posiciones no cambia el flujo», «Cambio deshecho a mano» y los mutantes `reorderOnEdit`, `writeDefaults`, `keepEmptyContainers` y `persistAutoLayout`. Mover y publicar sí crean versión, a propósito.
- **R6. La frontera crece a 14 operaciones, cuatro de ellas escriben flujos.** **Medida**: `Origin` y `Host` existentes y repetidos en los manejadores, ids validados en tres sitios, cuerpos con tope y mutantes de cada defensa nueva. Aguas abajo, un flujo publicado por un CSRF que pasara seguiría sin secretos de otro origen ([[decision-salida-http-politica]]).
- **R7. Coste de los E2E** (unos 3,5 minutos más, D22). **Medida**: tiempo del *job* de E2E de la web completo en el *runner*, anotado en el PR (FOLLOW-UP 7.1). Recorte por encima de 12 minutos.
- **R8. Ficheros ajenos tocados** (18 en `apps/web`). Es el contacto mínimo, porque la frontera, el cliente, las URLs y las guardas son únicos por diseño. **Medida**: el criterio del *diff*. Ninguno cambia el comportamiento del chat salvo el delta de `web-chat`, y todos los tests del chat siguen en verde en cada gate.
- **R9. `<Activity>` conserva el DOM oculto** (hasta 3 rutas). **Medida**: el editor vuelve a `loading` al ocultarse y cierra sus diálogos (D15), y los E2E miran solo lo visible (`text(page, …)`), como en el chat.
- **R10. Nodos de forma inválida en el borrador** (B1). «Añadir nodo» y «Editar como JSON» producen nodos que `targets` no recorre. **Medida**: todo pasa por `nodeTargets` y `nodeOutputs` defensivos, con tests de las ocho plantillas y de los nodos mal formados, el mutante `callTargetsDirect` y el E2E «añadir una condición no rompe el lienzo». Un *render* que lanzara llegaría a `error.tsx` con la consola sucia, que los E2E rechazan.
- **R11. Atrás del navegador pierde los cambios sin preguntar** (D15). Se acepta en la v0 y queda escrito en la wiki. **Medida**: ninguna. Es una limitación conocida, no un fallo.

## Open Questions

Requieren **aprobación humana** antes de la fase 1:
1. **Delta `4ced695`** (conductual, el usuario puede revertirlo):
   - En el inspector, `position` es de solo lectura (D8).
   - Al vaciar el último campo de un contenedor opcional, se quita el contenedor (D5).
2. **Delta `0520b08`** (conductual, decidido por el orquestador tras la revisión; el usuario puede revertirlo):
   - Elegir el destino de una salida en el inspector, también «ninguno», fija las posiciones (D11).
   - Un JSON con el que el flujo anidaría más de 1000 niveles no se aplica (D5).
   - Su consecuencia en `eff3d08`: «Posiciones de los nodos» y «Sin cambios que guardar» lo dicen igual.
3. **Lienzo propio sin dependencia** (D9) frente a React Flow. Es técnica, pero cambia lo que verá quien mantenga el editor: unas 700 líneas propias frente a una librería de unos 45 KB que habría que domar para cumplir la accesibilidad de la spec.
4. **«Cambios sin publicar» también en un flujo que nunca se publicó**: se muestra el dato de la API tal cual (`unpublishedChanges` es `true` al crear). La lista enseña «Sin publicar» y el aviso a la vez. Es la lectura literal de «si los tiene» y compatible con los escenarios. La alternativa (ocultarlo si `latestVersion` es `null`) sería un delta.

No queda nada técnico pendiente.
