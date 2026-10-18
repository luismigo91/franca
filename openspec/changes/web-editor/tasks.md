# Tasks: editor visual de flujos (`web-editor`)

**Revisión 4** (tercera ronda): `fitsField` antes de pintar cada campo del inspector, `getIn` tolerante, posiciones finitas, tablas por tipo con `Map` u `Object.hasOwn`, ida y vuelta por JSON al aplicar, y la tabla de guardas D25 con su test de flujos mal formados.

**Revisión 3** (segunda ronda de la revisión): `nodeTargets` filtra los saltos que no son texto y las salidas se identifican por `pointer`; `asText` para todo lo que se pinta; delta `eff3d08`.

**Revisión 2** (tras el FAIL de `popi:architecture-reviewer`): adaptador `node-targets.ts` (B1), 18 ficheros modificados con `operations.test.ts` y `admin.ts` (B2), y los no bloqueantes que resolvió el orquestador (ver `design.md`, cabecera).

Las fases son secuenciales: cada una empieza cuando la anterior pasa su gate. El comportamiento está en `specs/web-editor/spec.md` (44 requisitos y 78 escenarios, con los deltas `4ced695`, `0520b08` y `eff3d08` pendientes de aprobación) y en el delta de `specs/web-chat/spec.md`. El cómo está en `design.md` (D1-D25, «Contrato» y «Ficheros»).

Reglas para todas las fases:
- **Solo se tocan los ficheros de la tabla «Ficheros» de `design.md`.** En ningún gate imprimen nada `git diff --name-only main...HEAD -- apps/api packages turbo.json pnpm-lock.yaml .github apps/web/package.json`. Los ficheros existentes de `apps/web` que se modifican son solo los 18 de la tabla «Modificados». Uno que falte se añade antes al diseño, con su porqué.
- **Sin dependencias nuevas.**
- Ningún test sale de loopback ni llama a Anthropic o a Internet. Los E2E usan la pila de `web-chat` sin `FRANCA_ANTHROPIC_API_KEY`, `FRANCA_SECRET_*` ni `FRANCA_HTTP_*`.
- Tipos y validación de flujos solo desde `@franca/spec`: nada se redefine en la web.
- Textos visibles en español y con «Franca», nunca el nombre de un paquete ni del repo.
- Un gate solo se marca con checks realmente ejecutados, citando el comando y su resultado.
- Commits por fase con `git add` de rutas explícitas, sin `-A`. Ni ramas, ni *push*, ni PR sin orden del usuario.

**Estado de partida (medido el 2026-10-18)**:
- `pnpm exec openspec validate web-editor --strict`: en verde.
- `pnpm check`: **en rojo** en la rama, porque `tests/spec-coverage.test.ts` aplica el delta de `web-chat` y exige el título «Enlace al editor desde el inicio» (propuesta). La tarea 1.1 lo arregla primero.
- `validateFlow` empaquetado por Turbopack: un *chunk* de 144 KB (41,7 KB en gzip) con `Function` (sonda borrada, ver `design.md`, Context).

**Modo de aplicación recomendado: `apply normal`**, fase a fase con sus gates. El espacio de comportamiento es grande y visual (lienzo, arrastre, foco, 320 px) y necesita el navegador. Un `bucle aislado` (`popi:loop`) solo encaja en la fase 3 (mutación: lista cerrada y veredicto mecánico). La elección es del usuario.

**Antes de la fase 1**: aprobación del usuario del diseño y de las preguntas abiertas de `design.md` (deltas `4ced695` y `0520b08`, lienzo propio, aviso de cambios sin publicar en flujos nunca publicados).

## 1. Núcleo puro del editor y contacto con el chat — dueño: `popi:frontend-developer`

- [ ] 1.1 **Contacto con el chat** (D20), lo primero para que `pnpm check` vuelva a verde:
  - `src/lib/chat/copy.ts`: `noFlows` («Todavía no hay flujos publicados. Publica uno desde el editor de flujos.»), `editorLink` («Editor de flujos») y `goToEditor` («Ir al editor de flujos»).
  - `src/components/chat/list-state.tsx`: `emptyText: ReactNode`.
  - `src/components/chat/home-screen.tsx`: enlace a `/flujos` en la cabecera y en la lista vacía (`WEB_PAGES.flows`, que se añade a `src/config/endpoints.ts` en esta tarea).
  - `e2e/home.e2e.ts`: «Sin flujos publicados» comprueba el texto nuevo y el enlace a `/flujos`, y se añade `test('Enlace al editor desde el inicio')`. La ruta `/flujos` aún no existe: el test llega a `/flujos` y comprueba la URL. Se ejecuta en la fase 5.
  - `pnpm check` en verde (la cobertura de `web-chat` ya encuentra el título).
