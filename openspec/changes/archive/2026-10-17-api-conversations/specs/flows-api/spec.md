## MODIFIED Requirements

### Requirement: Forma de los errores
Toda respuesta de error que genera la API SHALL tener un cuerpo JSON con exactamente `message` (texto en español para personas) y `error` (código estable en snake_case), más los campos que documente su código: `issues` y `warnings` en `invalid_flow`, `warnings` en `literal_credential` (solo los avisos `credential_header_literal`), `issues` en `flow_version_invalid` y `currentRevision` en `revision_mismatch` (de un flujo o de una conversación). El cliente decide por `error`, nunca por `message`.

#### Scenario: Flujo inexistente
- **WHEN** se hace `GET /flows/no-existe`
- **THEN** la respuesta es 404 y su cuerpo tiene exactamente las claves `message` y `error`, con `error` `flow_not_found`

#### Scenario: Ruta o método desconocidos
- **WHEN** se hace `GET /nada`, `PATCH /flows/hola` y `GET /flows/%FF` (una secuencia `%` que no se puede decodificar)
- **THEN** las tres responden 404 con exactamente `{message, error: "not_found"}`

#### Scenario: Error interno
- **GIVEN** un fallo inesperado al leer un flujo (provocado en el test)
- **WHEN** se hace `GET /flows/hola`
- **THEN** la respuesta es 500 con exactamente `{message: "error interno", error: "internal_error"}`, sin traza, SQL ni contenido del flujo

#### Scenario: Errores de las conversaciones
- **GIVEN** `hola` publicado y una conversación suya, terminada
- **WHEN** se hace `GET /conversations/00000000-0000-4000-8000-000000000000`, `POST /conversations` con `{flowId: 5}` y `POST /conversations/:conversationId/inputs` de la conversación con `{input: {text: "x"}}`
- **THEN** responden 404, 400 y 409 con exactamente `{message, error}` y `error` `conversation_not_found`, `invalid_request` y `conversation_not_active`

### Requirement: Privacidad de los registros
La API SHALL no registrar cuerpos de petición ni de respuesta, ni valores de cabeceras. De una petición registra como mucho método, ruta, código y duración; de un avance de conversación, además, solo lo que permite «Privacidad de los registros de conversaciones» de `conversations-api`. Así, una credencial pegada por error en un flujo o un dato personal escrito en una conversación no se copian a los registros.

#### Scenario: Token pegado en un flujo
- **GIVEN** la salida de registro de la API capturada
- **WHEN** se hace `POST /flows` con `captacion-leads` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"` (rechazado con `literal_credential`), después `POST /flows` y `GET /flows/captacion-leads` con `captacion-leads` sin cambios, y una petición con `Authorization: Bearer secreto-cliente`
- **THEN** la salida capturada no contiene `abc123`, `secreto-cliente` ni el texto de ningún nodo del flujo
