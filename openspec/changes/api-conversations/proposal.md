# Proposal: API de conversaciones (`api-conversations`)

**Fecha**: 2026-10-17 · **Estado**: Draft · **Rama**: `feat/api-conversations` · **Feature 6 de 8** del plan (1-5 hechas: motor, `input`, `http`, `llm` con el adaptador de Claude y API de flujos; después vienen 7, el chat web de prueba, y 8, el editor visual).

## Why

Hoy Franca sabe guardar y publicar flujos (`flows-api`) y ejecutarlos en memoria (`@franca/engine`), pero nadie puede **conversar** con un flujo publicado: el motor es puro y deja al host la custodia del estado, la concurrencia, la caducidad, los valores de contacto y las credenciales. Sin esta feature, el chat de prueba (7) no tiene backend, y los requisitos «Host de producción: custodia del estado» y «… una continuación por estado» de `flow-engine` no los cumple ningún host real. Esta feature es ese host: una API que crea conversaciones fijadas a una versión publicada, las continúa con lo que escribe el usuario, guarda su transcripción y su estado en Postgres, conecta los nodos `llm` con Claude y pone límites de tiempo y de coste.

## What Changes

- **Conversaciones en Postgres**: cada conversación es una sesión del motor fijada a `(flowId, version)`. La API guarda su estado (que nunca sale al cliente ni se acepta de él), su transcripción y su coste.
- **Contrato HTTP** (todas con las reglas comunes de `flows-api`: `Host` local, sin `Origin`, `{message, error}`, 413/415/`invalid_json`, 503):

  | Método y ruta | Qué hace | Éxito | Errores propios |
  |---|---|---|---|
  | `POST /conversations` | Crea una conversación `{flowId, version?, contactId?}` sobre la última versión publicada (o la indicada) y ejecuta el motor hasta la primera parada | 201 `{conversation, events}` + `Location` + `ETag` | 400 `invalid_request`, 404 `flow_not_found` / `version_not_found` / `conversation_not_found` (su contacto se borró durante la creación), 409 `flow_not_published` / `flow_version_invalid` |
  | `GET /conversations` | Lista paginada, con filtros `flowId` y `status` | 200 `{items, total, limit, offset}` | 400 `invalid_query` |
  | `GET /conversations/:id` | El recurso conversación | 200 + `ETag` | 404 `conversation_not_found` |
  | `POST /conversations/:id/inputs` | Envía `{input}` (la entrada del usuario) y continúa la conversación; `If-Match` opcional | 200 `{conversation, events}` + `ETag` | 400 `invalid_request` / `invalid_input`, 404, 409 `conversation_busy` / `conversation_not_active` / `conversation_expired` / `flow_version_invalid`, 412 `revision_mismatch` |
  | `GET /conversations/:id/transcript` | Entradas del usuario y eventos del motor, en orden | 200 `{items, total, limit, offset}` | 404 |
  | `DELETE /conversations/:id` | Borra la conversación, su estado y su transcripción, de forma definitiva | 204 | 404 |
  | `DELETE /contacts/:contactId` | Borra los valores guardados de un contacto y todas sus conversaciones | 204 | 400 `invalid_request` |

