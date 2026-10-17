# flows-api Specification

## Purpose
Guardar y gestionar en la API de Franca los flujos validados con `@franca/spec`: un borrador editable sin pisar cambios y versiones publicadas inmutables que las conversaciones puedan fijar, con un contrato HTTP estable y expuesto solo en la máquina local mientras no haya autenticación.

Flujos de los escenarios: `captacion-leads` y `faq-ia` son los de `packages/spec/examples/`, y `hola` es `{"specVersion": "0.1", "id": "hola", "name": "Hola", "start": "fin", "nodes": [{"id": "fin", "type": "end"}]}`. Todas las peticiones de los escenarios llevan `Host: 127.0.0.1:3001`, no llevan `Origin` y, si tienen cuerpo, `Content-Type: application/json`, salvo que el escenario diga otra cosa.

## Requirements

### Requirement: Escucha solo en la máquina local
La API SHALL escuchar exactamente en la dirección de `HOST` y el puerto de `PORT` (por defecto 3001). Si `HOST` no está definida, escucha en `127.0.0.1`. Mientras no haya autenticación, `HOST` solo admite los textos exactos `127.0.0.1` y `::1` (no `localhost`, que puede resolver a una sola de las dos familias). Con cualquier otro valor, también vacío o con espacios, la API no arranca, termina con un código distinto de 0 y su mensaje nombra `HOST` y explica que falta autenticación para exponerla.

#### Scenario: Arranque por defecto
- **GIVEN** `DATABASE_URL` definida y `HOST` y `PORT` sin definir
- **WHEN** arranca la API
- **THEN** la dirección del socket que escucha es `127.0.0.1`, puerto 3001, y no hay otro socket a la escucha

#### Scenario: Dirección pública rechazada
- **WHEN** la API arranca por separado con `HOST` igual a `0.0.0.0`, `::`, `192.168.1.10`, `::ffff:127.0.0.1`, `localhost`, `""` y `" 127.0.0.1"`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `HOST`

#### Scenario: Loopback IPv6
- **WHEN** la API arranca con `HOST` igual a `::1`
- **THEN** la dirección del socket que escucha es `::1`, puerto 3001

### Requirement: Puerto de escucha
Si `PORT` está definida, SHALL ser un entero decimal de 0 a 65535, sin espacios, donde 0 elige un puerto libre. Con otro valor, también vacío, la API no arranca, termina con un código distinto de 0 y su mensaje nombra `PORT` sin repetir su valor.

#### Scenario: Puerto no válido
- **WHEN** la API arranca por separado con `PORT` igual a `abc`, `70000`, `""` y `" 3001"`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `PORT` sin repetir su valor

### Requirement: Configuración de la base de datos al arrancar
Sin `DATABASE_URL`, la API SHALL no arrancar: termina con un código distinto de 0 y su mensaje nombra la variable. Ni ese mensaje ni ningún otro de la API imprime el valor de `DATABASE_URL` ni credenciales (la línea de arranque sí muestra la dirección y el puerto en que escucha).

#### Scenario: Falta la variable
- **WHEN** la API arranca sin `DATABASE_URL`
- **THEN** termina con un código distinto de 0 y su mensaje contiene `DATABASE_URL`

#### Scenario: El valor no aparece al fallar la conexión
- **GIVEN** `DATABASE_URL` apunta a un puerto local sin servidor e incluye la contraseña `no-mostrar-1234`
- **WHEN** la API arranca y recibe `GET /flows`
- **THEN** ni la respuesta ni la salida de la API contienen `no-mostrar-1234`

### Requirement: Host local
Toda petición SHALL llevar una cabecera `Host` cuyo nombre, sin el puerto y sin distinguir mayúsculas, sea `localhost`, `127.0.0.1` o `[::1]`. Si no, la API responde 403 `forbidden_host` sin hacer nada más. Una petición HTTP/1.1 sin `Host` no llega a la API: Node la responde con su propio 400. Así, una página que use DNS rebinding para apuntar su dominio a la máquina local no puede usar la API.

#### Scenario: Host ajeno
- **WHEN** se hace `POST /flows` con el cuerpo `hola` y la cabecera `Host: evil.example:3001`
- **THEN** la respuesta es 403 con `{message, error: "forbidden_host"}`
- **AND** después `GET /flows/hola` con un `Host` local responde 404

#### Scenario: Nombres locales admitidos
- **WHEN** se hace `GET /flows` por separado con `Host` igual a `localhost:3001`, `LOCALHOST:3001`, `127.0.0.1:3001` y `[::1]:3001`
- **THEN** las cuatro responden 200

### Requirement: Sin acceso desde navegadores
Toda petición con cabecera `Origin`, con cualquier valor (también `null` o un origen local), SHALL responderse 403 `forbidden_origin` sin procesarla. Ninguna respuesta lleva cabeceras `Access-Control-Allow-*`. En v0 ningún navegador habla directamente con la API: lo harán, si hace falta, las features 7 y 8 con una lista explícita de orígenes.

#### Scenario: Escritura desde otra web
- **WHEN** se hace `POST /flows` con el cuerpo `hola` y la cabecera `Origin: https://evil.example`
- **THEN** la respuesta es 403 `forbidden_origin` y `GET /flows/hola` sin `Origin` responde 404

#### Scenario: Petición previa de CORS
- **WHEN** se hace `OPTIONS /flows` con `Origin: http://localhost:3000` y `Access-Control-Request-Method: POST`
- **THEN** la respuesta es 403 `forbidden_origin` y no tiene ninguna cabecera `Access-Control-Allow-*`

#### Scenario: Peticiones sin Origin
- **WHEN** se hace `GET /flows` sin cabecera `Origin`
- **THEN** responde 200 y no tiene ninguna cabecera `Access-Control-Allow-*`

### Requirement: Sin autenticación en v0
Ningún endpoint SHALL pedir credenciales ni asociar los flujos a un propietario: todos los flujos son de la instalación. La API ignora una cabecera `Authorization` en la petición.

