# conversations-api Specification

## Purpose
Conversar en la API de Franca con un flujo publicado: crear una conversación fijada a una versión, enviarle las entradas del usuario, leer su estado y su transcripción y borrarla, con el estado del motor custodiado en el servidor, una entrada a la vez, caducidad por inactividad, valores de contacto que pasan de una conversación a otra y un presupuesto de coste de los nodos `llm`.

Una conversación es una sesión de `@franca/engine` que custodia la API. Datos de los escenarios:

- `hola`, `captacion-leads` y `faq-ia` son los de `flows-api` (los dos últimos, de `packages/spec/examples/`).
- `pregunta` es `{"specVersion": "0.1", "id": "pregunta", "name": "Pregunta", "settings": {"sessionTimeoutMinutes": 30}, "variables": [{"name": "nombre", "type": "string"}, {"name": "email", "type": "email", "scope": "contact", "pii": true}], "start": "p", "nodes": [{"id": "p", "type": "input", "inputType": "text", "variable": "nombre", "prompt": [{"kind": "text", "text": "¿Nombre?"}], "next": "fin"}, {"id": "fin", "type": "end", "outcome": "ok", "content": [{"kind": "text", "text": "Adiós, {{email}}."}]}]}`.
- `saludo-contacto` es `{"specVersion": "0.1", "id": "saludo-contacto", "name": "Saludo", "variables": [{"name": "email", "type": "email", "scope": "contact", "pii": true}], "start": "fin", "nodes": [{"id": "fin", "type": "end", "content": [{"kind": "text", "text": "Hola, {{email}}."}]}]}`.
- `olvido` es `{"specVersion": "0.1", "id": "olvido", "name": "Olvido", "variables": [{"name": "email", "type": "email", "scope": "contact", "pii": true}], "start": "borrar", "nodes": [{"id": "borrar", "type": "set", "assignments": [{"variable": "email", "value": null}], "next": "fin"}, {"id": "fin", "type": "end"}]}`.
- `doble-llm` es `{"specVersion": "0.1", "id": "doble-llm", "name": "Doble llm", "start": "a", "nodes": [{"id": "a", "type": "llm", "provider": "principal", "goal": "Saluda.", "next": "b", "onExhausted": "fin"}, {"id": "b", "type": "llm", "provider": "principal", "goal": "Despídete.", "next": "fin", "onExhausted": "fin"}, {"id": "fin", "type": "end", "outcome": "fin"}]}`.

Todos son válidos y sin avisos (comprobado con `packages/spec/dist`). «Publicado» quiere decir creado con `POST /flows` y publicado con `POST /flows/:flowId/versions`. Las peticiones llevan `Host: 127.0.0.1:3001`, no llevan `Origin` y, si tienen cuerpo, `Content-Type: application/json`. Salvo que el escenario diga otra cosa, el proveedor `principal` es un proveedor simulado que el test inyecta en la API (ningún test llama a la API de Anthropic), el reloj de la API lo controla el test, el presupuesto por conversación es el de por defecto y `T` es el instante en que se crea la conversación.

## Requirements

### Requirement: Conversación fijada a una versión
Una conversación SHALL ejecutarse siempre con la versión publicada `(flowId, version)` con la que se creó, aunque después cambie el borrador, se publiquen otras versiones o se borre el flujo. Nunca usa el borrador. La API la arranca con `startSession` de `@franca/engine` y la continúa con `continueSession`.

#### Scenario: Publicar otra versión no cambia la conversación
- **GIVEN** `pregunta` publicado (versión 1) y una conversación creada con él, esperando en `p`
- **WHEN** se actualiza el borrador con el texto del `prompt` de `p` cambiado a `"¿Cómo te llamas?"`, se publica (versión 2) y se envía `{input: {text: "Ana"}}` a la conversación
- **THEN** la respuesta es 200 con `version` 1, `status` `ended` y `outcome` `"ok"`
- **AND** una conversación nueva de `pregunta` se crea con `version` 2 y su primer evento es un `message` con el texto `"¿Cómo te llamas?"`

### Requirement: Crear una conversación
`POST /conversations` SHALL crear una conversación, ejecutar el motor hasta su primera parada y responder 201 con el resultado del avance (ver «Resultado de un avance»), `Location: /conversations/<id>` y `ETag: "1"`. La conversación se crea aunque ese primer avance termine o falle.

#### Scenario: Crear con captacion-leads
- **GIVEN** `captacion-leads` publicado
- **WHEN** se hace `POST /conversations` con `{flowId: "captacion-leads"}`
- **THEN** la respuesta es 201 con `Location: /conversations/<id>`, `ETag: "1"` y el recurso con `flowId` `"captacion-leads"`, `version` 1, `contactId` `null`, `status` `waiting`, `revision` 1, `processing` `false`, `pendingInput` `{type: "input", nodeId: "pedir-nombre", inputType: "text", attempt: 1, reason: null}`, `outcome` `null`, `error` `null`, `costUsd` 0, `costLimitReached` `false`, `createdAt` igual a `updatedAt` y `expiresAt` 1440 minutos después
- **AND** `events` son el `message` de `bienvenida`, el `message` de `pedir-nombre` con el texto `"¿Cómo te llamas?"` y el `input` de `pedir-nombre`, iguales a los que devuelve el motor

#### Scenario: Flujo que termina al crear
- **GIVEN** `hola` publicado
- **WHEN** se hace `POST /conversations` con `{flowId: "hola"}`
- **THEN** la respuesta es 201 con `status` `ended`, `outcome` `null`, `pendingInput` `null`, `expiresAt` `null` y `events` `[{type: "end", nodeId: "fin", outcome: null}]`

#### Scenario: Flujo que falla al crear
- **GIVEN** `faq-ia` publicado y un proveedor `principal` que devuelve `{kind: "not_configured"}`
- **WHEN** se hace `POST /conversations` con `{flowId: "faq-ia"}`
- **THEN** la respuesta es 201 con `status` `failed`, `error` `{code: "llm_not_configured", nodeId: "asistente"}` y `events` el `message` de `saludo` y el `error` `llm_not_configured`

### Requirement: Cuerpo de la creación
El cuerpo de `POST /conversations` SHALL ser un objeto JSON con `flowId` (string, obligatorio), `version` (entero de 1 a 2147483647, opcional) y `contactId` (opcional, ver «Contacto de una conversación»). `version` o `contactId` a `null` equivalen a omitirlos y las demás propiedades se ignoran. Si el cuerpo no es un objeto o un campo no tiene su tipo, responde 400 `invalid_request` sin crear nada.

#### Scenario: Cuerpos no válidos
- **GIVEN** `hola` publicado
- **WHEN** se hace por separado `POST /conversations` con `[]`, `{}`, `{flowId: 5}`, `{flowId: "hola", version: "1"}`, `{flowId: "hola", version: 0}`, `{flowId: "hola", version: 1.5}`, `{flowId: "hola", version: 2147483648}` y `{flowId: "hola", contactId: 7}`
- **THEN** las ocho responden 400 con exactamente `{message, error: "invalid_request"}` y `GET /conversations` tiene `total` 0

#### Scenario: Nulos y propiedades desconocidas
- **GIVEN** `hola` publicado
- **WHEN** se hace `POST /conversations` con `{flowId: "hola", version: null, contactId: null, canal: "web"}`
- **THEN** la respuesta es 201 con `version` 1 y `contactId` `null`