- **Recurso conversación**: `{id, flowId, version, contactId, status, revision, processing, pendingInput, outcome, error, costUsd, costLimitReached, createdAt, updatedAt, expiresAt}`, con `status` `waiting` | `ended` | `failed` | `expired`. `pendingInput` es el último evento `input` (lo que el chat debe pintar para responder).
- **Una entrada a la vez**: la API reclama la conversación antes de ejecutar el motor. Una segunda entrada mientras tanto recibe 409 `conversation_busy` sin ejecutar nada. La reclamación caduca a los 300 s, y un resultado que llega después se descarta.
- **Caducidad** por `settings.sessionTimeoutMinutes` de la versión (1440 por defecto, como mucho un año) desde el último avance aplicado: la conversación pasa a `expired` y rechaza entradas.
- **Valores de contacto**: un `contactId` opaco que elige el cliente. Las variables `scope: contact` se comparten entre todas las conversaciones y flujos de ese contacto: al crear, se inyectan los valores guardados, y tras cada avance se guardan solo los que ese avance cambió.
- **Nodos `llm` con Claude**: proveedor `principal` con `@franca/llm-anthropic` si existe `FRANCA_ANTHROPIC_API_KEY`, con clave y `baseURL` explícitas. Sin clave, la API arranca y los nodos `llm` fallan con `llm_not_configured`, que queda registrado como aviso.
- **Límites por conversación y por avance**: un presupuesto de coste `llm` por conversación (`FRANCA_CONVERSATION_COST_LIMIT_USD`, 0,50 USD por defecto), 90 s por avance para pedir turnos, y cuerpos de 64 KiB como máximo en las dos rutas que reciben datos.
- **Nodos `http` deshabilitados**: el motor recibe un host sin la capacidad `http`, así que un nodo `http` hace fallar la conversación con `unsupported_node`. El host `http` de producción (anti-SSRF, secretos) pasa a una feature propia (ver Preguntas abiertas).
- **Datos personales**: transcripción, estado y valores de contacto son datos personales. Nunca salen en registros, se borran con los dos `DELETE` y el estado del motor se descarta al terminar o fallar.
- **`flows-api` cambia en dos requisitos** (deltas `MODIFIED`): «Forma de los errores» documenta los campos de los códigos nuevos, y «Privacidad de los registros» admite los metadatos de un avance.

