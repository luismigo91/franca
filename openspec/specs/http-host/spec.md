# http-host Specification

## Purpose
La salida `http` de la API de Franca: la capacidad `http` que la API da al motor para ejecutar los nodos `http` de las conversaciones. Fija lo que los requisitos «Host de producción: …» de `flow-engine` dejan a la instalación: qué destinos acepta (anti-SSRF), cómo se configuran los secretos y su origen exacto, qué cabeceras añade, cómo trata la resolución de nombres, TLS y el entorno, qué registra y qué avisa.

Datos de los escenarios:

- Los flujos son los de `conversations-api` (`captacion-leads` y `faq-ia`, de `packages/spec/examples/`). «Una conversación de `captacion-leads` lista para enviar» es una conversación suya a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`, esperando en `pedir-tamano`.
- **La red del test.** Ningún test sale a Internet ni necesita privilegios. El test fija a qué direcciones resuelve cada nombre y en qué orden, y lleva cada conexión que la API abre hacia una dirección y un puerto (los que la API validó) a un servidor local real del test; una conexión hacia un par sin servidor se rechaza. «Un servidor del test en `D`» es el que recibe las conexiones hacia el par `D`. Su certificado TLS es para el nombre que diga el escenario y lo firma una autoridad que la API acepta solo en el test.
- `P`, `P1` y `P2` son direcciones IPv4 unicast global distintas que elige el test (p. ej. `1.2.3.4`); la red del test nunca conecta con ellas de verdad.
- **El CRM del test**: `FRANCA_SECRET_CRM_TOKEN` = `Bearer prueba-crm-1`, `FRANCA_HTTP_SECRET_ORIGINS` = `CRM_TOKEN=https://crm.example.com`, `crm.example.com` resuelve a `P` y un servidor del test en `P:443`, con certificado de `crm.example.com`, responde 201 con el cuerpo `{"id":"L-1"}`.
- Salvo que el escenario diga otra cosa, la API arranca sin ninguna variable `FRANCA_SECRET_*` ni `FRANCA_HTTP_*`, la salida de registro está capturada, y el proveedor `principal` y el reloj de la API son los de `conversations-api`.

## Requirements

### Requirement: Salida http de la API
La API SHALL dar al motor, en cada avance de una conversación, una capacidad `http` que cumple todos los requisitos «Host de producción: …» de `flow-engine` con la configuración de esta capacidad: los secretos de la instalación y su lista de destinos permitidos. La instalación es el único tenant: todos los flujos usan sus secretos.

#### Scenario: Petición que recibe el CRM
- **GIVEN** el CRM del test y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** el servidor ha recibido una sola petición `POST /api/leads` con `authorization` `Bearer prueba-crm-1`, `content-type` `application/json` y el cuerpo `{"name":"Ana","email":"ana@example.com","companySize":"51+","segment":"empresa"}`
- **AND** la conversación termina con `outcome` `"lead-empresa"`

### Requirement: Orden de un intento
Cada intento SHALL comprobar en este orden y detenerse en la primera que falle: los secretos de sus cabeceras (`missing_secret`, sin resolver), el plazo del avance (`timeout`, sin resolver; ver «Tiempo máximo de un avance» de `conversations-api`), la resolución del nombre, la política de destinos (`blocked`, sin conectar), la conexión y TLS, y el envío y la lectura. El `timeoutMs` cuenta desde el primer paso. No hay espera entre intentos.

#### Scenario: Secreto ausente fuera de plazo
- **GIVEN** la API sin secretos, `llm-http` (de `conversations-api`) con la cabecera `{"Authorization": {"secret": "API_TOKEN"}}` en `h`, publicado, y un proveedor cuyo turno hace avanzar el reloj de la API 91 segundos y devuelve `{kind: "turn", text: "Hola", slots: {}, done: true, costUsd: 0.01}`
- **WHEN** se crea una conversación de ese flujo
- **THEN** queda en `failed` con `error` `{code: "missing_secret", nodeId: "h"}` (no `timeout`), sin evento `http`, y la API no ha pedido resolver `api.example.com`

