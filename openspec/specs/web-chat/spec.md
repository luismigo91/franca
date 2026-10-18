# web-chat Specification

## Purpose
El chat de prueba de la web de Franca (`apps/web`): una persona abre la web en su máquina, elige un flujo publicado en la API y conversa con él como lo haría un usuario final. Ve los mensajes con su ritmo, responde a las preguntas de los ocho tipos, ve los reintentos y el final, y puede reabrir, repetir y borrar sus conversaciones. El navegador nunca habla con la API: lo hace el servidor de la web, que es la frontera local del chat.

Datos de los escenarios:

- Franca arrancada en local: la API en `127.0.0.1:3001` con Postgres y la web en `127.0.0.1:3000`. El navegador abre `http://localhost:3000`. Salvo que el escenario diga otra cosa, la API arranca sin `FRANCA_ANTHROPIC_API_KEY` ni ninguna variable `FRANCA_SECRET_*` o `FRANCA_HTTP_*`.
- `captacion-leads` y `faq-ia` son los de `packages/spec/examples/`; `pregunta` y `saludo-contacto`, los de `conversations-api`. «Publicado» quiere decir lo mismo que en `conversations-api`.
- `preguntas` es `{"specVersion": "0.1", "id": "preguntas", "name": "Preguntas", "locale": "es", "settings": {"typingDelayMs": 0}, "variables": [{"name": "t", "type": "string"}, {"name": "e", "type": "email"}, {"name": "f", "type": "phone"}, {"name": "n", "type": "number"}, {"name": "u", "type": "url"}, {"name": "d", "type": "date"}, {"name": "b", "type": "boolean"}, {"name": "p", "type": "string"}, {"name": "x", "type": "json"}], "start": "texto", "nodes": [{"id": "texto", "type": "input", "inputType": "text", "variable": "t", "prompt": [{"kind": "text", "text": "¿Texto?"}], "placeholder": "Escribe algo", "next": "email"}, {"id": "email", "type": "input", "inputType": "email", "variable": "e", "prompt": [{"kind": "text", "text": "¿Email?"}], "next": "telefono"}, {"id": "telefono", "type": "input", "inputType": "phone", "variable": "f", "prompt": [{"kind": "text", "text": "¿Teléfono?"}], "next": "numero"}, {"id": "numero", "type": "input", "inputType": "number", "variable": "n", "prompt": [{"kind": "text", "text": "¿Número?"}], "validation": {"min": 1, "max": 10}, "next": "web"}, {"id": "web", "type": "input", "inputType": "url", "variable": "u", "prompt": [{"kind": "text", "text": "¿Web?"}], "next": "fecha"}, {"id": "fecha", "type": "input", "inputType": "date", "variable": "d", "prompt": [{"kind": "text", "text": "¿Fecha?"}], "next": "acepta"}, {"id": "acepta", "type": "input", "inputType": "boolean", "variable": "b", "prompt": [{"kind": "text", "text": "¿Aceptas?"}], "next": "plan"}, {"id": "plan", "type": "input", "inputType": "choice", "variable": "p", "prompt": [{"kind": "text", "text": "¿Plan?"}], "choices": [{"id": "basico", "label": "Básico", "imageUrl": "https://example.com/basico.png", "next": "extras"}, {"id": "pro", "label": "Pro", "imageUrl": "javascript:alert(1)", "next": "extras"}]}, {"id": "extras", "type": "input", "inputType": "choice", "multiple": true, "variable": "x", "prompt": [{"kind": "text", "text": "¿Extras?"}], "validation": {"max": 2}, "choices": [{"id": "a", "label": "Soporte"}, {"id": "b", "label": "Formación"}, {"id": "c", "label": "Informes"}], "next": "fin"}, {"id": "fin", "type": "end", "outcome": "completo", "content": [{"kind": "text", "text": "Gracias."}]}]}`.
- `medios` es `{"specVersion": "0.1", "id": "medios", "name": "Medios", "settings": {"typingDelayMs": 0}, "start": "m", "nodes": [{"id": "m", "type": "message", "content": [{"kind": "text", "text": "<b>Hola</b>\nhttps://example.com"}, {"kind": "image", "url": "https://example.com/logo.png", "alt": "Logo"}, {"kind": "image", "url": "javascript:alert(1)", "alt": "Malo"}, {"kind": "image", "url": "/relativa.png"}, {"kind": "image", "url": "https://usuario:clave@example.com/a.png"}, {"kind": "video", "url": "data:video/mp4;base64,AAAA"}, {"kind": "audio", "url": "https://example.com/audio.mp3"}, {"kind": "embed", "url": "https://example.com/widget", "alt": "Widget"}, {"kind": "embed", "url": "http://example.com/widget"}], "next": "fin"}, {"id": "fin", "type": "end"}]}`.
- Los dos son válidos y sin avisos (comprobado con `packages/spec/dist`), y sus eventos son los que devuelve `@franca/engine` (comprobado con `packages/engine/dist`).
- «Una petición del navegador» lleva `Host: localhost:3000` y `Origin: http://localhost:3000` si es una operación que cambia algo. «La API simulada» es un servidor local del test en la dirección de `FRANCA_API_URL` que registra cada petición que recibe (método, ruta, cabeceras y cuerpo) y responde lo que diga el escenario con la forma de la API.

## Requirements

### Requirement: Chat de prueba en local
La web de Franca SHALL ofrecer un chat de prueba: la página de inicio (`/`) lista los flujos publicados y las conversaciones recientes, y cada conversación tiene su página en `/conversaciones/<id>`. Todo el texto visible está en español y nombra el producto como «Franca», nunca con el nombre de un paquete o del repositorio. Desde la página de una conversación siempre se puede volver al inicio, y desde el inicio, ir al editor de flujos (`/flujos`, ver `web-editor`).