### Decisiones (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| Recurso `/conversations` (no `/sessions`), con `id` UUID v4 que genera la API | «Conversación» es el término de producto; «sesión» queda para el motor. Un UUID aleatorio no se puede adivinar ni enumerar, lo que importa cuando haya exposición más allá de loopback |
| Por defecto, la última versión publicada; nunca el borrador | Es lo que pide el plan. Probar borradores es la vista previa del editor (8), en el navegador y con un host simulado |
| Crear y enviar devuelven `{conversation, events}` del avance; la transcripción se lee aparte | El chat pinta los eventos nuevos sin releer todo, y al recargar recupera la conversación con `GET` y la transcripción |
| El estado del motor nunca sale de la API ni se acepta del cliente; el cuerpo de una entrada solo lee `input` | Es el MUST «Host de producción: custodia del estado»: si el cliente aportara el estado, podría reiniciar `maxTurns`, `costCapUsd` y el presupuesto |
| Propiedades desconocidas del cuerpo **ignoradas** (en creación y en entradas) | Mismo criterio que los parámetros desconocidos de `flows-api`. Además, el caso `custodia-estado` de la conformidad envía un estado propio que el host debe ignorar, no rechazar |
| Concurrencia: **409 `conversation_busy` inmediato**, sin cola de espera | Una cola tendría que decidir qué mensaje va primero y escondería los dobles envíos. El chat ya bloquea el envío mientras espera el turno, y `processing` le dice que hay uno en curso tras recargar |
| `If-Match` **opcional** con la `revision` (412 `revision_mismatch`) | Detecta una entrada repetida tras un corte de red sin obligar a todos los clientes. Es la misma semántica que publicar y borrar en `flows-api`. La conformidad continúa sin revisión |
| Reclamación de 300 s y 90 s por avance para pedir turnos `llm` | El peor avance (un turno de hasta 60 s del adaptador empezado en el segundo 89) dura unos 150 s. Con 300 s, ninguna reclamación caduca mientras su avance sigue vivo, y una API reiniciada a mitad de un avance desbloquea la conversación en 5 minutos |
| Pasados los 90 s, un turno se resuelve como `failed` sin llamar al proveedor (y el nodo sale por `onExhausted`) | Es lo que el contrato del motor ya define para «no se obtuvo un turno utilizable», y deja que el flujo siga por la salida que el autor previó (en `faq-ia`, escalar a una persona) |
| `sessionTimeoutMinutes` cuenta desde el **último avance aplicado** (también un reintento por respuesta inválida); con tope de 525600 | Es un plazo de inactividad. Los 400/409/412 no cuentan porque no cambian nada. El esquema no tiene máximo, y `1e300` es un entero válido que desbordaría las fechas |
| Caducada = `status` `expired`, 409 `conversation_expired`; se puede leer y borrar | El chat distingue «caducó» de «terminó» para ofrecer empezar de nuevo. Reabrirla es un non-goal |
| Flujo borrado: sus conversaciones siguen hasta terminar o caducar, pero no se crean nuevas | Es lo que `flows-api` previó al conservar las versiones «para que la feature 6 pueda terminar las sesiones fijadas» (FOLLOW-UP 7.3 de `api-flows`) |
| `contactId` opaco con el patrón `^[A-Za-z0-9_-]{1,64}$` (sin `@`, puntos ni espacios), opcional | Aparece en rutas y registros, así que no debe ser un email ni un nombre. Sin `contactId`, la conversación es anónima y no deja valores de contacto |
| Valores de contacto **compartidos entre todos los flujos** de la instalación, por nombre de variable | `scope: contact` describe a la persona, no al flujo. Los dos ejemplos declaran `email` como contacto, y la intención es que `faq-ia` conozca el email que ya dio en `captacion-leads`. El motor no impone tipos y aquí tampoco se imponen |
| Se guarda **solo lo que el avance cambió**; «sin valor» borra el guardado; un `default` no se guarda | Dos conversaciones del mismo contacto no se pisan valores que no tocaron. Un `default` es un valor de reserva del flujo, no un dato de la persona |
| Una conversación ve los valores de contacto tal como estaban al crearse | Es lo que da el motor: el estado lleva su propia vista de contacto. Releerlos en cada avance cambiaría el contrato del motor |
| El cliente **no** puede inyectar valores de contacto en v0 | Los únicos valores que llegan al motor son los que él mismo produjo, ya acotados (16384 unidades por texto, 1000 niveles). Así queda resuelto el límite de los valores que inyecta el host (FOLLOW-UP 6.4 de `engine-base` y 6.7 de `engine-input`) sin inventar otro. Inyectar valores es aditivo y se puede hacer después |
| Transcripción = entrada del usuario tal como llegó, más los eventos del motor tal cual | El chat la reconstruye sin reinterpretar nada. Guarda también las respuestas que el motor dio por inválidas, porque el usuario las vio y el bot le contestó (ver Preguntas abiertas). Los rechazos 400/409/412 no dejan rastro |
| Proveedor `principal` con `FRANCA_ANTHROPIC_API_KEY`, `apiKey` y `baseURL` explícitas; ni `ANTHROPIC_API_KEY` ni `ANTHROPIC_BASE_URL` sirven | Muchas shells de desarrollo ya tienen `ANTHROPIC_API_KEY` (de otras herramientas). Usarla en silencio gastaría dinero de otra cuenta al arrancar `pnpm dev`, y `ANTHROPIC_BASE_URL` podría desviar las conversaciones a otro servidor. Lo pide el FOLLOW-UP 8.3 de `engine-llm` |
| Sin clave: no se registra ningún proveedor, así que da `llm_not_configured` (falla la sesión), no `failed` | Es un hueco de configuración, no un fallo de un turno. Seguir por `onExhausted` escondería a quien prueba el flujo que falta la clave. El aviso en el registro es la alerta de operación que pide el FOLLOW-UP 8.3 |
| Presupuesto de coste por conversación (0,50 USD por defecto) como tope de parada; al alcanzarlo, `failed` sin llamar (salida por `onExhausted`) y `costLimitReached` | `costCapUsd` es por conversación de nodo, y un ciclo `llm` → `set` → `llm` lo reinicia (FOLLOW-UP 8.3 de `engine-llm`; ficha `decision-llm-coste-y-reintentos-en-el-adaptador`). Salir por `onExhausted` es la vía prevista para «no se pudo», y `costLimitReached` le dice a quien prueba el porqué |
| **`http` deshabilitado** (`unsupported_node`), en vez del host real o de un host que lo bloquee todo | El host real es un componente de seguridad grande con su propia suite (17 casos y 16 mutantes, FOLLOW-UP 6.1 de `engine-http`) y merece su propia feature y revisión. Un host que respondiera `blocked` llevaría el flujo por `onError` y, en `faq-ia`, diría al usuario que se creó un ticket que nunca se envió. Fallar con `unsupported_node` es honesto, y es lo que el motor ya hace con un hueco de capacidad |
| 64 KiB por cuerpo en `POST /conversations` y en las entradas | Una respuesta válida ocupa como mucho ~25 KB (4096 unidades con escapes). Con 1 MiB, cada entrada podría guardar un mega en la transcripción, y el lector de entradas del motor es lineal en el número de claves (FOLLOW-UP 6.9 de `engine-input`) |
| Estado del motor fuera de la base de datos cuando la conversación termina o falla | Minimización: ya no se puede continuar, y el estado lleva variables `pii`. Quedan el recurso y la transcripción, que es lo que el chat enseña |
| Borrado **definitivo** de conversaciones y de contactos; el borrado gana a un avance en curso | Es el borrado mínimo de datos personales que pide el alcance. Si un avance en curso pudiera volver a escribir lo borrado, la supresión no sería fiable |
| Sin caducidad automática de transcripciones en v0 | Solo hay una instalación local de un único usuario, y los dos `DELETE` cubren la supresión. Una purga programada es un mecanismo más (FOLLOW-UP), que debe llegar antes de exponer la API fuera de loopback |
| Estado guardado como texto de un único `JSON.stringify` (como los flujos), y `flow_id` con `COLLATE "C"` a mano en la migración | El estado puede tener claves `__proto__` y valores de 997 niveles (fichas `gotcha-jsonb-reordena-claves` y `gotcha-prisma-no-modela-colacion`; FOLLOW-UP 6.2 de `engine-http` y 7.3 de `api-flows`). Es una restricción para el diseño, y la cubre el requisito «Estado con anidamiento máximo» |

