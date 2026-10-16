## ADDED Requirements

### Requirement: Capacidad http del host
El host MAY ofrecer en `EngineHost` una función `http` que recibe una petición (ver «Petición entregada al host») y devuelve una promesa con el resultado de un intento (ver «Resultado de un intento»). El motor SHALL llamarla una vez por intento, esperar su resultado antes de hacer nada más y no llamarla en ningún otro caso. Si `http` falta o no es una función, el host no ofrece la capacidad.

#### Scenario: Una llamada por intento
- **GIVEN** un `http` `h` con `request` `{method: "GET", url: "https://api.example.com/x"}`, `retries` 0, `next` hacia un `end` con `outcome` `"ok"` y `onError` hacia un `end` con `outcome` `"ko"`, y un host cuyo `http` devuelve `{kind: "response", status: 200, body: ""}`
- **WHEN** el host arranca una sesión
- **THEN** `http` se ha llamado exactamente una vez, con `attempt` 1, y la sesión termina con `outcome` `"ok"`

#### Scenario: Un flujo sin http no llama al host
- **GIVEN** un flujo `message` → `end` y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** `http` no se ha llamado

#### Scenario: Capacidad que no es una función
- **GIVEN** un flujo `set` → `http` y un host `{http: "no"}`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `unsupported_node` y el `nodeId` del `http`

#### Scenario: Llamadas en secuencia
- **GIVEN** un flujo `http` `a` → `http` `b` → `end`, con el `onError` de cada uno hacia el siguiente nodo, y un host que cuenta cuántas llamadas tiene en curso a la vez
- **WHEN** el host arranca una sesión
- **THEN** nunca hay más de una llamada en curso y la de `b` empieza después de que se resuelva la de `a`

### Requirement: Lectura de la capacidad http
El motor SHALL leer `http` del host una sola vez cada vez que llega a un nodo `http` y llamarla con el host como `this`. Un host omitido o `null` equivale a `{}`.

#### Scenario: Host omitido o nulo
- **GIVEN** un flujo `set` → `http`
- **WHEN** el host arranca una sesión sin pasar host y otra pasando `null`
- **THEN** ambas fallan con `unsupported_node` y el `nodeId` del `http`, y ninguna promesa se rechaza

#### Scenario: Host con métodos
- **GIVEN** un host que es una instancia de una clase cuyo método `http` lee un campo del propio objeto (`this`) para responder status 200
- **WHEN** el host arranca una sesión con un `http` `GET` de `retries` 1
- **THEN** la sesión continúa en `next` y el método se ha llamado una vez, con `this` igual al host

### Requirement: Orden de comprobación de un nodo http
Al llegar a un `http`, el motor SHALL comprobar en este orden y detenerse en la primera que falle: límite de pasos (`step_limit_exceeded`), capacidad del host (`unsupported_node`), configuración (`invalid_http_config`), tamaño de los textos renderizados (`value_too_large`), petición construida (`onError` sin llamar al host) y límite de llamadas (`http_limit_exceeded`). Solo si todo pasa llama al host.

#### Scenario: La capacidad se comprueba antes que la configuración
- **GIVEN** un `http` con una cabecera llamada `"X Bad"` y un host sin capacidad `http`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `unsupported_node`, no con `invalid_http_config`

#### Scenario: La configuración gana al tamaño
- **GIVEN** la variable `a` con un `default` de 16385 caracteres `"a"` y un `http` con las cabeceras `{"X Bad": "x", "X-Ok": "{{a}}"}`, y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `invalid_http_config`, no con `value_too_large`, y `http` no se ha llamado

#### Scenario: El tamaño gana a la URL inválida
- **GIVEN** la variable `a` con un `default` de 16385 caracteres `"a"` y un `http` con `url` `"ftp://api.example.com/"` y la cabecera `{"X-Ok": "{{a}}"}`, y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `value_too_large` y no hay ningún evento `http`