- [ ] 1.2 `src/lib/editor/json-edit.ts` + test: `getIn`, `setIn` (en su sitio; clave nueva al final) y `removeIn` con JSON Pointer, con copia por la ruta y nunca `obj[key] =`. Casos:
  - Una cabecera `__proto__`.
  - Un `body` con claves `"10"` y `"a"`.
  - `constructor`.
  - Comparación del **texto** antes y después.
  - `getIn` con pasos intermedios que no son objetos: `/request/method` con `request` `null`, `5`, `"x"` y `[]`; `/0` sobre `"ab"`; `/constructor` sobre `{}`. Todos dan `undefined` sin lanzar.
  - `setIn` y `removeIn` lanzan el error de programación con un paso intermedio que no es objeto (revisión 4, D5).
- [ ] 1.3 `src/lib/editor/flow-text.ts` + test: `flowText` (un `JSON.stringify` sin caso nulo, D5) y `utf8Bytes` (`ñ` cuenta dos bytes).
- [ ] 1.3b `src/lib/editor/node-targets.ts` + test (B1, D10): `nodeTargets(node)` comprueba la forma mínima (`rules` lista de objetos en `condition`; `choices` ausente o lista de objetos en `input`) y llama a `targets`, o devuelve los saltos legibles con las mismas `key` y `pointer`. Casos:
  - `rules` ausente, `5` y `[null]`;
  - `choices` `"x"` y `[null]`;
  - una opción sin `id` de texto;
  - un `type` desconocido;
  - los nodos válidos de los ejemplos, con el mismo resultado que `targets`;
  - en los dos caminos, solo saltos con `id` de texto (la regla de la plantilla, sin `next`, y `{next: 5}` no dan nada), y la clave de una opción con su índice si su `id` no es texto (revisión 3).

  Ninguno lanza. `outputs`, `canvas-model`, `layout` y `rename` solo llegan a `targets` a través de él. La guarda estática de 2.9 lo comprueba: ningún fichero de `src/` salvo `node-targets.ts` importa `targets` de `@franca/spec`.
- [ ] 1.3c `src/lib/editor/as-text.ts` + test (revisión 3, D10): un texto tal cual; `{}`, `[]`, `5`, `null` y `true` con `JSON.stringify`; `undefined` da `""`.
- [ ] 1.4 `src/lib/editor/node-types.ts` (`NODE_TYPE_LABELS` con los ocho tipos en español) y `src/lib/editor/node-fields.ts` (descriptores de D8), con `node-fields.test.ts`:
  - Paridad recursiva de claves y clases con `schema` de `@franca/spec` para los ocho tipos, `nodeBase`, la raíz y `variable`.
  - Las opciones de cada `enum` salen del esquema en ejecución.
  - Validación a mano, una vez: se quita una clave de un descriptor, el test falla, y se restaura.
  - `fitsField(descriptor, value)` (revisión 4, D8): la matriz de cada clase contra `null`, `5`, `"x"`, `[]` y `{}`, y los casos de la tabla de D8 (cabeceras `{"x":1}`, `{"secret":5}` y `{"secret":"A","y":1}`; `when` `5`, `null` y `"x"`; `value` objeto donde no se admite JSON; un número infinito).
  - Las tablas por tipo (`NODE_TYPE_LABELS` y descriptores) se leen con `Object.hasOwn` o son `Map`: `type` `"constructor"`, `"toString"` y `"__proto__"` dan «tipo desconocido».
- [ ] 1.5 `src/lib/editor/fields.ts` + test (D5). Cada fila de la tabla de D5:
  - Texto, sin recortar.
  - Número: `abc`, `1.50`, `-3`, `08`, una cifra de 400 dígitos (se queda como texto: `Number` daría `Infinity`) y el vacío.
  - JSON libre y «Editar como JSON» aplican `JSON.parse(JSON.stringify(valor))`: `1e400` se queda en `null` en el borrador y en su texto.
  - `enum` con «(por defecto)».
  - Casilla que vuelve al `default`: quita la propiedad o, si el último guardado la tenía escrita **con el valor por defecto** en esa ruta (`"pii": false`), la vuelve a escribir con ese valor en su sitio. Marcar y desmarcar deja el texto como estaba. Con un guardado con `"pii": true`, desmarcar quita la propiedad.
  - Salto con «(ninguno)».
  - Valor en sus cinco modos y «(ninguno)».
  - JSON inválido conservado sin escribir.
  - Contenedores opcionales vacíos quitados y obligatorios conservados.
  - Plantillas de elementos.
  - Cambio de `kind` de un contenido.
  - Cabeceras: secreto, texto, añadir al final, renombrar en su sitio y nombre repetido.

  Con `it('Editar un campo no reordena el nodo')` y `it('Vaciar un campo opcional')` sobre `captacion-leads`, comparando el texto completo (golden literal).