### Qué ve cada consumidor

- **Feature 7 (chat de prueba)**:
  - Crea una conversación con `POST /conversations` y pinta `events` respetando `typingDelayMs`.
  - Usa `pendingInput` para saber qué pedir (texto, selección única o múltiple) y envía `{input}` con `If-Match`.
  - Al recargar, lee la conversación y su transcripción. Para «reiniciar», borra la conversación y crea otra.
  - No pinta al usuario final el evento `http` ni el `message` de los `error` (FOLLOW-UP 6.6 de `engine-base` y 6.3 de `engine-http`).
  - Decide cómo llega el navegador a la API (proxy desde el servidor de Next o lista de orígenes; FOLLOW-UP 7.4 de `api-flows`).
- **Feature 8 (editor)**: no usa esta API para la vista previa (motor en el navegador con un host simulado). Puede listar las conversaciones de un flujo.
- **Host `http` de producción (feature nueva)**: sustituye «Nodos http deshabilitados» por la capacidad real, sin cambiar el resto del contrato.

### Formato de flujo

- **`packages/spec/flow.schema.json` no cambia**, `validateFlow` no cambia y no hay que regenerar tipos. Ningún flujo existente se rompe.
- Esta feature da semántica a dos campos que el esquema ya tenía y el RFC-0001 (aún sin texto) no describe:
  - `settings.sessionTimeoutMinutes`: plazo de inactividad desde el último avance aplicado, como mucho un año.
  - `scope: contact`: valores compartidos por contacto entre todos los flujos de la instalación.
- Se anotan en `docs/rfcs/` como FOLLOW-UP, junto con los demás de RFC-0001.
- **Ejemplos**: `captacion-leads` y `faq-ia` se ejecutan hasta su nodo `http` (`enviar-crm`, `crear-ticket`), donde fallan con `unsupported_node` hasta que exista el host `http`.

## Capabilities

