# flow-validation Specification

## Purpose
Fijar lo que `validateFlow` de `@franca/spec` informa sobre un flujo de Franca además de sus errores: avisos con código estable que no impiden ejecutar ni guardar, y un resultado acotado (no lanza, no tarda más de lo lineal y no devuelve listas sin fin) con cualquier dato JSON, igual para la API, el editor y el motor.

## Requirements

### Requirement: Avisos del validador
El resultado de `validateFlow` SHALL incluir siempre `warnings`, una lista de avisos `{code, path, nodeId?, message}`. Los avisos no cambian `valid` ni `issues`. Se calculan cuando la forma del flujo es correcta, aunque haya errores semánticos. Si hay errores de forma, `warnings` es `[]`.

#### Scenario: Flujo válido con un aviso
- **GIVEN** `captacion-leads` con la `url` de `enviar-crm` cambiada a `"https://{{segmento}}.crm.example.com/api/leads"`
- **WHEN** se valida
- **THEN** `valid` es `true`, `issues` es `[]` y `warnings` tiene un aviso con `code` `url_template_in_origin`

#### Scenario: Flujo sin avisos
- **WHEN** se validan `captacion-leads` y `faq-ia` tal como están en `packages/spec/examples/`
- **THEN** ambos dan `valid` `true`, `issues` `[]` y `warnings` `[]`

#### Scenario: Error semántico y aviso a la vez
- **GIVEN** `captacion-leads` con `start` cambiado a `"no-existe"` y la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"`
- **WHEN** se valida
- **THEN** `valid` es `false`, `issues` contiene el issue `semantic` de `/start` y `warnings` contiene el aviso `credential_header_literal`

#### Scenario: Error de forma sin avisos
- **GIVEN** `captacion-leads` con la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"` y la propiedad `color` añadida al nodo `bienvenida`
- **WHEN** se valida
- **THEN** `valid` es `false`, `issues` tiene el issue de forma de `/nodes/0` y `warnings` es `[]`

### Requirement: Códigos y forma de los avisos
`@franca/spec` SHALL exportar `FLOW_WARNING_CODES`, la lista cerrada de códigos: `url_template_in_origin`, `credential_header_not_secret`, `credential_header_literal` y `too_many_warnings` (este último solo lo añade el recorte de «Recorte de avisos para mostrar», nunca `validateFlow`). Cada aviso tiene `path`, el JSON Pointer (RFC 6901) del campo exacto; `nodeId`, si es de un nodo, y `message` en español, sin repetir el id del nodo y sin valores del flujo salvo nombres de campo o de cabecera.

#### Scenario: Lista de códigos
- **WHEN** se importa `FLOW_WARNING_CODES` de `@franca/spec`
- **THEN** es `["url_template_in_origin", "credential_header_not_secret", "credential_header_literal", "too_many_warnings"]`

#### Scenario: El mensaje no contiene el valor de una cabecera
- **GIVEN** `captacion-leads` con la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"`
- **WHEN** se valida
- **THEN** ningún `message` de `warnings` contiene `"abc123"` ni `"Bearer"`

### Requirement: Orden de los avisos
`warnings` SHALL estar ordenada por `path` con comparación numérica de los índices (como `issues`), y un mismo campo tiene como mucho un aviso.

#### Scenario: Varios avisos ordenados
- **GIVEN** `captacion-leads` con la `url` de `enviar-crm` cambiada a `"https://crm.example.com:{{segmento}}/api/leads"` y su cabecera `Authorization` cambiada a `"Bearer abc123"`
- **WHEN** se valida
- **THEN** `warnings` tiene dos avisos y sus `path` son, en este orden, `/nodes/6/request/headers/Authorization` y `/nodes/6/request/url`

#### Scenario: Un aviso por url aunque tenga varios marcadores
- **GIVEN** `captacion-leads` con la `url` de `enviar-crm` cambiada a `"http{{segmento}}://{{segmento}}.example.com:{{segmento}}/x"`
- **WHEN** se valida
- **THEN** hay un único aviso `url_template_in_origin` en `/nodes/6/request/url`