- [ ] 1.6 `src/lib/editor/node-templates.ts` + test:
  - Las ocho plantillas de «Añadir nodo», con solo lo que dice la spec.
  - `<tipo>-<n>` con el menor `n` libre.
  - `emptyFlow(id, nombre)` con el texto exacto de «Crear un flujo vacío».
  - El JSON exacto de «Añadir un mensaje» como último nodo.
- [ ] 1.7 `src/lib/editor/rename.ts` + test:
  - `start` y todas las clases de `targets`: `next`, `else`, `onError`, `onExhausted`, `target`, `rules[i].next` y `choices[i].next`.
  - Patrón inválido y duplicado sin cambios.
  - Los textos con `{{…}}` intactos.
  - `it('Renombrar un nodo')`: ningún valor igual a `pedir-nombre` y `validateFlow` válido.
- [ ] 1.8 `src/lib/editor/node-ops.ts` + test:
  - Borrar sin tocar saltos (`validateFlow` da «onError apunta a un nodo inexistente: aviso-error»).
  - Sustituir por JSON: un no-objeto da error sin cambios; mismo `id`; otro `id` con las reglas de renombrar; cambio de `type`.
  - Un JSON de 100 000 niveles (en el nodo y en `request.body`) se rechaza con el error de profundidad antes de serializar, sin `RangeError` y con el flujo idéntico.
  - `connectOutput(flow, positions, nodeId, pointer, destino)` = `setTarget(fixPositions(…))`, que comparten el selector del inspector (también «ninguno») y el soltar (delta `0520b08`).
- [ ] 1.9 `src/lib/editor/outputs.ts`, `canvas-geometry.ts` y `canvas-model.ts` + tests:
  - Salidas por tipo, con selección única, selección múltiple y un tipo desconocido.
  - Conexiones desde `targets`, rotas y lazo.
  - Defensivas: una condición sin `rules` válidas tiene solo `else`, y un `input` con `choices` que no es una lista no tiene salidas de opción.
  - Las ocho plantillas de «Añadir nodo» y los nodos mal formados de 1.3b por `canvasModel`, sin lanzar.
  - `it('Salidas de los nodos de los ejemplos')`, con el `jump` añadido.
  - `it('Conexiones de captacion-leads')`: 12 conexiones, las tres de `pedir-tamano` y `onError` de `enviar-crm`.
  - Revisión 3:
    - la plantilla de regla añadida a una condición no da conexión para esa regla;
    - `rules: [{next: 5}]` no da ninguna;
    - dos opciones con el mismo `id` dan salidas y conexiones con `pointer` distintos;
    - una opción con `id` `{}` se etiqueta `choices[0].next`.
- [ ] 1.10 `src/lib/editor/layout.ts` y `positions.ts` + tests (D11):
  - Determinista y sin solapes, también con posiciones existentes en medio.
  - `bienvenida` en `{0, 0}`.
  - Nodos inalcanzables.
  - Enteros.
  - `fixPositions` al final de cada nodo.
  - `moveNode` fija todas y redondea.
  - El golden de «Mover un nodo guarda su posición».
  - Una `position` inválida se pinta en la automática.
  - `autoLayout` con las ocho plantillas de «Añadir nodo» y los nodos mal formados de 1.3b, sin lanzar y sin solapes.
  - Posición válida solo con `x` e `y` finitos: `{x: Infinity, y: 0}`, `{x: "a", y: 0}`, `null` y `5` se pintan en la automática (mutante `infinitePosition`). Un nodo con id `constructor`.
- [ ] 1.11 `src/lib/editor/drop.ts` + test (D12):
  - Destino válido.
  - Sustitución.
  - Vacío y cancelado, que dan `none` con el mismo objeto.
  - Propio nodo.
  - `next` de `llm` (sí) y `onExhausted` de `llm` (no).
  - El mismo JSON que `setTarget` salvo las `position`.
  - `it('Conectar una salida vacía arrastrando')`: tras conectar, `validateFlow` ya no dice que falte `next` en `message-1`.