### New Capabilities
- `conversations-api`: crear, continuar, leer, listar y borrar conversaciones sobre versiones publicadas. Cubre la custodia del estado, una entrada a la vez con reclamación caducable, la caducidad por inactividad, los valores de contacto entre conversaciones y su borrado, la transcripción, el proveedor de Claude y su configuración, el presupuesto de coste, el tiempo máximo por avance, los nodos `http` deshabilitados, los límites del cuerpo, la base de datos no disponible, la privacidad de los registros y la conformidad del host.

### Modified Capabilities
- `flows-api`:
  - «Forma de los errores» suma los campos documentados de los códigos nuevos: `issues` en `flow_version_invalid` y `currentRevision` en el `revision_mismatch` de una conversación.
  - «Privacidad de los registros» deja registrar, de un avance, los metadatos que fija `conversations-api` (antes solo método, ruta, código y duración).
- `flow-engine` y `llm-anthropic` no cambian: la API usa su contrato tal cual.

## Impact

- **`apps/api`**:
  - Módulo nuevo de conversaciones y contactos (controlador, servicio, acceso a datos), con su router propio, que convive con el de flujos sin retocarlo.
  - Reutiliza la frontera HTTP común (`localOnly`, cuerpo JSON, filtro de errores).
  - Lector interno de versiones por `(flowId, version)` que incluye flujos borrados.
  - Migración nueva de Prisma (conversaciones, transcripción, valores de contacto) con `COLLATE "C"` a mano en `flow_id`.
  - Códigos nuevos en `API_ERROR_CODES`: `invalid_request`, `invalid_input`, `conversation_not_found`, `flow_not_published`, `flow_version_invalid`, `conversation_busy`, `conversation_not_active` y `conversation_expired`.
  - Variables nuevas `FRANCA_ANTHROPIC_API_KEY` y `FRANCA_CONVERSATION_COST_LIMIT_USD` en la configuración de arranque.
  - Dependencias de espacio de trabajo `@franca/engine` y `@franca/llm-anthropic`.
- **Configuración y documentación**:
  - `turbo.json`: las variables nuevas en `passThroughEnv` ([[gotcha-turbo-filtra-variables-de-entorno]]).
  - `CLAUDE.md`: los nombres de las variables nuevas.
  - El fichero de ejemplo de variables lo crea una persona ([[harness-guard-env-falsos-positivos]]).
- **Tests**: e2e contra Postgres real con un proveedor `llm` simulado y un reloj inyectado, y un arnés de `HostConformanceHarness` que implementa las sesiones y el `llm` (los métodos de `http` no se implementan en esta feature).
- **Meta**: fichas de wiki para las decisiones no derivables (contacto compartido entre flujos y escritura solo de cambios; `http` deshabilitado hasta su feature), con su enforcement.
- **Sin cambios** en `packages/spec`, `packages/engine/src`, `packages/llm-anthropic/src` ni `apps/web`.

## Non-goals / Out of scope

- **Host `http` de producción** (anti-SSRF, resolución fijada, secretos por origen, límites de respuesta y su suite de conformidad): feature propia. Hasta entonces, `unsupported_node`.
- **Autenticación, usuarios, tenants y propietarios**, exposición fuera de loopback y acceso desde navegadores (CORS o proxy): v0 sigue siendo solo local, y la 7 decide cómo entra el navegador.
- **Gestionar contactos**: leer, editar o inyectar valores de contacto desde el cliente, listar contactos o filtrar conversaciones por `contactId`. Todo es aditivo.
- **Ver las variables de una conversación** (panel de depuración): aditivo, si lo pide la 7 o la 8.
- **Cerrar una conversación sin borrarla, reabrir una caducada o migrarla a otra versión**.
- **Caducidad y purga automáticas** de transcripciones, conversaciones y contactos, y **cifrado en reposo** de datos personales: FOLLOW-UP, antes de cualquier exposición fuera de loopback.
- **Presupuestos globales** (por instalación, día o tenant), limitación de peticiones y conciliar el coste contabilizado con la facturación de Anthropic.
- **Configurar el adaptador** (tabla de modelos y precios, `effort`, `maxOutputTokens`, varios proveedores o nombres distintos de `principal`) y comprobar las credenciales con una llamada al arrancar: se usan los valores por defecto de `@franca/llm-anthropic`, y una clave rechazada se ve en el aviso de `llm_not_configured`.
- **Ejecutar borradores**: es la vista previa del editor (8).
- **Eventos en tiempo real** (SSE o WebSocket) y aplicar `typingDelayMs` en el servidor: la respuesta trae los eventos del avance y el cliente los temporiza.
- **Claves de idempotencia** en las entradas: `If-Match` cubre la entrada repetida.
- **Aislar la CPU de un avance** (worker o tiempo de CPU): los límites del motor (200 pasos, regex lineal, flujos de 1 MiB, textos de 16384 unidades) acotan el peor caso a segundos con un flujo hostil, y en v0 los flujos los publica el propio usuario local. Pasa a FOLLOW-UP para antes de los flujos de terceros.