### Requirement: Cabeceras que no se pueden enviar
Si una cabecera del nodo tiene un nombre que no es un token de RFC 9110 (letras y dígitos ASCII y ``!#$%&'*+-.^_`|~``, al menos uno), dos cabeceras tienen el mismo nombre sin distinguir mayúsculas, un nombre es `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `TE`, `Trailer` o `Expect`, o empieza por `Proxy-` (sin distinguir mayúsculas), o hay más de 32 cabeceras, la sesión MUST fallar con `invalid_http_config` y el `nodeId` del http, sin llamar al host.

#### Scenario: Nombres que no son tokens
- **GIVEN** un host que ofrece `http`
- **WHEN** el host arranca por separado sesiones con un `http` cuya única cabecera se llama `"X Bad"`, `""`, `"X-Ñ"` y `"X:Y"`
- **THEN** cada sesión falla con `invalid_http_config` y el `nodeId` del `http`, sin evento `http`, y `http` no se ha llamado

#### Scenario: Nombres repetidos sin distinguir mayúsculas
- **GIVEN** un `http` con las cabeceras `{"Content-Type": "application/json", "content-type": "text/plain"}` y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `invalid_http_config`

#### Scenario: Cabeceras reservadas al host
- **GIVEN** un host que ofrece `http`
- **WHEN** el host arranca por separado sesiones con un `http` cuya única cabecera es `Host`, `content-length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `TE`, `Trailer`, `Expect` y `Proxy-Authorization`
- **THEN** cada sesión falla con `invalid_http_config`

#### Scenario: Número de cabeceras
- **GIVEN** un host que ofrece `http` y que devuelve `{kind: "response", status: 200, body: ""}`
- **WHEN** el host arranca una sesión con un `http` de 32 cabeceras `X-H1` a `X-H32` y otra con 33
- **THEN** la primera llama al host y termina en `next`, y la segunda falla con `invalid_http_config`

#### Scenario: Cabeceras admitidas
- **GIVEN** un `http` con las cabeceras `{"Accept": "application/json", "X-Request-Id": "r-1", "Authorization": {"secret": "CRM_TOKEN"}, "Cookie": "a=b"}` y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** la sesión no falla con `invalid_http_config` y el host recibe las cuatro cabeceras

### Requirement: Body en GET y punteros mal escapados
Si `method` es `GET` y el nodo tiene un `body` distinto de `null`, o si algún `pointer` de `responseMap` contiene un `~` que no va seguido de `0` o de `1`, la sesión MUST fallar con `invalid_http_config` y el `nodeId` del http, sin llamar al host.

#### Scenario: GET con body
- **GIVEN** un host que ofrece `http`
- **WHEN** el host arranca por separado sesiones con un `http` `GET` con `body` `{"a": 1}`, un `GET` con `body` `null` y un `DELETE` con `body` `{"a": 1}`
- **THEN** la primera falla con `invalid_http_config`, y la segunda y la tercera llaman al host

#### Scenario: Punteros mal escapados
- **GIVEN** un host que ofrece `http` y la variable `v` declarada
- **WHEN** el host arranca por separado sesiones con un `http` cuyo `responseMap` es `[{variable: "v", pointer: "/a~2"}]` y `[{variable: "v", pointer: "/a~"}]`
- **THEN** ambas fallan con `invalid_http_config` y `http` no se ha llamado

### Requirement: Petición entregada al host
Cada intento SHALL entregar al host un objeto nuevo `{nodeId, method, url, headers, body, timeoutMs, attempt, containsPii}`: la serialización WHATWG de la URL validada, las cabeceras (ver «Cabeceras de la petición»), el body serializado o `null` (ver «Cuerpo de la petición»), el `timeoutMs` del nodo o 10000, el número de intento (1 el primero) y `containsPii` (ver «Indicador de datos personales»). Lo que el host haga con el objeto no afecta al motor ni a los intentos siguientes.

#### Scenario: Petición mínima
- **GIVEN** un `http` `h` con `request` `{method: "GET", url: "https://api.example.com"}`, sin `headers`, `body`, `timeoutMs` ni `retries`, y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** el host recibe exactamente `{nodeId: "h", method: "GET", url: "https://api.example.com/", headers: [], body: null, timeoutMs: 10000, attempt: 1, containsPii: false}`

#### Scenario: Petición del ejemplo de captación de leads
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano`, con `nombre` `"Ana"` y `email` `"ana@example.com"`, y un host que ofrece `http`
- **WHEN** el host continúa con `{choice: "grande"}`
- **THEN** el host recibe `{nodeId: "enviar-crm", method: "POST", url: "https://crm.example.com/api/leads", headers: [{name: "Authorization", secret: "CRM_TOKEN"}, {name: "Content-Type", value: "application/json"}], body: "{\"name\":\"Ana\",\"email\":\"ana@example.com\",\"companySize\":\"51+\",\"segment\":\"empresa\"}", timeoutMs: 8000, attempt: 1, containsPii: true}`

#### Scenario: El host no altera los intentos siguientes
- **GIVEN** un `http` `GET` con `retries` 1 y la cabecera `{"X-A": "1"}`, y un host que en el primer intento cambia `url`, vacía `headers` y devuelve `{kind: "response", status: 503, body: ""}`, y en el segundo devuelve status 200
- **WHEN** el host arranca una sesión
- **THEN** el segundo intento recibe la `url` y las cabeceras originales y `attempt` 2, y el flujo recibido no ha cambiado

### Requirement: Cabeceras de la petición
`headers` SHALL ser una lista con una entrada por cabecera del nodo, en el orden del flujo (ver «Orden de cabeceras y claves del body») y con el nombre tal como está escrito: `{name, value}` con la plantilla renderizada, o `{name, secret}` con el nombre del secreto, sin resolverlo. Si hay body y ninguna cabecera se llama `Content-Type` (sin distinguir mayúsculas), se añade al final `{name: "Content-Type", value: "application/json"}`.

#### Scenario: Secreto por nombre y plantilla
- **GIVEN** `nombre` = `"Ana"` y un `http` `GET` con las cabeceras `{"Authorization": {"secret": "CRM_TOKEN"}, "X-Lead": "lead {{nombre}}"}` y un host que ofrece `http`
- **WHEN** se ejecuta el `http`
- **THEN** el host recibe `headers` `[{name: "Authorization", secret: "CRM_TOKEN"}, {name: "X-Lead", value: "lead Ana"}]`

#### Scenario: Content-Type por defecto
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado un `http` `POST` con `body` `{"a": 1}` sin cabeceras y otro igual con la cabecera `{"content-type": "text/plain"}`
- **THEN** el primero entrega `headers` `[{name: "Content-Type", value: "application/json"}]` y el segundo `[{name: "content-type", value: "text/plain"}]`

#### Scenario: Sin body no se añade Content-Type
- **GIVEN** un `http` `POST` con `body` `null` y sin cabeceras, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el host recibe `headers` `[]` y `body` `null`

### Requirement: Cuerpo de la petición
Si el nodo tiene un `body` distinto de `null`, el motor SHALL renderizar como plantilla cada string que contiene, a cualquier profundidad (las claves no), dejar tal cual numbers, booleans y `null`, y entregar su serialización JSON compacta, con las claves en el orden del flujo. Sin `body`, o con `body: null`, el host recibe `body: null`.

#### Scenario: Plantillas en los strings, claves literales
- **GIVEN** `nombre` = `"Ana"`, `n` = 3 y un `http` `POST` con `body` `{"nombre": "{{nombre}}", "edad": "{{n}}", "fijo": 3, "ok": true, "nada": null, "tags": ["{{nombre}}"], "{{nombre}}": "k"}`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el host recibe `body` `{"nombre":"Ana","edad":"3","fijo":3,"ok":true,"nada":null,"tags":["Ana"],"{{nombre}}":"k"}`

#### Scenario: Body que es un string
- **GIVEN** `nombre` = `"Ana"` y un `http` `POST` con `body` `"hola {{nombre}}"`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el host recibe `body` `"hola Ana"` (con las comillas: es un texto JSON)

### Requirement: Orden de cabeceras y claves del body
El «orden del flujo» de las cabeceras y de las claves del body SHALL ser el orden en que la forma JSON del flujo enumera sus propiedades: los nombres que son índices de array, como `"2"`, van primero y en orden numérico, y después los demás en el orden en que se escribieron. Las claves `__proto__` o `constructor` son claves normales.

#### Scenario: Orden de las claves
- **GIVEN** un flujo leído de un texto JSON con un `http` `POST` cuyo `body` es `{"b": 1, "2": 2, "a": {"z": 0, "1": 1}}`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el host recibe `body` `{"2":2,"b":1,"a":{"1":1,"z":0}}`

#### Scenario: Claves con nombre de Object
- **GIVEN** `nombre` = `"Ana"`, un flujo leído de un texto JSON con un `http` `POST` cuyo `body` es `{"__proto__": "{{nombre}}", "constructor": 1}`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el host recibe `body` `{"__proto__":"Ana","constructor":1}`

### Requirement: Valores insertados en la URL
Al renderizar la `url`, el motor SHALL sustituir cada marcador por la forma textual del valor, codificada en UTF-8 con `%XX` en mayúsculas salvo `A-Z`, `a-z`, `0-9`, `-`, `.`, `_` y `~`. El texto literal de la plantilla no se codifica. Una forma textual con un sustituto UTF-16 suelto hace la URL inválida (ver «Petición que no se puede construir»).

#### Scenario: Un valor no cambia la ruta ni la consulta
- **GIVEN** `id` = `"../admin"`, `q` = `"a b&c=d#e"` y un `http` `GET` con `url` `"https://api.example.com/users/{{id}}?q={{q}}"`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el host recibe `url` `"https://api.example.com/users/..%2Fadmin?q=a%20b%26c%3Dd%23e"`

#### Scenario: Texto no ASCII, números y objetos
- **GIVEN** `nombre` = `"José"`, `n` = 1500.5, `d` = `{"a": 1}`, `x` sin valor y un `http` `GET` con `url` `"https://api.example.com/buscar?nombre={{nombre}}&n={{n}}&d={{d}}&x={{x}}"`
- **WHEN** se ejecuta
- **THEN** el host recibe `url` `"https://api.example.com/buscar?nombre=Jos%C3%A9&n=1500.5&d=%7B%22a%22%3A1%7D&x="`

#### Scenario: Una variable no puede añadir los caracteres / ? # @ :
- **GIVEN** `base` = `"https://api.example.com"`, `sub` = `"evil.com/"` y un host que ofrece `http`
- **WHEN** se ejecutan por separado un `http` con `url` `"{{base}}/x"` y otro con `url` `"https://{{sub}}.example.com/"`
- **THEN** ambos continúan en `onError` con un evento `http` de `error` `invalid_url` y `attempts` 0, y `http` no se ha llamado

#### Scenario: Esquema con plantilla
- **GIVEN** un `http` `GET` con `url` `"http{{s}}://api.example.com/"` y un host que ofrece `http`
- **WHEN** se ejecuta por separado con `s` = `"s"` y con `s` = `"x"`
- **THEN** el primero llama al host con `url` `"https://api.example.com/"` y el segundo continúa en `onError` con `error` `invalid_url` (un valor puede completar el esquema, pero la URL tiene que acabar empezando por `http://` o `https://`)

#### Scenario: Etiquetas del host que el autor deja abiertas
- **GIVEN** un `http` `GET` con `url` `"https://{{sub}}.example.com/"` y un host que ofrece `http`
- **WHEN** se ejecuta por separado con `sub` = `"api"` y con `sub` = `"api.eu"`
- **THEN** el host recibe `url` `"https://api.example.com/"` y `"https://api.eu.example.com/"` (el autor decidió que esa parte del host sale de una variable; un valor solo aporta caracteres no reservados, y el `.` es uno de ellos, así que sí puede añadir etiquetas)

#### Scenario: Sustituto suelto en un valor
- **GIVEN** la variable de contacto `ref` inyectada con `"a\ud800"` y un `http` con `url` `"https://api.example.com/?ref={{ref}}"`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** continúa en `onError` con `error` `invalid_url`, sin llamar al host y sin que la promesa se rechace

### Requirement: URL de la petición
La URL renderizada SHALL empezar por `http://` o `https://` (sin distinguir mayúsculas); no contener blancos, controles, `Default_Ignorable_Code_Point`, sustitutos UTF-16 sueltos, `\`, `#` ni `%` en el host, y no tener segmentos de ruta `.` o `..`, tampoco escritos con `%2e` en cualquier combinación de mayúsculas (`.%2E`, `%2e.`). Si no, la petición no se puede construir (`invalid_url`).

#### Scenario: Esquemas y formas no permitidos
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"ftp://api.example.com/"`, `"api.example.com/x"`, `"https://user:pass@api.example.com/"`, `"https://api.example.com/a#b"`, `"https://api.example.com/a\b"`, `"https://api.example.com/a b"`, `"https://api.example.com/a​b"`, `"https://exa%41mple.com/"` y `"https://api%2eexample.com/"`
- **THEN** cada uno continúa en `onError` con `error` `invalid_url` y sin llamar al host

#### Scenario: Sustituto suelto en el texto de la URL
- **GIVEN** un flujo construido en memoria con un `http` `GET` cuya `url` es `"https://api.example.com/a\ud800"`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** continúa en `onError` con `error` `invalid_url` (el parser lo cambiaría en silencio por `%EF%BF%BD`)

#### Scenario: Segmentos de punto
- **GIVEN** `id` = `".."` y un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"https://api.example.com/users/../admin"`, `"https://api.example.com/users/%2E%2e/admin"`, `"https://api.example.com/users/.%2E/admin"`, `"https://api.example.com/users/%2e./admin"`, `"https://api.example.com/users/%2e/x"`, `"https://api.example.com/users/./x"` y `"https://api.example.com/users/{{id}}"`
- **THEN** cada uno continúa en `onError` con `error` `invalid_url` (el parser de WHATWG llevaría todos a otra ruta)

#### Scenario: Segmentos que no son de punto
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"https://api.example.com/u/..a"`, `"https://api.example.com/u/..."` y `"https://api.example.com/u/%252e%252e"`
- **THEN** el host recibe las tres URL sin cambios en la ruta

#### Scenario: Consulta pegada al host
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"https://api.example.com?x=/../y"` y `"https://api.example.com?x=/./y"`
- **THEN** el host recibe `"https://api.example.com/?x=/../y"` y `"https://api.example.com/?x=/./y"` (la ruta está vacía: una `/` de la consulta no abre una ruta, y su `..` no es un segmento)

### Requirement: Destino y longitud de la URL
La URL renderizada SHALL ser una URL absoluta WHATWG sin usuario ni contraseña cuyo host serializado cumpla la regla de «Host de una url» y no sea `localhost` ni termine en `.localhost`, y tener 8192 unidades como mucho tanto antes como después de serializarla. El host recibe la serialización. Si no, la petición no se puede construir (`invalid_url`).

#### Scenario: URLs válidas y su serialización
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"HTTPS://API.Example.com:8443/v1/leads?x=1"`, `"https://exámple.com/a"`, `"https://api.example.com/búsqueda"` y `"https://api.example.com/u?x=../a"`
- **THEN** el host recibe respectivamente `"https://api.example.com:8443/v1/leads?x=1"`, `"https://xn--exmple-qta.com/a"`, `"https://api.example.com/b%C3%BAsqueda"` y `"https://api.example.com/u?x=../a"` (un `..` en la consulta no es un segmento de ruta)

#### Scenario: Destinos internos
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"http://127.0.0.1/"`, `"http://2130706433/"`, `"http://0x7f.1/"`, `"http://１２７．０．０．１/"` (dígitos y puntos de ancho completo), `"http://[::1]/"`, `"http://localhost:8080/"`, `"http://api.localhost/"`, `"http://169.254.169.254/latest/meta-data"` y `"http://intranet/"`
- **THEN** cada uno continúa en `onError` con un evento `http` `{attempts: 0, status: null, error: "invalid_url"}` y `http` no se ha llamado (el parser convierte las formas anchas y numéricas en `127.0.0.1`)

#### Scenario: Longitud máxima de la URL
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"https://api.example.com/"` seguido de 8168 `"a"` (8192 en total) y de 8169 `"a"`
- **THEN** el primero llama al host y el segundo continúa en `onError` con `error` `invalid_url`

#### Scenario: Longitud antes de serializar
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` `GET` con `url` `"https://api.example.com:443/"` seguido de 8164 `"a"` (8192 unidades; su serialización quita `:443` y tiene 8188) y de 8165 `"a"` (8193 unidades; su serialización tendría 8189)
- **THEN** el primero llama al host con la `url` sin `:443` y el segundo continúa en `onError` con `error` `invalid_url`

#### Scenario: Valor que crece al codificarse
- **GIVEN** un `http` `GET` con `url` `"https://api.example.com/?q={{v}}"` y un host que ofrece `http`
- **WHEN** se ejecuta por separado con `v` = 907 caracteres `"中"` y con 908
- **THEN** el primero llama al host con una `url` de 8190 unidades y el segundo continúa en `onError` con `error` `invalid_url` (cada `中` se codifica como `%E4%B8%AD`: la URL renderizada tendría 8199)

### Requirement: Valores de cabecera
Cada valor de cabecera renderizado SHALL contener solo caracteres ASCII visibles (U+0021 a U+007E), espacios y tabuladores; si no, la petición no se puede construir (`invalid_header_value`). Así, un valor insertado no puede añadir cabeceras ni partir la petición.

#### Scenario: Salto de línea insertado
- **GIVEN** `v` = `"Ana\r\nX-Admin: 1"` y un `http` con la cabecera `{"X-Nombre": "{{v}}"}`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** continúa en `onError` con un evento `http` `{attempts: 0, status: null, error: "invalid_header_value"}` y `http` no se ha llamado

#### Scenario: Caracteres no ASCII y valores admitidos
- **GIVEN** un host que ofrece `http`
- **WHEN** se ejecutan por separado `http` con la cabecera `{"X-Nombre": "José"}`, `{"X-Vacia": ""}` y `{"Authorization": "Bearer {{t}}"}` con `t` = `"abc.def-123"`
- **THEN** el primero continúa en `onError` con `error` `invalid_header_value`, y los otros dos llaman al host con `value` `""` y `"Bearer abc.def-123"`

### Requirement: Tamaño máximo del body
La serialización JSON del body SHALL tener como mucho 65536 unidades de código UTF-16; si las supera, la petición no se puede construir (`body_too_large`).

#### Scenario: Body por encima y por debajo del límite
- **GIVEN** la variable `a` con un `default` de 16000 caracteres `"a"` y un host que ofrece `http`
- **WHEN** se ejecutan por separado un `http` `POST` con `body` `["{{a}}", "{{a}}", "{{a}}", "{{a}}"]` (64013 unidades) y otro con cinco elementos (80016)
- **THEN** el primero llama al host y el segundo continúa en `onError` con `error` `body_too_large`

### Requirement: Petición que no se puede construir
Si la URL, un valor de cabecera o el body no cumplen sus requisitos, el motor MUST NOT llamar al host: emite un evento `http` con `attempts` 0, `status` `null` y el motivo (`invalid_url`, `invalid_header_value` o `body_too_large`) y continúa en `onError` sin modificar variables. Se comprueban en este orden: URL, cabeceras en el orden del flujo y body.

#### Scenario: Se sigue por onError
- **GIVEN** un `http` `h` con `url` `"http://localhost/"`, `next` hacia un `end` con `outcome` `"ok"` y `onError` hacia un `end` con `outcome` `"ko"`, y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son `{type: "http", nodeId: "h", attempts: 0, status: null, error: "invalid_url"}` y el `end` con `outcome` `"ko"`

#### Scenario: La URL se comprueba antes que las cabeceras
- **GIVEN** un `http` con `url` `"http://localhost/"` y la cabecera `{"X-Nombre": "José"}`, y un host que ofrece `http`
- **WHEN** se ejecuta
- **THEN** el evento `http` tiene `error` `invalid_url`

### Requirement: Tamaño máximo de los textos de un http
Cada valor de cabecera y cada string del `body` de un `http`, ya renderizados, SHALL respetar el límite de «Tamaño máximo de un texto renderizado». Si uno lo supera, la sesión MUST fallar con `value_too_large` y el `nodeId` del http, sin llamar al host ni emitir el evento `http`. La `url` se rige por su propio límite (ver «Destino y longitud de la URL»).

#### Scenario: String del body demasiado largo
- **GIVEN** la variable `a` con un `default` de 16384 caracteres `"a"`, un `message` previo y un `http` `POST` con `body` `{"t": "{{a}}!"}`, y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son el `message` y un `error` `value_too_large` con el `nodeId` del `http`, y `http` no se ha llamado

#### Scenario: Justo en el límite y URL larga
- **GIVEN** la variable `a` con un `default` de 16384 caracteres `"a"` y un host que ofrece `http`
- **WHEN** se ejecutan por separado un `http` con la cabecera `{"X-A": "{{a}}"}` y otro con `url` `"https://api.example.com/?q={{a}}"`
- **THEN** el primero llama al host, y el segundo continúa en `onError` con `error` `invalid_url` (no falla con `value_too_large`)

### Requirement: Resultado de un intento
La promesa de `http` SHALL resolverse con uno de: `{kind: "response", status, body}` (`status` entero de 200 a 599, `body` el cuerpo decodificado como string), `{kind: "timeout"}`, `{kind: "network_error", requestSent}` (`requestSent` boolean u omitido, que equivale a `true`), `{kind: "blocked"}`, `{kind: "response_too_large"}` o `{kind: "missing_secret"}`. Las propiedades adicionales se ignoran.

#### Scenario: Propiedades adicionales
- **GIVEN** un `http` `GET` y un host cuyo `http` devuelve `{kind: "response", status: 200, body: "{}", headers: {"set-cookie": "s=1"}}`
- **WHEN** se ejecuta
- **THEN** el intento es un éxito y la sesión continúa en `next`

#### Scenario: requestSent omitido
- **GIVEN** un `http` `POST` con `retries` 2 y un host que devuelve `{kind: "network_error"}`
- **WHEN** se ejecuta
- **THEN** `http` se ha llamado una vez (se toma como enviada) y continúa en `onError` con `error` `network_error`

### Requirement: Resultado del host fuera de contrato
Si leer `http` del host lanza, si `http` lanza, si su promesa se rechaza o si resuelve con algo que no es un resultado de «Resultado de un intento» (también si leer una de sus propiedades lanza), la sesión MUST fallar con `http_host_error` y el `nodeId` del http, sin reintentar, sin seguir por `onError`, sin evento `http` y sin que el error incluya nada de lo que lanzó o devolvió el host. La promesa del motor no se rechaza.

#### Scenario: El host rechaza con un mensaje sensible
- **GIVEN** la variable `email` con `pii: true` y valor `"ana@example.com"`, un `http` `GET` con `retries` 3 y un host cuyo `http` rechaza con un error cuyo mensaje es `"fallo en https://api.example.com/?e=ana@example.com"`
- **WHEN** se ejecuta
- **THEN** la sesión falla con `http_host_error`, `http` se ha llamado una vez y ni el evento `error` ni el error del estado contienen `"ana@example.com"`

#### Scenario: Resultados mal formados
- **GIVEN** un `http` `GET` y un host que ofrece `http`
- **WHEN** el host devuelve por separado `null`, `{kind: "otro"}`, `{kind: "response", status: 199, body: ""}`, `{kind: "response", status: 600, body: ""}`, `{kind: "response", status: 200.5, body: ""}`, `{kind: "response", status: 200, body: 5}`, `{kind: "network_error", requestSent: "no"}`, un objeto cuyo getter `kind` lanza, o lanza de forma síncrona
- **THEN** cada sesión falla con `http_host_error` y ninguna promesa se rechaza

#### Scenario: Capacidad que lanza al leerla
- **GIVEN** un `http` `GET` y un host cuya propiedad `http` es un getter que lanza
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `http_host_error` y el `nodeId` del `http`, y la promesa no se rechaza

### Requirement: Secreto no disponible
Si el host resuelve un intento con `{kind: "missing_secret"}`, la sesión MUST fallar con `missing_secret` y el `nodeId` del http, sin reintentar, sin seguir por `onError` y sin evento `http`.

#### Scenario: Secreto que falta en el ejemplo
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano` y un host cuyo `http` devuelve `{kind: "missing_secret"}`
- **WHEN** el host continúa con `{choice: "grande"}`
- **THEN** el único evento es un `error` `missing_secret` con `nodeId` `enviar-crm`, `http` se ha llamado una vez y el resultado tiene `status` `failed`

### Requirement: Éxito de la llamada
Un intento que resuelve con `{kind: "response"}` y un `status` de 200 a 299 SHALL ser un éxito: el motor aplica `responseMap` (ver «Asignación de la respuesta»), emite el evento `http` con `error` `null` y continúa en `next`. Sin `responseMap`, o con un `responseMap` vacío, el cuerpo no se parsea.

#### Scenario: Códigos 2xx y cuerpos que no son JSON
- **GIVEN** un `http` `GET` sin `responseMap`, con `next` hacia un `end` con `outcome` `"ok"`
- **WHEN** el host devuelve por separado status 204 con `body` `""`, status 201 con `body` `"<html>"` y status 299 con `body` `"{"`
- **THEN** las tres sesiones terminan con `outcome` `"ok"`

### Requirement: Error de la llamada
Un intento que no es un éxito SHALL ser un error con un motivo: `http_status` (status fuera de 200-299, incluidas las redirecciones), `timeout`, `network_error`, `blocked` o `response_too_large`. Si no se reintenta (ver «Reintentos»), el motor emite el evento `http` con el motivo del último intento y continúa en `onError` sin modificar variables.

#### Scenario: Status de error y redirección
- **GIVEN** un `http` `h` `GET` con `retries` 1 y `onError` hacia un `end` con `outcome` `"ko"`
- **WHEN** el host devuelve por separado status 404 y status 301
- **THEN** cada sesión emite `{type: "http", nodeId: "h", attempts: 1, status: <el status>, error: "http_status"}` y termina con `outcome` `"ko"`

#### Scenario: Errores sin respuesta
- **GIVEN** un `http` `GET` con `retries` 0
- **WHEN** el host devuelve por separado `{kind: "timeout"}`, `{kind: "blocked"}`, `{kind: "response_too_large"}` y `{kind: "network_error", requestSent: false}`
- **THEN** cada evento `http` tiene `status` `null` y `error` respectivamente `timeout`, `blocked`, `response_too_large` y `network_error`

#### Scenario: Un error no toca las variables
- **GIVEN** la variable `ticket` = `"previo"` y un `http` con `responseMap` `[{variable: "ticket", pointer: "/id"}]` cuyo host devuelve status 500 con `body` `"{\"id\": \"T-9\"}"`
- **WHEN** se ejecuta
- **THEN** `ticket` sigue valiendo `"previo"`

### Requirement: Reintentos
Tras un intento con error, el motor SHALL hacer otro si el error es reintentable para el método (ver «Reintentos e idempotencia») y aún no ha hecho 1 + `retries` intentos (`retries` es el del nodo o 1). Cada intento lleva su `attempt`. Un error no reintentable corta los intentos. Un nodo `http` cuenta como un solo paso del límite de pasos, haga los intentos que haga.

#### Scenario: Reintento por defecto
- **GIVEN** un `http` `GET` sin `retries` y un host que devuelve status 503 y después status 200
- **WHEN** se ejecuta
- **THEN** `http` se ha llamado con `attempt` 1 y 2, y el evento `http` es `{attempts: 2, status: 200, error: null}` (con su `type` y `nodeId`)

#### Scenario: Reintentos agotados
- **GIVEN** un `http` `GET` con `retries` 2 y un host que devuelve siempre status 503
- **WHEN** se ejecuta
- **THEN** `http` se ha llamado 3 veces y el nodo continúa en `onError` con `{attempts: 3, status: 503, error: "http_status"}`

#### Scenario: Errores que cortan los intentos
- **GIVEN** un `http` `GET` con `retries` 5
- **WHEN** el host devuelve por separado siempre status 404, siempre status 501, siempre `{kind: "blocked"}` y siempre `{kind: "response_too_large"}`
- **THEN** en cada caso `http` se ha llamado una sola vez

#### Scenario: Sin reintentos
- **GIVEN** un `http` `GET` con `retries` 0 y un host que devuelve status 503
- **WHEN** se ejecuta
- **THEN** `http` se ha llamado una sola vez

#### Scenario: Los intentos no cuentan como pasos
- **GIVEN** una cadena lineal de 198 nodos `set` o `jump`, un `http` `GET` con `retries` 2 y un `end` como `next` y `onError` (200 nodos ejecutados), y un host que devuelve 503, 503 y 200
- **WHEN** el host arranca una sesión
- **THEN** la sesión termina con `status` `ended`

### Requirement: Reintentos e idempotencia
Los status 408 y 429 y `network_error` con `requestSent` `false` SHALL ser reintentables en todos los métodos. Los status 500, 502, 503 y 504, `timeout` y `network_error` con `requestSent` `true` SHALL ser reintentables solo en `GET`, `PUT` y `DELETE`, nunca en `POST` ni `PATCH`, porque el servidor pudo haber procesado la petición. Ningún otro error es reintentable.

#### Scenario: POST tras un timeout o un 503
- **GIVEN** un `http` `POST` con `retries` 2
- **WHEN** el host devuelve por separado siempre `{kind: "timeout"}`, siempre status 503 y siempre `{kind: "network_error", requestSent: true}`
- **THEN** en cada caso `http` se ha llamado una sola vez y el nodo continúa en `onError`

#### Scenario: Errores que se reintentan en cualquier método
- **GIVEN** un `http` `POST` con `retries` 2 y otro `PATCH` con `retries` 1
- **WHEN** el host del `POST` devuelve 429, 408 y 201, y el del `PATCH` devuelve `{kind: "network_error", requestSent: false}` y 200
- **THEN** el `POST` hace 3 intentos y el `PATCH` 2, y ambos continúan en `next`

#### Scenario: Métodos idempotentes
- **GIVEN** un `http` `PUT` y otro `DELETE`, ambos con `retries` 1
- **WHEN** el host del `PUT` devuelve `{kind: "timeout"}` y 200, y el del `DELETE` devuelve 500 y 204
- **THEN** ambos hacen 2 intentos y continúan en `next`

#### Scenario: Error del CRM en el ejemplo
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano` y un host que devuelve siempre status 500
- **WHEN** el host continúa con `{choice: "pequena"}`
- **THEN** `http` se ha llamado una vez (el nodo es un `POST`, aunque tenga `retries` 2) y los eventos son el `http` de `enviar-crm` con `{attempts: 1, status: 500, error: "http_status"}`, un `message` y un `end` con `outcome` `"lead-sin-enviar"`

### Requirement: Tiempo de espera y pausas
El motor SHALL entregar `timeoutMs` en cada intento y dejar que lo aplique el host (ver «Host de producción: tiempo por intento»). No mide el tiempo, no espera entre intentos y toma el resultado que devuelva el host, tarde lo que tarde. Un host MAY esperar antes de un intento con `attempt` mayor que 1.

#### Scenario: Respuesta que llega tarde
- **GIVEN** un `http` `GET` con `timeoutMs` 1000, temporizadores simulados y un host que devuelve status 200 después de avanzar 60000 ms de tiempo simulado
- **WHEN** se ejecuta
- **THEN** el intento es un éxito y la sesión continúa en `next`

#### Scenario: El motor no espera entre reintentos
- **GIVEN** un `http` `GET` con `retries` 2, temporizadores simulados y detenidos, y un host que devuelve al momento 503, 503 y 200
- **WHEN** el host arranca una sesión
- **THEN** la operación se resuelve sin avanzar los temporizadores

### Requirement: Límite de llamadas al host por avance
Cada operación SHALL hacer como mucho 10 llamadas externas al host, contando los reintentos; hoy solo las hace `http`, y el nodo `llm` compartirá el mismo presupuesto. Un reintento que sería la llamada 11 no se hace: el nodo continúa en `onError` con el motivo de su último intento. Un primer intento que sería la llamada 11 hace fallar la sesión con `http_limit_exceeded` y el `nodeId` de ese http, sin evento `http`. El contador se reinicia en cada operación.

#### Scenario: Ciclo de llamadas
- **GIVEN** un ciclo `http` `h` → `condition` → `h`, donde el `next` y el `onError` de `h` van al `condition`, cuya regla nunca se cumple y lleva a un `end`, y cuyo `else` vuelve a `h`; y un host que devuelve siempre status 200
- **WHEN** el host arranca una sesión
- **THEN** se emiten 10 eventos `http` seguidos de un `error` `http_limit_exceeded` con `nodeId` `h`, y `http` se ha llamado 10 veces

#### Scenario: Reintentos recortados por el límite
- **GIVEN** un `http` `a` `GET` con `retries` 5 cuyo `next` y `onError` van a un `http` `b` `GET` con `retries` 5, con `next` hacia un `end` `"ok"` y `onError` hacia un `end` `"ko"`, y un host que devuelve siempre status 503
- **WHEN** el host arranca una sesión
- **THEN** los eventos `http` son el de `a` con `attempts` 6 y el de `b` con `attempts` 4, y la sesión termina con `outcome` `"ko"`

#### Scenario: El contador se reinicia al continuar
- **GIVEN** una cadena de 10 `http` (cada uno con `next` y `onError` hacia el siguiente), seguida de un `input` y de un `http` más que lleva a un `end`, y un host que devuelve siempre status 200
- **WHEN** el host arranca una sesión y después la continúa con una respuesta válida
- **THEN** el arranque hace 10 llamadas y queda en `waiting`, y la continuación hace una llamada y termina con `status` `ended`

### Requirement: Asignación de la respuesta
Tras un éxito con `responseMap` no vacío, el motor SHALL parsear `body` como texto JSON y, entrada a entrada y en orden, resolver `pointer` según RFC 6901 (`~1` es `/` y `~0` es `~`; en un array, solo un índice decimal sin ceros a la izquierda y dentro de rango; en un objeto, solo propiedades propias) y asignar a `variable` el valor encontrado, o dejarla sin valor si no hay ninguno o es `null`.

#### Scenario: Ticket del ejemplo de FAQ
- **GIVEN** un `http` con `responseMap` `[{variable: "ticket", pointer: "/id"}]` y un host que devuelve status 201 con `body` `"{\"id\": \"T-1\", \"eco\": \"otro\"}"`
- **WHEN** se ejecuta
- **THEN** `ticket` vale `"T-1"` y la sesión continúa en `next`

#### Scenario: Tipos y punteros
- **GIVEN** un host que devuelve status 200 con el cuerpo `{"n": 3, "ok": true, "lista": [1, {"a": "x"}], "o": {"b": null}}` y un `http` cuyo `responseMap` asigna `"/n"`, `"/ok"`, `"/lista/1/a"`, `"/lista"` y `""` a cinco variables declaradas
- **WHEN** se ejecuta
- **THEN** las variables valen el number 3, el boolean true, el string `"x"`, el array `[1, {"a": "x"}]` y el documento entero

#### Scenario: Punteros que no encuentran nada
- **GIVEN** el mismo cuerpo, una variable `v` con `default: "previo"` y, por separado, `responseMap` `[{variable: "v", pointer: p}]` con `p` en `"/o/b"`, `"/falta"`, `"/lista/2"`, `"/lista/01"`, `"/lista/-"` y `"/n/x"`
- **WHEN** se ejecuta cada uno y después se evalúa `v isSet`
- **THEN** cada sesión continúa en `next` y la regla es falsa

#### Scenario: Escapes y nombres de Object
- **GIVEN** un host que devuelve status 200 con el cuerpo `{"a/b": 1, "m~n": 2, "__proto__": "p"}` y un `responseMap` que asigna `"/a~1b"`, `"/m~0n"`, `"/__proto__"` y `"/constructor"` a cuatro variables declaradas
- **WHEN** se ejecuta
- **THEN** las tres primeras valen 1, 2 y `"p"`, y la cuarta queda sin valor

#### Scenario: Orden y variables de contacto
- **GIVEN** la variable de contacto `email` y un host que devuelve status 200 con el cuerpo `{"a": "x@example.com", "b": "y@example.com"}`, y un `responseMap` `[{variable: "email", pointer: "/a"}, {variable: "email", pointer: "/b"}]`
- **WHEN** se ejecuta y la sesión termina
- **THEN** los valores de contacto del estado contienen `email: "y@example.com"`

### Requirement: Respuesta que no se puede asignar
Con `responseMap` no vacío, un éxito SHALL convertirse en el error `invalid_response`, sin reintento y sin asignar ninguna variable, si `body` no es un texto JSON o si un valor encontrado anida más de 100 niveles, contiene en un string o en una clave U+0000 o un sustituto suelto, contiene un number no finito o tiene una forma textual de más de 16384 unidades. El evento `http` lleva el status recibido.

#### Scenario: Cuerpo que no es JSON
- **GIVEN** la variable `ticket` = `"previo"`, un `http` `GET` con `retries` 2 y `responseMap` `[{variable: "ticket", pointer: "/id"}]`
- **WHEN** el host devuelve por separado status 200 con `body` `"<html>"` y status 200 con `body` `""`
- **THEN** cada sesión llama al host una vez, emite `{attempts: 1, status: 200, error: "invalid_response"}`, continúa en `onError` y `ticket` sigue valiendo `"previo"`

#### Scenario: Todo o nada
- **GIVEN** las variables `a` = `"previo-a"` y `b`, y un `responseMap` `[{variable: "a", pointer: "/a"}, {variable: "b", pointer: "/b"}]` cuyo cuerpo tiene `"a": "nuevo"` y en `"b"` un string de 16385 caracteres
- **WHEN** se ejecuta
- **THEN** continúa en `onError` con `error` `invalid_response` y `a` sigue valiendo `"previo-a"`

#### Scenario: Valores que no se pueden guardar
- **GIVEN** un `responseMap` `[{variable: "v", pointer: "/v"}]`
- **WHEN** el host devuelve por separado cuerpos cuyo `"v"` es el texto JSON `"a\u0000"`, `"\ud800"`, `1e400` y `{"k\u0000": 1}`
- **THEN** cada uno continúa en `onError` con `error` `invalid_response`

#### Scenario: Límites de tamaño y profundidad
- **GIVEN** un `responseMap` `[{variable: "v", pointer: "/v"}]`
- **WHEN** el host devuelve por separado un `"v"` string de 16384 caracteres, uno de 16385, un `"v"` con 100 niveles de arrays anidados y otro con 101
- **THEN** el primero y el tercero se asignan y continúan en `next`, y el segundo y el cuarto continúan en `onError` con `error` `invalid_response`

#### Scenario: Lo que no se mapea no cuenta
- **GIVEN** un `responseMap` `[{variable: "v", pointer: "/v"}]`
- **WHEN** el host devuelve status 200 con un cuerpo cuyo `"v"` es `"ok"` y cuyo `"w"` anida 100000 niveles de arrays
- **THEN** `v` vale `"ok"`, la sesión continúa en `next` y el estado se puede serializar como JSON

### Requirement: Tamaño máximo de la respuesta
Un `body` de más de 1048576 unidades de código UTF-16 SHALL tratarse como el error `response_too_large`, sin parsearlo y sin reintento, aunque el status sea 2xx y aunque no haya `responseMap`. El evento `http` lleva el status recibido.

#### Scenario: Respuesta justo por encima del límite
- **GIVEN** un `http` `GET` sin `responseMap`
- **WHEN** el host devuelve por separado status 200 con un `body` de 1048576 caracteres y con uno de 1048577
- **THEN** el primero continúa en `next` y el segundo en `onError` con `{attempts: 1, status: 200, error: "response_too_large"}`

### Requirement: Evento http
Antes de continuar en `next` o en `onError`, un `http` SHALL emitir `{type: "http", nodeId, attempts, status, error}`: llamadas hechas al host (0 si ninguna), status del último intento si fue una respuesta (si no, `null`) y `error` `null` en un éxito o el motivo: `invalid_url`, `invalid_header_value`, `body_too_large`, `http_status`, `timeout`, `network_error`, `blocked`, `response_too_large` o `invalid_response`.

#### Scenario: Evento de un éxito
- **GIVEN** un flujo `message` → `http` `h` → `end`, y un host que devuelve status 200
- **WHEN** el host arranca una sesión
- **THEN** los eventos son el `message`, `{type: "http", nodeId: "h", attempts: 1, status: 200, error: null}` y el `end`

#### Scenario: Sin evento http cuando la sesión falla
- **GIVEN** un `http` y un host que devuelve `{kind: "missing_secret"}`
- **WHEN** se ejecuta
- **THEN** no hay ningún evento `http` y el último evento es el `error`

### Requirement: Privacidad de la llamada http
El evento `http`, los eventos `error` y el error del estado MUST NOT incluir la URL renderizada, valores de cabecera, el body, el cuerpo de la respuesta, nada de lo que devuelva o lance el host ni el valor de un secreto. De la respuesta, solo los valores que asigna `responseMap` llegan al estado, y únicamente en su variable.

#### Scenario: Datos personales en la petición
- **GIVEN** la variable `email` con `pii: true` y valor `"ana@example.com"`, y por separado un `http` con `url` `"http://localhost/?e={{email}}"` y otro con `body` `{"e": "{{email}}"}` cuyo host devuelve status 404
- **WHEN** se ejecuta cada uno
- **THEN** ningún evento contiene `"ana@example.com"`

#### Scenario: Respuesta no mapeada
- **GIVEN** un `responseMap` `[{variable: "ticket", pointer: "/id"}]` y un host que devuelve status 200 con el cuerpo `{"id": "T-1", "eco": "SECRETO-ECO"}`
- **WHEN** se ejecuta y la sesión termina
- **THEN** ni los eventos ni el estado serializado como JSON contienen `"SECRETO-ECO"`

#### Scenario: Valor de un secreto devuelto por el host
- **GIVEN** un `http` con la cabecera `{"Authorization": {"secret": "CRM_TOKEN"}}` y, por separado, hosts que resuelven `CRM_TOKEN` a un valor marcador y después lanzan un error con el marcador en el mensaje, rechazan con el marcador, devuelven status 500 con el marcador en el `body`, o devuelven status 200 con el marcador en una propiedad adicional
- **WHEN** se ejecuta cada uno y la sesión termina o falla
- **THEN** ni la petición recibida por el host, ni los eventos, ni el estado serializado como JSON contienen el marcador

### Requirement: Indicador de datos personales
`containsPii` SHALL ser `true` si la plantilla de la `url`, la de algún valor de cabecera o algún string del `body` contiene un marcador de una variable personal, tenga o no valor; si no, `false`. Es personal una variable declarada con `pii: true` y, de forma transitiva, toda variable a la que algún `set` del flujo asigna un string cuya plantilla nombra una variable personal, se ejecute o no ese `set`.

#### Scenario: Plantillas con y sin variables pii
- **GIVEN** las variables `email` con `pii: true` y sin valor, y `segmento` sin `pii`, y un host que ofrece `http`
- **WHEN** se ejecutan por separado un `http` `POST` con `body` `{"s": "{{segmento}}"}`, uno con la cabecera `{"X-Email": "{{email}}"}` y uno `GET` cuyo `responseMap` asigna `"/e"` a `email`
- **THEN** el host recibe `containsPii` respectivamente `false`, `true` y `false`

#### Scenario: Variables derivadas de una pii con set
- **GIVEN** la variable `email` con `pii: true`, un `set` que asigna `saludo` = `"Hola {{email}}"`, `copia` = `"{{saludo}}"` y `fijo` = `"sin datos"`, y un host que ofrece `http`
- **WHEN** se ejecutan por separado, después del `set`, un `http` `POST` con `body` `{"t": "{{copia}}"}` y otro con `body` `{"t": "{{fijo}}"}`
- **THEN** el host recibe `containsPii` respectivamente `true` y `false`

### Requirement: Host de producción: destinos de red
El host de producción MUST devolver `{kind: "blocked"}` sin enviar nada si la dirección a la que va a conectar no es unicast global: loopback, privada, de enlace local (incluida la de metadatos 169.254.169.254), no especificada, compartida (100.64.0.0/10), multicast, broadcast o reservada, también como IPv4 mapeada en IPv6. Una instalación MAY permitir destinos concretos por configuración explícita (ver «Host de producción: destinos permitidos y resolución»).

#### Scenario: Dominios que resuelven a direcciones internas
- **GIVEN** un host de producción sin destinos permitidos para esos puertos y nombres DNS que resuelven, uno por clase, a `127.0.0.1`, `0.0.0.0`, `10.0.0.5`, `172.16.0.1`, `172.31.255.254`, `192.168.1.1`, `100.64.0.1`, `169.254.169.254`, `224.0.0.1`, `255.255.255.255`, `240.0.0.1`, `192.0.2.1`, `198.18.0.1`, `::1`, `::`, `fe80::1`, `fc00::1`, `fd12:3456::1`, `ff02::1`, `2001:db8::1`, `::ffff:127.0.0.1`, `::ffff:10.0.0.5`, y las mismas escritas de otra forma: `::ffff:7f00:1`, `0:0:0:0:0:0:0:1` y `0000:0000:0000:0000:0000:0000:0000:0001`
- **WHEN** recibe una petición a cada uno
- **THEN** devuelve `{kind: "blocked"}` en todos los casos y no abre ninguna conexión

### Requirement: Host de producción: destinos permitidos y resolución
El host de producción SHALL comprobar la dirección real de cada conexión, no una resolución previa, y MUST NOT conectar con ninguna dirección no permitida de una resolución, aunque otras de la misma resolución sí lo estén. Un destino permitido por configuración es una dirección **y** un puerto exactos: permitir `127.0.0.2:8443` no permite `127.0.0.2:80`.

#### Scenario: Cambio de resolución entre comprobación y conexión
- **GIVEN** un nombre DNS que primero resuelve a una dirección pública y, en la resolución siguiente, a `127.0.0.1`
- **WHEN** el host de producción recibe una petición a ese nombre
- **THEN** no conecta con `127.0.0.1`: o conecta con la dirección pública que comprobó o devuelve `{kind: "blocked"}`

#### Scenario: Resolución con respuestas mezcladas
- **GIVEN** un destino permitido A con un servidor que responde, un destino permitido R en el que nadie escucha, y un nombre DNS que resuelve, en rondas separadas, a `[A, 127.0.0.1]`, a `[127.0.0.1, A]` y a `[R, 127.0.0.1]`
- **WHEN** el host de producción recibe en cada ronda una petición a ese nombre, con el puerto del destino permitido
- **THEN** en ninguna ronda conecta con `127.0.0.1` en ese puerto; en las dos primeras recibe la respuesta de A o devuelve `{kind: "blocked"}`, y en la tercera devuelve `{kind: "blocked"}` o `{kind: "network_error"}` (no salta a `127.0.0.1` al fallar R)

### Requirement: Host de producción: redirecciones y credenciales propias
El host de producción MUST NOT seguir redirecciones: entrega la respuesta 3xx como `{kind: "response"}`. MUST NOT añadir credenciales propias (cookies guardadas, autenticación del entorno) ni usar un proxy que no aplique la misma política de destinos, y MUST verificar los certificados TLS.

#### Scenario: Redirección a un destino interno
- **GIVEN** un servidor público que responde 302 con `Location: http://127.0.0.1/`
- **WHEN** el host de producción recibe una petición a ese servidor
- **THEN** devuelve `{kind: "response", status: 302, body}` y no hace una segunda petición

#### Scenario: Cookies de una respuesta anterior
- **GIVEN** un servidor permitido que responde con `Set-Cookie: s=1`
- **WHEN** el host de producción recibe dos peticiones seguidas a ese servidor
- **THEN** la segunda llega al servidor sin cabecera `Cookie`

#### Scenario: Certificado no válido
- **GIVEN** un servidor permitido con un certificado TLS que no está firmado por una autoridad de confianza
- **WHEN** el host de producción recibe una petición `https` a ese servidor
- **THEN** devuelve `{kind: "network_error", requestSent: false}` y el servidor no recibe la petición

### Requirement: Host de producción: tamaño de la respuesta
El host de producción MUST dejar de leer y devolver `{kind: "response_too_large"}` en cuanto el cuerpo que entregaría supere 1048576 bytes. MUST decodificar `gzip`, `deflate` y `br` y aplicar el límite a lo ya descomprimido; con otra codificación que no decodifique, lo aplica a los bytes recibidos. MUST entregar el cuerpo decodificado como UTF-8.

#### Scenario: Cuerpo sin fin
- **GIVEN** un servidor que escribe un cuerpo sin fin hasta que el cliente cierra la conexión
- **WHEN** el host de producción recibe una petición con `timeoutMs` 5000
- **THEN** devuelve `{kind: "response_too_large"}` antes de que venza el tiempo

#### Scenario: Cuerpo comprimido sin fin
- **GIVEN** servidores que escriben sin fin un cuerpo de ceros comprimido con `gzip`, con `deflate`, con `br` y con una codificación desconocida (`x-franca-test`)
- **WHEN** el host de producción recibe una petición con `timeoutMs` 5000 a cada uno
- **THEN** devuelve `{kind: "response_too_large"}` en los cuatro casos antes de que venza el tiempo (un host que acumula lo descomprimido sin límite acaba en `timeout` o sin memoria)

#### Scenario: Bomba de descompresión
- **GIVEN** servidores que responden con un cuerpo de `a` de menos de 64 KiB comprimido con `gzip`, con `deflate` y con `br`, que descomprime a 2 MiB, y otro en `gzip` que descomprime a 1048576 bytes justos
- **WHEN** el host de producción recibe una petición a cada uno
- **THEN** devuelve `{kind: "response_too_large"}` en los tres primeros (un host que solo limita los bytes de red los entregaría) y `{kind: "response", status: 200, body}` con un `body` de 1048576 caracteres en el último

### Requirement: Host de producción: tiempo por intento
El host de producción MUST abortar un intento que no haya recibido la respuesta completa en `timeoutMs`, contados desde que empieza el intento (resolución, conexión, envío y lectura incluidos) como tope total y no como tiempo de inactividad, y devolver `{kind: "timeout"}`. Siempre resuelve con un resultado del contrato, sin rechazar la promesa.

#### Scenario: Servidor que se queda a medias
- **GIVEN** un servidor que envía las cabeceras de la respuesta y deja de enviar el cuerpo
- **WHEN** el host de producción recibe una petición con `timeoutMs` 500
- **THEN** devuelve `{kind: "timeout"}` entre 500 ms y 500 ms más la tolerancia del entorno

#### Scenario: Servidor que no responde
- **GIVEN** un servidor que acepta la conexión y la petición y nunca envía las cabeceras de la respuesta
- **WHEN** el host de producción recibe una petición con `timeoutMs` 500
- **THEN** devuelve `{kind: "timeout"}` entre 500 ms y 500 ms más la tolerancia del entorno

#### Scenario: Servidor que escribe muy despacio
- **GIVEN** un servidor que envía las cabeceras y después un byte del cuerpo cada 50 ms, sin terminar nunca
- **WHEN** el host de producción recibe una petición con `timeoutMs` 500
- **THEN** devuelve `{kind: "timeout"}` entre 500 ms y 500 ms más la tolerancia del entorno (un timeout de inactividad no vencería nunca)

### Requirement: Host de producción: fallos de conexión
El host de producción SHALL indicar `requestSent: false` en `network_error` solo cuando no llegó a enviarse ningún byte de la petición (fallo de DNS, conexión rechazada o TLS fallido), y `true` en cualquier otro fallo de red.

#### Scenario: Conexión rechazada
- **GIVEN** un destino permitido que rechaza la conexión
- **WHEN** el host de producción recibe una petición
- **THEN** devuelve `{kind: "network_error", requestSent: false}`

### Requirement: Host de producción: secretos
El host de producción MUST resolver cada cabecera `{name, secret}` con el secreto de la instalación (o del tenant) dueña del flujo, y solo si el origen de la `url` (esquema, host y puerto, comparados de forma exacta) está autorizado para ese secreto. Si no existe o no está autorizado, devuelve `{kind: "missing_secret"}` sin enviar nada. MUST NOT incluir el valor de un secreto en el resultado, en errores ni en registros.

#### Scenario: Secreto enviado a su origen
- **GIVEN** el secreto `CRM_TOKEN` autorizado solo para el origen de un servidor permitido que responde 204
- **WHEN** el host de producción recibe una petición a ese origen con la cabecera `{name: "Authorization", secret: "CRM_TOKEN"}`
- **THEN** el servidor recibe la cabecera `Authorization` con el valor del secreto y el resultado es `{kind: "response", status: 204, body: ""}`, sin el valor

#### Scenario: Secreto enviado a un origen no autorizado
- **GIVEN** el secreto `CRM_TOKEN` autorizado solo para `https://crm.example.com` y una petición con la cabecera `{name: "Authorization", secret: "CRM_TOKEN"}` a `https://eco.example.net/`, y otra a `http://crm.example.com/` (mismo host sin TLS: otro origen)
- **WHEN** el host de producción las recibe
- **THEN** devuelve `{kind: "missing_secret"}` en ambas y no abre ninguna conexión

#### Scenario: Secreto de otro tenant
- **GIVEN** un flujo del tenant A que nombra un secreto que solo existe en el tenant B
- **WHEN** el host de producción recibe la petición
- **THEN** devuelve `{kind: "missing_secret"}`

### Requirement: Host de producción: registros
El host de producción MUST NOT registrar en claro la URL, los valores de cabecera ni el body de una petición con `containsPii` `true`, ni el valor de un secreto de ninguna petición, ni el cuerpo de las respuestas. MAY registrar `nodeId`, método, origen de la URL, `attempt`, el tipo de resultado y el status.

#### Scenario: Petición con datos personales
- **GIVEN** una petición con `containsPii` `true`, `url` `"https://api.example.com/?e=ana%40example.com"` y `body` `"{\"e\":\"ana@example.com\"}"`
- **WHEN** el host de producción la ejecuta
- **THEN** sus registros no contienen `ana%40example.com` ni `ana@example.com`

### Requirement: Ejemplo de captación de leads con http
Con un host que ofrece `http`, `captacion-leads` SHALL completar la conversación: tras la última respuesta envía el lead con un `POST` y termina en `fin-empresa` o en `fin-pyme` si la llamada tiene éxito, o en `aviso-error` si no.

#### Scenario: Conversación completa con éxito
- **GIVEN** el flujo `captacion-leads` y un host que devuelve status 201
- **WHEN** el host arranca y continúa, usando cada vez el estado devuelto, con `{text: "Ana"}`, `{text: "ana@example.com"}` y `{choice: "grande"}`
- **THEN** la última operación emite el `http` de `enviar-crm` con `{attempts: 1, status: 201, error: null}`, un `message` con `"Gracias, Ana. Alguien del equipo comercial te escribe hoy mismo."` y un `end` con `outcome` `"lead-empresa"`
- **AND** el resultado tiene `status` `ended`

#### Scenario: Demasiadas peticiones en el CRM
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano` y un host que devuelve siempre status 429
- **WHEN** el host continúa con `{choice: "mediana"}`
- **THEN** `http` se ha llamado 3 veces y la sesión termina con `outcome` `"lead-sin-enviar"`

## MODIFIED Requirements

### Requirement: Profundidad máxima de anidamiento
El motor SHALL rechazar, antes de validarlos, copiarlos o ejecutarlos, los datos recibidos cuyo anidamiento supere 1000 niveles, con un resultado independiente de la pila disponible. La profundidad es el número de arrays y objetos anidados en el camino más largo (un escalar vale 0, `[[1]]` vale 2). En un estado no cuenta el propio objeto del estado: cada uno de sus campos admite 1000 niveles, de modo que su `contact` admite lo mismo que los valores de contacto recibidos al arrancar y todo estado que devuelve el motor se puede continuar. Un flujo se rechaza con `invalid_flow` y un único issue de capa `shape`, `path` `""` y un mensaje que nombra el límite; un contacto, con `invalid_contact`; un estado, con `invalid_state`.

#### Scenario: Flujo demasiado anidado
- **GIVEN** un flujo con una variable `json` cuyo `default` tiene 5000 niveles de arrays anidados
- **WHEN** el host arranca una sesión o intenta continuarla con ese flujo
- **THEN** la operación se rechaza con `invalid_flow` y un único issue de capa `shape` con `path` `""` que nombra el límite
- **AND** la promesa no se rechaza

#### Scenario: Predicado demasiado anidado
- **GIVEN** un `condition` cuya regla `when` anida 5000 predicados `all` de un elemento
- **WHEN** el host arranca una sesión
- **THEN** la operación se rechaza con `invalid_flow`, sin lanzar

#### Scenario: Flujo justo en el límite de anidamiento
- **GIVEN** un flujo con una variable `json` cuyo `default` es un array con 997 niveles de anidamiento (el flujo tiene profundidad 1000), y otro con 998 niveles (profundidad 1001)
- **WHEN** el host arranca una sesión con cada uno
- **THEN** el primero no se rechaza y el segundo se rechaza con `invalid_flow`

#### Scenario: Contacto demasiado anidado
- **WHEN** el host arranca con un valor de contacto de 100000 niveles de arrays anidados, o con uno de 999 niveles (el contacto tiene profundidad 1000) y otro de 1000 niveles (profundidad 1001)
- **THEN** el de 100000 y el de 1000 niveles se rechazan con `invalid_contact` y el de 999 no se rechaza
- **AND** ninguna promesa se rechaza

#### Scenario: Ida y vuelta con un contacto en el límite
- **GIVEN** un flujo con la variable de contacto `c` y un `input` de tipo `text`, y un valor de contacto `c` de 999 niveles de arrays anidados
- **WHEN** el host arranca una sesión y la continúa con `{text: "x"}` usando el estado devuelto, también tras pasarlo por JSON
- **THEN** el arranque queda en `waiting` y la continuación no se rechaza y termina con `status` `ended`

#### Scenario: Estado justo en el límite de anidamiento
- **GIVEN** el estado de una sesión en espera cuyo valor de contacto `c` tiene, por separado, 999 niveles de arrays anidados (el campo `contact` tiene profundidad 1000) y 1000 niveles (profundidad 1001), y lo mismo con una variable de sesión en `variables`
- **WHEN** el host intenta continuar cada uno con una respuesta válida
- **THEN** los de 999 niveles no se rechazan y los de 1000 se rechazan con `invalid_state`

#### Scenario: Estado demasiado anidado
- **GIVEN** un estado cuyo valor de una variable anida 100000 niveles de arrays
- **WHEN** el host intenta continuar la sesión
- **THEN** la operación se rechaza con `invalid_state`, sin lanzar

### Requirement: Eventos de salida
El motor SHALL producir eventos con estas formas: `{type: "message", nodeId, content, typingDelayMs}`, `{type: "input", nodeId, inputType, attempt, reason, …}` (ver «Evento input»), `{type: "http", nodeId, attempts, status, error}` (ver «Evento http»), `{type: "end", nodeId, outcome}` y `{type: "error", nodeId, code, message}`. Los eventos se devuelven en el orden en que ocurren. Cada operación produce como mucho un `end`, un `error` o un `input`, y siempre es el último evento.

#### Scenario: El fin es el último evento
- **GIVEN** un flujo con dos `message` seguidos de un `end`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son `message`, `message`, `end` y no hay ningún `error`

#### Scenario: El error es el último evento
- **GIVEN** un flujo cuyo segundo nodo es de tipo `http` y un host sin capacidad `http`
- **WHEN** el host arranca una sesión
- **THEN** el último evento es de tipo `error` y no hay ningún evento `end`

#### Scenario: El input es el último evento
- **GIVEN** un flujo cuyo segundo nodo es un `input`
- **WHEN** el host arranca una sesión
- **THEN** el último evento es de tipo `input` y no hay ningún `end` ni `error`

#### Scenario: El evento http no cierra la operación
- **GIVEN** un flujo `http` → `message` → `end` y un host que devuelve status 200
- **WHEN** el host arranca una sesión
- **THEN** los eventos son `http`, `message` y `end`, en ese orden

### Requirement: Nodos aún no soportados
Al llegar a un nodo `llm`, o a un nodo `http` cuando el host no ofrece la capacidad `http` (ver «Capacidad http del host»), el motor MUST NOT ejecutarlo: la sesión falla con el error `unsupported_node`, el `nodeId` de ese nodo y un mensaje que nombra su tipo. Los eventos producidos antes en la misma operación se conservan.

#### Scenario: Ejemplo de captación de leads
- **GIVEN** una sesión de `packages/spec/examples/captacion-leads.json` esperando en `pedir-tamano` y un host sin capacidad `http`
- **WHEN** el host continúa con `{choice: "pequena"}`
- **THEN** el único evento es un `error` de código `unsupported_node` con `nodeId` `enviar-crm`, y `segmento` vale `"pyme"` en el estado
- **AND** el resultado tiene `status` `failed`

#### Scenario: Ejemplo de FAQ con IA
- **GIVEN** el flujo `packages/spec/examples/faq-ia.json` y un host que ofrece `http`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son un `message` de `saludo` con `typingDelayMs` 400 y un `error` `unsupported_node` con `nodeId` `asistente`, y `http` no se ha llamado

#### Scenario: Nodo http tras un set
- **GIVEN** un flujo `set` → `http` y un host sin capacidad `http`
- **WHEN** el host arranca una sesión
- **THEN** el único evento es un `error` `unsupported_node` con el `nodeId` del `http`, y la asignación del `set` consta en el estado

### Requirement: Ejecución determinista y sin efectos externos
Con el mismo flujo, las mismas entradas y los mismos resultados del host para cada llamada a `http`, el motor SHALL devolver resultados estructuralmente iguales y entregar al host las mismas peticiones en el mismo orden. MUST NOT leer el reloj, generar aleatoriedad, leer el entorno, acceder a red o disco por sí mismo (a la red solo llega a través de `http` del host), ni escribir en consola. MUST NOT mutar el flujo, los valores de contacto, el estado ni la entrada del usuario recibidos.

#### Scenario: Dos ejecuciones iguales
- **GIVEN** un flujo y unos valores de contacto
- **WHEN** el host arranca dos sesiones con ellos
- **THEN** ambos resultados (`status`, `events` y `state`) son estructuralmente iguales

#### Scenario: Dos continuaciones iguales
- **GIVEN** un flujo, un estado en espera y una entrada
- **WHEN** el host continúa dos veces con ellos
- **THEN** ambos resultados son estructuralmente iguales

#### Scenario: Dos ejecuciones con el mismo guion de host
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano` y dos hosts que devuelven la misma secuencia de resultados (429 y 201)
- **WHEN** el host continúa con `{choice: "grande"}` una vez con cada uno
- **THEN** ambos resultados son estructuralmente iguales y ambos hosts han recibido las mismas peticiones en el mismo orden

#### Scenario: Sin escritura en consola
- **GIVEN** espías sobre todos los métodos de `console`
- **WHEN** se ejecutan sesiones que terminan, que fallan, que esperan, que reintentan, que se rechazan y que llaman a `http` con éxito, con error y con un host que lanza
- **THEN** ningún método de `console` se ha llamado

#### Scenario: Entradas congeladas
- **GIVEN** un flujo con un `set` y unos valores de contacto, ambos congelados en profundidad
- **WHEN** el host arranca una sesión
- **THEN** la operación no falla y las entradas no han cambiado

#### Scenario: Continuación con entradas congeladas
- **GIVEN** un flujo, un estado en espera y una entrada válida, los tres congelados en profundidad
- **WHEN** el host continúa la sesión
- **THEN** la operación no falla y ninguna de las tres entradas ha cambiado