- [ ] 1.12 `src/lib/editor/issues-view.ts`, `save-gate.ts` y `limits.ts` + tests:
  - Agrupación por nodo y por puntero, y la nota de forma.
  - Barreras en su orden: sin cambios, inválido, credencial y tamaño en bytes (`checkSavable`), más `checkPublishable` (`dirty`) y `checkTryable` (sin versión, `dirty`).
  - `tests/editor-parity.test.ts`: `MAX_FLOW_BYTES` igual al número de «Guardar el borrador» en la spec efectiva, y `NODE_TYPE_LABELS` igual a los tipos de `$defs.node.oneOf`.
- [ ] 1.13 `src/lib/editor/api-types.ts` y `copy.ts` + tests:
  - Lectores de `FlowResource` y `VersionResource` con formas buenas, rotas y desconocidas.
  - Los textos de la tabla de errores del contrato por contexto.
  - Ninguno contiene `@franca/`.
- [ ] 1.14 `src/lib/editor/editor-session.ts` + test, con un cliente falso (D4, D13, D14, D15):
  - `open`: `ready`, `not_found` y `load_error`, sin escribir posiciones.
  - `dirty` por texto, también tras deshacer a mano.
  - Ediciones mientras se guarda.
  - Cada fila de D13: 200; 412 con «Guardar encima» y `If-Match` de `currentRevision`, nunca `*`; perdida con relectura igual, distinta y fallida, sin reenviar nunca; 404, 400 y 413.
  - Publicar (201, 200, 412 y `dirty`) y borrar (204, 404 y 412).
  - `busy` descarta la segunda pulsación.
  - `reset` y la época descartan una respuesta tardía.
  - Los cinco escenarios que se prueban aquí (D22), con su título exacto y sin ninguna llamada al cliente falso en los cuatro de barrera:
    - `it('JSON de un nodo roto')`: `{"id":` da el error y el borrador idéntico;
    - `it('Publicar con cambios sin guardar')`;
    - `it('Probar sin versión publicada')`: `checkTryable` da «Publica el flujo antes de probarlo.» y no se llama al `start` falso;
    - `it('Cambio deshecho a mano')`;
    - `it('Flujo de más de 1 MiB')`: un flujo válido de 1 040 000 bytes generado de forma determinista, con 10 000 caracteres añadidos a un mensaje.
- [ ] 1.14b `src/lib/editor/malformed-flows.test.ts` (D25): un nodo de cada tipo con cada propiedad sustituida a su vez por `null`, `5`, `"x"`, `[]`, `{}` y el `null` que deja `1e400`. Sobre cada variante, nada lanza en `canvasModel`, `autoLayout`, `nodeOutputs`, `renameNode`, `fixPositions`, `connectOutput` (cada salida), `fitsField` (cada campo), `validateFlow` y `JSON.stringify`, y ningún texto para pintar es `[object Object]`. `readFlowResource` rechaza `flow.nodes` que no es una lista de objetos, un `id` que no es texto y un `start` que no es texto.
- [ ] 1.15 **Gate 1**:
  - `pnpm check` en verde.
  - `pnpm exec openspec validate web-editor --strict` en verde.
  - El *diff* de las reglas vacío.
  - Commit `feat(web): núcleo del editor de flujos`.

## 2. Frontera y servidor de la web — dueño: `popi:frontend-developer`

- [ ] 2.1 **Respuestas reales**: con la API real y Postgres en local, `curl -i` con `Connection: close` de `POST /flows` (201), `GET /flows/:id` (200), `PUT` (200 y 412), `POST …/versions` (201 y 200), `DELETE` (204 y 412), 404 `flow_not_found`, 409 `flow_already_exists` y `flow_id_reserved`, 400 `invalid_flow` y 428. Se copian byte a byte a `tests/helpers/real-flow-shapes.ts` con la fecha, como `real-api-shapes.ts`.
- [ ] 2.2 `src/config/endpoints.ts`: `WEB_ENDPOINTS` (`editorFlows`, `editorFlowCreate`, `editorFlow` y `editorFlowVersions`, con `encodeURIComponent`), `API_OPERATIONS` (`listFlows`, `getFlow`, `createFlow`, `updateFlow`, `publishFlow` y `deleteFlow`) y `WEB_PAGES.flowEditor`.
- [ ] 2.3 `src/server/api/transport.ts`: `'PUT'` en `TransportRequest.method`. `src/server/api/operations.ts`: las seis funciones de D2. `src/server/api/operations.test.ts`: «exporta exactamente las catorce operaciones» (lista de nombres) y `Object.keys(API_OPERATIONS)` con 14 claves (B2).
- [ ] 2.4 `src/server/frontier.ts`: el paso del segmento de `/api/editor/flows/` (404 `flow_not_found`). `src/server/frontier-editor.test.ts`:
  - `..%2Fconversations`, `Hola`, `%` mal formado, el segmento válido y la ruta sin segmento.
  - Que las mutaciones nuevas exigen `Origin` con la matriz de `web-chat`.
  - `it('la CSP no restringe scripts: el validador del editor compila con Function')` (D7).