#### Scenario: Credenciales ignoradas
- **GIVEN** el flujo `hola` creado
- **WHEN** se hace `GET /flows/hola` sin `Authorization` y con `Authorization: Bearer cualquiera`
- **THEN** ambas responden 200 con el mismo cuerpo

### Requirement: Forma de los errores
Toda respuesta de error que genera la API SHALL tener un cuerpo JSON con exactamente `message` (texto en español para personas) y `error` (código estable en snake_case), más los campos que documente su código: `issues` y `warnings` en `invalid_flow`, `warnings` en `literal_credential` (solo los avisos `credential_header_literal`), y `currentRevision` en `revision_mismatch`. El cliente decide por `error`, nunca por `message`.

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

### Requirement: Tipo de contenido del cuerpo
Toda petición con cuerpo SHALL llevar `Content-Type: application/json`, sin `charset` o con `charset=utf-8`, y no estar comprimida (`Content-Encoding` ausente o `identity`). Si no, responde 415 `unsupported_media_type` sin guardar nada.

#### Scenario: Texto plano
- **WHEN** se hace `POST /flows` con el texto JSON de `hola` y `Content-Type: text/plain`
- **THEN** la respuesta es 415 `unsupported_media_type` y `hola` no existe

#### Scenario: Cuerpo comprimido
- **WHEN** se hace `POST /flows/validate` con `hola` comprimido con gzip y `Content-Encoding: gzip`
- **THEN** la respuesta es 415 `unsupported_media_type`

#### Scenario: Charset explícito
- **WHEN** se hace `POST /flows` con `hola` y `Content-Type: application/json; charset=utf-8`
- **THEN** la respuesta es 201

### Requirement: Tamaño máximo del cuerpo
Un cuerpo de más de 1 048 576 bytes SHALL responderse 413 `payload_too_large` en cualquier endpoint, sin validarlo ni guardarlo.

#### Scenario: Justo en el límite y por encima
- **GIVEN** el texto JSON de `hola` completado con espacios al final hasta 1 048 576 bytes, y el mismo con un espacio más
- **WHEN** se envía cada uno con `POST /flows` (borrando `hola` entre medias)
- **THEN** el primero responde 201 y el segundo 413 `payload_too_large`, y tras el segundo `hola` no existe

#### Scenario: También al validar
- **WHEN** se hace `POST /flows/validate` con un cuerpo de 1 048 577 bytes
- **THEN** la respuesta es 413 `payload_too_large`

#### Scenario: Cuerpo que no llega entero
- **GIVEN** una petición `POST /flows` que declara `Content-Length: 1048577`, envía 7 bytes y no cierra la conexión
- **WHEN** pasa el tiempo máximo para recibir la petición entera (30 segundos; los e2e lo reducen)
- **THEN** el servidor responde 408 y cierra la conexión, sin retenerla los 300 segundos que Node permite por defecto

### Requirement: Cuerpo JSON
`POST /flows/validate`, `POST /flows` y `PUT /flows/:flowId` SHALL exigir un cuerpo. Un cuerpo vacío o que no es JSON bien formado responde 400 `invalid_json`, también al validar, porque no es un flujo. En cualquier otro endpoint, un cuerpo no vacío que no es JSON bien formado (o no es UTF-8 válido) también responde 400 `invalid_json`. Un JSON bien formado cuyo valor no es un objeto (array, texto, número, booleano o `null`) es un flujo inválido.

#### Scenario: JSON roto
- **WHEN** se hace `POST /flows/validate` y `POST /flows` con el cuerpo `{"id":`
- **THEN** ambas responden 400 `invalid_json`

#### Scenario: Cuerpo vacío
- **WHEN** se hace `POST /flows` sin cuerpo y con `Content-Type: application/json`
- **THEN** la respuesta es 400 `invalid_json`

#### Scenario: Publicar con un cuerpo roto
- **GIVEN** `hola` creado
- **WHEN** se hace `POST /flows/hola/versions` con el cuerpo `{"x":`
- **THEN** la respuesta es 400 `invalid_json` y `hola` no tiene versiones

#### Scenario: JSON que no es un objeto
- **WHEN** se hace `POST /flows/validate` con `[]` y `POST /flows` con `"hola"`
- **THEN** la primera responde 200 con `valid` `false` y un issue de forma con `path` `""`, y la segunda 400 `invalid_flow`

### Requirement: Validar sin guardar
`POST /flows/validate` SHALL responder 200 con exactamente `{valid, issues, warnings}`, iguales a los de `validateFlow` sobre la forma JSON del cuerpo, sea el flujo válido o no. No guarda nada y no necesita la base de datos.

#### Scenario: Flujo válido
- **WHEN** se hace `POST /flows/validate` con `captacion-leads`
- **THEN** la respuesta es 200 con exactamente `{valid: true, issues: [], warnings: []}`

#### Scenario: Flujo roto
- **WHEN** se hace `POST /flows/validate` con `captacion-leads` y la propiedad `color: "rojo"` añadida al nodo `bienvenida`
- **THEN** la respuesta es 200 con `{valid: false, issues: [{layer: "shape", path: "/nodes/0", nodeId: "bienvenida", message: "propiedad no permitida 'color'"}], warnings: []}`

#### Scenario: Flujo válido con avisos
- **WHEN** se hace `POST /flows/validate` con `captacion-leads` y la `url` de `enviar-crm` cambiada a `"https://crm.example.com{{segmento}}/api/leads"`
- **THEN** la respuesta es 200 con `valid` `true` y un aviso `url_template_in_origin` en `/nodes/6/request/url`

#### Scenario: No guarda
- **WHEN** se hace `POST /flows/validate` con `hola` y después `GET /flows/hola`
- **THEN** la segunda responde 404

#### Scenario: Flujo inválido de un mega
- **WHEN** se hace `POST /flows/validate` con `captacion-leads` y `nodes` sustituido por objetos `{}` hasta casi 1 048 576 bytes
- **THEN** la respuesta es 200 en menos de 5 segundos, con `valid` `false` e `issues` de 101 entradas (el tope de `flow-validation`)

