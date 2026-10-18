# Proposal: editor visual de flujos (`web-editor`)

**Fecha**: 2026-10-17 · **Estado**: Draft · **Rama**: `feat/web-editor` · **Feature 8, la última del plan** (hechas: motor, `input`, `http`, `llm` con el adaptador de Claude, API de flujos, API de conversaciones, salida http real, chat de prueba y demo local con CRM simulado).

## Why

Hoy, para tener un flujo en Franca hay que escribir su JSON a mano y enviarlo con `curl` a la API (`POST /flows`, `PUT` con `If-Match`, `POST …/versions`). El chat de prueba ya conversa con cualquier flujo publicado, pero su página vacía todavía dice «publícalo con la API». Falta la pieza que cierra el ciclo para quien diseña conversaciones: ver el flujo como un grafo, cambiarlo con formularios, enterarse de los errores mientras edita y guardar, publicar y probar sin salir de la web.

Las features anteriores ya dejaron casi todo listo: `validateFlow` no tiene IO y da `path` y `nodeId` por problema, el esquema ya admite `position` en cada nodo, la API custodia borradores con `If-Match` y versiones inmutables, y la web ya es una frontera local con operaciones fijas.

## What Changes

- **`/flujos`**: todos los flujos vivos (publicados o no), con su última versión o «Sin publicar», el aviso de cambios sin publicar y paginación. «Nuevo flujo» crea uno vacío (identificador y nombre) o uno desde un JSON pegado (así se traen los ejemplos).
- **`/flujos/<id>`**, el editor de un flujo:
  - **Lienzo** con los nodos (id, tipo en español, `title`), el inicio marcado y una conexión por cada salto de `targets` de `@franca/spec`, también las rotas. Se desplaza y amplía. Los nodos se mueven con el ratón o con las flechas, y las conexiones se crean o sustituyen arrastrando una salida hasta otro nodo.
  - **Inspector** por tipo con un campo por propiedad del esquema, para los ocho tipos. Los saltos se eligen de una lista, que es la vía del teclado para todo lo que hace el arrastre. Hay texto JSON solo donde el esquema admite JSON libre o anidado (`request.body`, predicados `all`/`any`, valores JSON) y «Editar como JSON» para cualquier nodo.
  - **Panel del flujo**: nombre, descripción, `locale`, `settings`, `start` y variables (con `pii`).
  - **Validación en vivo** en el navegador con `validateFlow`: lista de problemas y avisos con salto al nodo, y marcas en el lienzo.
  - **Acciones**: «Añadir nodo», «Borrar nodo», renombrar (con sus referencias), «Guardar» (`PUT` con `If-Match`, conflicto 412 y respuesta perdida), «Descartar cambios», «Publicar», «Probar» (abre una conversación del chat con la última versión publicada), «Ver JSON» con «Copiar» y «Borrar flujo».
- **Frontera local**: seis operaciones nuevas en el servidor de la web (de 8 a 14), con el mismo `Host`, `Origin`, cabeceras fijas, ids validados y sin `message` hacia el navegador.
- **Chat**: el inicio enlaza con el editor, y su página vacía manda al editor en vez de a la API.