#### Scenario: Secreto ausente sin resolver el nombre
- **GIVEN** la API sin secretos, `crm.example.com` resolviendo a `10.0.0.5` y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** la conversación queda en `failed` con `error` `{code: "missing_secret", nodeId: "enviar-crm"}`, la API no ha pedido resolver `crm.example.com` y no ha abierto ninguna conexión

#### Scenario: Resolución que no termina
- **GIVEN** un `http` `GET` a `https://api.example.com/x` con `timeoutMs` 500 y `retries` 0, y `api.example.com` con una resolución que nunca responde
- **WHEN** la API ejecuta el nodo
- **THEN** el evento `http` es `{attempts: 1, status: null, error: "timeout"}` (con su `type` y `nodeId`) y llega entre 500 ms y 500 ms más la tolerancia del entorno

### Requirement: Secretos de la instalación
La salida http SHALL resolver cada cabecera `{name, secret}` con el secreto de la instalación de ese nombre, y solo si el origen de la `url` (esquema, host y puerto) es exactamente uno de los orígenes autorizados para él; si no, el intento es `missing_secret`. El valor del secreto es el valor completo de la cabecera. Nunca se guarda en la base de datos ni aparece en respuestas, transcripciones o registros.

#### Scenario: Secreto fuera de la API
- **GIVEN** el CRM del test, con un servidor que responde 201 con el cuerpo `{"id":"L-1","eco":"Bearer prueba-crm-1"}`
- **WHEN** una conversación de `captacion-leads` lista para enviar recibe `{input: {choice: "grande"}}` y después se leen la conversación, su transcripción y sus filas en la base de datos
- **THEN** ni las respuestas, ni la transcripción, ni las filas, ni la salida de registro contienen `prueba-crm-1`

#### Scenario: Secreto autorizado para otro origen
- **GIVEN** el CRM del test con `FRANCA_HTTP_SECRET_ORIGINS` cambiada por separado a `CRM_TOKEN=https://crm.example.com:8443`, a `CRM_TOKEN=http://crm.example.com` y a `CRM_TOKEN=https://api.crm.example.com`
- **WHEN** en cada caso una conversación de `captacion-leads` lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** cada una queda en `failed` con `missing_secret` en `enviar-crm` y la API no ha abierto ninguna conexión

### Requirement: Forma de los orígenes de los secretos
`FRANCA_HTTP_SECRET_ORIGINS` SHALL ser una lista de entradas `NOMBRE=origen` separadas por comas, sin espacios. `NOMBRE` cumple `^[A-Z][A-Z0-9_]{0,63}$` y `origen` es un origen que puede tener la `url` de un nodo `http` (ver «Destino y longitud de la URL» de `flow-engine`), escrito exactamente como su serialización WHATWG: sin `/` final, ruta, usuario ni puerto por defecto. Un nombre puede repetirse con otros orígenes. Ausente o `""`, no hay secretos; una entrada vacía impide arrancar.

#### Scenario: Varios orígenes para un secreto
- **GIVEN** `FRANCA_SECRET_CRM_TOKEN` = `Bearer prueba-crm-1`, `FRANCA_HTTP_SECRET_ORIGINS` = `CRM_TOKEN=https://crm.example.com,CRM_TOKEN=https://crm.example.com:8443`, `crm.example.com` resolviendo a `P` y servidores del test en `P:443` y `P:8443` con certificado de `crm.example.com` que responden 204
- **WHEN** la API ejecuta un `http` `GET` con la cabecera `{"Authorization": {"secret": "CRM_TOKEN"}}` a `https://crm.example.com/` y otro a `https://crm.example.com:8443/`
- **THEN** los dos servidores reciben `authorization` `Bearer prueba-crm-1`