#### Scenario: Marca en la página de inicio
- **WHEN** se abre `/`
- **THEN** el título del documento contiene «Franca» y la página no contiene `@franca/`, `franca-web` ni «Create Next App»

#### Scenario: Enlace al editor desde el inicio
- **WHEN** se abre `/` y se sigue el enlace al editor de flujos
- **THEN** el navegador llega a `/flujos`

### Requirement: Flujos publicados
La página de inicio SHALL listar los flujos con alguna versión publicada (`GET /flows?published=true`), 20 por página y en el orden de la API, cada uno con su `name`, su `id`, su última versión y, si los tiene, el aviso de que hay cambios sin publicar (el chat usa la última versión publicada). «Ver más» carga la página siguiente. Los flujos sin publicar y los borrados no aparecen.

#### Scenario: Solo los publicados
- **GIVEN** `captacion-leads` publicado y después modificado sin publicar, `pregunta` publicado y `hola` creado sin publicar
- **WHEN** se abre `/`
- **THEN** la lista de flujos tiene `Captación de leads` (versión 1, con el aviso de cambios sin publicar) y `Pregunta` (versión 1, sin el aviso), y no tiene `hola`

#### Scenario: Más de una página de flujos
- **GIVEN** 21 flujos publicados
- **WHEN** se abre `/` y se pulsa «Ver más»
- **THEN** la lista tiene primero 20 flujos y después 21, sin repetir ninguno

### Requirement: Estados de las listas
Mientras carga una lista, la página de inicio SHALL indicarlo. Vacía, muestra un mensaje propio: sin flujos publicados, que se publique uno desde el editor de flujos, con un enlace a `/flujos`; sin conversaciones, que aún no se ha probado ningún flujo. Si la API no responde o responde un error, muestra un mensaje en español, sin el texto de la API, con «Reintentar», que vuelve a pedir la lista.

#### Scenario: Sin flujos publicados
- **GIVEN** ningún flujo publicado
- **WHEN** se abre `/`
- **THEN** la página dice que todavía no hay flujos publicados, enlaza con `/flujos` para publicar uno y no ofrece ningún botón «Probar»

#### Scenario: API parada
- **GIVEN** la API parada
- **WHEN** se abre `/`, se arranca la API y se pulsa «Reintentar»
- **THEN** la página dice primero que no se puede conectar con la API de Franca, con «Reintentar», y después muestra la lista de flujos

### Requirement: Conversaciones recientes
La página de inicio SHALL listar las conversaciones de la instalación (`GET /conversations`), 20 por página y en el orden de la API, cada una con su `flowId`, su versión, su estado en español («En espera», «Terminada», «Fallida» o «Caducada»), su `outcome` y su `contactId` si los tiene, y la fecha de su última actividad en la hora local. «Ver más» carga la página siguiente, y cada conversación abre su página.

#### Scenario: Conversación terminada en la lista
- **GIVEN** una conversación de `preguntas` terminada con `outcome` `"completo"` y otra de `pregunta` esperando en `p`, actualizada después
- **WHEN** se abre `/`
- **THEN** la primera conversación de la lista es la de `pregunta` con «En espera», la segunda la de `preguntas` con «Terminada» y `completo`, y pulsar la segunda lleva a `/conversaciones/<id>` con su `id`

### Requirement: Empezar una conversación
Pulsar «Probar» en un flujo SHALL crear una conversación con su última versión publicada (`POST /conversations` con su `flowId` y, si se escribió, el `contactId`), indicar que la está iniciando mientras la API no responde y, cuando responde 201, llevar a la página de la conversación, donde se reproducen los eventos de ese primer avance (ver «Ritmo de los mensajes»).

#### Scenario: Probar el ejemplo de captación de leads
- **GIVEN** `captacion-leads` publicado
- **WHEN** se pulsa «Probar» en `Captación de leads` sin identificador de contacto
- **THEN** la API recibe `POST /conversations` con el cuerpo `{"flowId":"captacion-leads"}`, el navegador llega a `/conversaciones/<id>` con el `id` de la conversación creada, la conversación muestra «¡Hola! Te hago tres preguntas y te paso con la persona adecuada.» y «¿Cómo te llamas?», y después aparece un campo de texto

### Requirement: Contacto de la prueba
La página de inicio SHALL ofrecer un campo opcional «Identificador de contacto», con el aviso de que no debe ser un dato personal (solo letras, números, `-` y `_`). Si se rellena, la conversación se crea con ese `contactId`. Si la API lo rechaza (400 `invalid_request`), el campo lo indica y no se navega. El chat no recuerda el valor entre visitas.

#### Scenario: El email pasa de un flujo a otro
- **GIVEN** `captacion-leads` y `saludo-contacto` publicados
- **WHEN** se prueba `Captación de leads` con el contacto `c-1`, se responde `Ana` y `ana@example.com`, se vuelve al inicio y se prueba `Saludo` con el contacto `c-1`
- **THEN** la segunda conversación muestra «Hola, ana@example.com.» y el panel de detalles de las dos dice `c-1`

#### Scenario: Identificador de contacto no admitido
- **GIVEN** `pregunta` publicado
- **WHEN** se escribe `ana@example.com` como identificador de contacto y se pulsa «Probar» en `Pregunta`
- **THEN** la página sigue en `/`, el campo indica que el identificador no es válido y `GET /conversations` tiene el mismo `total` que antes

### Requirement: Errores al empezar
Si la creación falla, el chat SHALL quedarse en la página de inicio y mostrar un mensaje propio según `error`: `flow_not_found` (el flujo ya no existe, y recarga la lista), `flow_not_published`, `flow_version_invalid` (hay que publicar una versión nueva), `database_unavailable`, sin respuesta de la API, y uno genérico para cualquier otro código. Nunca muestra el `message` de la API.