### Decisiones (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| **Posiciones en `nodes[].position`**, que ya existe en `nodeBase` (`{x, y}` numéricos, opcional) | No cambia el contrato ni hace falta RFC: el esquema ya lo tiene, `validateFlow` lo excluye de los marcadores y el motor lo ignora (comprobado en `packages/spec/src/validate.ts` y `packages/engine/src`). Guardarlas aparte en la API sería tabla, endpoints y migración nuevos para algo que el formato ya resuelve. Un diseño automático sin guardar haría saltar los nodos al cambiar una conexión |
| Diseño automático determinista para los nodos sin `position`, que no se escribe hasta mover o añadir un nodo; entonces se fijan todos | Abrir y salir no puede cambiar el borrador: un `PUT` con otro texto sube la revisión («Guardar sin cambios» de `flows-api`). Al primer movimiento se fija lo que se ve, así nada salta después. Enteros, para que el JSON sea estable |
| Validación **en el navegador** con `validateFlow`, nunca `POST /flows/validate` | Es el mismo código y el mismo veredicto que aplica la API al guardar. Va sin red, sin latencia y sin una operación más en la frontera. Su coste es lineal y está acotado ([[gotcha-ajv-allerrors-cuadratico]]) |
| Formulario por tipo para los ocho tipos, con texto JSON solo en lo libre o anidado y «Editar como JSON» por nodo | Los ejemplos ya usan `http`, `llm` y `condition`: dejar un tipo fuera haría ineditable un ejemplo. El JSON por nodo es la salida para lo que un formulario no cubre bien (predicados anidados, `body`) sin inventar un constructor visual |
| Cada campo escribe directamente en el JSON: conserva el orden, no escribe los valores por defecto y vaciar un campo opcional quita la propiedad | La API compara textos («Guardar sin cambios», «Publicar sin cambios»). Reordenar o rellenar valores por defecto crearía revisiones y versiones sin cambios reales. Un número mal escrito se guarda como texto para que lo señale el validador y no se pierda en silencio |
| Solo se guarda un flujo válido (sin errores, sin `credential_header_literal` y como mucho de 1 MiB); mientras tanto, los cambios viven en la pestaña y salir pide confirmación | La API rechaza los borradores inválidos (`invalid_flow`, `literal_credential`, 413) y cambiar eso es un cambio de contrato. Guardar en el navegador contradiría «Privacidad en la web». Ver la pregunta abierta 1 |
| «Guardar» explícito, sin autoguardado | Casi todo paso intermedio es inválido (un nodo nuevo está sin conectar y es inalcanzable: error semántico). Un autoguardado fallaría casi siempre, y además cada guardado sube la revisión |
| 412: «Cargar el guardado» o «Guardar encima» con la `currentRevision` recibida, nunca `If-Match: *` | Es una decisión de la persona y no se pierde nada. Con la revisión concreta, un tercer cambio que llegue entre medias vuelve a dar 412 |
| Respuesta perdida: releer y comparar el texto, nunca reenviar | Mismo patrón que el chat. Reenviar con el mismo `If-Match` daría un 412 falso si el primero sí se aplicó |
| Conexiones arrastrando en el lienzo **y** desde el inspector, con el mismo JSON (decisión del usuario, 2026-10-18) | Arrastrar es lo que se espera de un editor visual. El inspector sigue siendo la vía del teclado y del lector de pantalla para todo lo que hace el arrastre, así que las salidas del lienzo no reciben el foco: un control a medias accesible es peor que ninguno |
| Una salida por cada salto que usa el motor: en selección única, `choices[].next`; en múltiple, el `next` del nodo | Es lo que sigue `resumeInput` (`packages/engine/src/nodes/input.ts`). Una salida que el motor ignora crearía conexiones sin efecto |
| Soltar en vacío o con Escape no cambia nada; soltar sobre el propio nodo se rechaza salvo `next` de `llm`; una salida conectada se sustituye al soltarla en otro nodo | Un gesto fallido no debe borrar nada: quitar un salto se hace con «ninguno» en el inspector. El autosalto sigue la regla del validador ([[domain-llm-puede-saltar-a-si-mismo]]). Una salida es un campo, así que tiene un único destino |
| Conectar arrastrando fija las posiciones, como mover o añadir | Si no, el diseño automático recolocaría los nodos justo debajo del puntero al cambiar el grafo |
| «Probar» = conversación del chat con la última versión publicada, solo sin cambios sin guardar | Reutiliza `POST /conversations` y el chat tal cual («Conversación fijada a una versión»). Probar el borrador exigiría ejecutar el motor en el navegador con un host simulado para `http` y `llm`: es otra feature |
| Cabeceras como texto o como secreto por nombre; el editor no lista los secretos de la instalación | Es lo que pide [[domain-flujos-sin-secretos]]. La API no expone los nombres configurados y exponerlos sería cambiar la API. Los avisos del validador se muestran en la cabecera, y «Guardar» se adelanta al 400 `literal_credential` |
| Las URLs del flujo se muestran como texto y no se cargan | Editar no debe hacer peticiones a terceros ni ejecutar contenido ajeno. El filtro de URLs y los medios son del chat ([[decision-filtro-de-urls-sobre-lo-parseado]]) |
| Seis operaciones fijas nuevas, sin proxy genérico y con el id validado contra el patrón del esquema | Es la misma frontera de [[decision-frontera-local-de-la-web]]: lista cerrada y rutas armadas con argumentos validados. `proxy.ts` ya exige `Origin` en todo método que no sea `GET` ni `HEAD`, así que las mutaciones nuevas nacen protegidas |
| Errores hacia el navegador como `{error}` (+ `currentRevision`), sin `issues` ni `warnings` de la API | El editor ya tiene el veredicto local, que es el mismo. Mantiene el saneado actual de `responses.ts` sin un caso nuevo |
| Borrar un nodo deja sus saltos rotos (dibujados y señalados) | Borrar referencias en cascada cambiaría otros nodos sin que se vea. Lo roto se ve y se arregla. «Descartar cambios» recupera |
| Deshacer: solo «Descartar cambios» y el deshacer propio de cada campo | Un historial de deshacer es una feature en sí. En v0 basta volver al último guardado |