## FOLLOW-UP pendientes etiquetados para la feature 6

| FOLLOW-UP | Veredicto | Dónde o por qué |
|---|---|---|
| `engine-base` 6.5: versión del flujo junto al estado y bloqueo para dos `continueSession` concurrentes | **Dentro** | «Conversación fijada a una versión», «Una entrada a la vez», «Reclamación caducada», «Revisión esperada al enviar una entrada» |
| `engine-base` 6.5: tope de CPU por avance en el host | **Fuera** | Non-goals: lo acotan los límites del motor; FOLLOW-UP para cuando haya flujos de terceros |
| `engine-input` 6.7: persistir el estado `waiting` y fijar la versión por sesión | **Dentro** | «Conversación fijada a una versión», «El estado del motor no sale de la API» |
| `engine-input` 6.7: `invalid_input` a un 4xx | **Dentro** | «Entrada rechazada» (400 `invalid_input`) |
| `engine-input` 6.7 y `engine-base` 6.4 (parte 6): limitar los valores de contacto que inyecta el host | **Dentro, resuelto por diseño** | «Valores de contacto al crear»: solo se inyectan valores que produjo el motor, ya acotados, y el cliente no puede inyectar |
| `engine-input` 6.7: concurrencia de dos continuaciones | **Dentro** | «Una entrada a la vez» |
| `engine-input` 6.9: limitar el cuerpo HTTP que llega al host (`readUserInput` es lineal en claves) | **Dentro** | «Tamaño máximo del cuerpo de una conversación» (64 KiB) |
| `engine-http` 6.1: host HTTP real con anti-SSRF, `HostConformanceHarness` y `HOST_CONFORMANCE_CASES` de `http` con sus mutantes | **Fuera** | Feature propia del host `http` (Preguntas abiertas, 1). Aquí: «Nodos http deshabilitados» |
| `engine-http` 6.2: tope de tiempo total por avance | **Dentro** | «Tiempo máximo de un avance» |
| `engine-http` 6.2: tope de CPU | **Fuera** | Como `engine-base` 6.5 |
| `engine-http` 6.2: persistir o no el evento `http` | **Dentro** | «Contenido de la transcripción»: todos los eventos, `http` incluido, tal cual (no llevan URL ni cuerpos) |
| `engine-http` 6.2: guardar el flujo como texto, no `jsonb` | **Dentro, ya resuelto** | Las versiones ya son texto (`api-flows`), y el estado se guarda igual (Decisiones) |
| `engine-http` 6.2: el almacén admite 1001 niveles | **Dentro** | «Estado con anidamiento máximo» |
| `engine-http` 6.9: NAT64, v4 mapeada de metadatos e IPv4-compatible en la conformidad | **Fuera** | Va con el host `http` de producción |
| `engine-llm` 8.3: custodiar el estado y reclamarlo antes del motor, con caducidad | **Dentro** | «El estado del motor no sale de la API», «Una entrada a la vez», «Reclamación caducada» |
| `engine-llm` 8.3: presupuesto de coste por sesión | **Dentro** | «Presupuesto de coste por conversación» y su configuración |
| `engine-llm` 8.3: presupuesto por tenant | **Fuera** | No hay tenants |
| `engine-llm` 8.3: proveedor con `createAnthropicClient`, `apiKey` y `baseURL` explícitas | **Dentro** | «Proveedor de Claude», «Sin credenciales de Claude» |
| `engine-llm` 8.3: modelos permitidos, precios, `effort` y `maxOutputTokens` por instalación | **Fuera** | Valores por defecto del adaptador; configurarlos es aditivo |
| `engine-llm` 8.3: comprobar las credenciales al arrancar | **Fuera** | Haría depender el arranque de la red, y ningún test puede llamar a Anthropic. En su lugar, la línea de arranque dice si hay proveedor, y el aviso de `llm_not_configured` delata una clave rechazada |
| `engine-llm` 8.3: conciliar el coste con la facturación real | **Fuera** | Es operación: no hay API de facturación en el alcance |
| `engine-llm` 8.3: estado con `conversation` como dato personal, retención y borrado | **Dentro** (borrado) / **Fuera** (retención automática) | «Datos personales de una conversación», «Borrar una conversación», «Borrar un contacto». La purga automática es FOLLOW-UP |
| `engine-llm` 8.3: casos `registros-llm`, `custodia-estado`, `una-continuacion` y `reclamacion-caducada` con host real y mutantes | **Dentro** | «Conformidad del host de conversaciones» y Plan de verificación |
| `engine-llm` 8.3: tope de tiempo total por avance | **Dentro** | «Tiempo máximo de un avance» |
| `engine-llm` 8.3: alerta de operación para `llm_not_configured` | **Dentro** | «Aviso de proveedor no configurado» |
| `engine-llm` 9.2: `unknownModelPrices` y recargos de residencia (`inference_geo`) en la tabla de precios | **Fuera** | Es del adaptador (`llm-anthropic`); la API usa su tabla por defecto. Pasa a un FOLLOW-UP de `llm-anthropic` |
| `engine-llm` 9.2: `invokeCapability<Req>` común a `llm` y `http` | **Fuera** | Refactor interno del motor sin cambio de conducta. Encaja con la feature del host `http` |
| `api-flows` 7.3: lector interno de versiones que incluya flujos borrados | **Dentro** | «Conversaciones de un flujo borrado» |
| `api-flows` 7.3: qué pasa con las sesiones en espera de un flujo borrado | **Dentro** | Siguen hasta terminar o caducar, y no se crean nuevas |
| `api-flows` 7.3: `COLLATE "C"` en el `flow_id` de la tabla de sesiones | **Dentro** | Restricción de diseño (Decisiones e Impact) |