#### Scenario: Flujo borrado después de cargar la lista
- **GIVEN** `pregunta` publicado y la página de inicio abierta
- **WHEN** se hace `DELETE /flows/pregunta` en la API y después se pulsa «Probar» en `Pregunta`
- **THEN** la página sigue en `/`, dice que el flujo ya no existe y la lista de flujos ya no tiene `Pregunta`

### Requirement: Página de una conversación
`/conversaciones/<id>` SHALL mostrar la conversación como la guarda la API: lee el recurso y toda la transcripción, página a página, y pinta su historia sin retardos, con la pregunta pendiente si está `waiting`. La cabecera muestra el `name` de la versión (o el `flowId` si el flujo se borró) y la versión. Si el id no existe, muestra «Conversación no encontrada» y un enlace al inicio.

#### Scenario: Reabrir una conversación
- **GIVEN** una conversación de `captacion-leads` a la que se ha respondido ` Ana ` y `ana@` desde el chat
- **WHEN** se recarga su página
- **THEN** se ven, en orden y sin indicador de «escribiendo», los mensajes de `bienvenida` y `pedir-nombre`, la respuesta ` Ana `, el mensaje de `pedir-email`, la respuesta `ana@`, «Ese email no parece válido, ¿lo revisas?» y el campo de la pregunta pendiente
- **AND** la cabecera dice `Captación de leads` y la versión 1

#### Scenario: Transcripción de varias páginas
- **GIVEN** la API simulada con una conversación `waiting` cuya transcripción tiene `total` 150
- **WHEN** se abre su página
- **THEN** la API simulada recibe `GET /conversations/<id>/transcript` con `limit=100&offset=0` y con `limit=100&offset=100`, y la página pinta las 150 entradas en orden de `seq`

#### Scenario: Conversación que no existe
- **WHEN** se abre `/conversaciones/00000000-0000-4000-8000-000000000000` y `/conversaciones/no-es-un-uuid`
- **THEN** las dos muestran «Conversación no encontrada» con un enlace a `/`, y la segunda no llega a la API

#### Scenario: Conversación de un flujo borrado
- **GIVEN** una conversación de `pregunta` esperando en `p` y después `DELETE /flows/pregunta`
- **WHEN** se abre su página y se responde `Ana`
- **THEN** la cabecera dice `pregunta` y la conversación termina con «Adiós, .»

### Requirement: Texto de los mensajes
El chat SHALL pintar cada elemento `text` de un evento `message` como texto plano, con sus saltos de línea, sin interpretar HTML ni Markdown y sin convertir direcciones en enlaces: ningún texto del flujo ni del asistente de un `llm` se convierte en enlace, imagen ni marcado.

#### Scenario: Marcado y direcciones en un texto
- **GIVEN** `medios` publicado
- **WHEN** se prueba `Medios`
- **THEN** la conversación muestra el texto `<b>Hola</b>` literalmente y, en la línea siguiente, `https://example.com`, y el mensaje no contiene ningún elemento `b` ni `a`

### Requirement: Contenido multimedia
El chat SHALL pintar un elemento `image` como imagen, `video` y `audio` con los controles nativos del navegador y `embed` en un marco aislado que no puede navegar la página del chat, con `alt` como texto alternativo y sin enviar `Referer`, solo si su `url` está admitida (ver «Direcciones admitidas»). Si no lo está, muestra «Contenido no disponible» y su `alt`, sin cargar nada.

#### Scenario: Multimedia del flujo de medios
- **GIVEN** `medios` publicado
- **WHEN** se prueba `Medios`
- **THEN** el mensaje tiene una imagen con `src` `https://example.com/logo.png` y texto alternativo `Logo`, un audio con `https://example.com/audio.mp3`, un marco aislado con `https://example.com/widget`, y cinco «Contenido no disponible», uno de ellos con `Malo`
- **AND** el navegador no ha pedido ninguna dirección distinta de esas tres para el contenido del mensaje

### Requirement: Direcciones admitidas
Una `url` de multimedia o un `imageUrl` de opción SHALL admitirse solo si es una URL absoluta WHATWG sin usuario ni contraseña, con esquema `https:` o, salvo en `embed`, `http:`. El chat usa su serialización (`href`), nunca el texto original. `javascript:`, `data:`, `blob:`, `file:`, las relativas y cualquier otro esquema se rechazan.

#### Scenario: Direcciones rechazadas
- **WHEN** el chat decide si admite, por separado, `javascript:alert(1)`, `JavaScript:alert(1)`, `java` + salto de línea + `script:alert(1)`, `data:image/png;base64,AAAA`, `blob:https://example.com/x`, `file:///etc/hosts`, `/relativa.png`, `//example.com/a.png`, `https://usuario:clave@example.com/a.png` y, en `embed`, `http://example.com/widget`
- **THEN** no admite ninguna

#### Scenario: Direcciones admitidas y su serialización
- **WHEN** el chat decide si admite `HTTPS://Example.COM/a.png` en una imagen y `http://example.com/a.mp3` en un audio
- **THEN** admite las dos y usa `https://example.com/a.png` y `http://example.com/a.mp3`

### Requirement: Opciones con imagen
En una pregunta de selección, cada opción SHALL mostrar su `label` como texto plano y, si su `imageUrl` está admitida, su imagen. Si no lo está, la opción se muestra sin imagen y se puede elegir igual.

#### Scenario: Una imagen admitida y otra no
- **GIVEN** una conversación de `preguntas` esperando en `plan`
- **WHEN** se mira la pregunta pendiente
- **THEN** la opción `Básico` tiene una imagen con `https://example.com/basico.png`, la opción `Pro` no tiene imagen y la página no contiene ningún atributo con `javascript:`
- **AND** pulsar `Pro` envía `{"input":{"choice":"pro"}}`

### Requirement: Ritmo de los mensajes
Al crear una conversación o enviar una respuesta, el chat SHALL mostrar un indicador de «escribiendo» mientras espera a la API y después pintar cada `message` en orden, mostrando antes el indicador durante su `typingDelayMs` (con 0, enseguida). La pregunta pendiente aparece tras el último mensaje. Lo que se lee de la transcripción se pinta sin retardos ni indicador.