### Qué ve cada consumidor

- **Quien diseña flujos**: `pnpm dev` o `pnpm dev:demo` y `http://localhost:3000/flujos`. Puede importar `captacion-leads-local` pegando su JSON, cambiarlo, publicarlo y probarlo en el chat de la demo.
- **Chat de prueba**: igual, más el enlace al editor y su página vacía con otro texto.
- **API**: sin cambios. Recibe del servidor de la web `GET /flows`, `GET/PUT/DELETE /flows/:id`, `POST /flows` y `POST /flows/:id/versions` como de cualquier cliente local.

### Formato de flujo

**`packages/spec/flow.schema.json` no cambia**, ni los tipos ni `validateFlow`, así que ningún flujo se rompe. `position` ya forma parte del formato v0 (`$defs/position` en `nodeBase`). El editor la escribe y el motor la ignora. RFC-0001 todavía no tiene texto (`docs/rfcs/README.md`): cuando lo tenga, debe decir que `position` es solo de presentación.

## Capabilities

### New Capabilities

- `web-editor`: el editor de flujos de la web. Cubre la lista de flujos, crear (vacío o desde JSON), abrir, el lienzo, las posiciones y el diseño automático, mover, las salidas de cada tipo y conectar arrastrando (con sus destinos no permitidos), el panel del flujo, el inspector de los ocho tipos, los campos sobre el JSON, las cabeceras y los secretos, añadir, renombrar y borrar nodos, el JSON de un nodo, la validación en vivo, ir a un problema, guardar (sin cambios, conflicto, respuesta perdida y errores), descartar, salir con cambios, publicar, probar, ver el JSON y borrar el flujo. También las operaciones del editor en la API, `Origin` y `Host`, el cuerpo hacia la API, las respuestas, la privacidad, las URLs sin cargar, la accesibilidad, el foco y la pantalla estrecha.

### Modified Capabilities

- `web-chat`: «Chat de prueba en local» (enlace al editor y escenario nuevo «Enlace al editor desde el inicio»), «Estados de las listas» (la página vacía enlaza con `/flujos`, mismo título de escenario) y «Operaciones del chat en la API» (las ocho son las del chat; las del editor están en `web-editor`).
- `flows-api`, `conversations-api`, `flow-validation`, `flow-engine`, `http-host`, `llm-anthropic` y `dev-simulated-services` no cambian. Lo he auditado contra `apps/api/src/flows/` (controlador, `flows.service.ts`, `if-match.ts`, `flow-body.ts`, `list-query.ts`, `http/limits.ts`), `apps/web/src/` (`proxy.ts`, `server/frontier.ts`, `server/api/operations.ts`, `server/bff/*`, `config/*`, `lib/web-client.ts`) y `packages/spec/src/`.

## Impact