#### Scenario: Orígenes de secretos no admitidos
- **WHEN** la API arranca por separado con `FRANCA_SECRET_CRM_TOKEN` = `Bearer x` y `FRANCA_HTTP_SECRET_ORIGINS` igual a `CRM_TOKEN`, `crm_token=https://crm.example.com`, `CRM_TOKEN=https://crm.example.com/`, `CRM_TOKEN=https://crm.example.com:443`, `CRM_TOKEN=HTTPS://crm.example.com`, `CRM_TOKEN=ftp://crm.example.com`, `CRM_TOKEN=https://1.2.3.4`, `CRM_TOKEN=http://localhost:8080` y `CRM_TOKEN=https://crm.example.com, CRM_TOKEN=https://x.example.com`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_HTTP_SECRET_ORIGINS`

#### Scenario: Entradas vacías en los orígenes
- **WHEN** la API arranca por separado con `FRANCA_SECRET_CRM_TOKEN` = `Bearer x` y `FRANCA_HTTP_SECRET_ORIGINS` igual a `CRM_TOKEN=https://crm.example.com,` (coma final), `,CRM_TOKEN=https://crm.example.com`, `CRM_TOKEN=https://crm.example.com,,CRM_TOKEN=https://crm.example.com:8443`, `,` y `" "` (un espacio)
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_HTTP_SECRET_ORIGINS`
- **AND** con `FRANCA_HTTP_SECRET_ORIGINS` = `""` la API arranca sin secretos

### Requirement: Valores de los secretos
Por cada nombre de `FRANCA_HTTP_SECRET_ORIGINS`, `FRANCA_SECRET_<NOMBRE>` SHALL dar su valor: de 1 a 8192 caracteres ASCII visibles, espacios o tabuladores, sin blancos al principio ni al final. Si falta, está vacía o no cumple, la API no arranca, termina con un código distinto de 0 y su mensaje nombra la variable sin repetir su valor.

#### Scenario: Valores de secreto no admitidos
- **GIVEN** `FRANCA_HTTP_SECRET_ORIGINS` = `CRM_TOKEN=https://crm.example.com`
- **WHEN** la API arranca por separado sin `FRANCA_SECRET_CRM_TOKEN` y con ella igual a `""`, `" Bearer no-mostrar-1"`, `"Bearer no-mostrar-1\n"`, `"Bearer ñ-no-mostrar-1"` y 8193 caracteres `"a"`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0, su mensaje nombra `FRANCA_SECRET_CRM_TOKEN` y ninguna salida contiene `no-mostrar-1`
- **AND** con `Bearer x` y con 8192 caracteres `"a"` la API arranca

### Requirement: Secretos sin origen
Una variable `FRANCA_SECRET_<NOMBRE>` cuyo nombre no está en `FRANCA_HTTP_SECRET_ORIGINS` SHALL ignorarse: ese secreto no existe para los flujos. La salida de arranque SHALL decir, en una línea, qué secretos hay con sus orígenes, qué variables `FRANCA_SECRET_*` se ignoran y qué destinos permite la instalación, sin ningún valor de secreto.

#### Scenario: Secreto sin origen ignorado
- **GIVEN** la API arrancada con `FRANCA_SECRET_SOPORTE_TOKEN` = `Bearer no-mostrar-2` y sin `FRANCA_HTTP_SECRET_ORIGINS`, y `faq-ia` publicado con un proveedor que devuelve `{kind: "failed", costUsd: 0}`
- **WHEN** se crea una conversación de `faq-ia` y se envía `{input: {text: "ana@example.com"}}`
- **THEN** la conversación queda en `failed` con `missing_secret` en `crear-ticket`, la salida de arranque nombra `FRANCA_SECRET_SOPORTE_TOKEN` como ignorada y no contiene `no-mostrar-2`

#### Scenario: Salida de arranque de la salida http
- **GIVEN** el CRM del test y `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:8080`
- **WHEN** la API arranca
- **THEN** su salida de arranque contiene una línea con `CRM_TOKEN`, `https://crm.example.com` y `127.0.0.1:8080`, y no contiene `prueba-crm-1`