#### Scenario: Retardo por defecto del ejemplo
- **GIVEN** `captacion-leads` publicado (sin `settings`: `typingDelayMs` 600)
- **WHEN** se pulsa «Probar»
- **THEN** el indicador de «escribiendo» se ve hasta que aparece «¡Hola! Te hago tres preguntas…», «¿Cómo te llamas?» aparece al menos 600 ms después del primero, y el campo de texto no aparece antes que «¿Cómo te llamas?»

#### Scenario: Indicador mientras la API responde
- **GIVEN** la API simulada con una conversación esperando y que tarda 5 segundos en responder a la entrada
- **WHEN** se envía una respuesta
- **THEN** el indicador de «escribiendo» se ve durante esos 5 segundos y desaparece al pintar el primer mensaje de la respuesta

### Requirement: Eventos técnicos fuera de la conversación
El chat SHALL no pintar en la conversación los eventos `http` ni `llm`, ni el `message` de ningún evento `error`, ni en directo ni desde la transcripción: el usuario final no los ve. Los tipos de evento y de contenido que el chat no conoce se ignoran sin romper la página.

#### Scenario: Fallo del nodo http del ejemplo
- **GIVEN** una conversación de `captacion-leads` a la que se ha respondido `Ana` y `ana@example.com`
- **WHEN** se pulsa `Más de 50` y después se recarga la página
- **THEN** las dos veces la conversación termina con el aviso «La conversación no ha podido continuar» y la página no contiene «el host no tiene un secreto»

#### Scenario: Evento desconocido
- **GIVEN** la API simulada con una conversación cuya respuesta de avance tiene los eventos `{type: "nuevo", nodeId: "x"}`, un `message` con un elemento `{kind: "mapa", url: "https://example.com/m"}` y otro `{kind: "text", text: "Sigo"}`, y un `input` de tipo `text`
- **WHEN** se envía una respuesta
- **THEN** la conversación muestra «Sigo» y el campo de texto, sin errores en la consola del navegador y sin pedir `https://example.com/m`

### Requirement: Preguntas de texto
Con un `input` cuyo `inputType` no es `choice` (también el de un `llm`), el chat SHALL ofrecer un campo de texto con el `placeholder` del evento si lo trae: de varias líneas en `text` (Intro envía y Mayúsculas+Intro añade una línea) y de una en los demás, con el teclado del tipo en móviles. Enviar manda `{input: {text}}` con el texto tal cual, sin recortar ni validar: valida el flujo.

#### Scenario: Las siete preguntas de texto
- **GIVEN** `preguntas` publicado
- **WHEN** se prueba `Preguntas` y se responde, una a una, ` hola `, `a@b.co`, `+34 600 000 000`, `muchos`, `5`, `https://example.com`, `2026-10-17` y `sí`
- **THEN** la API recibe esas ocho entradas como `{"input":{"text":…}}` con el texto exacto, también los espacios de ` hola `
- **AND** el campo de `texto` muestra el `placeholder` `Escribe algo`, `muchos` deja la conversación en `numero` con el aviso de formato y la siguiente pregunta pendiente es `plan`

#### Scenario: Respuesta vacía
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se pulsa Intro con el campo vacío
- **THEN** la API recibe `{"input":{"text":""}}` y la conversación muestra otra vez «¿Nombre?» con el aviso de respuesta vacía

### Requirement: Selección única
Con un `input` `choice` sin `multiple`, el chat SHALL mostrar un botón por opción, en el orden del evento, y ningún campo de texto. Pulsar una opción manda `{input: {choice: id}}` con su `id`.

#### Scenario: Tamaño de empresa
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** se mira la pregunta pendiente y se pulsa `Más de 50`
- **THEN** había tres botones, `1 a 10`, `11 a 50` y `Más de 50`, en ese orden y sin campo de texto, y la API recibe `{"input":{"choice":"grande"}}`

### Requirement: Selección múltiple
Con un `input` `choice` con `multiple: true`, el chat SHALL mostrar una casilla por opción, en el orden del evento, y un botón «Enviar» que manda `{input: {choices: [id, …]}}` con las marcadas en el orden de las opciones. Se puede enviar sin marcar ninguna: el flujo decide si la respuesta es válida.

#### Scenario: Extras en el orden de las opciones
- **GIVEN** una conversación de `preguntas` esperando en `extras`
- **WHEN** se marcan `Informes`, `Soporte` y `Formación` y se pulsa «Enviar»; después, en la pregunta nueva, se marcan `Informes` y `Soporte` y se pulsa «Enviar»
- **THEN** la API recibe `{"input":{"choices":["a","b","c"]}}`, la conversación sigue en `extras` con el aviso de fuera de rango, y después recibe `{"input":{"choices":["a","c"]}}` y la conversación termina con `completo`

#### Scenario: Ninguna marcada
- **GIVEN** una conversación de `preguntas` esperando en `extras`
- **WHEN** se pulsa «Enviar» sin marcar ninguna
- **THEN** la API recibe `{"input":{"choices":[]}}` y la conversación sigue en `extras` con el aviso de respuesta vacía

### Requirement: Motivo de una respuesta inválida
Si el `input` pendiente trae `reason`, el chat SHALL mostrar junto a la respuesta un aviso en español según el motivo: `too_long` (demasiado larga), `required` (vacía), `invalid_format` (sin el formato esperado), `out_of_range` (fuera de lo permitido) y `pattern_mismatch` (no sigue el formato que pide el flujo); con otro, uno genérico. Sin `reason`, ninguno. Es la única pista de un mensaje rechazado en un `llm`.