### Requirement: Marcador en el origen de la url
El origen escrito de la `url` de un `http` es su texto hasta el primer `/`, `?`, `#` o `\` posterior al primer `://`, o hasta el primero de esos caracteres o el final si no hay `://`. Si contiene un marcador `{{nombre}}`, con o sin espacios dentro, `validateFlow` SHALL añadir el aviso `url_template_in_origin` en `/nodes/<i>/request/url`, con el `nodeId` del http.

#### Scenario: Marcador en el esquema, en el host, pegado al host y en el puerto
- **GIVEN** `captacion-leads`
- **WHEN** se valida por separado con la `url` de `enviar-crm` cambiada a `"http{{segmento}}://crm.example.com/api/leads"`, `"https://{{segmento}}.crm.example.com/api/leads"`, `"https://crm.example.com{{segmento}}/api/leads"`, `"https://crm.example.com:{{segmento}}/api/leads"` y `"https://{{ segmento }}.example.com/"`
- **THEN** cada uno es válido y tiene exactamente el aviso `{code: "url_template_in_origin", path: "/nodes/6/request/url", nodeId: "enviar-crm", message: "el origen de la url (esquema, host o puerto) depende de una variable: un valor puede cambiar el destino de la petición"}`

#### Scenario: La url entera sale de una variable
- **GIVEN** `captacion-leads` con la `url` de `enviar-crm` cambiada a `"{{segmento}}/api/leads"`
- **WHEN** se valida
- **THEN** tiene el aviso `url_template_in_origin` (en ejecución daría `invalid_url`, porque un valor no puede aportar `:` ni `/`)

#### Scenario: Marcadores fuera del origen
- **GIVEN** `captacion-leads`
- **WHEN** se valida por separado con la `url` de `enviar-crm` cambiada a `"https://crm.example.com/api/{{segmento}}"`, `"https://crm.example.com?s={{segmento}}"` y `"https://crm.example.com/api/leads?s={{segmento}}#{{segmento}}"`
- **THEN** ninguno tiene avisos

#### Scenario: Llaves que no son un marcador
- **GIVEN** `captacion-leads` con la `url` de `enviar-crm` cambiada a `"https://crm{{1x}}.example.com/api/leads"`
- **WHEN** se valida
- **THEN** no tiene avisos (`{{1x}}` no es un nombre de variable, así que no es un marcador)

### Requirement: Cabecera de credenciales con texto
Si una cabecera de credenciales de un `http` (`Authorization`, `Proxy-Authorization`, `Cookie`, `X-Api-Key`, `Api-Key` o `X-Auth-Token`, sin distinguir mayúsculas) tiene un texto en lugar de `{"secret": "NOMBRE"}`, `validateFlow` SHALL añadir en su puntero, con el `nodeId` del http, el aviso `credential_header_not_secret` si el texto tiene algún marcador `{{nombre}}`, o `credential_header_literal` si no tiene ninguno (también vacío).

#### Scenario: Token pegado en Authorization
- **GIVEN** `captacion-leads` con la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer abc123"`
- **WHEN** se valida
- **THEN** el flujo es válido y tiene exactamente el aviso `{code: "credential_header_literal", path: "/nodes/6/request/headers/Authorization", nodeId: "enviar-crm", message: "la cabecera Authorization lleva el valor escrito en el flujo: las credenciales van como referencia a un secreto ({\"secret\": \"NOMBRE\"})"}`

#### Scenario: Credencial a partir de una variable y nombre en minúsculas
- **GIVEN** `captacion-leads` con las cabeceras de `enviar-crm` cambiadas a `{"x-api-key": "{{segmento}}", "Content-Type": "application/json"}`
- **WHEN** se valida
- **THEN** tiene exactamente el aviso `{code: "credential_header_not_secret", path: "/nodes/6/request/headers/x-api-key", nodeId: "enviar-crm", message: "la cabecera x-api-key se construye con variables: las credenciales van como referencia a un secreto ({\"secret\": \"NOMBRE\"})"}`

#### Scenario: Marcador dentro de un texto con prefijo
- **GIVEN** `captacion-leads` con la cabecera `Authorization` de `enviar-crm` cambiada a `"Bearer {{segmento}}"`
- **WHEN** se valida
- **THEN** tiene un único aviso, `credential_header_not_secret`, en `/nodes/6/request/headers/Authorization`