### Requirement: Lo validado es lo guardado
La API SHALL validar, guardar y devolver la forma JSON del cuerpo (el resultado de `JSON.stringify` sobre lo que da `JSON.parse` del texto), de modo que lo validado es exactamente lo guardado. Un número que JSON no puede representar, como `1e400`, queda como `null`. Un flujo de más de 1000 niveles de anidamiento es inválido y nunca da un 500.

#### Scenario: Número no representable en un default
- **GIVEN** `captacion-leads` escrito como texto con la variable `{"name": "limite", "type": "number", "default": 1e400}` añadida
- **WHEN** se hace `POST /flows` y después `GET /flows/captacion-leads`
- **THEN** la primera responde 201 y en la segunda esa variable tiene `default` `null`

#### Scenario: Número no representable donde se exige un número
- **WHEN** se hace `POST /flows` con `captacion-leads` escrito como texto con `"position": {"x": 1e400, "y": 0}` en `bienvenida`
- **THEN** la respuesta es 400 `invalid_flow` con el issue `{layer: "shape", path: "/nodes/0/position/x", nodeId: "bienvenida", message: "debe ser de tipo number"}`

#### Scenario: Anidamiento extremo
- **GIVEN** `captacion-leads` con una variable `j` de tipo `json` cuyo `default` tiene 100000 niveles de arrays anidados (unos 200 kB)
- **WHEN** se hace `POST /flows` y `POST /flows/validate` con él
- **THEN** la primera responde 400 `invalid_flow` y la segunda 200 con `valid` `false`, ambas con el único issue `{layer: "shape", path: "", message: "el flujo supera la profundidad máxima de anidamiento (1000)"}`

### Requirement: Orden de las propiedades
El flujo que devuelve la API, borrador o versión, SHALL ser la forma JSON guardada, propiedad a propiedad y en el mismo orden en que la enumera esa forma (claves que son índices primero y en orden numérico, y después las demás en el orden en que se escribieron). Las claves `__proto__` y `constructor` son claves normales.

#### Scenario: Orden de las cabeceras
- **GIVEN** `captacion-leads` con las cabeceras de `enviar-crm` cambiadas a `{"X-B": "1", "X-A": "2", "Authorization": {"secret": "CRM_TOKEN"}}`
- **WHEN** se hace `POST /flows`, después `POST /flows/captacion-leads/versions`, y se leen el borrador y la versión 1
- **THEN** en las tres respuestas las cabeceras de `enviar-crm` aparecen en el texto JSON en el orden `X-B`, `X-A`, `Authorization`

#### Scenario: Claves con nombre de Object en el body
- **GIVEN** `captacion-leads` escrito como texto con el `body` de `enviar-crm` cambiado a `{"__proto__": "{{nombre}}", "b": 1, "2": 2}`
- **WHEN** se hace `POST /flows` y después `GET /flows/captacion-leads`
- **THEN** el texto JSON del `body` devuelto es `{"2":2,"__proto__":"{{nombre}}","b":1}`

### Requirement: Identidad de un flujo
Un flujo SHALL identificarse por el `id` de su JSON, único en la instalación (también frente a los flujos borrados, cuyo `id` queda reservado), y la API no expone otro identificador. Una ruta cuyo `:flowId` no cumple el patrón de `id` de la spec (`^[a-z][a-z0-9_-]{0,63}$`) responde 404 `flow_not_found`.

#### Scenario: Identificador con mayúsculas
- **WHEN** se hace `GET /flows/Captacion-Leads`
- **THEN** la respuesta es 404 `flow_not_found`

#### Scenario: Ruta específica antes que el parámetro
- **GIVEN** que existe un flujo con `id` `validate`
- **WHEN** se hace `POST /flows/validate` con `hola`
- **THEN** responde 200 con el veredicto de validación y no toca el flujo `validate`

### Requirement: Crear un flujo
`POST /flows` SHALL guardar un flujo válido como borrador con `revision` 1 y sin versiones, y responder 201 con el recurso flujo, `Location: /flows/<id>` y `ETag: "1"`. Un flujo inválido responde 400 `invalid_flow` con `issues` y `warnings` y no se guarda.

#### Scenario: Crear captacion-leads
- **WHEN** se hace `POST /flows` con `captacion-leads`
- **THEN** la respuesta es 201 con `Location: /flows/captacion-leads`, `ETag: "1"` y el recurso con `id` `captacion-leads`, `name` `"Captación de leads"`, `revision` 1, `latestVersion` `null`, `unpublishedChanges` `true`, `createdAt` igual a `updatedAt`, `flow` igual al enviado y `warnings` `[]`

#### Scenario: Flujo inválido
- **WHEN** se hace `POST /flows` con `captacion-leads` y `color: "rojo"` en `bienvenida`
- **THEN** la respuesta es 400 con exactamente `{message, error: "invalid_flow", issues: [{layer: "shape", path: "/nodes/0", nodeId: "bienvenida", message: "propiedad no permitida 'color'"}], warnings: []}` y `GET /flows/captacion-leads` responde 404

#### Scenario: Se guarda con avisos
- **WHEN** se hace `POST /flows` con `captacion-leads` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer {{segmento}}"`
- **THEN** la respuesta es 201 y `warnings` contiene el aviso `credential_header_not_secret` en `/nodes/6/request/headers/Authorization`

### Requirement: Id en uso al crear
Si el `id` del flujo ya existe, `POST /flows` SHALL responder 409 `flow_already_exists`, y si perteneció a un flujo borrado, 409 `flow_id_reserved`. Los dos se comprueban después de la validez y de las credenciales, y el existente no cambia.

#### Scenario: Id repetido
- **GIVEN** `captacion-leads` creado
- **WHEN** se hace `POST /flows` con `captacion-leads` cambiando `name` a `"Otro"`
- **THEN** la respuesta es 409 `flow_already_exists` y el borrador sigue con `name` `"Captación de leads"` y `revision` 1