- **`apps/web`**:
  - Páginas `/flujos` y `/flujos/[flowId]`, componentes en `src/components/editor/` y la lógica pura del editor (modelo sobre el JSON, renombrado, posiciones, diseño automático) en `src/lib/editor/`.
  - Seis funciones nuevas en `src/server/api/operations.ts`, sus rutas en `src/app/api/**` (todas con `await connection()`), sus manejadores en `src/server/bff/` y `API_OPERATIONS` y `WEB_ENDPOINTS` en `src/config/endpoints.ts`.
  - Validador de ids de flujo reutilizado (`isFlowId`) y lectura de cuerpos de flujo en `request.ts`.
  - Contacto con el chat: el enlace del inicio y el texto de la lista vacía.
  - `@franca/spec` en el bundle del navegador, con ajv: tamaño y uso de `new Function`, ver Riesgos. Posible dependencia del lienzo, que tendría que justificar el diseño.
- **Guardas y tests de la web**: `tests/static-guard.test.ts` pasa de «exactamente ocho funciones» a la lista cerrada nueva, como cambio deliberado. Hay que extender `tests/spec-coverage.test.ts` a `web-editor`, añadir mutantes nuevos a `tests/mutations.json` y E2E nuevos en `e2e/`.
- **`CLAUDE.md`, el `README` y la wiki**: la ruta del editor. Una ficha nueva si el diseño deja una decisión no derivable (diseño automático o validación fuera del hilo principal).
- **Sin cambios** en `apps/api`, `packages/*`, Prisma, `turbo.json` (salvo que el diseño lo pida), la CI ni el formato de flujo.
- **Aviso para la rama**: mientras este cambio esté activo, `tests/spec-coverage.test.ts` aplica el delta de `web-chat` y exige un test con el título «Enlace al editor desde el inicio», así que **`pnpm check` queda en rojo en `feat/web-editor` hasta que exista**. Los escenarios de `web-editor` no los vigila nadie hasta que se extienda la cobertura (tarea del diseño). Además, el E2E «Sin flujos publicados» ya existe y tendrá que comprobar el enlace nuevo.

## Non-goals / Out of scope

- **Colaboración en tiempo real**: ni presencia, ni sondeo, ni *streaming*. Dos pestañas se resuelven con `If-Match` y 412.
- **Deshacer y rehacer ilimitados**: solo «Descartar cambios» y el deshacer de cada campo.
- **Autenticación, usuarios, permisos** y exponer la web fuera de loopback.
- **Guardar borradores inválidos** y **autoguardado** (pregunta abierta 1). **Recuperar cambios sin guardar** tras cerrar la pestaña: no se guarda nada en el navegador.
- **Vista previa del borrador sin publicar** (motor en el navegador con host simulado).
- Copiar y pegar nodos, selección múltiple, grupos, comentarios, alinear o reordenar automáticamente a demanda, y plantillas o galería de flujos.
- **Historial de versiones**: listar, ver, comparar o restaurar versiones anteriores, y elegir la versión al probar.
- **Cambiar el `id` de un flujo** y **duplicar un flujo**. Se hacen copiando el JSON y creando otro.
- **Cambiar el tipo de un nodo desde el formulario**: se hace con «Editar como JSON».
- **Constructor visual de predicados anidados**: van como JSON.
- **Atajos desde un problema**, como «declarar esta variable».
- **Listar los secretos o los proveedores de la instalación**: la API no los expone.
- **Previsualizar multimedia** en el editor.
- **Importar o exportar ficheros**: se pega y se copia texto.
- **Buscar o filtrar flujos**, borrar varios a la vez y contactos.
- **Cambios en la API, en el formato de flujo o en el motor.**
- **Rendimiento garantizado para flujos enormes** (cerca de 1 MiB o miles de nodos): tienen que funcionar, pero sin objetivo de fluidez (ver Riesgos).

## FOLLOW-UP pendientes etiquetados para esta feature

| FOLLOW-UP | Veredicto | Dónde o por qué |
|---|---|---|
| `web-chat`: el editor hereda la frontera y añade sus operaciones | **Dentro** | «Operaciones del editor en la API», «Cambios de flujos solo desde la propia web», «Cuerpo de los flujos hacia la API» y «Respuestas de flujos en el navegador» |
| `web-chat`: elegir la versión al empezar, ver el grafo y la vista previa con host simulado | **Dentro solo el grafo** | El lienzo. Elegir versión y vista previa quedan fuera (Non-goals y pregunta 4) |
| `domain-flujos-sin-secretos`: selector de secretos y proveedores por nombre, con los avisos visibles | **Dentro** | «Cabeceras y secretos». Sin lista de nombres de la instalación |
| `web-chat`: la página vacía decía «publica con la API» | **Dentro** | «Estados de las listas» (modificado) |
| `api-flows` 7.4: OpenAPI exportado | **Fuera** | La web sigue siendo el único consumidor |