#### Scenario: Texto vacío y llaves que no son un marcador
- **GIVEN** `captacion-leads`
- **WHEN** se valida por separado con las cabeceras de `enviar-crm` cambiadas a `{"Proxy-Authorization": ""}` y a `{"Authorization": "Bearer {{1x}}"}`
- **THEN** cada uno tiene un único aviso, `credential_header_literal`, en el puntero de su cabecera

#### Scenario: Referencias a secreto y otras cabeceras
- **WHEN** se validan `captacion-leads` (con `Authorization` como `{"secret": "CRM_TOKEN"}` y `Content-Type` como texto) y `faq-ia`
- **THEN** ninguno tiene los avisos `credential_header_not_secret` ni `credential_header_literal`

### Requirement: Profundidad máxima en la validación
`validateFlow` SHALL rechazar sin lanzar, antes de cualquier otra comprobación, un valor cuyo anidamiento de arrays y objetos supere 1000 niveles (la medida de «Profundidad máxima de anidamiento» de `flow-engine`). Lo rechaza con un único issue `{layer: "shape", path: "", message: "el flujo supera la profundidad máxima de anidamiento (1000)"}` y `warnings` `[]`. Nunca lanza con un valor que produce `JSON.parse`.

#### Scenario: Predicado demasiado anidado
- **GIVEN** `captacion-leads` con la regla `when` de `ruta-segmento` anidada en 5000 predicados `all` de un elemento (hoy `validateFlow` lanza `RangeError`)
- **WHEN** se valida
- **THEN** no lanza, `valid` es `false` e `issues` es exactamente el issue de profundidad

#### Scenario: Justo en el límite
- **GIVEN** `captacion-leads` con una variable `j` de tipo `json` cuyo `default` es un array con 997 niveles de anidamiento (el flujo tiene profundidad 1000), y otro con 998 niveles (profundidad 1001)
- **WHEN** se validan
- **THEN** el primero es válido y el segundo da exactamente el issue de profundidad

#### Scenario: Predicado anidado hasta el límite
- **GIVEN** `captacion-leads` con la regla `when` de `ruta-segmento` anidada en tantos predicados `all` de un elemento como caben sin que el flujo supere 1000 niveles
- **WHEN** se valida
- **THEN** no lanza y su resultado no contiene el issue de profundidad

#### Scenario: Mismo issue que el motor
- **GIVEN** el flujo de 998 niveles del escenario «Justo en el límite»
- **WHEN** el host arranca con él una sesión del motor
- **THEN** la operación se rechaza con `invalid_flow` e `issues` igual a `validateFlow(flujo).issues`

### Requirement: Tope de issues
`issues` SHALL tener como mucho 100 issues (`MAX_FLOW_ISSUES`). Si hay más, tiene los 100 primeros en su orden seguidos de `{layer, path: "", code: "too_many_issues", message: "hay más errores: solo se muestran los 100 primeros"}`, con la capa de los anteriores. `code` es un campo opcional nuevo que solo lleva ese issue final (el de profundidad no, para seguir igual al del motor). `validateFlow` no recorta `warnings`.

#### Scenario: Más errores que el tope
- **GIVEN** `captacion-leads` con `nodes` sustituido por 150 objetos `{}`
- **WHEN** se valida
- **THEN** `issues` tiene 101 entradas: las de forma de `/nodes/0` a `/nodes/99`, en ese orden, y al final `{layer: "shape", path: "", code: "too_many_issues", message: "hay más errores: solo se muestran los 100 primeros"}`

#### Scenario: Justo en el tope
- **GIVEN** `captacion-leads` con `nodes` sustituido por 100 objetos `{}`
- **WHEN** se valida
- **THEN** `issues` tiene exactamente 100 entradas, sin el issue final

#### Scenario: Tope de errores semánticos
- **GIVEN** `captacion-leads` con 150 nodos `message` válidos añadidos que nadie alcanza
- **WHEN** se valida
- **THEN** `issues` tiene 101 entradas y la última es `{layer: "semantic", path: "", code: "too_many_issues", message: "hay más errores: solo se muestran los 100 primeros"}`