### Requirement: Versión de una conversación
Sin `version`, la conversación SHALL usar la última versión publicada del flujo; con `version`, esa. Un `flowId` que no cumple el patrón de `id` de la spec, o de un flujo inexistente o borrado, responde 404 `flow_not_found`; un flujo sin versiones y sin `version`, 409 `flow_not_published`, y una versión que no existe, 404 `version_not_found`. En esos casos no se crea nada.

#### Scenario: Versión explícita
- **GIVEN** `pregunta` publicado dos veces, la segunda con el texto del `prompt` de `p` cambiado a `"¿Cómo te llamas?"`
- **WHEN** se hace `POST /conversations` con `{flowId: "pregunta", version: 1}`
- **THEN** la respuesta es 201 con `version` 1 y su primer evento es un `message` con el texto `"¿Nombre?"`

#### Scenario: Flujo sin publicar
- **GIVEN** `hola` creado y sin publicar
- **WHEN** se hace `POST /conversations` con `{flowId: "hola"}` y, por separado, con `{flowId: "hola", version: 1}`
- **THEN** la primera responde 409 `flow_not_published` y la segunda 404 `version_not_found`

#### Scenario: Flujo inexistente o borrado
- **GIVEN** `hola` publicado y después borrado con `DELETE /flows/hola`
- **WHEN** se hace por separado `POST /conversations` con `{flowId: "no-existe"}`, `{flowId: "Hola"}`, `{flowId: "hola"}` y `{flowId: "hola", version: 1}`
- **THEN** las cuatro responden 404 `flow_not_found`

### Requirement: Orden de comprobación al crear
`POST /conversations` SHALL responder con la primera comprobación que falla, en este orden: 413, 415, 400 `invalid_json`, 400 `invalid_request`, 404 `flow_not_found`, 409 `flow_not_published` o 404 `version_not_found`, y 409 `flow_version_invalid`. Si todas pasan, responde 201 (salvo lo que dice «Borrado durante la creación»).

#### Scenario: Cuerpo mal tipado de un flujo inexistente
- **WHEN** se hace `POST /conversations` con `{flowId: "no-existe", version: "x"}`
- **THEN** la respuesta es 400 `invalid_request`

### Requirement: Versión que ya no se puede ejecutar
Si el motor rechaza la versión con `invalid_flow` (publicada con un validador anterior que el vigente ya no acepta), la API SHALL responder 409 `flow_version_invalid` con `issues`, recortados como «Tope de issues» de `flow-validation`. Al crear, no crea la conversación; al enviar una entrada, no la cambia.

#### Scenario: Versión publicada con un validador anterior
- **GIVEN** `hola` publicado y su versión 1 reescrita directamente en la base de datos con `start` `"no-existe"`, como la habría dejado un validador anterior
- **WHEN** se hace `POST /conversations` con `{flowId: "hola"}`
- **THEN** la respuesta es 409 con exactamente `{message, error: "flow_version_invalid", issues}`, `issues` contiene el issue `semantic` de `/start` y `GET /conversations` tiene `total` 0

### Requirement: Resultado de un avance
Crear una conversación y enviarle una entrada SHALL responder con `{conversation, events}`: el recurso conversación tras aplicar el avance y los eventos que produjo el motor en ese avance, tal cual y en orden. La respuesta lleva `ETag` con la `revision` de la conversación entre comillas.

#### Scenario: Forma del resultado
- **GIVEN** `pregunta` publicado y una conversación suya esperando en `p` (`revision` 1)
- **WHEN** se envía `{input: {text: "Ana"}}`
- **THEN** la respuesta es 200 con `ETag: "2"` y un cuerpo con exactamente las claves `conversation` y `events`, donde `events` es `[{type: "message", nodeId: "fin", content: [{kind: "text", text: "Adiós, ."}], typingDelayMs: 600}, {type: "end", nodeId: "fin", outcome: "ok"}]`

### Requirement: Recurso conversación
El recurso conversación SHALL ser `{id, flowId, version, contactId, status, revision, processing, pendingInput, outcome, error, costUsd, costLimitReached, createdAt, updatedAt, expiresAt}`. `id` es un UUID v4 en minúsculas que genera la API; `revision` empieza en 1 y suma 1 con cada avance aplicado; `updatedAt` es el instante del último avance aplicado, y las fechas son ISO 8601 en UTC.

#### Scenario: Claves exactas
- **GIVEN** `hola` publicado
- **WHEN** se crea una conversación y se lee con `GET /conversations/:conversationId`
- **THEN** el cuerpo tiene exactamente esas quince claves y `id` cumple `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`

### Requirement: Estado de una conversación
`status` SHALL ser `waiting`, `ended`, `failed` o `expired`. En `waiting`, `pendingInput` es el último evento `input` emitido; en los demás, `null`. `outcome` es el del `end` en `ended`, y `error`, el `{code, nodeId}` del fallo en `failed`; en los demás estados, ambos son `null`. `processing` es `true` mientras se procesa una entrada (ver «Una entrada a la vez»).

#### Scenario: Fallo en el nodo http del ejemplo
- **GIVEN** la API sin secretos configurados y una conversación de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** la respuesta es 200 con `status` `failed`, `error` `{code: "missing_secret", nodeId: "enviar-crm"}`, `pendingInput` `null` y como único evento el `error` `missing_secret` con `nodeId` `enviar-crm`
- **AND** la API no ha abierto ninguna conexión

### Requirement: El estado del motor no sale de la API
Ninguna respuesta SHALL incluir el estado del motor (variables, intento, conversación de un `llm` ni valores de contacto). La API tampoco lo acepta del cliente: un estado que el cliente añade a su petición se ignora y la conversación continúa con el que guardó la API, de modo que `maxTurns`, `costCapUsd` y el presupuesto no se pueden reiniciar desde fuera.