## Plan de verificación por capas

- **Unit (aplica)**: la lógica pura del editor, sin React:
  - Campos sobre el JSON: orden, valores por defecto sin escribir, vaciar, números escritos como texto y cabecera de texto o de secreto.
  - Renombrar con todas las clases de salto de `targets`, rechazo de duplicados y de patrón, borrar un nodo y JSON de un nodo, también con otro `id`.
  - Plantillas de «Añadir nodo» y su `<tipo>-<n>`.
  - Salidas de cada tipo (incluidas la selección única y la múltiple) y resolución del soltar: destino válido, sustitución, vacío, propio nodo y autosalto de `llm`.
  - Diseño automático: determinista, sin solapes y respetando las posiciones existentes. Fijar posiciones al mover o añadir. Comparación de cambios por texto. Decisión de releer tras una respuesta perdida.
  - Todo test negativo se valida haciendo fallar su fixture a propósito.
- **Paridad (aplica)**: los ids de flujo con el patrón del esquema (`isFlowId` ya lo lee de `@franca/spec`) y los códigos de error, con la paridad existente.
- **Golden/contractual (aplica, pequeño)**: el texto JSON que genera el editor en los casos de «Crear un flujo vacío», «Añadir un mensaje», «Editar un campo no reordena el nodo» y «Mover un nodo guarda su posición». Es lo que guarda la API y lo que compara.
- **Integración HTTP (aplica)**: el servidor de la web contra la API simulada:
  - Las seis operaciones con su ruta, `If-Match` y cuerpo exactos.
  - Ids con rutas dentro, `Origin` y `Host` en las mutaciones nuevas, 413, `invalid_json` e `invalid_request`.
  - Cabeceras que no se reenvían, saneado de errores (sin `message`, `issues` ni `warnings`) y `currentRevision` en el 412.
  - Registro sin contenido de flujos.
- **E2E opción-al-menos-una-vez (aplica)**: navegador contra la API real:
  - Crear vacío y desde JSON, los ocho tipos en el inspector, mover con teclado, conectar arrastrando (cada clase de salida al menos una vez, soltar en vacío y sobre el propio nodo), renombrar, borrar un nodo, validación en vivo e ir al problema.
  - Guardar, conflicto con dos pestañas, descartar, salir con cambios, publicar, «Probar» hasta la conversación y borrar el flujo.
  - Recorrido solo con teclado, 320 px y `medios` sin peticiones a terceros.
  - Contra la API simulada: respuesta perdida, error sin su mensaje y flujo que no existe.
- **Smoke de ruta (aplica)**: `/flujos`, `/flujos/<id>` existente, «Flujo no encontrado» y el 403 con un `Host` ajeno.
- **Mutación (aplica, manual)**: `writeDefaults`, `reorderOnEdit`, `persistAutoLayout`, `skipRenameReferences`, `ifMatchStar`, `resendOnLoss`, `saveInvalid`, `skipLiteralCredentialCheck`, `forwardIssues`, `genericFlowPassthrough`, `unvalidatedFlowId`, `loadFlowUrls`, `storeDraftInBrowser`, `allowSelfDrop`, `clearOnEmptyDrop` y `multipleChoiceOutputs`. Cada mutante debe hacer fallar al menos un test.
- **Cobertura de la spec (aplica)**: extender `tests/spec-coverage.test.ts` para que cada escenario de `web-editor` tenga un test con su título exacto, igual que con `web-chat`.

## Métricas de éxito

Franca es una herramienta local sin analítica, así que el éxito se comprueba con los E2E y con una prueba a mano:

- Una persona crea desde `/flujos` un flujo de tres pasos (mensaje, pregunta y fin), lo publica y lo prueba en el chat sin `curl` ni JSON a mano.
- Importa `captacion-leads-local` en la demo, cambia un texto, lo publica y lo prueba hasta `lead-empresa`.
- Abrir y cerrar cualquier flujo nunca crea revisiones.
- Ninguna petición de la web va a la API fuera de las catorce operaciones.