#### Scenario: Inválido e id repetido
- **GIVEN** `captacion-leads` creado
- **WHEN** se hace `POST /flows` con `captacion-leads` y `color: "rojo"` en `bienvenida`
- **THEN** la respuesta es 400 `invalid_flow`

### Requirement: Credenciales escritas en el flujo
Un flujo válido con algún aviso `credential_header_literal` en su lista completa de avisos SHALL rechazarse al crear, actualizar y publicar con 400 `literal_credential` y el cuerpo `{message, error, warnings}`, donde `warnings` son solo los `credential_header_literal`, sin guardar ni publicar nada y sin repetir el valor de la cabecera en la respuesta. `POST /flows/validate` no rechaza: responde 200 con el aviso.

#### Scenario: Token pegado al crear
- **WHEN** se hace `POST /flows` con `captacion-leads` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"`
- **THEN** la respuesta es 400 con exactamente las claves `message`, `error` (`literal_credential`) y `warnings`, que contiene el aviso `credential_header_literal` en `/nodes/6/request/headers/Authorization`
- **AND** el texto de la respuesta no contiene `abc123` y `GET /flows/captacion-leads` responde 404

#### Scenario: Token pegado al actualizar
- **GIVEN** `captacion-leads` creado (`revision` 1)
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y la cabecera `X-Api-Key` añadida a `enviar-crm` con el valor `"k-123"`
- **THEN** la respuesta es 400 `literal_credential` y el borrador sigue en `revision` 1 sin cambios

#### Scenario: Publicar un borrador con un token pegado
- **GIVEN** el flujo `captacion-leads` con un borrador escrito directamente en la base de datos cuya cabecera `Authorization` de `enviar-crm` es `"Bearer abc123"`
- **WHEN** se publica
- **THEN** la respuesta es 400 `literal_credential` y `GET /flows/captacion-leads/versions` tiene `total` 0

#### Scenario: Credencial escrita después del aviso 100
- **WHEN** se hace `POST /flows` con un flujo válido de 150 nodos `http` encadenados cuya `url` es `"https://{{segmento}}.example.com/x"`, y en el último la cabecera `Authorization` `"Bearer abc123"`
- **THEN** la respuesta es 400 `literal_credential` y su `warnings` tiene un único aviso, el `credential_header_literal` del último nodo

#### Scenario: Validar no rechaza
- **WHEN** se hace `POST /flows/validate` con `captacion-leads` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"`
- **THEN** la respuesta es 200 con `valid` `true` y el aviso `credential_header_literal`

#### Scenario: Inválido y con una credencial escrita
- **WHEN** se hace `POST /flows` con `captacion-leads`, `color: "rojo"` en `bienvenida` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"`
- **THEN** la respuesta es 400 `invalid_flow`

### Requirement: Avisos en las respuestas
Toda lista `warnings` de una respuesta (`validate`, recurso flujo, recurso versión, `invalid_flow` y `literal_credential`) SHALL pasar por `capWarnings` de `@franca/spec`: como mucho 100 avisos y, si hay más, el aviso final `too_many_warnings`. Las decisiones de la API (como `literal_credential`) usan siempre la lista completa.

#### Scenario: Muchos avisos al validar
- **WHEN** se hace `POST /flows/validate` con un flujo válido de 150 nodos `http` encadenados cuya `url` es `"https://{{segmento}}.example.com/x"`
- **THEN** la respuesta es 200 con `valid` `true` y `warnings` de 101 entradas, la última `{code: "too_many_warnings", path: "", message: "hay más avisos: solo se muestran los 100 primeros"}`

### Requirement: Recurso flujo
El recurso flujo SHALL ser `{id, name, revision, latestVersion, unpublishedChanges, createdAt, updatedAt, flow, warnings}`. `name` es el del borrador; `latestVersion` es el número de la última versión o `null`; `unpublishedChanges` es `true` si no hay versiones o si el borrador difiere de la última; las fechas son ISO 8601 en UTC; `flow` es el borrador, y `warnings`, los que da `validateFlow` sobre él al responder.

#### Scenario: Tras publicar
- **GIVEN** `captacion-leads` creado y publicado una vez
- **WHEN** se hace `GET /flows/captacion-leads`
- **THEN** `latestVersion` es 1, `unpublishedChanges` es `false` y `revision` sigue siendo 1

#### Scenario: Cambios sin publicar
- **GIVEN** `captacion-leads` creado, publicado y después actualizado con `name` `"Leads v2"`
- **WHEN** se hace `GET /flows/captacion-leads`
- **THEN** `name` es `"Leads v2"`, `revision` 2, `latestVersion` 1 y `unpublishedChanges` `true`

### Requirement: Obtener un flujo
`GET /flows/:flowId` SHALL responder 200 con el recurso flujo y la cabecera `ETag` con su revisión entre comillas. Si el flujo no existe o está borrado, responde 404 `flow_not_found`. La API no hace lecturas condicionales: ignora `If-None-Match` e `If-Modified-Since` y nunca responde 304 (el `ETag` identifica la revisión del borrador, no la respuesta entera, que también cambia al publicar).

#### Scenario: Leer un flujo
- **GIVEN** `captacion-leads` creado y actualizado dos veces
- **WHEN** se hace `GET /flows/captacion-leads`
- **THEN** la respuesta es 200 con `ETag: "3"` y `revision` 3

#### Scenario: Lectura condicional ignorada
- **GIVEN** `captacion-leads` creado y publicado después de leerlo con `ETag: "1"`
- **WHEN** se hace `GET /flows/captacion-leads` con `If-None-Match: "1"`
- **THEN** la respuesta es 200 con el recurso completo y `latestVersion` 1

### Requirement: Listar flujos
`GET /flows` SHALL responder 200 con `{items, total, limit, offset}`, donde cada item es el recurso flujo sin `flow` ni `warnings`. Los flujos borrados no aparecen. El orden es `updatedAt` descendente y, a igualdad, `id` ascendente por código de carácter. `limit` es un entero de 1 a 100 (20 por defecto) y `offset`, uno mayor o igual que 0 (0 por defecto). `published=true` deja solo los flujos con alguna versión, y `published=false`, los que no tienen ninguna.