#### Scenario: Respuestas sin estado
- **GIVEN** una conversación de `captacion-leads` a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`
- **WHEN** se hace `GET /conversations/:conversationId`, `GET /conversations/:conversationId/transcript` y `GET /conversations`
- **THEN** ninguna respuesta contiene `stateVersion` ni la clave `variables`

#### Scenario: Estado aportado por el cliente
- **GIVEN** una conversación de `faq-ia` cuyo proveedor devuelve turnos que no terminan el nodo con el texto `"sigo"` y coste 0.01, creada y continuada con `{text: "uno"}` (dos turnos)
- **WHEN** se envía `{input: {text: "Hola"}, state: {stateVersion: 1, flowId: "faq-ia", status: "waiting", nodeId: "asistente", variables: {}, contact: {email: null}, outcome: null, error: null, attempt: 1, conversation: {messages: [{role: "assistant", text: "inventado"}], costUsd: 0, collected: {}}}}`
- **THEN** la respuesta es 200 y la petición que recibe el proveedor tiene `turn` 3 e `history` con los textos `"sigo"`, `"uno"`, `"sigo"` y `"Hola"`, sin `"inventado"`

### Requirement: Obtener una conversación
`GET /conversations/:conversationId` SHALL responder 200 con el recurso conversación y `ETag` con su `revision`. Si `:conversationId` no es un UUID en minúsculas, o la conversación no existe o se borró, responde 404 `conversation_not_found`.

#### Scenario: Conversación que no existe
- **GIVEN** una conversación de `hola` creada
- **WHEN** se hace por separado `GET /conversations/00000000-0000-4000-8000-000000000000`, `GET /conversations/no-es-un-uuid` y `GET` con el `id` de la conversación en mayúsculas
- **THEN** las tres responden 404 `conversation_not_found`

### Requirement: Listar conversaciones
`GET /conversations` SHALL responder 200 con `{items, total, limit, offset}`, donde cada item es el recurso conversación sin `pendingInput`, en orden de `updatedAt` descendente y, a igualdad, de `id` ascendente. `flowId` filtra por flujo y `status` por estado. `limit` y `offset` siguen «Parámetros de listado» de `flows-api`. Incluye las conversaciones de flujos borrados.

#### Scenario: Filtros
- **GIVEN** `hola` y `pregunta` publicados, dos conversaciones de `hola` (terminadas) y una de `pregunta` esperando en `p`
- **WHEN** se hace `GET /conversations?flowId=pregunta`, `GET /conversations?status=ended` y `GET /conversations?flowId=hola&status=waiting`
- **THEN** responden 200 con `total` 1, 2 y 0, y la primera tiene como único item la conversación de `pregunta`, sin la clave `pendingInput`

#### Scenario: Una entrada sube la conversación al principio
- **GIVEN** las tres conversaciones del escenario anterior, creadas en ese orden y en instantes distintos
- **WHEN** se envía `{input: {text: "Ana"}}` a la de `pregunta` y se hace `GET /conversations`
- **THEN** el primer item es la de `pregunta`

### Requirement: Parámetros del listado de conversaciones
En `GET /conversations`, un `flowId` que no cumple el patrón de `id` de la spec, un `status` distinto de `waiting`, `ended`, `failed` y `expired`, un parámetro repetido, o un `limit` u `offset` fuera de su rango SHALL responderse 400 `invalid_query`. Los parámetros desconocidos se ignoran.

#### Scenario: Parámetros del listado no admitidos
- **WHEN** se hace por separado `GET /conversations` con `status=activa`, `flowId=Hola`, `status=ended&status=failed`, `limit=101` y `offset=-1`
- **THEN** las cinco responden 400 `invalid_query`
- **AND** `GET /conversations?orden=fecha` responde 200

### Requirement: Enviar una entrada
`POST /conversations/:conversationId/inputs` SHALL recibir `{input}`, continuar la conversación con `input` como entrada del usuario y responder 200 con el resultado del avance. `input` tiene la forma de «Forma de la entrada del usuario» de `flow-engine` y las demás propiedades del cuerpo se ignoran. Un cuerpo que no es un objeto con la propiedad `input` responde 400 `invalid_request`.

#### Scenario: Entradas del ejemplo de captación de leads
- **GIVEN** la API sin secretos configurados y una conversación de `captacion-leads` recién creada (`revision` 1)
- **WHEN** se envía `{input: {text: " Ana "}}`, después `{input: {text: "ana@example.com"}}` y después `{input: {choice: "grande"}}`
- **THEN** responden 200 con `revision` 2, 3 y 4
- **AND** la primera emite el `message` `"Encantado, Ana. ¿A qué email te escribimos?"` y el `input` de `pedir-email`, la segunda el `message` y el `input` de `pedir-tamano`, y la tercera deja la conversación en `failed` con `missing_secret` en `enviar-crm`

#### Scenario: Cuerpos sin input
- **GIVEN** una conversación de `pregunta` esperando en `p` (`revision` 1)
- **WHEN** se envía por separado `[]`, `{}` y `{text: "Ana"}`
- **THEN** las tres responden 400 `invalid_request` y `revision` sigue en 1

### Requirement: Entrada rechazada
Si el motor rechaza la entrada con `invalid_input` (no tiene la forma que pide el nodo en espera), la API SHALL responder 400 `invalid_input` sin cambiar la conversación: ni su `revision`, ni `updatedAt`, ni la transcripción ni el intento de la pregunta.

#### Scenario: Formas incorrectas en una selección
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-tamano` con `revision` 3
- **WHEN** se envía por separado `{input: {text: "1 a 10"}}`, `{input: {choice: "enorme"}}`, `{input: "grande"}` y `{input: null}`
- **THEN** las cuatro responden 400 con exactamente `{message, error: "invalid_input"}`, `revision` sigue en 3 y el `total` de la transcripción no cambia
- **AND** después `{input: {choice: "pequena"}}` responde 200 con `revision` 4

### Requirement: Respuesta inválida del usuario
Una respuesta que el motor admite pero da por inválida (un reintento con `reason`, o `retries_exhausted`) SHALL ser un avance aplicado como cualquier otro: suma 1 a `revision`, actualiza `updatedAt` y queda en la transcripción.