- [ ] 2.5 `src/server/bff/request.ts`: `readJsonText` y `readFlowBody` (D2). `readJsonBody` conserva su contrato y sus tests existentes siguen en verde.
- [ ] 2.6 `src/server/bff/handlers.ts`: los seis manejadores en el orden de D2, las tres plantillas y `rejectedByFrontier` con el cuerpo de la decisión. Rutas `src/app/api/editor/flows/route.ts`, `[flowId]/route.ts` y `[flowId]/versions/route.ts` con `await connection()`.
- [ ] 2.7 `src/server/bff/editor-handlers.test.ts`, contra `tests/helpers/fake-api.ts` y las respuestas de 2.1:
  - Método, ruta, consulta, cabeceras y bytes exactos de cada operación (la lista sin `published`). Publicar llega con `Content-Length: 0` y sin `Content-Type`; borrar, sin `Content-Length`.
  - `If-Match` ausente, `*`, `W/"1"` y `1`.
  - Ids inválidos sin llamar.
  - La frontera repetida.
  - Publicar y borrar con un cuerpo que no se reenvía.
  - `[]`, `null` y `"x"` dan `invalid_request`, y un cuerpo no JSON `invalid_json`.
  - Un cuerpo poco profundo con espacios no canónicos llega serializado de nuevo.
  - Un cuerpo de **100 000 niveles** con espacios no canónicos llega a la API exactamente como se recibió y no da 500. Así muere `stringifyWithoutDepthGuard`: Node serializa 1001 y 5000 niveles sin lanzar, así que con esos tamaños el test no lo mataría.
  - El 204.
  - Errores sin `message`, `issues` ni `warnings` (cuerpo con `MARCA-MENSAJE` y `MARCA-ISSUE`) y `currentRevision`.
  - Un 5xx registra solo plantilla, estado y código.
  - `it('Cuerpo de un flujo demasiado grande')`: 1 048 577 bytes da 413 y `[]` da 400 `invalid_request`, sin llamar a la API.
- [ ] 2.8 `src/lib/web-client.ts`: `'PUT'`, `createEditorClient` y `editorClient` (D3). `src/lib/web-client-editor.test.ts` con un `fetch` falso:
  - URL, método, `If-Match: "<n>"`, cuerpo, `cache` y `credentials` de las seis llamadas.
  - 201 frente a 200 al publicar.
  - El 204.
  - Un 4xx sin cuerpo da `unknown`.
  - `network_error` solo con rechazo.
- [ ] 2.9 `tests/static-guard.test.ts` (D21):
  - `operations.ts` exporta exactamente las catorce funciones por nombre (el título del test pasa a «…exactamente catorce funciones»).
  - Ficheros de ruta: de 7 a 10 (`expect(routes.length).toBe(10)`), y manejadores: de ≥ 13 a ≥ 19 (los seis nuevos).
  - Solo `src/lib/editor/node-targets.ts` llega a `targets` de `@franca/spec` (B1). Fuera de `src/server/**` se rechazan también `import * as … from '@franca/spec'`, `import('@franca/spec')` y cualquier importación con nombre que incluya `targets` (también `targets as x`). Cada caso, con su control.
  - `@franca/spec` en el navegador, solo desde `src/lib/editor/**`.
  - En `src/components/editor/**`, ni `<img`, `<video`, `<audio`, `<iframe`, `<embed`, `<object`, `<source`, `<picture` ni `<a `, y los `href=` solo de `WEB_PAGES`.

  Cada regla nueva con su control (un caso prohibido que la guarda detecta), como los de `web-chat`. `eslint.config.mjs`: `next/image` en `src/components/editor/**`, validado a mano una vez.