#### Scenario: Sin flujos
- **WHEN** se hace `GET /flows` sin flujos guardados
- **THEN** la respuesta es 200 con `{items: [], total: 0, limit: 20, offset: 0}`

#### Scenario: Orden y páginas
- **GIVEN** `hola`, `captacion-leads` y `faq-ia` creados en ese orden y en instantes distintos
- **WHEN** se hace `GET /flows?limit=2` y `GET /flows?limit=2&offset=2`
- **THEN** la primera da los `id` `faq-ia` y `captacion-leads` con `total` 3, y la segunda da `hola` con `total` 3, `limit` 2 y `offset` 2

#### Scenario: Actualizar sube un flujo al principio
- **GIVEN** los tres flujos del escenario anterior
- **WHEN** se actualiza `hola` con un `name` distinto y se hace `GET /flows`
- **THEN** el primer item es `hola`

#### Scenario: Solo publicados
- **GIVEN** `hola` y `captacion-leads` creados, y solo `captacion-leads` publicado
- **WHEN** se hace `GET /flows?published=true` y `GET /flows?published=false`
- **THEN** la primera da solo `captacion-leads` (`total` 1) y la segunda solo `hola` (`total` 1)

### Requirement: Parámetros de listado
En `GET /flows` y `GET /flows/:flowId/versions`, un `limit` u `offset` que no sea un entero decimal dentro de su rango (`limit` de 1 a 100; `offset` de 0 a 2147483647), un parámetro repetido, o un `published` distinto de `true` o `false`, SHALL responderse 400 `invalid_query`. Los parámetros desconocidos se ignoran.

#### Scenario: Valores fuera de rango o mal escritos
- **WHEN** se hace por separado `GET /flows` con `limit=0`, `limit=101`, `limit=abc`, `limit=2.5`, `offset=-1`, `offset=2147483648`, `limit=1&limit=2` y `published=si`
- **THEN** las ocho responden 400 `invalid_query`

#### Scenario: Límites admitidos y parámetros desconocidos
- **WHEN** se hace `GET /flows?limit=1`, `GET /flows?limit=100`, `GET /flows?offset=2147483647` y `GET /flows?orden=nombre`
- **THEN** las cuatro responden 200

### Requirement: Actualizar el borrador
`PUT /flows/:flowId` SHALL sustituir el borrador por el flujo del cuerpo, sumar 1 a `revision`, actualizar `updatedAt` y responder 200 con el recurso flujo y el `ETag` nuevo, sin tocar las versiones. Si el `id` del cuerpo no es el de la ruta, responde 400 `flow_id_mismatch` y no guarda nada. Para cambiar el `id`, hay que crear otro flujo.

#### Scenario: Cambiar el nombre
- **GIVEN** `captacion-leads` creado (`revision` 1)
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y el flujo con `name` `"Leads v2"`
- **THEN** la respuesta es 200 con `ETag: "2"`, `revision` 2, `name` `"Leads v2"` y `updatedAt` posterior a `createdAt`

#### Scenario: Cambiar el id
- **GIVEN** `captacion-leads` creado
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y el flujo con `id` `"captacion-leads-v2"`
- **THEN** la respuesta es 400 `flow_id_mismatch`, el borrador sigue en `revision` 1 y `GET /flows/captacion-leads-v2` responde 404

#### Scenario: Actualizar un flujo inexistente
- **WHEN** se hace `PUT /flows/hola` con `If-Match: "1"` y `hola` sin haberlo creado
- **THEN** la respuesta es 404 `flow_not_found` y `hola` no se crea

#### Scenario: Borrador inválido
- **GIVEN** `captacion-leads` creado
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y `color: "rojo"` en `bienvenida`
- **THEN** la respuesta es 400 `invalid_flow` con `issues` y `warnings`, y el borrador sigue en `revision` 1 sin cambios

### Requirement: Revisión esperada al actualizar
`PUT /flows/:flowId` SHALL exigir `If-Match`. Si falta, responde 428 `precondition_required`. Si no es `*` ni contiene el ETag fuerte de la revisión actual, responde 412 `revision_mismatch` con `currentRevision` y el `ETag` actual. En ninguno de los dos casos guarda nada. `If-Match: *` actualiza sea cual sea la revisión.

#### Scenario: Sin If-Match
- **GIVEN** `captacion-leads` creado
- **WHEN** se hace `PUT /flows/captacion-leads` sin `If-Match`
- **THEN** la respuesta es 428 `precondition_required` y `revision` sigue en 1

#### Scenario: Revisión desfasada
- **GIVEN** `captacion-leads` actualizado una vez (`revision` 2)
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"`
- **THEN** la respuesta es 412 con `{message, error: "revision_mismatch", currentRevision: 2}` y `ETag: "2"`, y el borrador no cambia

#### Scenario: Etiqueta débil o sin comillas
- **GIVEN** `captacion-leads` creado (`revision` 1)
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: W/"1"` y, por separado, con `If-Match: 1`
- **THEN** ambas responden 412 `revision_mismatch`

#### Scenario: Sobrescribir explícitamente
- **GIVEN** `captacion-leads` en `revision` 4
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: *` y `name` `"Importado"`
- **THEN** la respuesta es 200 con `revision` 5

#### Scenario: Lista de etiquetas
- **GIVEN** `captacion-leads` en `revision` 2
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1", "2"`
- **THEN** la respuesta es 200 con `revision` 3

### Requirement: Actualizaciones simultáneas
De dos actualizaciones del mismo borrador con el mismo `If-Match`, SHALL aplicarse como mucho una: la otra responde 412 `revision_mismatch`. El borrador final es exactamente el de la que respondió 200.

#### Scenario: Dos pestañas guardan a la vez
- **GIVEN** `captacion-leads` en `revision` 1
- **WHEN** se envían a la vez dos `PUT /flows/captacion-leads` con `If-Match: "1"`, una con `name` `"A"` y otra con `name` `"B"`
- **THEN** una responde 200 con `revision` 2 y la otra 412, y `GET /flows/captacion-leads` da `revision` 2 y el `name` de la que respondió 200