## Riesgos

- **`<Activity>` conserva el DOM y el estado de las rutas visitadas** ([[gotcha-cache-components-activity-y-prerender]]). Al volver al editor, Next podría enseñar el estado viejo, con cambios sin guardar ya descartados, en vez de releer. «Abrir un flujo» y «Salir con cambios sin guardar» lo exigen, y el diseño tiene que resolverlo como `use-paged-list.ts` (releer al mostrarse y volver a `loading` en el *cleanup*).
- **ajv en el navegador**: suma su peso al bundle de `/flujos/<id>` y compila el esquema con `new Function`. Hoy la CSP de la web solo tiene `frame-ancestors 'none'` (`server/frontier.ts`), así que funciona. Si alguien añade `script-src` sin `'unsafe-eval'`, la validación en vivo se rompe en silencio. Habría que precompilarlo (ajv *standalone*) o cubrirlo con un test.
- **Flujos grandes**: validar en cada pulsación un flujo cercano a 1 MiB, o pintar miles de nodos, puede trabar la interfaz. `validateFlow` es lineal y acotado, pero no gratis. El diseño decide entre agrupar las pulsaciones (*debounce*) y un Web Worker, y si el lienzo pinta solo lo visible. Medirlo en el runner, no en el portátil (`lecciones-equipo`).
- **Revisiones y versiones de más**: cualquier normalización del JSON (reordenar, rellenar valores por defecto, decimales en las posiciones) crea revisiones y, al publicar, versiones sin cambios de comportamiento. Lo cubren el golden y los mutantes `reorderOnEdit`, `writeDefaults` y `persistAutoLayout`. Mover nodos y publicar **sí** crea una versión nueva, a propósito (pregunta 5).
- **La frontera crece de 8 a 14 operaciones, y las nuevas escriben flujos.** Un CSRF que pasara podría publicar un flujo con nodos `http` hacia cualquier URL. Lo contienen `Origin`, `Host`, la ausencia de marcos y, aguas abajo, que un secreto solo viaja a su origen autorizado ([[decision-salida-http-politica]]). El JSON pegado de una fuente ajena tiene el mismo límite: puede llamar a terceros, pero sin los secretos de otro origen.
- **Pérdida de trabajo**: sin autoguardado ni almacenamiento local, cerrar la pestaña tras confirmar pierde los cambios. El usuario lo acepta al confirmar. Mitigan «Ver JSON» y la confirmación de salida.
- **Accesibilidad de un lienzo**: arrastrar nodos y conexiones no es accesible por sí mismo. Por eso todo lo que hace el lienzo se puede hacer desde el inspector y el panel del flujo con teclado, y los nodos se mueven también con las flechas. El escenario «El arrastre y el inspector dan el mismo flujo» vigila que las dos vías no diverjan.
- **Arrastre en los E2E**: los gestos de puntero en Playwright son más frágiles que los clics. La resolución del soltar (qué campo, qué destino, autosalto, vacío) va a unit como función pura, y en E2E cada salida se arrastra al menos una vez.
- **Coste de los E2E en la CI**: muchos escenarios nuevos de navegador. Lo combinatorio va a unit (campos, renombrado, diseño automático) y en E2E cada opción solo una vez.

## Preguntas abiertas

Marcadas como **[producto]** (decide el usuario) o **[técnica]** (decide el arquitecto). **Las de producto (1 a 10) las resolvió el usuario el 2026-10-18**: aceptó todas las recomendaciones salvo la 3, y los deltas aplican lo decidido. Las técnicas siguen abiertas para el arquitecto.