- [ ] 2.10 **Gate 2**:
  - `pnpm check` en verde.
  - Con `pnpm --filter @franca/web build && … start` delante de la API real, un `curl` por operación: lista, crear, leer, guardar con `If-Match`, publicar y borrar, más un 403 sin `Origin` y un 404 con `..%2Fconversations`. Salida pegada en el gate.
  - *Diff* de las reglas vacío.
  - Commit `feat(web): operaciones del editor en la frontera`.

## 3. QA del núcleo y de la frontera — dueño: `popi:qa-tester` (unit, integración y mutación)

- [ ] 3.1 Revisión adversarial de las costuras, con el código ajeno abierto:
  - Los dobles de `editor-handlers.test.ts` y de `editor-session.test.ts` tienen la forma de `real-flow-shapes.ts`.
  - Los lectores de `api-types.ts` aceptan las respuestas reales.
  - `readFlowBody` reenvía exactamente lo que `inspectFlowBody` de la API validará.

  Lo que falte se añade como test.
- [ ] 3.2 Los 41 mutantes de D23 en `tests/mutations.json`, con `find` único en su fichero y `tests` con los que lo matan. `pnpm --filter @franca/web mutate`: ninguno sobrevive. La salida se pega en el gate.
- [ ] 3.3 Cada test negativo nuevo que no es mutante («no llama a la API», «sin `issues`», «no contiene», paridades) se valida una vez a mano, provocando el caso prohibido y viendo que falla. La lista va en el gate.
- [ ] 3.4 **Gate 3**: `pnpm check` en verde, la mutación sin supervivientes y commit `test(web): mutantes y negativos del editor`.

## 4. Pantallas del editor — dueño: `popi:frontend-developer`

- [ ] 4.1 Páginas (D1):
  - `src/app/flujos/page.tsx`.
  - `src/app/flujos/[flowId]/page.tsx`, con `<Suspense>`, `await params` e `isFlowId`.
  - `editor-loading.tsx` y `editor-not-found.tsx`.
- [ ] 4.2 `/flujos` (D16, D18):
  - `flows-screen.tsx`, con `usePagedList(editorClient.listFlows)`, `ListState` y `useListFocus`.
  - `editor-flow-list.tsx`.
  - `new-flow-dialog.tsx`: los dos modos, foco en el campo culpable y 409 en el identificador.
  - Navegación con `GuardedLink`.
- [ ] 4.3 `src/hooks/use-editor-session.ts` (abrir en `useEffect` y `reset` en el *cleanup* de `useLayoutEffect`), `use-unsaved-guard.ts` (`beforeunload` solo con `dirty`), `guarded-link.tsx` (`onNavigate` y `ConfirmDialog`) y `confirm-dialog.tsx` (D15). Cada `<dialog>` del editor y de `/flujos` se cierra en el *cleanup* de un `useLayoutEffect`, y toda navegación del editor (`router.push`) cierra antes los diálogos abiertos.
- [ ] 4.4 `editor-screen.tsx`, `editor-header.tsx`, `editor-actions.tsx` (Guardar, Publicar, Probar con `useStartConversation` y su nota, Descartar cambios, Ver JSON, Añadir nodo y Borrar flujo), `add-node-menu.tsx`, `flow-json-dialog.tsx` y `node-json-dialog.tsx`. Incluye la región `role="status"` y el foco de la tabla de D17.
- [ ] 4.5 Lienzo (D9-D12):
  - `flow-canvas.tsx`: zona con desplazamiento, mundo escalado y límites congelados durante el arrastre.
  - `canvas-node.tsx`: botón, nombre accesible, marcas con texto, flechas, `data-drop` con texto, y `width`/`height` fijos de `nodeSize` con `overflow-hidden` y textos recortados (D10). Todo valor del flujo se pinta con `asText`.
  - Las `key` de React de salidas y conexiones son `<índice del nodo>:<pointer>`, y cada salida lleva `data-pointer` (revisión 3).
  - `canvas-edges.tsx`: `data-edge-*` y conexiones rotas con texto.
  - `zoom-controls.tsx`: solo botones, sin Ctrl/⌘ + rueda.
  - `use-canvas-drag.ts`: mover y conectar con Pointer Events, `elementFromPoint` y `resolveDrop`. La línea provisional y su `<svg>` llevan `pointer-events: none`, y Escape se escucha en `window` mientras dura el arrastre (D12).
  - El selector de salto del inspector usa `connectOutput` (fija posiciones, delta `0520b08`).
  - `canvas-node.test.tsx` (marcado):
    - el estilo con el tamaño de `nodeSize`, también con un `title` de 120 caracteres;
    - `title` `{}`, `[]`, `5` y `null`, y `type` `{}`, sin lanzar y con su texto JSON (mutante `renderRawTitle`).