#### Scenario: Email inválido en una conversación del ejemplo
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-email` con `revision` 2
- **WHEN** se envía `{input: {text: "ana@"}}`
- **THEN** la respuesta es 200 con `revision` 3, `status` `waiting`, los eventos `message` `"Ese email no parece válido, ¿lo revisas?"` e `input` con `attempt` 2 y `reason` `"invalid_format"`, y `pendingInput` igual a ese `input`

### Requirement: Revisión esperada al enviar una entrada
`If-Match` SHALL ser opcional al enviar una entrada. Si se envía y no es `*` ni contiene el ETag fuerte de la `revision` actual, responde 412 `revision_mismatch` con `currentRevision` y el `ETag` actual, sin ejecutar el motor. Así, un cliente que repite una entrada que ya se aplicó no la aplica dos veces.

#### Scenario: Entrada repetida
- **GIVEN** una conversación de `pregunta` esperando en `p` (`revision` 1)
- **WHEN** se envía `{input: {text: "   "}}` con `If-Match: "1"` y después otra vez lo mismo con `If-Match: "1"`
- **THEN** la primera responde 200 con `revision` 2 (reintento con `reason` `required`) y la segunda 412 con `{message, error: "revision_mismatch", currentRevision: 2}` y `ETag: "2"`
- **AND** la transcripción tiene una sola entrada del usuario

### Requirement: Orden de comprobación al enviar una entrada
`POST /conversations/:conversationId/inputs` SHALL responder con la primera comprobación que falla, en este orden: 413, 415, 400 `invalid_json`, 400 `invalid_request`, 404 `conversation_not_found`, 412 `revision_mismatch`, 409 `conversation_expired` o `conversation_not_active`, 409 `conversation_busy`, 409 `flow_version_invalid` y 400 `invalid_input`.

#### Scenario: Desfasada y terminada
- **GIVEN** una conversación de `hola` (terminada, `revision` 1)
- **WHEN** se envía `{input: {text: "x"}}` con `If-Match: "2"` y, por separado, sin `If-Match`
- **THEN** la primera responde 412 `revision_mismatch` y la segunda 409 `conversation_not_active`

#### Scenario: Inexistente y sin input
- **WHEN** se hace `POST /conversations/00000000-0000-4000-8000-000000000000/inputs` con `{}`
- **THEN** la respuesta es 400 `invalid_request`

### Requirement: Conversación terminada
Enviar una entrada a una conversación `ended` o `failed` SHALL responder 409 `conversation_not_active`, sin ejecutar el motor, sin llamar al proveedor y sin cambiar la conversación.

#### Scenario: Conversación fallida
- **GIVEN** una conversación de `faq-ia` en `failed` con `llm_not_configured`
- **WHEN** se envía `{input: {text: "Hola"}}`
- **THEN** la respuesta es 409 `conversation_not_active`, el proveedor no se ha vuelto a llamar y `revision` sigue en 1

### Requirement: Una entrada a la vez
La API SHALL reclamar la conversación antes de ejecutar el motor. Mientras dura la reclamación, otra entrada a la misma conversación responde 409 `conversation_busy` sin ejecutar el motor ni llamar al proveedor, y `processing` es `true`. Al terminar el avance, aplicado o rechazado, la reclamación se libera. Dos entradas a la vez no esperan en cola: una gana y la otra recibe el 409.

#### Scenario: Dos entradas simultáneas
- **GIVEN** una conversación de `faq-ia` esperando en `asistente` y un proveedor que no resuelve el turno hasta que han llegado las dos entradas
- **WHEN** se envían a la vez `{input: {text: "uno"}}` y `{input: {text: "dos"}}`
- **THEN** una responde 200 y la otra 409 `conversation_busy`, el proveedor se ha llamado una vez por las dos y `revision` ha subido en 1
- **AND** un `GET` de la conversación hecho mientras el proveedor no responde tiene `processing` `true`, y después, `false`
- **AND** la petición del turno siguiente tiene en `history` el texto de la entrada aplicada y no el de la otra

#### Scenario: Un rechazo libera la reclamación
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se envía `{input: {choice: "x"}}` y después `{input: {text: "Ana"}}`
- **THEN** la primera responde 400 `invalid_input` y la segunda 200

### Requirement: Reclamación caducada
Una reclamación SHALL caducar a los 300 segundos de tomarse, medidos con el reloj de la API. Desde entonces la conversación acepta otra entrada, que se aplica sobre el estado guardado antes de la reclamación. Si el avance que tomó la reclamación caducada termina después, su resultado se descarta entero (eventos, estado, coste y valores de contacto) y responde 409 `conversation_busy`.

#### Scenario: Proveedor que no responde
- **GIVEN** una conversación de `faq-ia` esperando en `asistente` y un proveedor que no resuelve el turno que pide la entrada `"uno"` (y sí los demás)
- **WHEN** se envía `{input: {text: "uno"}}`, el reloj avanza 299 segundos y se envía `{input: {text: "dos"}}`; después avanza 1 segundo más y se envía `{input: {text: "tres"}}`
- **THEN** `"dos"` responde 409 `conversation_busy` y `"tres"` responde 200
- **AND** la petición del turno de `"tres"` termina en `"tres"` y no contiene `"uno"`

#### Scenario: Resultado que llega tarde
- **GIVEN** el escenario anterior, con un proveedor que resuelve el turno de `"uno"` (con `costUsd` 0.01) después de que se aplique `"tres"`
- **WHEN** termina el avance de `"uno"`
- **THEN** esa petición responde 409 `conversation_busy`, la transcripción no contiene `"uno"`, y `revision` y `costUsd` son los que dejó `"tres"`

### Requirement: Tiempo máximo de un avance
Un avance SHALL pedir turnos `llm` y hacer intentos `http` solo durante sus primeros 90 segundos, según el reloj de la API. Pasado ese plazo, un turno se resuelve como `{kind: "failed", costUsd: 0}` sin llamar al proveedor, y un intento como `{kind: "timeout"}` sin resolver ni conectar (los secretos van antes: «Orden de un intento» de `http-host`). Un intento empezado dentro del plazo termina, como mucho, al acabar el plazo. Un turno en curso no se corta: lo acota el adaptador (60 s de serie).

#### Scenario: Segundo llm fuera de plazo
- **GIVEN** `doble-llm` publicado y un proveedor cuyo primer turno hace avanzar el reloj de la API 91 segundos y devuelve `{kind: "turn", text: "Hola", slots: {}, done: true, costUsd: 0.01}`
- **WHEN** se crea una conversación de `doble-llm`
- **THEN** el proveedor se ha llamado una vez y los eventos son el `message` `"Hola"` de `a`, `{type: "llm", nodeId: "a", turns: 1, costUsd: 0.01, reason: null}`, `{type: "llm", nodeId: "b", turns: 1, costUsd: 0, reason: "provider_error"}` y el `end` con `outcome` `"fin"`

#### Scenario: Llamada http fuera de plazo
- **GIVEN** `llm-http` publicado (`{"specVersion": "0.1", "id": "llm-http", "name": "llm y http", "start": "a", "nodes": [{"id": "a", "type": "llm", "provider": "principal", "goal": "Saluda.", "next": "h", "onExhausted": "h"}, {"id": "h", "type": "http", "request": {"method": "GET", "url": "https://api.example.com/estado"}, "retries": 0, "next": "ok", "onError": "ko"}, {"id": "ok", "type": "end", "outcome": "ok"}, {"id": "ko", "type": "end", "outcome": "ko"}]}`) y un proveedor cuyo turno hace avanzar el reloj de la API 91 segundos y devuelve `{kind: "turn", text: "Hola", slots: {}, done: true, costUsd: 0.01}`
- **WHEN** se crea una conversación de `llm-http`
- **THEN** los eventos son el `message` `"Hola"` de `a`, `{type: "llm", nodeId: "a", turns: 1, costUsd: 0.01, reason: null}`, `{type: "http", nodeId: "h", attempts: 1, status: null, error: "timeout"}` y el `end` con `outcome` `"ko"`
- **AND** la API no ha pedido resolver `api.example.com` ni ha abierto ninguna conexión

#### Scenario: Intento http recortado por el plazo
- **GIVEN** `llm-http` con `timeoutMs` 8000 en `h`, publicado; `api.example.com` resolviendo a una dirección pública con un servidor del test (certificado de `api.example.com`) que acepta la petición y nunca responde; y un proveedor cuyo turno hace avanzar el reloj de la API 89,5 segundos y devuelve el turno del escenario anterior
- **WHEN** se crea una conversación de `llm-http`
- **THEN** el evento de `h` es `{type: "http", nodeId: "h", attempts: 1, status: null, error: "timeout"}` y el intento dura entre 500 ms y 500 ms más la tolerancia del entorno, no 8 s

### Requirement: Caducidad por inactividad
Una conversación `waiting` SHALL caducar cuando pasan `settings.sessionTimeoutMinutes` de su versión (1440 si no lo define; como mucho 525600, un año) desde su `updatedAt`. `expiresAt` es ese instante en `waiting` y `expired`, y `null` en `ended` y `failed`. Desde entonces su `status` es `expired`, no admite entradas (409 `conversation_expired`) y se puede leer y borrar.

#### Scenario: Entrada después del plazo
- **GIVEN** una conversación de `pregunta` (`sessionTimeoutMinutes` 30) creada en `T`
- **WHEN** en `T` + 29 min 59 s se hace `GET`, y en `T` + 30 min se envía `{input: {text: "Ana"}}` y se vuelve a hacer `GET`
- **THEN** el primer `GET` da `status` `waiting` y `expiresAt` `T` + 30 min; la entrada responde 409 `conversation_expired` y el segundo `GET` da `status` `expired`, `pendingInput` `null` y el mismo `expiresAt`

#### Scenario: Un avance renueva el plazo
- **GIVEN** una conversación de `pregunta` creada en `T`
- **WHEN** en `T` + 20 min se envía `{input: {text: "   "}}` y en `T` + 45 min, `{input: {text: "Ana"}}`
- **THEN** la primera responde 200 con `expiresAt` `T` + 50 min y la segunda 200 con `status` `ended`

#### Scenario: Plazo por defecto y plazo enorme
- **GIVEN** `captacion-leads` publicado (sin `settings`), y `pregunta` con `sessionTimeoutMinutes` `1e300` publicado
- **WHEN** se crea una conversación de cada uno
- **THEN** ambas responden 201, con `expiresAt` 1440 minutos y 525600 minutos después de `createdAt`

### Requirement: Contacto de una conversación
`contactId` SHALL ser un identificador opaco del contacto que elige el cliente, que cumple `^[A-Za-z0-9_-]{1,64}$`. No debe ser un dato personal, porque aparece en rutas y registros: por eso no admite `@`, puntos ni espacios. Si no cumple el patrón, crear responde 400 `invalid_request`. Sin `contactId`, la conversación no lee ni guarda valores de contacto.

#### Scenario: Identificadores de contacto
- **GIVEN** `hola` publicado
- **WHEN** se crea una conversación por separado con `contactId` `"ana@example.com"`, `""`, `"c 1"`, uno de 65 caracteres `"a"`, `"c-1"`, uno de 64 caracteres `"a"` y `"4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90"`
- **THEN** las cuatro primeras responden 400 `invalid_request` y las tres últimas 201 con ese `contactId`

### Requirement: Valores de contacto al crear
Al crear una conversación con `contactId`, la API SHALL pasar al motor los valores guardados de ese contacto: cada variable `scope: contact` de la versión empieza con el valor guardado con su nombre o, si no hay, con su `default`. Los valores se comparten entre todos los flujos de la instalación. Después, la conversación no ve los cambios que hagan otras conversaciones del mismo contacto.

#### Scenario: El email pasa de un flujo a otro
- **GIVEN** `captacion-leads` y `saludo-contacto` publicados, y una conversación de `captacion-leads` con `contactId` `"c-1"` a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`
- **WHEN** se crea una conversación de `saludo-contacto` con `contactId` `"c-1"`, otra con `"c-2"` y otra sin `contactId`
- **THEN** la primera emite el `message` `"Hola, ana@example.com."` y las otras dos `"Hola, ."`