## Plan de verificación por capas

- **Unit (aplica)**:
  - Configuración de arranque: `FRANCA_CONVERSATION_COST_LIMIT_USD` admitida y rechazada, y `FRANCA_ANTHROPIC_API_KEY` ausente, vacía o definida, con el cliente con `apiKey` y `baseURL` explícitas.
  - Patrones de `contactId` y de `id` de conversación.
  - Cálculo de `expiresAt` con el tope de 525600.
  - Diferencia de valores de contacto (cambio, «sin valor», `default`, `__proto__`).
  - Envoltura de la capacidad `llm`: presupuesto, plazo de 90 s y suma de coste.
  - Todo test negativo se valida haciendo fallar su fixture a propósito.
- **Golden/contractual (aplica, ligero)**: forma exacta (`toEqual` con todas las claves) del recurso conversación, de `{conversation, events}`, de las entradas de la transcripción y de cada error nuevo. Sin baselines protegidos.
- **Integración HTTP (aplica, el grueso)**: e2e con supertest contra Postgres real, un proveedor `llm` simulado y un reloj inyectado, por endpoint:
  - Happy path, 400 `invalid_request` / `invalid_input` / `invalid_query`, 404, 409 (cada código), 412, 413 (64 KiB), 415 y 503.
  - En lugar de autenticación, `forbidden_host`, `forbidden_origin` y ausencia de CORS.
  - Concurrencia (dos entradas a la vez, reclamación caducada, resultado tardío y borrado durante un avance), caducidad, contacto entre flujos y supresión, y presupuesto.
  - Privacidad de los registros con marcadores y estado que no sale.