### Requirement: Destinos permitidos por la instalación
`FRANCA_HTTP_ALLOWED_DESTINATIONS` SHALL ser una lista, separada por comas y sin espacios, de pares `dirección:puerto` que la salida http permite aunque la dirección no sea unicast global: IPv4 en decimal con puntos y sin ceros a la izquierda, o IPv6 entre corchetes, y un puerto de 1 a 65535 sin ceros a la izquierda. Ausente o `""`, no permite ninguno. Con otro valor, también una entrada vacía, la API no arranca, termina con un código distinto de 0 y su mensaje nombra la variable.

#### Scenario: Destinos permitidos no admitidos
- **WHEN** la API arranca por separado con `FRANCA_HTTP_ALLOWED_DESTINATIONS` igual a `localhost:8080`, `127.0.0.1`, `127.0.0.1:0`, `127.0.0.1:65536`, `127.0.0.1:08080`, `127.0.0.01:8080`, `::1:8080`, `10.0.0.0/8:80`, `*:80` y `127.0.0.1:8080, 127.0.0.2:8080`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_HTTP_ALLOWED_DESTINATIONS`
- **AND** con `127.0.0.1:8080,[::1]:8443` la API arranca

#### Scenario: Entradas vacías en los destinos permitidos
- **WHEN** la API arranca por separado con `FRANCA_HTTP_ALLOWED_DESTINATIONS` igual a `127.0.0.1:8080,` (coma final), `,127.0.0.1:8080`, `127.0.0.1:8080,,[::1]:8443`, `,` y `" "` (un espacio)
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_HTTP_ALLOWED_DESTINATIONS`
- **AND** con `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `""` la API arranca sin destinos permitidos

### Requirement: Comparación de los destinos permitidos
Un par permitido SHALL permitir solo esa dirección con ese puerto, comparadas como direcciones y no como texto: una IPv4 mapeada en IPv6 (`::ffff:0:0/96`) es su IPv4 y una IPv6 vale lo mismo escrita de cualquier forma. Un par permitido admite también `http://` sin TLS (ver «Solo https hacia destinos públicos»).

#### Scenario: Destino local permitido
- **GIVEN** `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:8080`, `crm.local.test` resolviendo a `127.0.0.1` y un servidor del test en `127.0.0.1:8080` que responde 200
- **WHEN** la API ejecuta un `http` `GET` a `http://crm.local.test:8080/` y otro a `http://crm.local.test:8081/`
- **THEN** el primero recibe la respuesta 200 y el segundo da el evento `http` con `error` `blocked`, sin conectar con `127.0.0.1:8081`

#### Scenario: Dirección permitida escrita de otra forma
- **GIVEN** `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:8080,[::1]:8443`, `a.local.test` resolviendo a `::ffff:7f00:1`, `b.local.test` resolviendo a `0:0:0:0:0:0:0:1` y servidores del test en esos dos pares que responden 200
- **WHEN** la API ejecuta un `http` `GET` a `http://a.local.test:8080/` y otro a `http://b.local.test:8443/`
- **THEN** los dos reciben la respuesta 200

### Requirement: Direcciones IPv4 unicast global
Una IPv4 SHALL ser unicast global para «Host de producción: destinos de red» solo si no es multicast (`224.0.0.0/4`) y no está en el registro de direcciones IPv4 de propósito especial de IANA, o está en una entrada suya con «Globally Reachable» `True`. Cualquier otra se bloquea salvo que su par esté permitido.

#### Scenario: Rangos IPv4 que no son globales
- **GIVEN** nombres que resuelven, uno a uno, a `198.51.100.7`, `203.0.113.7`, `192.0.0.8`, `100.127.255.254`, `127.255.255.255` y `239.255.255.250`
- **WHEN** la API ejecuta un `http` `GET` a `https://<nombre>/` con cada uno
- **THEN** cada uno da el evento `http` con `error` `blocked` y la API no ha abierto ninguna conexión

