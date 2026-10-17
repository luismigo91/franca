## ADDED Requirements

### Requirement: Forma de los nombres locales
`FRANCA_HTTP_LOCAL_NAMES` SHALL ser una lista de entradas `nombre=dirección` separadas por comas y sin espacios. `nombre` es un host que puede tener la `url` de un nodo `http`, escrito como su serialización y terminado en `.test`. `dirección` es una IPv4 de `127.0.0.0/8` sin ceros a la izquierda, o `[::1]`. Un nombre puede repetirse. Si falta o es `""`, no hay nombres locales; con otro valor, también una entrada vacía, la API no arranca y el mensaje nombra la variable.

#### Scenario: Nombres locales no admitidos
- **WHEN** la API arranca por separado con `FRANCA_HTTP_LOCAL_NAMES` igual a `crm.franca.test`, `crm.franca.test=`, `=127.0.0.1`, `CRM.franca.test=127.0.0.1`, `crm.example.com=127.0.0.1`, `crm.franca.test.=127.0.0.1`, `test=127.0.0.1`, `localhost=127.0.0.1`, `crm.localhost=127.0.0.1`, `crm.franca.test=10.0.0.5`, `crm.franca.test=1.2.3.4`, `crm.franca.test=127.000.0.1`, `crm.franca.test=127.0.0.1:4010`, `crm.franca.test=::1`, `crm.franca.test=[::2]`, `crm.franca.test=[0:0:0:0:0:0:0:1]`, `crm.franca.test=[::ffff:127.0.0.1]`, `crm.franca.test=localhost` y `crm.franca.test=127.0.0.1, otro.franca.test=127.0.0.1`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_HTTP_LOCAL_NAMES`
- **AND** con `crm.franca.test=127.0.0.1,crm.franca.test=[::1],soporte.franca.test=127.0.0.2` la API arranca

#### Scenario: Entradas vacías en los nombres locales
- **WHEN** la API arranca por separado con `FRANCA_HTTP_LOCAL_NAMES` igual a `crm.franca.test=127.0.0.1,` (coma final), `,crm.franca.test=127.0.0.1`, `crm.franca.test=127.0.0.1,,otro.franca.test=127.0.0.1`, `,` y `" "` (un espacio)
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_HTTP_LOCAL_NAMES`
- **AND** con `FRANCA_HTTP_LOCAL_NAMES` = `""` la API arranca sin nombres locales

### Requirement: Resolución de un nombre local
En un intento hacia una `url` cuyo host es un nombre local, la resolución SHALL ser sus direcciones, en el orden en que están escritas, sin preguntar al resolutor del sistema. El resto del intento no cambia: se aplica la misma política de destinos, así que la dirección solo es alcanzable si su par está en `FRANCA_HTTP_ALLOWED_DESTINATIONS`. Los demás nombres, también los de `.test` que no están en la lista, se resuelven como siempre.

#### Scenario: CRM con nombre local
- **GIVEN** `FRANCA_HTTP_LOCAL_NAMES` = `crm.franca.test=127.0.0.1`, `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:4010`, `FRANCA_SECRET_CRM_TOKEN` = `Bearer prueba-crm-1` y `FRANCA_HTTP_SECRET_ORIGINS` = `CRM_TOKEN=http://crm.franca.test:4010`
- **AND** un servidor del test en `127.0.0.1:4010` que responde 201 con el cuerpo `{"id":"L-1"}`, y `captacion-leads` con la `url` de `enviar-crm` cambiada a `http://crm.franca.test:4010/api/leads`, publicado
- **WHEN** una conversación suya lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** el servidor ha recibido una sola petición `POST /api/leads` con `host` `crm.franca.test:4010` y `authorization` `Bearer prueba-crm-1`
- **AND** la conversación termina con `outcome` `"lead-empresa"` y la API no ha pedido resolver `crm.franca.test`

#### Scenario: Nombre local en mayúsculas en la url
- **GIVEN** `FRANCA_HTTP_LOCAL_NAMES` = `api.franca.test=127.0.0.1`, `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:4010` y un servidor del test en `127.0.0.1:4010` que responde 200
- **WHEN** la API ejecuta un `http` `GET` a `http://API.Franca.TEST:4010/`
- **THEN** recibe la respuesta 200 y la API no ha pedido resolver ningún nombre (el motor entrega el host en minúsculas)

#### Scenario: Nombre local sin destino permitido
- **GIVEN** el CRM con nombre local de «CRM con nombre local» pero sin `FRANCA_HTTP_ALLOWED_DESTINATIONS`, y una conversación de esa copia de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** el evento `http` de `enviar-crm` es `{attempts: 1, status: null, error: "blocked"}` y la conversación termina con `outcome` `"lead-sin-enviar"`
- **AND** la API no ha abierto ninguna conexión y la salida contiene el aviso de destino bloqueado con `internal_destination`

#### Scenario: Orden de las direcciones de un nombre local
- **GIVEN** `FRANCA_HTTP_LOCAL_NAMES` = `api.franca.test=[::1],api.franca.test=127.0.0.1`, `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `[::1]:4010,127.0.0.1:4010`, ningún servidor en `[::1]:4010` y un servidor del test en `127.0.0.1:4010` que responde 200
- **WHEN** la API ejecuta un `http` `GET` a `http://api.franca.test:4010/`
- **THEN** recibe la respuesta 200, la API ha intentado conectar primero con `[::1]:4010` y después con `127.0.0.1:4010`, y no ha pedido resolver ningún nombre

#### Scenario: Nombres que no son locales
- **GIVEN** `FRANCA_HTTP_LOCAL_NAMES` = `crm.franca.test=127.0.0.1`, `otro.franca.test` sin resolución, y `api.example.com` resolviendo a `P` con un servidor del test en `P:443`, con certificado de `api.example.com`, que responde 200
- **WHEN** la API ejecuta un `http` `GET` a `http://otro.franca.test:4010/` con `retries` 0 y otro a `https://api.example.com/`
- **THEN** el primero da el evento `http` `{attempts: 1, status: null, error: "network_error"}` (con su `type` y `nodeId`) y el segundo recibe la respuesta 200
- **AND** la API ha pedido resolver `otro.franca.test` y `api.example.com`

### Requirement: Nombres locales en la salida de arranque
La línea de arranque de la salida http (ver «Secretos sin origen») SHALL incluir también cada nombre local con sus direcciones en el orden escrito, o decir que no hay ninguno. Los nombres locales no son secretos.

#### Scenario: Salida de arranque con nombres locales
- **GIVEN** `FRANCA_HTTP_LOCAL_NAMES` = `crm.franca.test=127.0.0.1,crm.franca.test=[::1]` y `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:4010`
- **WHEN** la API arranca
- **THEN** la línea de su salida de arranque que contiene `127.0.0.1:4010` contiene también `crm.franca.test`, `127.0.0.1` y `[::1]`, en ese orden
- **AND** sin `FRANCA_HTTP_LOCAL_NAMES` esa línea dice que no hay nombres locales