- **Conformidad (aplica)**: `registros-llm`, `custodia-estado`, `una-continuacion` y `reclamacion-caducada` de `HOST_CONFORMANCE_CASES`, más un mutante del host por caso que lo haga fallar: aceptar el estado del cliente, no reclamar, reclamación que no caduca y registrar el contenido `llm`.
- **E2E opción-al-menos-una-vez (no aplica)**: no hay UI. La 7 recorre cada `inputType` contra esta API.
- **Smoke de ruta (no aplica)**: no hay páginas.
- **Paridad (no aplica todavía)**: la web aún no espeja `API_ERROR_CODES`. El test de paridad llega con la 7 (FOLLOW-UP 7.4 de `api-flows`).
- **Mutación con arnés (no aplica)**: `apps/api` no tiene arnés de mutación. Los mutantes del host de la conformidad cubren las costuras críticas (custodia, reclamación, registros).

## Riesgos

- **Sin autenticación**: cualquier proceso de la máquina puede leer transcripciones (datos personales) y gastar el presupuesto `llm`. Se mitiga con loopback, `Host` y `Origin`, el presupuesto por conversación y los UUID aleatorios. Ningún despliegue sin una feature de autenticación.
- **Gasto real con Claude**: el presupuesto es por conversación y no global, así que muchas conversaciones suman. Lo facturado puede superar lo contabilizado (ficha `decision-llm-coste-y-reintentos-en-el-adaptador`). Es opt-in con `FRANCA_ANTHROPIC_API_KEY`.
- **Avances largos**: una petición puede tardar hasta unos 150 s con turnos lentos. Aceptable en local, y el chat muestra «escribiendo».
- **Reclamación huérfana** tras reiniciar la API o caer la base de datos a mitad de un avance: la conversación queda bloqueada hasta 5 minutos (409 `conversation_busy`).
- **Valores de contacto compartidos entre flujos** con tipos distintos para el mismo nombre: el motor no impone tipos, y un flujo puede recibir un valor que otro escribió con otro sentido. Se documenta en una ficha de wiki.
- **Los ejemplos no llegan al final** mientras `http` siga deshabilitado.
- **Transcripciones sin caducidad**: crecen hasta que alguien las borra.

## Preguntas abiertas (con la recomendación ya aplicada en la spec)

1. **¿El host `http` de producción va como feature propia, y cuándo?** Recomendación aplicada: sí, fuera de la 6 (`unsupported_node` hasta entonces). Recomiendo insertarla como **6b, justo después de esta y antes del chat (7)**, para que el chat pruebe los dos ejemplos de punta a punta. Cambia el plan de 8 a 9 features: lo decide el usuario.
2. **¿Valores de contacto compartidos entre flujos o por flujo?** Aplicado: compartidos en toda la instalación, por nombre de variable, porque `scope: contact` describe a la persona. La alternativa (por flujo) es más aislada, pero haría que `faq-ia` volviera a pedir el email que ya dio en `captacion-leads`.
3. **¿La transcripción guarda las respuestas que el motor da por inválidas?** Aplicado: sí, tal como llegaron, porque el usuario las escribió y el bot le contestó. Se borran con la conversación. La alternativa (guardar solo las aceptadas) minimiza más, pero el chat mostraría al recargar un «no parece válido» sin la respuesta que lo provocó.
4. **¿Presupuesto por conversación de 0,50 USD por defecto?** Aplicado: sí, configurable. Con Opus 5.5 da para unas decenas de turnos, muy por encima del `costCapUsd` 0,05 de `faq-ia`.
5. **¿Purga automática de transcripciones y contactos antes de salir de loopback?** Recomendación: sí, como requisito de la feature de autenticación o exposición. En v0 basta con los dos `DELETE`.