- [ ] 4.6 Inspector y panel por descriptores (D5, D8):
  - `node-inspector.tsx`, `inspector-field.tsx` y un componente por clase de campo.
  - `flow-panel.tsx`.
  - `problems-list.tsx`, con la nota de forma y los avisos.
  - Los problemas de cada campo enlazados con `aria-describedby`.
  - `inspector-field.tsx` consulta `fitsField` antes de pintar cada campo, también los anidados, y si no encaja pinta el JSON libre con su nota (D8). Así, por ejemplo, una lista con elementos que no son objetos (`rules: [null]`, `choices: [null]`) pasa entera a JSON libre.
  - `node-inspector.test.tsx` (marcado): un `http` con `request: null`, otro con `headers: null`, una cabecera `{"x": 1}`, una condición con `when: 5` y un `type` `"constructor"`. Ninguno lanza, se ve el JSON libre con su nota y no aparece `[object Object]` (mutante `skipFieldFit`).
  - `content-field.test.tsx` (URLs como texto) y `problems-list.test.tsx` (marcado; `nodeId` y partes del flujo con `asText`).
- [ ] 4.7 Composición y 320 px (D18): dos columnas en `lg`, lienzo con altura propia, `min-w-0` y `overflow-wrap: anywhere`.
- [ ] 4.8 **Verificación en el navegador** (`/popi:verify frontend`) con `pnpm dev` y la API real. Se recorre: importar `captacion-leads`, mover, conectar arrastrando cada clase de salida, renombrar, guardar, publicar y probar, más el 412 con dos pestañas y salir con cambios. Consola limpia, y en la pestaña de red solo `/api/*` del propio origen. Hallazgos anotados en el gate.
- [ ] 4.9 **Gate 4**: `pnpm check` en verde, la verificación 4.8 hecha y commit `feat(web): editor visual de flujos`.

## 5. E2E y cobertura de la spec — dueño: `popi:qa-tester` (E2E)

- [ ] 5.1 Ayudas y forma real (D22):
  - `e2e/support/editor.ts`: `openEditor`, `node`, `edges`, `dragOutput` (destino, vacío, fuera y Escape), `lastRequest`, `bodyOf` y `forwardThenCut`.
  - `e2e/support/admin.ts`: se amplía con `flow(flowId)` y `versions(flowId)` contra la API real (B2), y los escenarios que leen el estado los usan.
  - `e2e/editor-api-shapes.e2e.ts` compara `real-flow-shapes.ts` con la API real (claves y orden).
- [ ] 5.2 Los 66 escenarios de navegador con su título exacto, en los ficheros de la tabla «Escenario → test» de `design.md`. Más dos de apoyo:
  - `test('cada clase de salida se conecta arrastrando')` en `editor-canvas.e2e.ts`: `choices[pequena].next`, `rules[0].next`, `onExhausted` y el `target` de un `jump` añadido.
  - `test('añadir una condición no rompe el lienzo')` en `editor-inspector.e2e.ts` (B1): `condition-1` pintado con su salida `else`, la lista dice que falta `rules` y la consola sigue limpia.
  - «Abrir sin posiciones no cambia el flujo» comprueba además que la `boundingBox` de cada nodo no pasa de `nodeSize × zoom`.
  - Lo que la API real no produce a voluntad va contra la simulada: «Flujo que no existe en el editor», «Validar no llama a la API», «Guardado con respuesta perdida» y «Error de la API sin su mensaje».
  - «Recargar con cambios», con el `dialog` `beforeunload`. Si no se emite sin cabeza, se usa el *fallback* de D22 y su motivo queda en el test.
- [ ] 5.3 `e2e/home.e2e.ts`: se ejecutan «Enlace al editor desde el inicio» y «Sin flujos publicados» contra la ruta real.
- [ ] 5.4 `tests/spec-coverage.test.ts` (D24): `web-chat` y `web-editor` (44 requisitos y 78 escenarios como mínimo), con títulos únicos entre las dos. `pnpm check` lo pasa con los 78 títulos.
- [ ] 5.5 Revisión de la interfaz con la skill `web-design-guidelines` sobre `/flujos` y `/flujos/<id>`, también a 320 px. Lo que sea presentacional se corrige. Lo conductual vuelve a la spec.
- [ ] 5.6 **Gate 5**:
  - `docker compose up -d`, `DATABASE_URL` y `pnpm test:e2e` en verde, con la duración del job de E2E de la web completo antes y después anotada (portátil, solo orientativa).
  - `pnpm check` en verde.
  - Commit `test(web): E2E del editor de flujos`.