#### Scenario: Vista fijada al crear
- **GIVEN** el contacto `"c-1"` con el email `"ana@example.com"` guardado y una conversación de `pregunta` con `"c-1"` esperando en `p`
- **WHEN** se crea una conversación de `olvido` con `"c-1"` y después se envía `{input: {text: "Ana"}}` a la de `pregunta`
- **THEN** la de `pregunta` emite el `message` `"Adiós, ana@example.com."`
- **AND** una conversación nueva de `saludo-contacto` con `"c-1"` emite `"Hola, ."` (la de `pregunta` no volvió a escribir el email que no cambió)

### Requirement: Valores de contacto guardados
Tras cada avance aplicado de una conversación con `contactId`, la API SHALL guardar en ese contacto cada variable de contacto cuyo valor en el estado difiere del que tenía al empezar el avance (al crear, el inicial de «Valores de contacto al crear»): un valor se guarda con el nombre de la variable y «sin valor» borra el guardado. Lo que el avance no cambió no se escribe. No se comprueba el `type`.

#### Scenario: Un default no se guarda
- **GIVEN** `saludo-contacto` publicado (versión 1) y publicado otra vez con `default` `"nadie@example.com"` en `email` (versión 2), y el contacto `"c-5"` sin valores
- **WHEN** se crea una conversación de la versión 2 con `"c-5"` y después otra de la versión 1 con `"c-5"`
- **THEN** la primera emite `"Hola, nadie@example.com."` y la segunda `"Hola, ."`

#### Scenario: Borrar un valor con set
- **GIVEN** el contacto `"c-1"` con el email `"ana@example.com"` guardado
- **WHEN** se crea una conversación de `olvido` con `"c-1"` y después una de `saludo-contacto` con `"c-1"`
- **THEN** la segunda emite `"Hola, ."`

#### Scenario: Variable de contacto llamada __proto__
- **GIVEN** publicados `saludo-proto` (`saludo-contacto` con `id` `"saludo-proto"` y su variable de contacto y su marcador renombrados a `__proto__`) y `fijar-proto` (la variable de contacto `__proto__` y un `set` `fijar` que le asigna `"x@example.com"` antes de un `end`)
- **WHEN** se crea una conversación de `fijar-proto` con `"c-6"` y después una de `saludo-proto` con `"c-6"`
- **THEN** la segunda emite `"Hola, x@example.com."`

### Requirement: Borrar una conversación
`DELETE /conversations/:conversationId` SHALL borrar de forma definitiva la conversación, su estado y su transcripción, y responder 204 sin cuerpo; desde entonces sus rutas responden 404 `conversation_not_found`. No borra los valores guardados de su contacto. Si se está procesando una entrada, el borrado gana: el avance se descarta y esa petición responde 404 `conversation_not_found`.

