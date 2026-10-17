## RENAMED Requirements

- FROM: `### Requirement: Nodos http deshabilitados`
- TO: `### Requirement: Nodos http en las conversaciones`

## MODIFIED Requirements

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

### Requirement: Estado de una conversación
`status` SHALL ser `waiting`, `ended`, `failed` o `expired`. En `waiting`, `pendingInput` es el último evento `input` emitido; en los demás, `null`. `outcome` es el del `end` en `ended`, y `error`, el `{code, nodeId}` del fallo en `failed`; en los demás estados, ambos son `null`. `processing` es `true` mientras se procesa una entrada (ver «Una entrada a la vez»).

#### Scenario: Fallo en el nodo http del ejemplo
- **GIVEN** la API sin secretos configurados y una conversación de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** la respuesta es 200 con `status` `failed`, `error` `{code: "missing_secret", nodeId: "enviar-crm"}`, `pendingInput` `null` y como único evento el `error` `missing_secret` con `nodeId` `enviar-crm`
- **AND** la API no ha abierto ninguna conexión

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

### Requirement: Tiempo máximo de un avance
Un avance SHALL pedir turnos `llm` y hacer intentos `http` solo durante sus primeros 90 segundos, medidos con el reloj de la API. Pasado ese plazo, un turno se resuelve como `{kind: "failed", costUsd: 0}` sin llamar al proveedor, y un intento como `{kind: "timeout"}` sin resolver ni conectar (los secretos se comprueban antes: ver «Orden de un intento» de `http-host`). Un intento empezado dentro del plazo termina, como mucho, al acabar el plazo. Un turno en curso no se corta: lo acota el adaptador (60 s por defecto).

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

### Requirement: Privacidad de los registros de conversaciones
La API SHALL no registrar las entradas del usuario, el contenido de los eventos, la transcripción, variables, valores de contacto, peticiones o resultados `llm` más allá de «Host de producción: registros de llm» de `flow-engine`, ni nada de una llamada `http` más allá de «Registros de la salida http» de `http-host`. De un avance puede registrar el `id` de la conversación, `flowId`, `version`, el estado final, el `code` y `nodeId` de un fallo, y los avisos de `http-host`.

#### Scenario: Datos personales fuera del registro
- **GIVEN** la salida de registro capturada, una conversación de `captacion-leads` con `contactId` `"c-1"` a la que se envía `{text: "Ana Pérez"}` y `{text: "ana@example.com"}`, y una de `faq-ia` cuyo proveedor responde con el texto `"MARCA-RESPUESTA"` y a la que se envía `{text: "MARCA-PREGUNTA"}`
- **WHEN** se leen sus transcripciones y se borran las dos conversaciones
- **THEN** la salida no contiene `Ana Pérez`, `ana@example.com`, `Encantado`, `MARCA-RESPUESTA` ni `MARCA-PREGUNTA`

### Requirement: Conformidad del host de conversaciones
La API SHALL pasar todos los casos de `HOST_CONFORMANCE_CASES` de `@franca/engine/conformance` con un arnés cuyas sesiones son las conversaciones de la API, cuyo `llm` es la capacidad de la API con el proveedor del caso como `principal` y cuyo `http` es la salida http de la API (`http-host`) con el resolutor, los destinos permitidos, los secretos y el registro del arnés. Sus servidores son locales y reales: la suite no sale a Internet ni necesita privilegios, en Linux y en macOS.

#### Scenario: Suite de conformidad
- **WHEN** se ejecutan contra la API y Postgres reales todos los casos de `HOST_CONFORMANCE_CASES`
- **THEN** todos devuelven `[]`
- **AND** el test falla si algún caso del catálogo no se ha ejecutado (un caso nuevo del motor entra solo)