#### Scenario: Email inválido en el ejemplo
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-email`
- **WHEN** se responde `ana@`
- **THEN** la conversación muestra «Ese email no parece válido, ¿lo revisas?» y la pregunta pendiente tiene el aviso de formato
- **AND** al responder `ana@example.com` el aviso desaparece

#### Scenario: Mensaje rechazado en un llm
- **GIVEN** la API simulada con una conversación esperando en un `llm` y que responde a la entrada solo con `{type: "input", nodeId: "a", inputType: "text", attempt: 2, reason: "too_long"}`
- **WHEN** se envía una respuesta
- **THEN** la pregunta pendiente tiene el aviso de respuesta demasiado larga y la conversación no tiene ningún mensaje nuevo del flujo

### Requirement: Respuestas del usuario
Cada respuesta SHALL aparecer en la conversación como un mensaje del usuario en cuanto se envía: el texto tal como se envió, o el `label` de la opción elegida (los de una múltiple, en el orden de las opciones y separados por comas). Si la API no la aplica, el mensaje desaparece y la respuesta vuelve a su campo. Al reabrir, se reconstruye igual desde la transcripción.

#### Scenario: Etiqueta de la opción en directo y al reabrir
- **GIVEN** una conversación de `preguntas` esperando en `extras`
- **WHEN** se marcan `Informes` y `Soporte`, se pulsa «Enviar» y después se recarga la página
- **THEN** las dos veces el último mensaje del usuario es `Soporte, Informes`

### Requirement: Revisión esperada en cada respuesta
Cada respuesta SHALL enviarse a la API con `If-Match` y la `revision` de la conversación que el chat tiene pintada, entre comillas. El chat nunca reenvía una respuesta por su cuenta.

#### Scenario: If-Match en las respuestas
- **GIVEN** una conversación de `pregunta` recién creada desde el chat (`revision` 1)
- **WHEN** se responde `   ` y después `Ana`
- **THEN** la API recibe la primera con `If-Match: "1"` y la segunda con `If-Match: "2"`

### Requirement: Una respuesta a la vez
Mientras se envía una respuesta, el chat SHALL desactivar la pregunta pendiente, de modo que un doble clic o un segundo Intro no mandan otra. Si la respuesta de la web se pierde (corte o tiempo agotado), relee la conversación: si su `revision` avanzó, pinta lo aplicado; si no, dice que no se ha podido enviar y ofrece «Reintentar», que reenvía con el mismo `If-Match`.

#### Scenario: Doble clic en una opción
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** se hace doble clic en `1 a 10`
- **THEN** la API recibe una sola entrada y la transcripción tiene una sola respuesta del usuario

#### Scenario: Respuesta perdida después de aplicarse
- **GIVEN** la API simulada con una conversación de `revision` 1 que aplica la entrada y cierra la conexión sin responder, y cuyas lecturas posteriores dan `revision` 2 con la respuesta en la transcripción
- **WHEN** se envía `Ana`
- **THEN** la API simulada recibe una sola entrada, después la lectura de la conversación y de su transcripción, y la conversación muestra `Ana` una sola vez y lo que se aplicó

### Requirement: Conversación avanzada en otra pestaña
Si la API responde 412 `revision_mismatch`, el chat SHALL releer la conversación y su transcripción, pintarlas, avisar de que la conversación avanzó en otra pestaña y dejar la respuesta no enviada en su campo, sin reenviarla.

#### Scenario: Dos pestañas
- **GIVEN** una conversación de `pregunta` esperando en `p`, abierta en dos pestañas
- **WHEN** se responde `   ` en la primera y después `Ana` en la segunda
- **THEN** la segunda recibe 412 de la API, muestra la respuesta de la primera, el aviso de otra pestaña y `Ana` en el campo, y la transcripción tiene una sola respuesta del usuario

### Requirement: Conversación ocupada
Si la API responde 409 `conversation_busy`, o al abrirla la conversación tiene `processing` `true`, el chat SHALL avisar de que está procesando otra respuesta y ofrecer «Volver a cargar», que la relee, con la respuesta no enviada en su campo. Mientras, no consulta la API por su cuenta.

#### Scenario: Ocupada al enviar
- **GIVEN** la API simulada con una conversación esperando que responde 409 `conversation_busy` a la entrada
- **WHEN** se envía `Ana`, se esperan 10 segundos y se pulsa «Volver a cargar»
- **THEN** la página avisa de que la conversación está procesando otra respuesta, `Ana` sigue en el campo, la API simulada no recibe nada durante esos 10 segundos y después recibe la lectura de la conversación

### Requirement: Fin de la conversación
Cuando la conversación queda `ended`, `failed` o `expired`, el chat SHALL quitar la pregunta pendiente y mostrar un aviso: «Conversación terminada» (con el `outcome` si lo tiene), «La conversación no ha podido continuar» o «La conversación ha caducado por inactividad», con «Empezar de nuevo» y «Volver al inicio». Ningún aviso incluye el `message` de un `error`.

#### Scenario: Final con outcome
- **GIVEN** una conversación de `preguntas` esperando en `extras`
- **WHEN** se marca `Soporte` y se pulsa «Enviar»
- **THEN** la conversación muestra «Gracias.» y el aviso «Conversación terminada» con `completo`, sin pregunta pendiente

#### Scenario: Reintentos agotados
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-email` (`maxRetries` 2)
- **WHEN** se responde `a`, `b` y `c`
- **THEN** la conversación muestra el aviso «La conversación no ha podido continuar», sin pregunta pendiente, y la página no contiene «se agotaron los reintentos»

#### Scenario: Caducada al responder
- **GIVEN** la API simulada con una conversación esperando que responde 409 `conversation_expired` a la entrada y cuya lectura posterior da `status` `expired`
- **WHEN** se envía `Ana`
- **THEN** la conversación muestra el aviso «La conversación ha caducado por inactividad» con «Empezar de nuevo», sin pregunta pendiente