### Requirement: Orden de comprobación al actualizar
`PUT /flows/:flowId` SHALL responder con la primera comprobación que falla, en este orden: 413, 415, 400 `invalid_json`, 404 `flow_not_found`, 428, 412, 400 `invalid_flow`, 400 `literal_credential` y 400 `flow_id_mismatch`. Las precondiciones van antes que el contenido (RFC 9110, §13.2.1).

#### Scenario: Desfasado e inválido
- **GIVEN** `captacion-leads` en `revision` 2
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y `color: "rojo"` en `bienvenida`
- **THEN** la respuesta es 412 `revision_mismatch`

#### Scenario: Inexistente y sin If-Match
- **WHEN** se hace `PUT /flows/hola` sin `If-Match` y sin haber creado `hola`
- **THEN** la respuesta es 404 `flow_not_found`

#### Scenario: Inválido y con otro id
- **GIVEN** `captacion-leads` en `revision` 1
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y un flujo con `id` `"otro"` y `color: "rojo"` en `bienvenida`
- **THEN** la respuesta es 400 `invalid_flow`

### Requirement: Guardar sin cambios
Un `PUT` que pasa todas las comprobaciones con un flujo cuya forma JSON tiene el mismo texto que el borrador SHALL responder 200 con el recurso, sin cambiar `revision` ni `updatedAt`.

#### Scenario: Autoguardado repetido
- **GIVEN** `captacion-leads` en `revision` 1
- **WHEN** se hace `PUT /flows/captacion-leads` con `If-Match: "1"` y el mismo flujo con que se creó
- **THEN** la respuesta es 200 con `revision` 1, `ETag: "1"` y el mismo `updatedAt`

#### Scenario: Mismo contenido en otro orden
- **GIVEN** `hola` en `revision` 1
- **WHEN** se hace `PUT /flows/hola` con `If-Match: "1"` y `hola` con sus propiedades escritas en otro orden (`name` antes que `id`)
- **THEN** la respuesta es 200 con `revision` 2 (el texto de la forma JSON es distinto)

### Requirement: Publicar una versión
`POST /flows/:flowId/versions` SHALL crear la versión siguiente (1 si no hay) con una copia del borrador y su `publishedAt`, y responder 201 con el recurso versión y `Location: /flows/<id>/versions/<n>`. No cambia el borrador, su `revision` ni su `updatedAt`. Admite peticiones sin cuerpo; si lo trae, se aplican las reglas comunes de cuerpo (413, 415 e `invalid_json`) y su contenido se ignora.

#### Scenario: Primera versión
- **GIVEN** `captacion-leads` creado
- **WHEN** se hace `POST /flows/captacion-leads/versions` sin cuerpo
- **THEN** la respuesta es 201 con `Location: /flows/captacion-leads/versions/1` y `{flowId: "captacion-leads", version: 1, name: "Captación de leads", publishedAt, flow, warnings: []}`, con `flow` igual al borrador

#### Scenario: Segunda versión tras un cambio
- **GIVEN** `captacion-leads` publicado una vez y actualizado con `name` `"Leads v2"`
- **WHEN** se publica
- **THEN** la respuesta es 201 con `version` 2 y `name` `"Leads v2"`

#### Scenario: Publicar un flujo inexistente
- **WHEN** se hace `POST /flows/no-existe/versions`
- **THEN** la respuesta es 404 `flow_not_found`

### Requirement: Orden de comprobación al publicar
`POST /flows/:flowId/versions` SHALL responder con la primera comprobación que falla, en este orden: 413, 415, 400 `invalid_json`, 404 `flow_not_found`, 412, 400 `invalid_flow` y 400 `literal_credential`; si todas pasan, 200 sin cambios o 201 con la versión nueva.

#### Scenario: Desfasado e inválido al publicar
- **GIVEN** el flujo `hola` en `revision` 2 con un borrador escrito directamente en la base de datos cuyo `start` es `"no-existe"`
- **WHEN** se publica con `If-Match: "1"`
- **THEN** la respuesta es 412 `revision_mismatch` y no hay versiones

### Requirement: Publicar sin cambios
Si el borrador tiene el mismo texto de forma JSON que la última versión, publicar SHALL responder 200 con esa versión, sin crear otra.

#### Scenario: Doble clic en publicar
- **GIVEN** `captacion-leads` publicado una vez y sin cambios después
- **WHEN** se publica de nuevo
- **THEN** la respuesta es 200 con `version` 1 y `GET /flows/captacion-leads/versions` tiene `total` 1

#### Scenario: Volver al contenido de una versión anterior
- **GIVEN** `hola` publicado (versión 1), actualizado con `name` `"Hola 2"` y publicado (versión 2), y actualizado otra vez con `name` `"Hola"`
- **WHEN** se publica
- **THEN** la respuesta es 201 con `version` 3 (solo se compara con la última versión)

### Requirement: Revisión esperada al publicar o borrar
En `POST /flows/:flowId/versions` y `DELETE /flows/:flowId`, `If-Match` SHALL ser opcional. Si se envía y no es `*` ni contiene el ETag de la revisión actual del borrador, responde 412 `revision_mismatch` con `currentRevision` y no publica ni borra.

#### Scenario: Publicar lo que se estaba viendo
- **GIVEN** `captacion-leads` en `revision` 2
- **WHEN** se publica con `If-Match: "1"`
- **THEN** la respuesta es 412 `revision_mismatch` con `currentRevision` 2 y no hay versiones

#### Scenario: Borrar con la revisión al día
- **GIVEN** `captacion-leads` en `revision` 2
- **WHEN** se hace `DELETE /flows/captacion-leads` con `If-Match: "2"`
- **THEN** la respuesta es 204

### Requirement: Publicar revalida el borrador
Publicar SHALL validar el borrador con el `validateFlow` vigente. Si no es válido, responde 400 `invalid_flow` con `issues` y `warnings` y no crea ninguna versión; si es válido pero tiene una credencial escrita, 400 `literal_credential`. Así, toda versión fue válida al publicarse, aunque el borrador se guardara con un validador anterior.