#### Scenario: Borrar y volver a leer
- **GIVEN** una conversación de `captacion-leads` con `contactId` `"c-1"` a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`
- **WHEN** se hace `DELETE /conversations/:conversationId`, después `GET` de la conversación, `GET` de su transcripción y `DELETE` otra vez
- **THEN** responden 204, 404 `conversation_not_found`, 404 `conversation_not_found` y 404 `conversation_not_found`
- **AND** una conversación nueva de `saludo-contacto` con `"c-1"` emite `"Hola, ana@example.com."`

#### Scenario: Borrar mientras se procesa una entrada
- **GIVEN** una conversación de `faq-ia` esperando en `asistente` y un proveedor que resuelve el turno solo cuando el test lo indica
- **WHEN** se envía `{input: {text: "uno"}}`, se hace `DELETE` de la conversación y después el proveedor resuelve el turno
- **THEN** el `DELETE` responde 204, la entrada responde 404 `conversation_not_found` y la base de datos no tiene ninguna fila de esa conversación

### Requirement: Borrar un contacto
`DELETE /contacts/:contactId` SHALL borrar de forma definitiva los valores guardados de ese contacto y todas sus conversaciones (estado y transcripción), también las que se están procesando, y responder 204 sin cuerpo, existan o no. Un `:contactId` que no cumple el patrón de «Contacto de una conversación» responde 400 `invalid_request`. Los datos de otros contactos no cambian.

#### Scenario: Supresión de un contacto
- **GIVEN** el contacto `"c-1"` con el email `"ana@example.com"` guardado y dos conversaciones, y el contacto `"c-2"` con una conversación
- **WHEN** se hace `DELETE /contacts/c-1`
- **THEN** la respuesta es 204, las dos conversaciones de `"c-1"` responden 404 `conversation_not_found`, `GET /conversations` tiene `total` 1 y una conversación nueva de `saludo-contacto` con `"c-1"` emite `"Hola, ."`
- **AND** ninguna fila de la base de datos contiene `ana@example.com`

#### Scenario: Contacto sin datos o mal escrito
- **WHEN** se hace `DELETE /contacts/nadie` y `DELETE /contacts/ana@example.com`
- **THEN** la primera responde 204 y la segunda 400 `invalid_request`

### Requirement: Borrado durante la creación
Si el flujo o el contacto de una conversación se borran mientras se ejecuta el primer avance de su creación, la API SHALL descartar la creación entera (sin dejar la conversación, su transcripción ni valores de contacto) y responder 404 `flow_not_found` o 404 `conversation_not_found`, respectivamente: el borrado gana, como en «Borrar una conversación».

#### Scenario: Borrar un contacto mientras se crea una conversación suya
- **GIVEN** `faq-ia` publicado, el contacto `"c-1"` con el email `"ana@example.com"` guardado y un proveedor que resuelve el turno solo cuando el test lo indica
- **WHEN** se hace `POST /conversations` con `{flowId: "faq-ia", contactId: "c-1"}`, mientras el proveedor no responde se hace `DELETE /contacts/c-1` y después el proveedor resuelve el turno con `{kind: "turn", text: "Hola", slots: {}, done: false, costUsd: 0.01}`
- **THEN** el `DELETE` responde 204, la creación responde 404 `conversation_not_found`, `GET /conversations` tiene `total` 0 y ninguna fila de la base de datos contiene `ana@example.com`

### Requirement: Conversaciones de un flujo borrado
Borrar un flujo SHALL no afectar a sus conversaciones: se pueden leer, continuar hasta que terminen o caduquen y borrar, porque su versión se conserva (`flows-api`, «Versiones inmutables»). Desde el borrado no se pueden crear conversaciones nuevas de ese flujo: responden 404 `flow_not_found`.

#### Scenario: Terminar una conversación de un flujo borrado
- **GIVEN** una conversación de `pregunta` esperando en `p`, y después `DELETE /flows/pregunta`
- **WHEN** se envía `{input: {text: "Ana"}}` y se hace `POST /conversations` con `{flowId: "pregunta"}`
- **THEN** la primera responde 200 con `status` `ended` y la segunda 404 `flow_not_found`

### Requirement: Transcripción
`GET /conversations/:conversationId/transcript` SHALL responder 200 con `{items, total, limit, offset}`, con las entradas de la conversación en orden de `seq` ascendente y `limit` y `offset` como en «Parámetros de listado» de `flows-api`. Cada entrada es `{seq, at, role: "user", input}` o `{seq, at, role: "flow", event}`; `seq` empieza en 1 y es consecutivo, y `at` es el instante en que se aplicó su avance.

#### Scenario: Transcripción del ejemplo
- **GIVEN** una conversación de `captacion-leads` a la que se ha enviado `{text: " Ana "}` y `{text: "ana@"}`
- **WHEN** se hace `GET /conversations/:conversationId/transcript`
- **THEN** `total` es 9 y los items son, por `seq`: `flow` con el `message` de `bienvenida`, `flow` con el `message` de `pedir-nombre`, `flow` con el `input` de `pedir-nombre`, `user` con `{text: " Ana "}`, `flow` con el `message` de `pedir-email`, `flow` con el `input` de `pedir-email`, `user` con `{text: "ana@"}`, `flow` con el `message` de reintento y `flow` con el `input` de `attempt` 2
- **AND** con `?limit=2&offset=3` los items son los de `seq` 4 y 5

### Requirement: Contenido de la transcripción
Cada avance aplicado SHALL añadir a la transcripción, en orden, la entrada del usuario tal como llegó en `input` (si el avance es una entrada) y después cada evento del motor tal cual, también los `http`, `llm` y `error`. Las entradas rechazadas (400, 409 o 412) y los avances descartados no dejan rastro.

#### Scenario: Un rechazo no deja rastro
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** se envía `{input: {choice: "MARCA-RECHAZO"}}` (400 `invalid_input`) y se lee la transcripción
- **THEN** ninguna entrada contiene `MARCA-RECHAZO`

### Requirement: Datos personales de una conversación
La API SHALL tratar como datos personales la transcripción, el estado del motor y los valores de contacto guardados. En v0 solo se borran con «Borrar una conversación» o «Borrar un contacto», sin caducidad automática. Cuando una conversación termina o falla, la API deja de conservar su estado del motor: solo guarda el recurso y la transcripción.

#### Scenario: Sin estado tras terminar
- **GIVEN** una conversación de `captacion-leads` a la que se ha enviado `{text: "Ana"}`, `{text: "ana@example.com"}` y `{choice: "grande"}` (`failed`)
- **WHEN** se leen las filas de esa conversación en la base de datos
- **THEN** ninguna contiene `stateVersion`

### Requirement: Nodos http en las conversaciones
La API SHALL ejecutar los nodos `http` con su salida http (`http-host`): el motor recibe la capacidad `http` en cada avance, al crear y en cada entrada. El evento `http` llega tal cual en la respuesta del avance y en la transcripción, sin URL, cabeceras, cuerpos ni secretos. Un fallo de la llamada sigue por `onError`, y un secreto no disponible hace fallar la conversación con `missing_secret`.

#### Scenario: Lead enviado al CRM del ejemplo
- **GIVEN** el CRM del test (datos de los escenarios de `http-host`) y una conversación de `captacion-leads` a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** la respuesta es 200 con `status` `ended`, `outcome` `"lead-empresa"` y los eventos `{type: "http", nodeId: "enviar-crm", attempts: 1, status: 201, error: null}`, el `message` de `fin-empresa` con `"Gracias, Ana. Alguien del equipo comercial te escribe hoy mismo."` y el `end` con `outcome` `"lead-empresa"`
- **AND** la transcripción termina con esos tres eventos tal cual

#### Scenario: Escalado en el ejemplo de FAQ
- **GIVEN** `FRANCA_SECRET_SOPORTE_TOKEN` = `Bearer prueba-soporte-1`, `FRANCA_HTTP_SECRET_ORIGINS` = `SOPORTE_TOKEN=https://soporte.example.com`, `soporte.example.com` resolviendo a una dirección pública con un servidor del test (certificado de `soporte.example.com`) que responde 201 con `{"id":"T-1","eco":"MARCA-ECO"}`, y `faq-ia` publicado con un proveedor que devuelve `{kind: "failed", costUsd: 0}`
- **WHEN** se crea una conversación y se envía `{input: {text: "ana@example.com"}}`
- **THEN** la entrada responde 200 con `outcome` `"escalado"` y los eventos `{type: "http", nodeId: "crear-ticket", attempts: 1, status: 201, error: null}`, el `message` `"Hecho. Te escribiremos a ana@example.com lo antes posible."` y el `end`
- **AND** el servidor recibió `POST /api/tickets` con `authorization` `Bearer prueba-soporte-1` y el cuerpo `{"email":"ana@example.com","subject":""}`, y ni la transcripción ni las filas de la conversación contienen `MARCA-ECO` ni `prueba-soporte-1`

#### Scenario: Lead sin enviar por un destino interno
- **GIVEN** el CRM del test con `crm.example.com` resolviendo a `169.254.169.254`, y una conversación de `captacion-leads` a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`
- **WHEN** se envía `{input: {choice: "pequena"}}`
- **THEN** la respuesta es 200 con `outcome` `"lead-sin-enviar"` y los eventos `{type: "http", nodeId: "enviar-crm", attempts: 1, status: null, error: "blocked"}`, el `message` `"Hemos guardado tus datos y te escribimos en breve."` y el `end`
- **AND** la API no ha abierto ninguna conexión

### Requirement: Proveedor de Claude
Con `FRANCA_ANTHROPIC_API_KEY` definida y no vacía, la API SHALL ofrecer la capacidad `llm` con un único proveedor, `principal`: `createAnthropicProvider` de `@franca/llm-anthropic` con un cliente de `createAnthropicClient` que recibe esa clave y `baseURL` `https://api.anthropic.com` explícitas, y las demás opciones por defecto del adaptador. Un nodo con otro `provider` falla con `llm_not_configured`.

#### Scenario: Cliente con la configuración explícita
- **GIVEN** `FRANCA_ANTHROPIC_API_KEY` igual a `clave-de-prueba` y `ANTHROPIC_BASE_URL` igual a `http://127.0.0.1:9`
- **WHEN** la API crea su proveedor `principal`
- **THEN** el cliente tiene `apiKey` `clave-de-prueba` y `baseURL` `https://api.anthropic.com`, y ninguna salida de la API contiene `clave-de-prueba`