## 6. Documentación y cierre — dueño: `popi:frontend-developer`

- [ ] 6.1 `.claude/rules/frontend/architecture.md`: «catorce operaciones fijas», las rutas `/api/editor/flows/**`, `src/lib/editor/` y que `@franca/spec` solo entra en el navegador por el editor.
- [ ] 6.2 Wiki (`/popi:wiki add`), con la línea del índice en `.claude/rules/always/knowledge-wiki.md` y `metadata.enforcement`:
  - `gotcha-json-stringify-recursivo`: `JSON.parse` es iterativo y `JSON.stringify` lanza `RangeError` con el anidamiento que cabe en 1 MiB; por eso la web reenvía el texto y el editor usa `flowText`. Enforcement: `editor-handlers.test.ts` y `flow-text.test.ts`.
  - `gotcha-targets-asume-forma-valida`: `targets()` de `@franca/spec` lanza `TypeError` con un nodo de forma inválida (condición sin `rules` o con `[null]`, `choices` `"x"` o `[null]`), y el editor los produce con «Añadir nodo» y «Editar como JSON». Por eso todo pasa por `nodeTargets`. Enforcement: `node-targets.test.ts`, la guarda estática (solo `node-targets.ts` importa `targets`), el mutante `callTargetsDirect` y el E2E «añadir una condición no rompe el lienzo».
  - `decision-editor-lienzo-y-validacion`: lienzo propio, validación síncrona y ajv con `Function`, que exige una CSP sin `script-src`. Incluye el límite aceptado de la v0: **atrás del navegador con cambios sin guardar no pregunta** y los pierde (`<Activity>` oculta el editor y `reset` los descarta; Next no da una API estable para interceptar `popstate`). Enforcement: `frontier-editor.test.ts`, la guarda estática y el mutante `scriptSrcWithoutEval`; lo de atrás es `none — limitación aceptada, escrita para que nadie la tome por un fallo`.
  - `decision-frontera-local-de-la-web`: actualizar de ocho a catorce operaciones y de tres a siete manejadores con defensa en profundidad.

  `.claude/rules/always/gotchas.md`: las dos líneas de «Ficheros». `pnpm wiki:lint` en verde.
- [ ] 6.3 `CLAUDE.md` (la ruta del editor), `README.md` de la raíz (`/flujos` en el recorrido local) y `apps/web/README.md` (el editor y cómo se prueba).
- [ ] 6.4 Prueba a mano de las métricas de la propuesta: crear un flujo de tres pasos y probarlo sin JSON a mano, e importar `captacion-leads-local` en `pnpm dev:demo` y probarlo hasta `lead-empresa`. Si el *fallback* de D22 se usó, recargar a mano con cambios y ver la confirmación.
- [ ] 6.5 **Gate 6**:
  - El criterio del *diff* de `design.md` no imprime nada, y `--diff-filter=M` en `apps/web` lista los 18 ficheros.
  - `pnpm check` en verde y `pnpm exec openspec validate web-editor --strict` en verde.
  - Commit `docs: editor de flujos en reglas, wiki y README`.
  - Después, `/opsx:archive` en la misma rama, antes del PR, y `/popi:verify`.

## 7. Seguimiento

- [ ] 7.1 FOLLOW-UP: medir en el *runner* la duración del job de E2E de la web completo (chat, editor y `@lento`) antes y después (D22, R7) y anotarla en el PR. Si pasa de 12 minutos, aplicar el recorte de D22.
- [ ] 7.2 FOLLOW-UP: medir en el *runner* el tiempo de un cambio de texto con el flujo de 1 MiB y el de abrir uno de 5000 nodos (R1). Por encima de 100 ms o 3 s, `useDeferredValue` o virtualizar, con su propio cambio.
- [ ] 7.3 DEPLOY-TIME: no aplica. Es una herramienta local sin despliegue: el cambio se cierra con el merge.
- [ ] 7.4 FOLLOW-UP: si alguna vez la web necesita una CSP con `script-src`, precompilar ajv (*standalone*) en `packages/spec` con su propio cambio antes de añadirla (D7, R2).