#### Scenario: Borrador que dejó de ser válido
- **GIVEN** el flujo `hola` con un borrador escrito directamente en la base de datos cuyo `start` es `"no-existe"`, como lo habría dejado un validador anterior
- **WHEN** se publica
- **THEN** la respuesta es 400 `invalid_flow` con, entre sus `issues`, el `semantic` de `/start`, y `GET /flows/hola/versions` tiene `total` 0

### Requirement: Publicaciones simultáneas
Dos publicaciones simultáneas del mismo borrador SHALL crear una sola versión: una responde 201 y la otra 200 con la misma versión. Los números de versión de un flujo son consecutivos desde 1, sin huecos ni repetidos.

#### Scenario: Dos publicaciones a la vez
- **GIVEN** `captacion-leads` sin versiones
- **WHEN** se envían a la vez dos `POST /flows/captacion-leads/versions`
- **THEN** una responde 201 y la otra 200, ambas con `version` 1, y `GET /flows/captacion-leads/versions` tiene `total` 1

### Requirement: Versiones inmutables
Una versión SHALL quedar igual para siempre: ningún endpoint la modifica ni la borra, y borrar su flujo la conserva en la base de datos (para que la feature 6 pueda terminar las sesiones fijadas a ella). El recurso versión es `{flowId, version, name, publishedAt, flow, warnings}`, donde `flow` es la copia publicada y `warnings` lo que da `validateFlow` sobre ella al responder.

#### Scenario: Editar el borrador no cambia la versión
- **GIVEN** `captacion-leads` publicado (versión 1) y después actualizado con `name` `"Leads v2"`
- **WHEN** se hace `GET /flows/captacion-leads/versions/1`
- **THEN** `name` y `flow.name` son `"Captación de leads"`

#### Scenario: Sin rutas para cambiar una versión
- **GIVEN** `captacion-leads` publicado
- **WHEN** se hace `PUT /flows/captacion-leads/versions/1` con el flujo y `DELETE /flows/captacion-leads/versions/1`
- **THEN** ambas responden 404 `not_found` y la versión 1 no cambia

### Requirement: Leer versiones
`GET /flows/:flowId/versions` SHALL responder 200 con `{items, total, limit, offset}`, de la versión más nueva a la más antigua, con items `{flowId, version, name, publishedAt}` y los mismos `limit` y `offset` que el listado de flujos. Un flujo inexistente o borrado da 404 `flow_not_found`.

#### Scenario: Historial
- **GIVEN** `hola` con tres versiones
- **WHEN** se hace `GET /flows/hola/versions?limit=2`
- **THEN** los items tienen `version` 3 y 2, en ese orden, con `total` 3

#### Scenario: Flujo sin versiones
- **GIVEN** `hola` creado sin publicar
- **WHEN** se hace `GET /flows/hola/versions`
- **THEN** la respuesta es 200 con `{items: [], total: 0, limit: 20, offset: 0}`

### Requirement: Leer una versión
`GET /flows/:flowId/versions/:version` SHALL responder 200 con el recurso versión. Un flujo inexistente o borrado da 404 `flow_not_found`. Una versión inexistente, o un `:version` que no es un entero positivo en decimal sin ceros a la izquierda de como mucho 2147483647, da 404 `version_not_found`.

#### Scenario: Versión que no existe
- **GIVEN** `hola` con una versión
- **WHEN** se hace por separado `GET /flows/hola/versions/2`, `/versions/0`, `/versions/01`, `/versions/latest`, `/versions/2147483648` y `GET /flows/no-existe/versions/1`
- **THEN** las cinco primeras responden 404 `version_not_found` y la última 404 `flow_not_found`

### Requirement: Borrar un flujo
`DELETE /flows/:flowId` SHALL borrar el flujo de forma lógica y responder 204 sin cuerpo: desde entonces no aparece en `GET /flows` y todos sus endpoints responden 404 `flow_not_found`, pero su `id` queda reservado para siempre (crear otro con ese `id` responde 409 `flow_id_reserved`), su numeración de versiones nunca se reinicia y sus versiones publicadas se conservan sin cambios en la base de datos. Si no existe o ya está borrado, responde 404 `flow_not_found`.

#### Scenario: Borrar y volver a crear
- **GIVEN** `hola` con dos versiones
- **WHEN** se hace `DELETE /flows/hola`, después `GET /flows/hola`, `GET /flows/hola/versions/1` y `POST /flows` con `hola`
- **THEN** responden 204, 404 `flow_not_found`, 404 `flow_not_found` y 409 `flow_id_reserved`

#### Scenario: Las versiones se conservan
- **GIVEN** `hola` con dos versiones
- **WHEN** se hace `DELETE /flows/hola`
- **THEN** la base de datos conserva las versiones 1 y 2 de `hola` con el mismo `name`, `flow` y `publishedAt` que tenían

#### Scenario: Fuera del listado
- **GIVEN** `hola` y `captacion-leads` creados
- **WHEN** se borra `hola` y se hace `GET /flows`
- **THEN** la respuesta solo tiene `captacion-leads`, con `total` 1

#### Scenario: Borrar un flujo inexistente
- **WHEN** se hace `DELETE /flows/no-existe`
- **THEN** la respuesta es 404 `flow_not_found`

#### Scenario: Borrar dos veces
- **GIVEN** `hola` borrado
- **WHEN** se hace `DELETE /flows/hola`, `PUT /flows/hola` con `If-Match: *` y `POST /flows/hola/versions`
- **THEN** las tres responden 404 `flow_not_found`

### Requirement: Base de datos no disponible
Si la base de datos no responde (no acepta conexiones por el motivo que sea, las acepta y no contesta, las corta a mitad de una consulta o una consulta no termina: Postgres la corta a los 3,5 segundos y el cliente deja de esperar a los 4), los endpoints que leen o escriben flujos SHALL responder 503 `database_unavailable` en menos de 10 segundos, sin datos de conexión en respuesta ni registros. `POST /flows/validate` responde con normalidad.