1. **[producto] ¿Se puede guardar un borrador inválido?** La API no lo admite (`invalid_flow`), y casi todo paso intermedio es inválido: un nodo nuevo sin conectar es inalcanzable, y eso es un error semántico. **Recomendación**: no en v0. Los cambios viven en la pestaña, «Guardar» explica por qué no se puede y salir pide confirmación. Si en la práctica se pierde trabajo, el siguiente paso sería «borrador de trabajo» en la API: una columna sin validar y aparte del borrador validado, que es un cambio de contrato de `flows-api` con su propia spec. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
2. **[producto] ¿Autoguardado?** **Recomendación**: no. Fallaría con cada estado intermedio inválido y sube la revisión en cada guardado. «Guardar» es explícito. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
3. **[producto] ¿Conexiones arrastrando en el lienzo?** Recomendación original: no en v0. **Resuelta (usuario, 2026-10-18): sí**, arrastrando y también en el inspector, que sigue siendo la vía del teclado. Ver «Salidas de cada tipo de nodo», «Crear conexiones arrastrando» y «Destinos no permitidos al arrastrar».
4. **[producto] ¿Probar el borrador sin publicarlo?** **Recomendación**: no en v0. «Probar» usa la última versión publicada en el chat. Una vista previa del borrador exige el motor en el navegador y un host simulado que decida qué responden `http` y `llm`, y eso es una feature aparte. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
5. **[producto] Mover nodos cambia el flujo**: sube la revisión al guardar y, al publicar, crea una versión nueva idéntica en comportamiento. **Recomendación**: aceptarlo, porque las posiciones son parte del formato. Separarlas exigiría guardarlas aparte en la API (endpoints y tabla nuevos) o cambiar «Publicar sin cambios» para ignorarlas, y las dos cosas son cambios de contrato. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
6. **[producto] Conflicto 412: ¿se ofrece «Guardar encima»?** **Recomendación**: sí, junto a «Cargar el guardado», con la `currentRevision` recibida y nunca con `*`. Sin «Guardar encima», la única salida sería copiar el JSON a mano. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
7. **[producto] Deshacer**: **Recomendación**: solo «Descartar cambios» y el deshacer de cada campo. Un historial de deshacer queda fuera. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
8. **[producto] Borrar un nodo**: ¿se dejan rotos sus saltos o se quitan? **Recomendación**: dejarlos rotos, dibujados y señalados. Quitarlos cambiaría otros nodos sin que se vea. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
9. **[producto] «Probar» con cambios sin guardar**: **Recomendación**: no disponible. Salir a la conversación perdería los cambios, y lo que se prueba es la versión publicada. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
10. **[producto] Crear desde JSON pegado**: **Recomendación**: sí. Es la forma de traer los ejemplos y la demo sin `curl`, y cuesta un campo de texto más el mismo validador. **Resuelta (usuario, 2026-10-18): aceptada la recomendación.**
11. **[técnica] Dónde viven las posiciones**: resuelta con la evidencia. Van en `nodes[].position`, que ya existe en el esquema. Alternativas descartadas: un campo nuevo en el esquema (no hace falta), guardarlas aparte en la API (cambia la API) y solo diseño automático (los nodos saltarían).
12. **[técnica] Validación local frente a `POST /flows/validate`**: local, con `validateFlow`. El arquitecto decide si agrupa pulsaciones y si usa un Web Worker. Requisito: menos de un segundo desde el último cambio para flujos como los ejemplos, y que la interfaz no se trabe.
13. **[técnica] ajv y la CSP**: decidir si se precompila el validador (ajv *standalone*) o se fija con un test que la CSP no prohíbe `new Function` mientras no se precompile.
14. **[técnica] `issues` de la API en los errores**: **recomendación**: no reenviarlos, porque el veredicto local es el mismo código. Si se reenviaran, haría falta sanearlos con su forma (`layer`, `path`, `nodeId`, `message`) y otro mutante.
15. **[técnica] Rutas de la web**: el listado del editor no puede ser el `GET /api/flows` de hoy, que fija `published=true` («Flujos publicados» de `web-chat`). Hace falta una ruta propia sin `published`. El arquitecto decide los nombres en `src/app/api/**`.
16. **[técnica] Lienzo**: SVG o DOM propios frente a una dependencia (por ejemplo, de la familia React Flow). Si es una dependencia, el arquitecto la justifica por tamaño, licencia compatible con MIT, accesibilidad por teclado y que no haga peticiones de red. También elige el algoritmo del diseño automático (por capas según la distancia desde `start`, por ejemplo).
17. **[técnica] Activity y la relectura**: cómo garantiza el editor que al mostrarse vuelve a leer y descarta el estado oculto (ver Riesgos).