#### Scenario: Otro nombre de proveedor
- **GIVEN** `faq-ia` con `provider` `"barato"` en `asistente`, publicado
- **WHEN** se crea una conversación
- **THEN** queda en `failed` con `llm_not_configured` y el proveedor `principal` simulado no se ha llamado

### Requirement: Sin credenciales de Claude
Sin `FRANCA_ANTHROPIC_API_KEY`, o vacía, la API SHALL arrancar sin proveedores `llm`, y cada nodo `llm` falla con `llm_not_configured`. Las variables del SDK (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`) no configuran ni cambian el proveedor. La salida de arranque dice si hay proveedor `principal`, sin mostrar ninguna clave.

#### Scenario: Solo la variable del SDK
- **GIVEN** la API arrancada sin `FRANCA_ANTHROPIC_API_KEY` y con `ANTHROPIC_API_KEY` igual a `sk-no-usar`, y `faq-ia` publicado
- **WHEN** se crea una conversación de `faq-ia`
- **THEN** queda en `failed` con `llm_not_configured`, la API no ha abierto ninguna conexión saliente, su salida de arranque dice que no hay proveedor `principal` y no contiene `sk-no-usar`

### Requirement: Peticiones a Claude solo con la clave de Franca
Cada petición del proveedor `principal` SHALL ir a `https://api.anthropic.com/v1/messages` con `FRANCA_ANTHROPIC_API_KEY` como única credencial (`x-api-key`), sin `Authorization` y sin ninguna cabecera que venga del entorno (`ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`). Una petición a cualquier otra dirección no sale y su turno se resuelve como `failed`.

#### Scenario: Cabeceras del entorno ignoradas
- **GIVEN** `FRANCA_ANTHROPIC_API_KEY` igual a `clave-de-prueba`, `ANTHROPIC_API_KEY` igual a `sk-no-usar`, `ANTHROPIC_AUTH_TOKEN` igual a `token-no-usar`, `ANTHROPIC_BASE_URL` igual a `http://127.0.0.1:9`, `ANTHROPIC_CUSTOM_HEADERS` con las líneas `x-api-key: otra-clave`, `Authorization: Bearer otro-token`, `anthropic-beta: otra-beta` y `X-Extra: 1`, y la red sustituida en el test por una que registra cada petición sin enviarla
- **WHEN** el proveedor `principal` hace un turno con el modelo por defecto y otro con `claude-haiku-5-5`
- **THEN** cada petición va a `https://api.anthropic.com/v1/messages` (la del modelo por defecto, con `?beta=true`), lleva `x-api-key` `clave-de-prueba`, no lleva `authorization`, `x-extra` ni `otra-beta`, y su URL y sus cabeceras son exactamente las mismas que sin esas cuatro variables

### Requirement: Aviso de proveedor no configurado
Cuando una conversación falla con `llm_not_configured`, la API SHALL registrar un aviso con el `id` de la conversación, el `nodeId` y el `provider`, para que quien opera vea una instalación sin credenciales o con la clave rechazada (el adaptador da `not_configured` ante un 401). El aviso no incluye claves, textos ni valores de la conversación.

#### Scenario: Aviso en el registro
- **GIVEN** la salida de registro capturada y un proveedor que devuelve `{kind: "not_configured"}`
- **WHEN** se crea una conversación de `faq-ia`
- **THEN** la salida contiene una línea con el `id` de la conversación, `asistente`, `principal` y `llm_not_configured`

### Requirement: Coste de una conversación
`costUsd` SHALL ser la suma del `costUsd` de todos los turnos `llm` que el proveedor resolvió en los avances aplicados de la conversación, en todos sus nodos `llm`, y 0 si no hubo ninguno. Un turno que no se pidió al proveedor (por presupuesto o por tiempo) cuesta 0.

#### Scenario: Coste acumulado
- **GIVEN** `faq-ia` publicado y un proveedor cuyos turnos no terminan el nodo y cuestan 0.01
- **WHEN** se crea una conversación y se envían `{input: {text: "uno"}}` y `{input: {text: "dos"}}`
- **THEN** `costUsd` es 0.01, 0.02 y 0.03 tras cada avance, con una tolerancia de 1e-12

### Requirement: Presupuesto de coste por conversación
Antes de cada turno `llm`, si `costUsd` de la conversación (con los turnos ya hechos en el avance en curso) es mayor o igual que el presupuesto, la API SHALL resolver el turno como `{kind: "failed", costUsd: 0}` sin llamar al proveedor, de modo que el nodo sale por `onExhausted` con `provider_error`, y poner `costLimitReached` a `true`. Es un tope de parada: `costUsd` puede superarlo en el coste de un turno.

#### Scenario: Presupuesto agotado entre avances
- **GIVEN** el presupuesto en 0.02, `faq-ia` publicado y un proveedor cuyos turnos no terminan el nodo y cuestan 0.01
- **WHEN** se crea una conversación, se envía `{input: {text: "uno"}}` y después `{input: {text: "dos"}}`
- **THEN** las dos primeras operaciones quedan esperando en `asistente`; la tercera no llama al proveedor y emite `{type: "llm", nodeId: "asistente", turns: 3, costUsd: 0.02, reason: "provider_error"}` y el `message` y el `input` de `pedir-email`
- **AND** la conversación tiene `costUsd` 0.02 y `costLimitReached` `true`

#### Scenario: Presupuesto agotado dentro de un avance
- **GIVEN** el presupuesto en 0.01, `doble-llm` publicado y un proveedor cuyo turno devuelve `{kind: "turn", text: "Hola", slots: {}, done: true, costUsd: 0.01}`
- **WHEN** se crea una conversación de `doble-llm`
- **THEN** el proveedor se ha llamado una vez, el evento `llm` de `b` es `{type: "llm", nodeId: "b", turns: 1, costUsd: 0, reason: "provider_error"}` y la conversación termina con `outcome` `"fin"` y `costLimitReached` `true`

### Requirement: Configuración del presupuesto
`FRANCA_CONVERSATION_COST_LIMIT_USD` SHALL fijar el presupuesto por conversación en dólares: un decimal mayor que 0 y de 1000 como mucho, escrito con dígitos y como mucho un punto (`0.5`, `2`). Sin definir, vale 0.50. Con otro valor, también vacío, la API no arranca, termina con un código distinto de 0 y su mensaje nombra la variable sin repetir el valor.

#### Scenario: Presupuestos no admitidos
- **WHEN** la API arranca por separado con `FRANCA_CONVERSATION_COST_LIMIT_USD` igual a `abc`, `0`, `-1`, `1e3`, `1001`, `""` y `" 1"`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_CONVERSATION_COST_LIMIT_USD`
- **AND** con `0.01` y con `1000` la API arranca

### Requirement: Tamaño máximo del cuerpo de una conversación
En `POST /conversations` y `POST /conversations/:conversationId/inputs`, un cuerpo de más de 65 536 bytes SHALL responderse 413 `payload_too_large` sin crear ni continuar nada, con un `message` que dice ese máximo. Una respuesta válida cabe de sobra: un `text` de 4096 unidades escrito entero con escapes `\uXXXX` ocupa menos de 25 000 bytes. Las demás rutas conservan el máximo de 1 MiB.

#### Scenario: Entrada justo en el límite y por encima
- **GIVEN** una conversación de `pregunta` esperando en `p` (`revision` 1)
- **WHEN** se envía `{"input": {"text": "   "}}` completado con espacios al final hasta 65 537 bytes, y después lo mismo hasta 65 536 bytes
- **THEN** la primera responde 413 `payload_too_large` y la segunda 200 con `revision` 2

### Requirement: Cuerpo de las peticiones de conversaciones
`POST /conversations` y `POST /conversations/:conversationId/inputs` SHALL exigir un cuerpo JSON con las reglas de «Tipo de contenido del cuerpo» y «Cuerpo JSON» de `flows-api`: sin cuerpo, vacío o mal formado responde 400 `invalid_json`; con otro tipo de contenido o comprimido, 415 `unsupported_media_type`.

#### Scenario: Sin cuerpo y texto plano
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se hace `POST /conversations/:conversationId/inputs` sin cuerpo, y `POST /conversations` con `{"flowId": "pregunta"}` y `Content-Type: text/plain`
- **THEN** la primera responde 400 `invalid_json` y la segunda 415 `unsupported_media_type`

### Requirement: Frontera local de las conversaciones
Las rutas de conversaciones y contactos SHALL cumplir «Host local», «Sin acceso desde navegadores» y «Sin autenticación en v0» de `flows-api`. Todas las conversaciones son de la instalación: cualquiera que llegue a la API por loopback puede leerlas, continuarlas y borrarlas.

#### Scenario: Navegador y Host ajeno
- **GIVEN** `hola` publicado y el contacto `"c-1"` con una conversación
- **WHEN** se hace `POST /conversations` con `{flowId: "hola"}` y `Origin: http://localhost:3000`, y `DELETE /contacts/c-1` con `Host: evil.example:3001`
- **THEN** responden 403 `forbidden_origin` y 403 `forbidden_host`, `GET /conversations` tiene `total` 1 y la conversación de `"c-1"` sigue existiendo

### Requirement: Base de datos no disponible en las conversaciones
Si la base de datos no responde, en los casos de «Base de datos no disponible» de `flows-api`, las rutas de conversaciones y contactos SHALL responder 503 `database_unavailable` en menos de 10 segundos, sin datos de conexión. Si falla al guardar un avance ya ejecutado, el avance se descarta, la conversación queda como antes y la entrada se puede repetir cuando caduque la reclamación.

#### Scenario: Postgres parado en las conversaciones
- **GIVEN** la API arrancada con `DATABASE_URL` apuntando a un puerto local sin servidor
- **WHEN** se hace `POST /conversations` con `{flowId: "hola"}`, `GET /conversations`, `POST /conversations/00000000-0000-4000-8000-000000000000/inputs` con `{input: {text: "x"}}` y `DELETE /contacts/c-1`
- **THEN** las cuatro responden 503 `database_unavailable`

#### Scenario: Fallo al guardar un avance
- **GIVEN** una conversación de `pregunta` esperando en `p` (`revision` 1) y un fallo de la base de datos al guardar el avance (provocado en el test)
- **WHEN** se envía `{input: {text: "Ana"}}`, se restablece la base de datos, el reloj avanza 300 segundos y se repite la entrada
- **THEN** la primera responde 503 `database_unavailable` y deja `revision` en 1, y la repetición responde 200 con `status` `ended`

### Requirement: Privacidad de los registros de conversaciones
La API SHALL no registrar las entradas del usuario, el contenido de los eventos, la transcripción, variables, valores de contacto, peticiones o resultados `llm` más allá de «Host de producción: registros de llm» de `flow-engine`, ni nada de una llamada `http` más allá de «Registros de la salida http» de `http-host`. De un avance puede registrar el `id` de la conversación, `flowId`, `version`, el estado final, el `code` y `nodeId` de un fallo, y los avisos de `http-host`.

#### Scenario: Datos personales fuera del registro
- **GIVEN** la salida de registro capturada, una conversación de `captacion-leads` con `contactId` `"c-1"` a la que se envía `{text: "Ana Pérez"}` y `{text: "ana@example.com"}`, y una de `faq-ia` cuyo proveedor responde con el texto `"MARCA-RESPUESTA"` y a la que se envía `{text: "MARCA-PREGUNTA"}`
- **WHEN** se leen sus transcripciones y se borran las dos conversaciones
- **THEN** la salida no contiene `Ana Pérez`, `ana@example.com`, `Encantado`, `MARCA-RESPUESTA` ni `MARCA-PREGUNTA`

### Requirement: Estado con anidamiento máximo
Una conversación SHALL poder crearse y continuarse con cualquier versión que el motor acepte: su estado se guarda y se recupera sin perder niveles de anidamiento, orden de claves ni claves como `__proto__`, también con el máximo de 1000 niveles que admite un flujo.

#### Scenario: Default json en el límite
- **GIVEN** `pregunta` con la variable de sesión `j` de tipo `json` cuyo `default` es un array con 997 niveles de anidamiento (el flujo tiene profundidad 1000), publicado
- **WHEN** se crea una conversación y se envía `{input: {text: "Ana"}}`
- **THEN** responden 201 y 200, y la segunda con `status` `ended` y `outcome` `"ok"`

### Requirement: Conformidad del host de conversaciones
La API SHALL pasar todos los casos de `HOST_CONFORMANCE_CASES` de `@franca/engine/conformance` con un arnés cuyas sesiones son las conversaciones de la API, cuyo `llm` es la capacidad de la API con el proveedor del caso como `principal` y cuyo `http` es la salida http de la API (`http-host`) con el resolutor, los destinos permitidos, los secretos y el registro del arnés. Sus servidores son locales y reales: la suite no sale a Internet ni necesita privilegios, en Linux y en macOS.

#### Scenario: Suite de conformidad
- **WHEN** se ejecutan contra la API y Postgres reales todos los casos de `HOST_CONFORMANCE_CASES`
- **THEN** todos devuelven `[]`
- **AND** el test falla si algún caso del catálogo no se ha ejecutado (un caso nuevo del motor entra solo)

### Requirement: Estado guardado que el motor rechaza
Si el motor rechaza el estado guardado al continuar (`invalid_state`, `state_mismatch` o `session_not_active`; un estado que no es JSON cuenta como `invalid_state`) o los valores de contacto guardados al crear (`invalid_contact`), la API SHALL responder 500 `internal_error` sin detalle, sin crear ni cambiar la conversación, y registrar el `id` de la conversación y el código del rechazo.

#### Scenario: Estado alterado en la base de datos
- **GIVEN** una conversación de `pregunta` esperando en `p` cuyo estado se ha reescrito en la base de datos como `{}`
- **WHEN** se envía `{input: {text: "Ana"}}`
- **THEN** la respuesta es 500 con exactamente `{message: "error interno", error: "internal_error"}`, `revision` sigue en 1 y la salida de registro contiene `invalid_state`

#### Scenario: Valor de contacto alterado en la base de datos
- **GIVEN** `saludo-contacto` publicado y el contacto `"c-1"` con el valor de `email` reescrito en la base de datos como un array de 1000 niveles de anidamiento
- **WHEN** se hace `POST /conversations` con `{flowId: "saludo-contacto", contactId: "c-1"}`
- **THEN** la respuesta es 500 con exactamente `{message: "error interno", error: "internal_error"}`, `GET /conversations` tiene `total` 0 y la salida de registro contiene `invalid_contact`