#### Scenario: Postgres parado
- **GIVEN** la API arrancada con `DATABASE_URL` apuntando a un puerto local sin servidor
- **WHEN** se hace `GET /flows`, `POST /flows` con `hola` y `POST /flows/validate` con `hola`
- **THEN** las dos primeras responden 503 `database_unavailable` y la tercera 200 con `valid` `true`

#### Scenario: Postgres mudo
- **GIVEN** la API arrancada con `DATABASE_URL` apuntando a un servidor local que acepta conexiones y nunca contesta
- **WHEN** se hace `GET /flows`, `POST /flows` con `hola` y `PUT /flows/hola` con `If-Match: *` y `hola`
- **THEN** las tres responden 503 `database_unavailable`, cada una en menos de 10 segundos

#### Scenario: Bloqueo que no se suelta
- **GIVEN** `hola` creado y otra conexión a la base con una transacción abierta que tiene bloqueada su fila (`SELECT … FOR UPDATE`) y no termina
- **WHEN** se hace `PUT /flows/hola` con `If-Match: *` y `hola`
- **THEN** la respuesta es 503 `database_unavailable` en menos de 10 segundos

#### Scenario: Tabla de flujos retenida
- **GIVEN** `hola` creado y otra conexión a la base con `LOCK TABLE flows IN ACCESS EXCLUSIVE MODE` en una transacción que no termina
- **WHEN** se hace a la vez `GET /flows/hola`, `GET /flows`, `POST /flows` con otro `id`, `PUT /flows/hola` con `If-Match: *`, `POST /flows/hola/versions` y `DELETE /flows/hola`
- **THEN** todas responden 503 `database_unavailable`, cada una en menos de 10 segundos

#### Scenario: Tabla de versiones retenida
- **GIVEN** `hola` creado y publicado, y otra conexión con `LOCK TABLE flow_versions IN ACCESS EXCLUSIVE MODE` en una transacción que no termina
- **WHEN** se hace `GET /flows/hola/versions`
- **THEN** la respuesta es 503 `database_unavailable` en menos de 10 segundos, no 500

#### Scenario: Conexión cortada por el servidor
- **GIVEN** `hola` creado y una petición de la API esperando un bloqueo (de tabla en `GET /flows/hola`, de fila en `PUT /flows/hola` con `If-Match: *` y en `POST /flows/hola/versions`)
- **WHEN** el servidor termina la conexión de esa petición mientras espera (`pg_terminate_backend`, lo que ve la API en un reinicio o una conmutación por error)
- **THEN** cada petición responde 503 `database_unavailable`, no 500

#### Scenario: Postgres que enmudece a mitad de una transacción
- **GIVEN** `hola` creado y un Postgres que, tras aceptar `BEGIN`, deja de contestar y de transmitir en cuanto la API pide bloquear la fila
- **WHEN** se hace `PUT /flows/hola` con `If-Match: *` y `POST /flows/hola/versions`
- **THEN** ambas responden 503 `database_unavailable`, cada una en menos de 10 segundos (el corte de la consulta y el `ROLLBACK` sobre la conexión muda suman menos de 10 segundos)

#### Scenario: Demasiadas conexiones
- **GIVEN** la API arrancada con `DATABASE_URL` de un rol de Postgres con `CONNECTION LIMIT 0`
- **WHEN** se hace `GET /flows` y `POST /flows` con `hola`
- **THEN** ambas responden 503 `database_unavailable`, no 500

#### Scenario: Servidor inalcanzable
- **GIVEN** la API arrancada con `DATABASE_URL` apuntando a una dirección a la que no hay ruta (`0.0.0.1`)
- **WHEN** se hace `GET /flows` y `POST /flows` con `hola`
- **THEN** ambas responden 503 `database_unavailable` en menos de 10 segundos, no 500

#### Scenario: Transacción caducada por el propio código
- **GIVEN** una operación de la API cuya transacción interactiva supera su tiempo máximo antes de su última consulta (provocado en el test)
- **WHEN** se hace la petición
- **THEN** la respuesta es 500 `internal_error`, no 503, y el registro del 500 nombra la clase del error y el código `P2028`

### Requirement: Base de datos mal configurada
Si `DATABASE_URL` apunta a una base que no existe, a credenciales sin acceso o a una conexión segura (`sslmode`) que el servidor no admite, los endpoints que leen o escriben flujos SHALL responder 503 `database_unavailable`, como con una base caída, sin datos de conexión en la respuesta ni en los registros. El registro del 503 SHALL nombrar el código de Prisma (`P1000`, `P1003`, `P1010` o `P1011`) para que quien opera distinga una configuración errónea de una caída.

#### Scenario: Base, usuario o conexión segura mal configurados
- **GIVEN** la API arrancada con `DATABASE_URL` a una base inexistente, a un usuario inexistente o con `sslmode=require` contra un servidor sin TLS (cada uno por separado, con una contraseña reconocible en la cadena)
- **WHEN** se hace `GET /flows`, `POST /flows` con `hola` y `POST /flows/validate` con `hola`
- **THEN** las dos primeras responden 503 `database_unavailable` y la tercera 200; ni las respuestas ni el registro contienen la contraseña, el nombre de la base ni el del usuario, y el registro de cada 503 termina con `P1003`, `P1010` y `P1011` respectivamente

### Requirement: Privacidad de los registros
La API SHALL no registrar cuerpos de petición ni de respuesta, ni valores de cabeceras; como mucho, método, ruta, código y duración. Así, una credencial pegada por error en un flujo no se copia a los registros.

#### Scenario: Token pegado en un flujo
- **GIVEN** la salida de registro de la API capturada
- **WHEN** se hace `POST /flows` con `captacion-leads` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"` (rechazado con `literal_credential`), después `POST /flows` y `GET /flows/captacion-leads` con `captacion-leads` sin cambios, y una petición con `Authorization: Bearer secreto-cliente`
- **THEN** la salida capturada no contiene `abc123`, `secreto-cliente` ni el texto de ningún nodo del flujo