### Requirement: Errores al enviar una respuesta
Si enviar falla con otro código, el chat SHALL mostrar un mensaje propio según `error` y dejar la respuesta en su campo: `invalid_input` (relee la conversación), `conversation_not_active` y `conversation_expired` (relee y muestra el fin), `conversation_not_found` (ya no existe), `payload_too_large` (demasiado larga para enviarla), `flow_version_invalid`, `database_unavailable`, sin respuesta de la API, y uno genérico para otro.

#### Scenario: Respuesta enorme
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se pega en el campo un texto de 70 000 caracteres `a` y se envía
- **THEN** la API responde 413, el chat dice que la respuesta es demasiado larga para enviarla, el texto sigue en el campo y la conversación sigue esperando en `p` con la misma `revision`

#### Scenario: Conversación borrada desde otra pestaña
- **GIVEN** una conversación de `pregunta` esperando en `p`, abierta en una pestaña, y después borrada con `DELETE /conversations/:conversationId` en la API
- **WHEN** se responde `Ana` en la pestaña
- **THEN** el chat dice que la conversación ya no existe, con un enlace al inicio

### Requirement: Empezar de nuevo
«Empezar de nuevo» SHALL crear una conversación nueva del mismo `flowId`, con su última versión publicada y el mismo `contactId`, y llevar a su página; la anterior se conserva. Está disponible siempre en la página de una conversación, también mientras espera. Si no se puede crear, lo dice como en «Errores al empezar».

#### Scenario: Probar la versión nueva
- **GIVEN** una conversación de `pregunta` (versión 1) con el contacto `c-1`, y después `pregunta` publicado otra vez con el `prompt` de `p` cambiado a `"¿Cómo te llamas?"` (versión 2)
- **WHEN** se pulsa «Empezar de nuevo» en su página
- **THEN** el navegador llega a la página de otra conversación, con la versión 2, el contacto `c-1` y el mensaje «¿Cómo te llamas?», y `GET /conversations` tiene las dos

### Requirement: Borrar una conversación
La página de una conversación SHALL ofrecer «Borrar conversación», que pide confirmación (el borrado es definitivo y no borra los datos guardados del contacto), hace `DELETE /conversations/:conversationId` y vuelve al inicio, donde ya no aparece. Si ya no existía (404), también vuelve al inicio. Cancelar no borra nada.

#### Scenario: Borrar y cancelar
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se pulsa «Borrar conversación» y se cancela, y después se pulsa otra vez y se confirma
- **THEN** la API no recibe ningún `DELETE` tras cancelar; tras confirmar, recibe uno, el navegador llega a `/` y la conversación no está en la lista

### Requirement: Detalles de la prueba
Junto a la conversación, y separado de ella, el chat SHALL mostrar un panel «Detalles de la prueba» con el recurso conversación: `id`, flujo y versión, contacto, estado, `outcome`, `error` (`code` y `nodeId`), intento y `reason` de la pregunta pendiente, `costUsd`, `costLimitReached`, `revision` y fechas. Se actualiza tras cada avance y al releer la conversación.

#### Scenario: Fallo de llm sin credenciales
- **GIVEN** `faq-ia` publicado y la API sin `FRANCA_ANTHROPIC_API_KEY`
- **WHEN** se prueba `FAQ con IA y escalado a humano`
- **THEN** la conversación muestra «Hola, soy el asistente. Pregúntame lo que necesites sobre el servicio.» y el aviso de conversación que no ha podido continuar, y el panel dice «Fallida», `llm_not_configured`, `asistente` y un coste de 0
- **AND** la página no contiene «el proveedor o el modelo del nodo no están configurados»

#### Scenario: Intento de la pregunta pendiente
- **GIVEN** una conversación de `captacion-leads` esperando en `pedir-email`
- **WHEN** se responde `ana@`
- **THEN** el panel dice intento 2 con `invalid_format` y la `revision` 3

### Requirement: Actividad técnica en los detalles
El panel de detalles SHALL listar, en orden, los eventos `http` (`nodeId`, `attempts`, `status` y `error`), `llm` (`nodeId`, `turns`, `costUsd` y `reason`) y `error` (`code` y `nodeId`, nunca su `message`) de la conversación, en directo y al reabrirla. Es información para quien prueba el flujo: no forma parte de la conversación.

#### Scenario: Llamada bloqueada y turno de llm
- **GIVEN** la API simulada con una conversación cuya transcripción tiene `{type: "llm", nodeId: "asistente", turns: 2, costUsd: 0.02, reason: null}`, `{type: "http", nodeId: "enviar-crm", attempts: 1, status: null, error: "blocked"}` y un `end` con `outcome` `"lead-sin-enviar"`
- **WHEN** se abre su página
- **THEN** el panel lista, en ese orden, el `llm` de `asistente` con 2 turnos y su coste, y el `http` de `enviar-crm` con 1 intento y `blocked`, y la conversación no muestra ninguno de los dos

### Requirement: Pregunta no soportada
Si el `input` pendiente tiene un `inputType` que el chat no conoce, SHALL mostrar en su lugar que esa pregunta no se puede responder desde el chat de prueba, sin ningún campo para responder. El resto de la conversación y el panel de detalles se pintan igual.

#### Scenario: Tipo de pregunta futuro
- **GIVEN** la API simulada con una conversación cuyo `pendingInput` es `{type: "input", nodeId: "q", inputType: "firma", attempt: 1, reason: null}`
- **WHEN** se abre su página
- **THEN** la página dice que esa pregunta no se puede responder desde el chat de prueba y no tiene campo de texto, botones de opción ni casillas

### Requirement: La web solo escucha en la máquina local
`pnpm dev` y `pnpm --filter @franca/web start` SHALL servir la web solo en `127.0.0.1`, puerto 3000, y nunca en todas las interfaces: la web da acceso a una API sin autenticación.