### Requirement: Direcciones IPv6 unicast global
Una IPv6 SHALL ser unicast global solo si está en `2000::/3` y no está en el registro de direcciones IPv6 de propósito especial de IANA, o está en una entrada suya con «Globally Reachable» `True`. Las mapeadas (`::ffff:0:0/96`) y las NAT64 (`64:ff9b::/96`) se juzgan por la IPv4 que incrustan; 6to4 (`2002::/16`), Teredo (`2001::/32`) y NAT64 local (`64:ff9b:1::/48`) no son globales.

#### Scenario: IPv4 pública detrás de NAT64
- **GIVEN** `api.example.com` resolviendo a la NAT64 de `P` (`64:ff9b::` seguido de los 32 bits de `P`) y un servidor del test en ese par y el puerto 443, con certificado de `api.example.com`, que responde 200
- **WHEN** la API ejecuta un `http` `GET` a `https://api.example.com/`
- **THEN** recibe la respuesta 200

#### Scenario: Rangos IPv6 que no son globales
- **GIVEN** nombres que resuelven, uno a uno, a `2001:db8::7`, `100::1`, `2002:102:304::1`, `2001::1`, `64:ff9b:1::102:304`, `64:ff9b::a00:5`, `::ffff:192.168.1.1` y `4000::1`
- **WHEN** la API ejecuta un `http` `GET` a `https://<nombre>/` con cada uno
- **THEN** cada uno da el evento `http` con `error` `blocked` y la API no ha abierto ninguna conexión

### Requirement: Resolución de nombres
La salida http SHALL resolver el nombre de la `url` en cada intento y bloquear el intento sin conectar si alguna dirección de la resolución no está permitida, aunque otras sí. Conecta con las direcciones en el orden de la resolución y pasa a la siguiente solo si la conexión con la anterior falla sin haber enviado nada. Un nombre que no se puede resolver da `{kind: "network_error", requestSent: false}`.

#### Scenario: Resolución con una dirección interna
- **GIVEN** el CRM del test con `crm.example.com` resolviendo a `[P, 10.0.0.5]` y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** el evento `http` de `enviar-crm` es `{attempts: 1, status: null, error: "blocked"}`, la conversación termina con `outcome` `"lead-sin-enviar"` y la API no ha abierto ninguna conexión

#### Scenario: Primera dirección que rechaza la conexión
- **GIVEN** el CRM del test con `crm.example.com` resolviendo a `[P1, P]`, sin servidor en `P1:443`, y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** la conversación termina con `outcome` `"lead-empresa"` y el servidor en `P:443` ha recibido una sola petición

#### Scenario: Nombre que no existe
- **GIVEN** el CRM del test con `crm.example.com` sin resolución (el nombre no existe) y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** el evento `http` de `enviar-crm` es `{attempts: 3, status: null, error: "network_error"}` y la conversación termina con `outcome` `"lead-sin-enviar"`

### Requirement: Solo https hacia destinos públicos
Un intento a una `url` `http://` SHALL bloquearse sin conectar si alguna dirección de su resolución no es de un par permitido, aunque sea unicast global: los datos de un flujo no viajan sin cifrar por Internet. `http://` solo llega a pares permitidos.

#### Scenario: http sin TLS hacia una dirección pública
- **GIVEN** `api.example.com` resolviendo a `P` y un servidor del test en `P:80`
- **WHEN** la API ejecuta un `http` `GET` a `http://api.example.com/`
- **THEN** el evento `http` tiene `error` `blocked` y el servidor no ha recibido ninguna conexión

### Requirement: Certificado del servidor
La salida http SHALL verificar el certificado TLS contra el nombre del host de la `url` (no contra la dirección) y las autoridades de confianza de Node, con el nombre en SNI. Un certificado no válido, caducado o de otro nombre da `{kind: "network_error", requestSent: false}` y el servidor no recibe la petición. `NODE_TLS_REJECT_UNAUTHORIZED` no desactiva la verificación.

#### Scenario: Certificado de otro nombre
- **GIVEN** el CRM del test con el certificado del servidor emitido para `otro.example.com`, y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** el evento `http` de `enviar-crm` tiene `error` `network_error`, el servidor no ha recibido ninguna petición HTTP y la conversación termina con `outcome` `"lead-sin-enviar"`