#### Scenario: El issue de profundidad no lleva código
- **GIVEN** el flujo de 998 niveles del escenario «Justo en el límite»
- **WHEN** se valida
- **THEN** su único issue no tiene la propiedad `code`

### Requirement: Recorte de avisos para mostrar
`@franca/spec` SHALL exportar `capWarnings(warnings)`, que devuelve la lista igual si tiene como mucho 100 avisos (`MAX_FLOW_WARNINGS`) y, si tiene más, los 100 primeros seguidos de `{code: "too_many_warnings", path: "", message: "hay más avisos: solo se muestran los 100 primeros"}`. Lo usan los consumidores para mostrar; las decisiones se toman con la lista completa.

#### Scenario: Recortar 150 avisos
- **GIVEN** una lista de 150 avisos `url_template_in_origin`
- **WHEN** se recorta con `capWarnings`
- **THEN** el resultado tiene 101 entradas: los 100 primeros en su orden y al final el aviso `too_many_warnings`

#### Scenario: Sin recorte
- **WHEN** se recorta con `capWarnings` una lista de 100 avisos
- **THEN** el resultado es la misma lista

### Requirement: Coste acotado de la validación
El tiempo de `validateFlow` SHALL crecer de forma lineal con el tamaño del flujo, sea válido o no. Revisa la forma por piezas (la raíz sin `nodes` y cada nodo) y da todos los errores de una pieza solo si su texto JSON tiene como mucho 8192 caracteres y las piezas detalladas suman como mucho 65536; si no, uno. Deja de revisar nodos cuando ya no cabe ningún issue en el tope. Semántica y avisos recorren el flujo una vez, sin copiar lo de debajo en cada nivel.

#### Scenario: Detalle en un nodo normal
- **GIVEN** `captacion-leads` con `timeoutMs` 50 y la propiedad `color` añadidos a `enviar-crm`
- **WHEN** se valida
- **THEN** `issues` tiene los dos errores de forma de `enviar-crm`: `/nodes/6` (`"propiedad no permitida 'color'"`) y `/nodes/6/timeoutMs` (`"debe ser >= 100"`)

#### Scenario: Un nodo grande da un solo error
- **GIVEN** `captacion-leads` con `timeoutMs` 50, la propiedad `color` y un `body` de 10000 caracteres en `enviar-crm`
- **WHEN** se valida
- **THEN** `issues` tiene un único issue de forma, con `nodeId` `enviar-crm`

#### Scenario: Un mega de nodos vacíos
- **GIVEN** `captacion-leads` con `nodes` sustituido por unos 340000 objetos `{}` (alrededor de 1 MiB de texto JSON)
- **WHEN** se valida
- **THEN** termina en menos de 2 segundos con 101 issues

#### Scenario: Un error real repetido
- **GIVEN** `captacion-leads` con `nodes` sustituido por copias de `bienvenida` con la propiedad `color`, hasta alrededor de 1 MiB de texto JSON
- **WHEN** se valida
- **THEN** termina en menos de 2 segundos con 101 issues

#### Scenario: Un nodo enorme con errores
- **GIVEN** `captacion-leads` con la regla `when` de `ruta-segmento` cambiada a `{"all": [...]}` con 200000 predicados `{}`
- **WHEN** se valida
- **THEN** termina en menos de 2 segundos con un único issue de forma, en `/nodes/7/rules/0/when` (`"no coincide con ninguna de las formas permitidas"`)

#### Scenario: Muchas variables rotas
- **GIVEN** `captacion-leads` con `variables` sustituido por 200000 objetos `{"x": 1}`
- **WHEN** se valida
- **THEN** termina en menos de 2 segundos con un único issue de forma, cuyo `path` empieza por `/variables/0`

#### Scenario: Muchos marcadores en un body profundo
- **GIVEN** `captacion-leads` con la variable `a` de tipo `string` declarada y el `body` de `enviar-crm` cambiado a 990 niveles de arrays alrededor de un texto con 200000 marcadores `{{a}}` (alrededor de 1 MB)
- **WHEN** se valida
- **THEN** el flujo es válido y la validación termina en menos de 500 milisegundos