#### Scenario: Otra interfaz de la máquina
- **GIVEN** la web arrancada con `pnpm dev` en una máquina con una dirección de red distinta de loopback
- **WHEN** se conecta a esa dirección en el puerto 3000 y a `127.0.0.1:3000`
- **THEN** la primera conexión se rechaza y la segunda responde

### Requirement: Host local en la web
Toda petición a la web SHALL llevar un `Host` cuyo nombre, sin el puerto y sin distinguir mayúsculas, sea `localhost`, `127.0.0.1` o `[::1]`. Si no, responde 403 sin contenido de la instalación y sin llamar a la API. Así, una página que use DNS rebinding no puede leer ni usar el chat.

#### Scenario: Host ajeno
- **GIVEN** `pregunta` publicado y la API simulada
- **WHEN** se hace `GET /` y se pide crear una conversación de `pregunta`, las dos con `Host: evil.example:3000` (la segunda con `Origin: http://evil.example:3000`)
- **THEN** las dos responden 403, la primera no contiene `Pregunta` y la API simulada no ha recibido ninguna petición

#### Scenario: Nombres locales
- **WHEN** se hace `GET /` con `Host` `localhost:3000`, `127.0.0.1:3000`, `[::1]:3000` y `LOCALHOST:3000`, y por separado con `localhost.evil.example:3000` y `127.0.0.1.nip.io:3000`
- **THEN** las cuatro primeras responden 200 y las dos últimas 403

### Requirement: Operaciones solo desde la propia web
Toda petición a la web que crea, continúa o borra una conversación SHALL llevar un `Origin` igual al origen de la propia petición (`http://` y su `Host`). Si falta o es otro, también `null`, responde 403 sin llamar a la API. Ninguna respuesta de la web lleva cabeceras `Access-Control-Allow-*`.

#### Scenario: Otra web intenta crear una conversación
- **GIVEN** `pregunta` publicado y la API simulada
- **WHEN** se pide a la web crear una conversación de `pregunta` con `Host: localhost:3000` y, por separado, `Origin: https://evil.example`, `Origin: null`, `Origin: http://127.0.0.1:3000` y sin `Origin`
- **THEN** las cuatro responden 403 sin cabeceras `Access-Control-Allow-*` y la API simulada no ha recibido ninguna petición
- **AND** con `Origin: http://localhost:3000` la API simulada recibe `POST /conversations`

### Requirement: Sin marcos de otras páginas
Toda respuesta de la web SHALL impedir que otra página la muestre dentro de un marco, con `Content-Security-Policy: frame-ancestors 'none'` y `X-Frame-Options: DENY`. Así, una web ajena no puede superponer el chat para provocar clics en «Probar», en una respuesta o en «Borrar conversación», que sí llevarían el `Origin` de la propia web.

#### Scenario: El chat dentro de un marco ajeno
- **GIVEN** una página de otro origen (`http://127.0.0.1` con otro puerto) que incluye `http://localhost:3000/` en un `iframe`
- **WHEN** el navegador abre esa página
- **THEN** el marco no muestra el chat (su documento no contiene «Franca»), y la respuesta de `/` lleva `frame-ancestors 'none'` en `Content-Security-Policy` y `X-Frame-Options: DENY`

### Requirement: Operaciones del chat en la API
Las páginas del chat SHALL usar solo estas operaciones de la API: `GET /flows?published=true`, `GET /flows/:flowId/versions/:version`, `GET /conversations`, `GET /conversations/:conversationId`, `GET /conversations/:conversationId/transcript`, `POST /conversations`, `POST /conversations/:conversationId/inputs` y `DELETE /conversations/:conversationId`. Las del editor son las de `web-editor`, y la web no usa otras. Un id de conversación que no es un UUID en minúsculas no llega a la API.

#### Scenario: Recorrido completo
- **GIVEN** la API simulada delante de la API real, reenviando cada petición y registrándola, y `captacion-leads` publicado
- **WHEN** se abre `/`, se prueba `Captación de leads`, se responde hasta el final, se recarga la página, se pulsa «Empezar de nuevo» y se borra la conversación
- **THEN** cada petición registrada es de una de esas ocho operaciones

#### Scenario: Id de conversación con una ruta dentro
- **GIVEN** la API simulada
- **WHEN** se pide a la web, desde el navegador, enviar una respuesta y borrar la conversación `..%2F..%2Fflows%2Fhola` y la conversación `00000000-0000-4000-8000-00000000000A`
- **THEN** las cuatro peticiones se responden como conversación no encontrada y la API simulada no ha recibido ninguna

### Requirement: Peticiones de la web a la API
Cada petición de la web a la API SHALL ir a la dirección de «Dirección de la API» con un `Host` local, sin `Origin`, sin cookies ni `Authorization` y sin reenviar ninguna cabecera del navegador, con `Content-Type: application/json` si lleva cuerpo. La web no deja de esperar un avance antes de 180 segundos ni una lectura antes de 15.

#### Scenario: Cabeceras que recibe la API
- **GIVEN** la API simulada con una conversación esperando
- **WHEN** el navegador, con una cookie `sesion=1` para `localhost`, envía una respuesta con la cabecera `X-Extra: 1`
- **THEN** la API simulada recibe `POST /conversations/<id>/inputs` con el `Host` de `FRANCA_API_URL`, `content-type` `application/json` e `if-match`, y sin `origin`, `cookie`, `authorization`, `referer` ni `x-extra`

#### Scenario: Avance largo
- **GIVEN** la API simulada con una conversación esperando y que tarda 150 segundos en responder a la entrada
- **WHEN** se envía una respuesta
- **THEN** el chat pinta el resultado del avance cuando llega, sin aviso de error

### Requirement: Dirección de la API
La web SHALL hablar con la API en `FRANCA_API_URL`, por defecto `http://127.0.0.1:3001`. Solo admite `http://` hacia `127.0.0.1`, `[::1]` o `localhost`, con puerto opcional y sin ruta, consulta, usuario ni contraseña. Con otro valor, también vacío, la web no arranca, termina con un código distinto de 0 y su mensaje nombra la variable sin repetir el valor.