#### Scenario: Verificación de TLS desactivada en el entorno
- **GIVEN** la API arrancada con `NODE_TLS_REJECT_UNAUTHORIZED` = `0` y el CRM del test con un certificado firmado por una autoridad que la API no acepta
- **WHEN** una conversación de `captacion-leads` lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** el servidor no ha recibido ninguna petición HTTP y la conversación termina con `outcome` `"lead-sin-enviar"`

### Requirement: Sin proxy del entorno
La salida http SHALL conectar directamente con la dirección que validó, sin proxy: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` y `NODE_USE_ENV_PROXY` (en mayúsculas o minúsculas) no cambian por dónde sale una petición.

#### Scenario: Proxy del entorno ignorado
- **GIVEN** la API arrancada con `NODE_USE_ENV_PROXY` = `1` y `HTTPS_PROXY`, `HTTP_PROXY` y `ALL_PROXY` apuntando a un servidor local del test que registra cada conexión, y el CRM del test
- **WHEN** una conversación de `captacion-leads` lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** la conversación termina con `outcome` `"lead-empresa"`, el CRM ha recibido la petición y el servidor del proxy no ha recibido ninguna conexión

### Requirement: Cabeceras que añade la API
Además de las cabeceras del nodo, la petición SHALL llevar solo `Host` (el host de la `url`, con el puerto si no es el de por defecto), `Content-Length` si hay body (y `Content-Length: 0` en un `POST`, `PUT` o `PATCH` sin body, como recomienda RFC 9110), `Connection: close`, y `Accept-Encoding: gzip, deflate, br` y `User-Agent: Franca` si el nodo no las define. Nunca añade cookies, credenciales ni cabeceras del entorno.

#### Scenario: Cabeceras que recibe el servidor
- **GIVEN** `api.example.com` resolviendo a `P` y un servidor del test en `P:443`, con certificado de `api.example.com`, que responde 200 con `Set-Cookie: s=1`
- **WHEN** la API ejecuta dos veces un `http` `POST` a `https://api.example.com/x` con `body` `{"a": 1}` y la cabecera `{"X-Id": "1"}`, y después un `GET` con las cabeceras `{"User-Agent": "Otro", "Accept-Encoding": "identity"}`
- **THEN** las dos primeras llegan con exactamente las cabeceras `host`, `content-length`, `connection`, `accept-encoding`, `user-agent`, `x-id` y `content-type`, y el `GET` con `user-agent` `Otro` y `accept-encoding` `identity`, sin `cookie` ni `content-length`
- **AND** un `POST` y un `DELETE` a `https://api.example.com/x` sin `body` llegan, respectivamente, con `content-length` `0` y sin `content-length`

### Requirement: Una conexión por intento
Cada intento SHALL abrir su propia conexión, tras resolver y validar el destino, y cerrarla al terminar. Ninguna conexión se reutiliza entre intentos, nodos ni conversaciones.

#### Scenario: Dos intentos, dos conexiones
- **GIVEN** `api.example.com` resolviendo a `P` y un servidor del test en `P:443`, con certificado de `api.example.com`, que responde 503 y después 200
- **WHEN** la API ejecuta un `http` `GET` a `https://api.example.com/x` con `retries` 1
- **THEN** el evento `http` es `{attempts: 2, status: 200, error: null}` (con su `type` y `nodeId`), el servidor ha recibido dos conexiones y la API ha pedido resolver `api.example.com` dos veces

### Requirement: Fallos de red de un intento
Un fallo antes de enviar ningún byte de la petición (resolución, conexión rechazada o inalcanzable, TLS) SHALL dar `{kind: "network_error", requestSent: false}`; cualquier otro fallo de red, también uno inesperado de la propia salida http, `{kind: "network_error", requestSent: true}`. La promesa nunca se rechaza.

#### Scenario: Lead que no se duplica
- **GIVEN** el CRM del test con un servidor que lee la petición entera y cierra la conexión sin responder, y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** el servidor ha recibido una sola petición, el evento `http` de `enviar-crm` es `{attempts: 1, status: null, error: "network_error"}` y la conversación termina con `outcome` `"lead-sin-enviar"`

### Requirement: Respuestas que el motor no admite
Una respuesta con un status fuera de 200 a 599, o cuyo cuerpo comprimido no se puede descomprimir, SHALL dar `{kind: "network_error", requestSent: true}`: el motor no admite ese status y haría fallar la conversación con `http_host_error`.

#### Scenario: Status fuera de rango
- **GIVEN** `api.example.com` resolviendo a `P` y un servidor del test en `P:443`, con certificado de `api.example.com`, que responde con el status `600` y, en otra ronda, con `Content-Encoding: gzip` y un cuerpo que no es gzip
- **WHEN** la API ejecuta en cada ronda un `http` `GET` a `https://api.example.com/x` con `retries` 0
- **THEN** cada evento `http` es `{attempts: 1, status: null, error: "network_error"}` (con su `type` y `nodeId`) y ninguna conversación falla con `http_host_error`

### Requirement: Registros de la salida http
La API SHALL no registrar nada de una llamada `http` (URL, origen, dirección, cabeceras, body, valores de secretos ni cuerpos de respuesta), tenga o no `containsPii`, salvo los avisos de «Aviso de secreto no disponible» y «Aviso de destino bloqueado».

#### Scenario: Llamada http fuera del registro
- **GIVEN** el CRM del test con un servidor que responde 201 con el cuerpo `{"id":"L-1","eco":"MARCA-RESPUESTA"}`, y `captacion-leads` con la `url` de `enviar-crm` cambiada a `https://crm.example.com/api/leads?origen=MARCA-URL` y la cabecera `{"X-Campana": "MARCA-CABECERA"}` añadida
- **WHEN** una conversación suya lista para enviar recibe `{input: {choice: "grande"}}`, y otra lo hace con `crm.example.com` resolviendo a `10.0.0.5`
- **THEN** la salida registrada desde que se crea la primera conversación no contiene `MARCA-URL`, `MARCA-CABECERA`, `MARCA-RESPUESTA`, `crm.example.com`, `10.0.0.5`, `ana@example.com` ni `prueba-crm-1`

### Requirement: Aviso de secreto no disponible
Cuando un intento da `missing_secret`, la API SHALL registrar un aviso con el `id` de la conversación, el `nodeId`, `missing_secret`, el nombre del secreto y el motivo: `not_configured` (la instalación no lo tiene) u `origin_not_allowed` (no está autorizado para ese origen). Los nombres de secreto no son secretos.

#### Scenario: Avisos de secreto en el registro
- **GIVEN** una conversación de `captacion-leads` lista para enviar con la API sin secretos, y otra con el CRM del test y `FRANCA_HTTP_SECRET_ORIGINS` = `CRM_TOKEN=https://crm.example.com:8443`
- **WHEN** cada una recibe `{input: {choice: "grande"}}`
- **THEN** la salida contiene una línea con el `id` de la primera, `enviar-crm`, `missing_secret`, `CRM_TOKEN` y `not_configured`, y otra con el `id` de la segunda, `enviar-crm`, `CRM_TOKEN` y `origin_not_allowed`

### Requirement: Aviso de destino bloqueado
Cuando un intento da `blocked`, la API SHALL registrar un aviso con el `id` de la conversación, el `nodeId`, `blocked` y el motivo: `internal_destination` (alguna dirección no es unicast global ni de un par permitido) o `insecure_transport` (`http://` hacia un destino que no es un par permitido), sin el nombre ni las direcciones. Si se dan los dos, el motivo es `internal_destination`.

#### Scenario: Avisos de destino en el registro
- **GIVEN** el CRM del test con `crm.example.com` resolviendo a `10.0.0.5`, y una conversación de `captacion-leads` lista para enviar
- **WHEN** se envía `{input: {choice: "grande"}}`
- **THEN** la salida contiene una línea con el `id` de la conversación, `enviar-crm`, `blocked` e `internal_destination`