#### Scenario: Direcciones no admitidas
- **WHEN** la web arranca por separado con `FRANCA_API_URL` igual a `https://127.0.0.1:3001`, `http://api.example.com:3001`, `http://127.0.0.1:3001/v1`, `http://u:p@127.0.0.1:3001`, `127.0.0.1:3001` y `""`
- **THEN** ninguna llega a escuchar, cada una termina con un código distinto de 0 y su mensaje nombra `FRANCA_API_URL` y no contiene `api.example.com`
- **AND** con `http://localhost:3001`, `http://[::1]:3001` y sin la variable, la web arranca

### Requirement: Sin caché de datos
Las respuestas de la web con datos de la instalación (páginas y operaciones) SHALL llevar `Cache-Control: no-store`, y cada carga de una página lee la API en ese momento: nada de lo que muestra el chat sale de una caché del servidor de la web ni del navegador.

#### Scenario: Conversación creada fuera del chat
- **GIVEN** `pregunta` publicado y `/` abierta
- **WHEN** se crea una conversación de `pregunta` directamente en la API y se recarga `/`
- **THEN** la lista de conversaciones la incluye y la respuesta de la página lleva `Cache-Control: no-store`

### Requirement: Privacidad en la web
La web SHALL no registrar las respuestas del usuario, los eventos, la transcripción ni los `contactId`, y no guardar nada de una conversación en el navegador (cookies, `localStorage`, `sessionStorage` ni IndexedDB): todo se lee de la API. De una conversación, solo su `id` aparece en la URL.

#### Scenario: Marcas fuera de los registros y del navegador
- **GIVEN** la salida de registro de la web capturada y `captacion-leads` publicado
- **WHEN** se prueba con el contacto `c-marca`, se responde `MARCA-NOMBRE` y `marca@example.com`, y se recarga la página
- **THEN** la salida de la web no contiene `MARCA-NOMBRE`, `marca@example.com` ni `c-marca`, y el navegador no tiene cookies, ni claves en `localStorage` o `sessionStorage`, ni bases de IndexedDB de `localhost:3000`

### Requirement: Códigos de error conocidos
La web SHALL conocer todos los códigos de `API_ERROR_CODES` de la API con una lista espejada y un test que falla si las dos divergen. El chat decide por `error`, nunca por el `message` de la API, y trata un código que no está en la lista como un error genérico.

#### Scenario: Paridad de códigos
- **GIVEN** la lista espejada de la web y `API_ERROR_CODES` de `apps/api`
- **WHEN** se añade un código a una de las dos y se ejecutan los tests de la web
- **THEN** el test de paridad falla

#### Scenario: Código desconocido
- **GIVEN** la API simulada con una conversación esperando que responde 409 con `{message: "MARCA-MENSAJE", error: "codigo_nuevo"}` a la entrada
- **WHEN** se envía una respuesta
- **THEN** el chat muestra el mensaje genérico de error, la respuesta sigue en su campo y la página no contiene `MARCA-MENSAJE`

### Requirement: Accesibilidad del chat
El chat SHALL poderse usar solo con teclado: el foco va a la pregunta pendiente cuando aparece, los mensajes nuevos se anuncian a los lectores de pantalla (una región de registro), cada campo, botón y casilla tiene un nombre accesible y cada imagen su `alt` (vacío si es decorativa). Se usa desde 320 px de ancho sin desplazamiento horizontal.

#### Scenario: Solo con teclado
- **GIVEN** `captacion-leads` publicado
- **WHEN** desde `/` se llega con el tabulador a «Probar» de `Captación de leads`, se pulsa Intro, se escribe `Ana` y se pulsa Intro, se escribe `ana@example.com` y se pulsa Intro, y se llega con el tabulador a `11 a 50` y se pulsa Intro
- **THEN** la conversación termina con el aviso de conversación fallida sin haber usado el ratón, y la lista de mensajes tiene el rol `log`

#### Scenario: Pantalla estrecha
- **GIVEN** una conversación de `preguntas` esperando en `plan`, en una ventana de 320 px de ancho
- **WHEN** se abre su página
- **THEN** la página no tiene desplazamiento horizontal y las dos opciones y el panel de detalles se pueden alcanzar

### Requirement: El foco no se pierde
Mientras se envía una respuesta, o si el envío falla, el foco SHALL seguir en el campo o en el botón de la pregunta, con el texto intacto, y al terminar la conversación pasar al aviso de fin. Lo mismo en el inicio con «Probar», «Ver más» y «Reintentar»: el foco no cae a la página, y si la API rechaza el identificador de contacto va al campo del contacto. Así el chat se usa solo con teclado.

#### Scenario: El foco no se pierde tras un envío fallido
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se envía una respuesta de 70 000 caracteres, que la API rechaza con 413, y otra que la API rechaza con 409 `conversation_busy`
- **THEN** las dos veces el elemento con el foco es el campo de la respuesta, con su texto

#### Scenario: El foco pasa al aviso de fin al terminar
- **GIVEN** una conversación de `pregunta` esperando en `p`
- **WHEN** se responde `Ana`
- **THEN** la conversación termina y el foco está en el aviso «Conversación terminada»

#### Scenario: Foco al rechazarse el contacto
- **GIVEN** `pregunta` publicado
- **WHEN** se escribe `ana@example.com` como identificador de contacto y se pulsa «Probar» en `Pregunta` con el teclado
- **THEN** el foco está en el campo «Identificador de contacto»

#### Scenario: Foco tras Ver más
- **GIVEN** 21 flujos publicados
- **WHEN** se pulsa «Ver más» de los flujos con el teclado
- **THEN** el foco no está en la página: sigue en un elemento de la lista de flujos
