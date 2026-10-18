# web-editor Specification

## Purpose
El editor visual de flujos de la web de Franca (`apps/web`): una persona, en su máquina, crea y edita flujos sobre un lienzo, ve los problemas de validación mientras edita, guarda el borrador en la API, lo publica y lo prueba en el chat de prueba de `web-chat`. Hereda la frontera local de la web: el navegador nunca habla con la API, lo hace el servidor de la web con operaciones fijas.

Datos de los escenarios:

- Los de `web-chat`: Franca arrancada en local (API en `127.0.0.1:3001` con Postgres, web en `127.0.0.1:3000`, navegador en `http://localhost:3000`), «una petición del navegador» y «la API simulada».
- `hola`, `captacion-leads` y `faq-ia` son los de `flows-api`. `captacion-leads` tiene 11 nodos y solo `bienvenida` tiene `position` (`{x: 0, y: 0}`); ningún nodo de `faq-ia` la tiene. `medios` es el de `web-chat`. «Creado» y «publicado» quieren decir lo mismo que en `conversations-api`.
- «Guardar», «Publicar», «Probar», «Borrar flujo», «Descartar cambios», «Ver JSON», «Añadir nodo», «Borrar nodo» y «Editar como JSON» son las acciones del editor de un flujo. «El inspector» es el formulario del nodo seleccionado y «el panel del flujo», el de sus propiedades generales.
- «El texto JSON» de un flujo es `JSON.stringify` de su valor. Todos los veredictos citados son los de `validateFlow` de `packages/spec/dist`.

## Requirements

### Requirement: Editor de flujos en local
La web de Franca SHALL ofrecer un editor de flujos: `/flujos` lista los flujos de la instalación y `/flujos/<id>` edita uno. Todo el texto visible está en español y nombra el producto como «Franca», nunca con el nombre de un paquete o del repositorio. Desde el editor siempre se puede ir al chat de prueba (`/`) y volver a `/flujos`.

#### Scenario: Del editor al chat
- **WHEN** se abre `/flujos` y se sigue el enlace al chat de prueba
- **THEN** el título del documento de `/flujos` contiene «Franca» y no contiene `@franca/` ni `franca-web`, y el navegador llega a `/`

### Requirement: Lista de flujos del editor
`/flujos` SHALL listar todos los flujos vivos (`GET /flows`), publicados o no, 20 por página y en el orden de la API, cada uno con su `name`, su `id`, su última versión o «Sin publicar» y, si los tiene, el aviso de cambios sin publicar. «Ver más» carga la página siguiente y cada flujo abre su editor. Los flujos borrados no aparecen.

#### Scenario: Borradores y publicados en la lista
- **GIVEN** `captacion-leads` publicado y después actualizado sin publicar, y `hola` creado después sin publicar
- **WHEN** se abre `/flujos`
- **THEN** la lista tiene primero `Hola` («Sin publicar») y después `Captación de leads` (versión 1, con el aviso de cambios sin publicar)
- **AND** pulsar `Hola` lleva a `/flujos/hola`

#### Scenario: Más de una página en el editor
- **GIVEN** 21 flujos creados, ninguno publicado
- **WHEN** se abre `/flujos` y se pulsa «Ver más»
- **THEN** la lista tiene primero 20 flujos y después 21, sin repetir ninguno

### Requirement: Estados de la lista de flujos
Mientras carga, `/flujos` SHALL indicarlo. Sin flujos, dice que todavía no hay ninguno y ofrece «Nuevo flujo». Si la API no responde o responde un error, muestra un mensaje en español, sin el texto de la API, con «Reintentar», que vuelve a pedir la lista.

#### Scenario: Sin flujos en el editor
- **GIVEN** ningún flujo creado
- **WHEN** se abre `/flujos`
- **THEN** la página dice que todavía no hay flujos y ofrece «Nuevo flujo»

#### Scenario: API parada en el editor
- **GIVEN** la API parada
- **WHEN** se abre `/flujos`, se arranca la API y se pulsa «Reintentar»
- **THEN** la página dice primero que no se puede conectar con la API de Franca, con «Reintentar», y después muestra la lista

### Requirement: Crear un flujo vacío
«Nuevo flujo» SHALL pedir un identificador y un nombre y crear con `POST /flows` el flujo `{"specVersion":"0.1","id":<id>,"name":<nombre>,"start":"inicio","nodes":[{"id":"inicio","type":"end"}]}`; con 201 lleva a su editor. Antes de enviarlo lo valida con `validateFlow`: si no es válido, el campo culpable lo indica, recibe el foco y no se envía nada. El `id` de un flujo no cambia después.

#### Scenario: Crear un flujo vacío
- **WHEN** en `/flujos` se pulsa «Nuevo flujo», se escribe el identificador `bienvenida-web` y el nombre `Bienvenida` y se confirma
- **THEN** la API recibe `POST /flows` con el texto `{"specVersion":"0.1","id":"bienvenida-web","name":"Bienvenida","start":"inicio","nodes":[{"id":"inicio","type":"end"}]}`
- **AND** el navegador llega a `/flujos/bienvenida-web`, cuyo lienzo tiene un único nodo, `inicio`, marcado como inicio

#### Scenario: Identificador no admitido
- **WHEN** en «Nuevo flujo» se escribe el identificador `Mi Flujo` y el nombre `Mío` y se confirma
- **THEN** el campo del identificador dice que no es válido y tiene el foco, y la API no recibe ninguna petición

### Requirement: Crear un flujo desde JSON
«Nuevo flujo» SHALL permitir también pegar el texto JSON de un flujo. Si no es JSON, si el flujo no es válido según `validateFlow` (con la lista de sus problemas) o si tiene un aviso `credential_header_literal`, dice por qué y no envía nada. Si es válido, lo crea con `POST /flows` con su texto JSON y lleva a su editor.

#### Scenario: Importar un ejemplo
- **WHEN** en «Nuevo flujo» se pega el contenido de `packages/spec/examples/captacion-leads.json` y se confirma
- **THEN** la API recibe `POST /flows` con el texto JSON de `captacion-leads`, y el navegador llega a `/flujos/captacion-leads`, cuyo lienzo tiene 11 nodos y 12 conexiones

#### Scenario: JSON pegado que no es un flujo válido
- **WHEN** en «Nuevo flujo» se pega `{"id":` y se confirma, y después se pega `{"id": "x"}` y se confirma
- **THEN** la primera vez dice que el texto no es JSON y la segunda lista los cuatro problemas de forma (faltan `specVersion`, `name`, `start` y `nodes`), y la API no recibe ninguna petición

### Requirement: Id en uso al crear
Si la API responde 409 `flow_already_exists` o `flow_id_reserved` al crear, el editor SHALL quedarse en «Nuevo flujo», conservar lo escrito e indicar en el campo del identificador que ya existe un flujo con ese id o que perteneció a un flujo borrado y no se puede reutilizar.

#### Scenario: Id repetido en el editor
- **GIVEN** `hola` creado
- **WHEN** en «Nuevo flujo» se escribe el identificador `hola` y el nombre `Otro` y se confirma
- **THEN** el campo del identificador dice que ya existe un flujo con ese id, el diálogo sigue abierto con `Otro` escrito y `hola` sigue llamándose `Hola`

#### Scenario: Id reservado en el editor
- **GIVEN** `hola` creado y borrado
- **WHEN** en «Nuevo flujo» se escribe el identificador `hola` y se confirma
- **THEN** el campo del identificador dice que ese id perteneció a un flujo borrado y no se puede reutilizar

### Requirement: Abrir un flujo
`/flujos/<id>` SHALL leer el borrador de la API (`GET /flows/:flowId`) en cada carga, también al volver a la página, y mostrar su `name`, su `id`, su revisión, su última versión o «Sin publicar» y el aviso de cambios sin publicar, además del lienzo. Nada de lo que muestra sale de una caché.

#### Scenario: Abrir captacion-leads
- **GIVEN** `captacion-leads` creado
- **WHEN** se abre `/flujos/captacion-leads`
- **THEN** la página muestra `Captación de leads`, `captacion-leads`, la revisión 1 y «Sin publicar», y el lienzo tiene sus 11 nodos con `bienvenida` marcado como inicio

#### Scenario: Flujo cambiado fuera del editor
- **GIVEN** `captacion-leads` creado y `/flujos/captacion-leads` abierta
- **WHEN** se actualiza en la API con `name` `"Leads v2"` y se recarga la página
- **THEN** la página muestra `Leads v2` y la revisión 2

### Requirement: Estados del editor de un flujo
Mientras lee el flujo, el editor SHALL indicarlo. Si el flujo no existe o está borrado, muestra «Flujo no encontrado» con un enlace a `/flujos`; un id que no cumple el patrón de `id` de la spec no llega a la API. Si la API no responde o responde un error, muestra un mensaje en español, sin el texto de la API, con «Reintentar».

#### Scenario: Flujo que no existe en el editor
- **GIVEN** la API simulada
- **WHEN** se abre `/flujos/no-existe`, al que la API simulada responde 404 `flow_not_found`, y `/flujos/No%20Vale`
- **THEN** las dos muestran «Flujo no encontrado» con un enlace a `/flujos`, y la API simulada solo ha recibido `GET /flows/no-existe`

#### Scenario: API parada al abrir un flujo
- **GIVEN** `hola` creado y la API parada
- **WHEN** se abre `/flujos/hola`, se arranca la API y se pulsa «Reintentar»
- **THEN** la página dice primero que no se puede conectar con la API de Franca y después muestra el lienzo de `hola`

### Requirement: Lienzo del flujo
El lienzo SHALL mostrar cada nodo de `nodes` con su `id`, su tipo en español y su `title` si lo tiene, marcar el nodo de `start` y dibujar una conexión por cada salto que da `targets` de `@franca/spec`, con el nombre de su campo. Un salto a un nodo que no existe se dibuja como conexión rota. El lienzo se puede desplazar y ampliar. Los textos se pintan como texto plano.

#### Scenario: Conexiones de captacion-leads
- **GIVEN** `captacion-leads` creado
- **WHEN** se abre su editor
- **THEN** el lienzo tiene 12 conexiones, entre ellas tres que salen de `pedir-tamano` (`choices[pequena].next` y `choices[mediana].next` hacia `marcar-pyme` y `choices[grande].next` hacia `marcar-empresa`) y `onError` de `enviar-crm` hacia `aviso-error`

### Requirement: Posiciones de los nodos
El lienzo SHALL colocar cada nodo en su `position` (dibujada acotada a ±10 000 000, sin cambiar el flujo). Los nodos sin `position` los coloca un diseño automático que sigue las conexiones desde `start`, no se solapa con ningún nodo y da siempre el mismo resultado para el mismo flujo. Esas posiciones no se escriben en el flujo hasta que se mueve o se añade un nodo, o se conecta una salida.

#### Scenario: Abrir sin posiciones no cambia el flujo
- **GIVEN** `faq-ia` creado
- **WHEN** se abre su editor, se recarga la página y se vuelve a abrir
- **THEN** ningún nodo se solapa con otro, cada nodo aparece las dos veces en el mismo sitio, «Guardar» dice que no hay cambios y la API no ha recibido ningún `PUT`

### Requirement: Mover un nodo
Un nodo del lienzo SHALL poderse mover arrastrándolo y, con el foco en él, con las flechas del teclado (10 unidades por pulsación). Mover o añadir un nodo, o conectar una salida (arrastrando o eligiendo su destino en el inspector, también «ninguno»), escribe su `position` y, a la vez, la de todos los nodos que no la tenían, con la posición en que se ven, así que nada cambia de sitio después. Las posiciones se escriben como enteros.

#### Scenario: Mover un nodo guarda su posición
- **GIVEN** `captacion-leads` creado y su editor abierto
- **WHEN** se lleva el foco a `pedir-nombre`, se pulsa dos veces la flecha derecha y se pulsa «Guardar»
- **THEN** en el flujo que recibe la API todos los nodos tienen `position` con enteros, `bienvenida` sigue en `{x: 0, y: 0}` y `pedir-nombre` tiene `x` 20 unidades mayor que la posición en que se pintó al abrir, y la misma `y`

#### Scenario: Conectar desde el inspector no mueve los nodos
- **GIVEN** el editor de `faq-ia` abierto
- **WHEN** en el inspector de `crear-ticket` se elige `fin-resuelto` como `onError` usando solo el teclado
- **THEN** ningún nodo cambia de sitio en el lienzo y, en «Ver JSON», todos los nodos tienen `position` con enteros

### Requirement: Salidas de cada tipo de nodo
Cada nodo SHALL mostrar en el lienzo una salida por cada salto que usa el motor según su tipo: `next` en `message`, `set` e `input` que no sea de selección única; `choices[<id>].next` de cada opción en la selección única; `rules[<i>].next` de cada regla y `else` en `condition`; `next` y `onError` en `http`; `next` y `onExhausted` en `llm`, y `target` en `jump`. `end` no tiene salidas. Cada salida lleva el nombre de su campo.

#### Scenario: Salidas de los nodos de los ejemplos
- **GIVEN** `captacion-leads` y `faq-ia` creados
- **WHEN** se abren sus editores y, en el de `captacion-leads`, se añade un nodo `jump`
- **THEN** `bienvenida` tiene la salida `next`; `pedir-tamano`, `choices[pequena].next`, `choices[mediana].next` y `choices[grande].next`; `ruta-segmento`, `rules[0].next` y `else`; `enviar-crm`, `next` y `onError`; `asistente`, `next` y `onExhausted`; el `jump`, `target`, y ningún nodo `end` tiene salidas

### Requirement: Crear conexiones arrastrando
Una salida SHALL poderse arrastrar hasta otro nodo del lienzo: al soltarla, su campo pasa a ser el `id` del destino, con el mismo JSON que si se eligiera en el inspector, y la conexión que ya tuviera se sustituye. Soltarla en vacío, fuera del lienzo o cancelar con Escape no cambia nada. Las salidas no reciben el foco: la vía del teclado es el inspector, donde cada salida es un selector de nodo y se puede hacer todo lo que hace el arrastre.

#### Scenario: Sustituir una conexión arrastrando
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** se arrastra la salida `next` de `pedir-nombre` hasta `pedir-tamano` y se suelta
- **THEN** el `next` de `pedir-nombre` es `pedir-tamano`, el lienzo ya no dibuja la conexión de `pedir-nombre` a `pedir-email` y la lista de problemas tiene «nodo inalcanzable desde start» en `pedir-email`

#### Scenario: Conectar una salida vacía arrastrando
- **GIVEN** el editor de `hola` con un mensaje añadido (`message-1`, sin `next`)
- **WHEN** se arrastra la salida `next` de `message-1` hasta `fin` y se suelta
- **THEN** el lienzo dibuja la conexión de `message-1` a `fin` y la lista de problemas ya no dice que a `message-1` le falta `next`

#### Scenario: Soltar una conexión en vacío
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** se arrastra la salida `onError` de `enviar-crm` y se suelta sobre una zona vacía del lienzo, y después se arrastra otra vez y se pulsa Escape antes de soltar
- **THEN** el `onError` de `enviar-crm` sigue siendo `aviso-error` y «Guardar» dice que no hay cambios

#### Scenario: El arrastre y el inspector dan el mismo flujo
- **GIVEN** el editor de `captacion-leads` abierto en dos pestañas
- **WHEN** en la primera se arrastra la salida `else` de `ruta-segmento` hasta `fin-empresa`, y en la segunda se elige `fin-empresa` como `else` en el inspector de `ruta-segmento` usando solo el teclado
- **THEN** «Ver JSON» muestra el mismo texto en las dos pestañas, salvo las `position`

#### Scenario: Conectar arrastrando no mueve los nodos
- **GIVEN** el editor de `faq-ia` abierto
- **WHEN** se arrastra la salida `onError` de `crear-ticket` hasta `fin-resuelto` y se suelta
- **THEN** ningún nodo cambia de sitio en el lienzo y, en «Ver JSON», todos los nodos tienen `position` con enteros

### Requirement: Destinos no permitidos al arrastrar
Soltar una salida sobre su propio nodo SHALL no cambiar nada y decir que un nodo no puede saltar a sí mismo, salvo la salida `next` de un `llm`, que sí puede (otra vuelta de la conversación, como admite el validador). Mientras se arrastra una salida, el lienzo distingue, con algo más que el color, los nodos donde se puede soltar de los que no.

#### Scenario: Soltar sobre el propio nodo
- **GIVEN** el editor de `faq-ia` abierto
- **WHEN** se arrastra la salida `next` de `pedir-email` hasta `pedir-email` y se suelta, y después la salida `onExhausted` de `asistente` hasta `asistente`
- **THEN** las dos veces el editor dice que un nodo no puede saltar a sí mismo y el flujo no cambia

#### Scenario: Un llm que vuelve a sí mismo
- **GIVEN** el editor de `faq-ia` abierto
- **WHEN** se arrastra la salida `next` de `asistente` hasta `asistente` y se suelta
- **THEN** el `next` de `asistente` es `asistente`, el lienzo dibuja la conexión de `asistente` a sí mismo y la lista de problemas no tiene ninguno sobre `asistente` (solo «nodo inalcanzable desde start» en `comprobar` y `fin-resuelto`)

### Requirement: Propiedades del flujo
El panel del flujo SHALL editar `name`, `description`, `locale`, `settings`, `start` (elegido entre los nodos) y `variables` (añadir, cambiar y quitar, con `name`, `type`, `scope`, `pii`, `description` y `default`), con las reglas de «Campos sobre el JSON del flujo». El `id` y `specVersion` se muestran sin poderse cambiar.

#### Scenario: Declarar una variable personal
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el panel del flujo se añade la variable `ciudad` de tipo `string`, se marca como dato personal y se pulsa «Guardar»
- **THEN** el último elemento de `variables` del flujo que recibe la API es exactamente `{"name":"ciudad","type":"string","pii":true}`

### Requirement: Inspector de cada tipo de nodo
El inspector SHALL tener un campo por cada propiedad del esquema del tipo del nodo, para los ocho tipos, con `type` y `position` de solo lectura: la posición cambia al mover el nodo o con «Editar como JSON». Los saltos se eligen entre los nodos del flujo o «ninguno». `value` de `set`, de opciones y de reglas, y `default`, se escriben como texto, número, sí/no, nulo o JSON, según admita el esquema. `request.body` y los predicados con `all` o `any` se editan como texto JSON.

#### Scenario: Los ocho tipos en el inspector
- **GIVEN** `captacion-leads` y `faq-ia` creados
- **WHEN** se selecciona en el lienzo un nodo de cada uno de los siete tipos que tienen y, en `captacion-leads`, se añade un nodo `jump`
- **THEN** cada inspector muestra los campos de su tipo con los valores del flujo, entre ellos el `method` `POST` de `enviar-crm`, el `provider` `principal` de `asistente`, las tres opciones de `pedir-tamano` y el `target` sin elegir del `jump`

#### Scenario: Regla de una condición
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `ruta-segmento` se cambia el valor de texto de su regla de `empresa` a `pyme` y se pulsa «Guardar»
- **THEN** el `when` de esa regla en el flujo que recibe la API es exactamente `{"variable":"segmento","op":"eq","value":"pyme"}`

### Requirement: Campos sobre el JSON del flujo
Cada campo SHALL escribir directamente en el JSON del flujo: un cambio toca solo su propiedad, que conserva su sitio (una nueva va al final de su objeto); los valores por defecto del esquema no se escriben si no se tocan; vaciar un campo opcional quita la propiedad, y también el objeto o la lista opcionales que deja vacíos. Un campo numérico guarda un número si el texto es decimal y, si no, el texto, para que lo señale el validador.

#### Scenario: Editar un campo no reordena el nodo
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `pedir-email` se cambia `retryMessage` a `Revísalo, por favor.` y se pulsa «Guardar»
- **THEN** el texto JSON que recibe la API es el de `captacion-leads` con solo ese texto cambiado

#### Scenario: Vaciar un campo opcional
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `pedir-email` se vacía `maxRetries` y se pulsa «Guardar»
- **THEN** la `validation` de `pedir-email` en el flujo que recibe la API es exactamente `{"retryMessage":"Ese email no parece válido, ¿lo revisas?"}`

#### Scenario: Número escrito con letras
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `enviar-crm` se escribe `abc` en `timeoutMs`
- **THEN** la lista de problemas tiene «debe ser de tipo integer» en `enviar-crm`, y el campo conserva `abc`

### Requirement: Cabeceras y secretos
Cada cabecera de un nodo `http` SHALL editarse como texto o como secreto. Como secreto solo se escribe el nombre (`{"secret": "NOMBRE"}`): el editor nunca pide, lee ni muestra el valor de un secreto, ni el de un proveedor de `llm`, que también es un nombre. Los avisos `credential_header_literal` y `credential_header_not_secret` se muestran en su cabecera.

#### Scenario: Cabecera con un secreto
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `enviar-crm` se añade la cabecera `X-Api-Key` como secreto `SOPORTE_TOKEN` y se pulsa «Guardar»
- **THEN** las cabeceras del flujo que recibe la API terminan en `"X-Api-Key":{"secret":"SOPORTE_TOKEN"}`

#### Scenario: Token pegado en una cabecera
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `enviar-crm` se cambia `Authorization` a texto con `Bearer abc123` y se pulsa «Guardar»
- **THEN** la cabecera muestra el aviso de credencial escrita, «Guardar» dice que hay que usar un secreto y la API no recibe ningún `PUT`

### Requirement: Añadir un nodo
«Añadir nodo» SHALL ofrecer los ocho tipos y crear el nodo al final de `nodes`, con id `<tipo>-<n>` (el menor `n` libre desde 1), `position` en la zona visible del lienzo y nada más que: `content` o `prompt` con un texto vacío en `message` e `input`, `inputType` `text` en `input`, `request` `{method: "GET", url: ""}` en `http`, y `provider` `principal` y `goal` vacío en `llm`. Queda seleccionado.

#### Scenario: Añadir un mensaje
- **GIVEN** el editor de `hola` abierto
- **WHEN** se pulsa «Añadir nodo» y se elige el tipo mensaje
- **THEN** el lienzo tiene el nodo `message-1`, seleccionado y con el foco, la lista de problemas dice que a `message-1` le falta `next`, y «Ver JSON» muestra `{"id":"message-1","type":"message","position":{…},"content":[{"kind":"text","text":""}]}` como último nodo, con `fin` también con `position`

### Requirement: Renombrar un nodo
Cambiar el `id` de un nodo SHALL cambiarlo también en `start` y en todos los saltos que apuntan a él. Si el id nuevo no cumple el patrón de `id` de la spec o ya lo tiene otro nodo, el campo lo indica y no cambia nada.

#### Scenario: Renombrar un nodo
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** se cambia el id de `pedir-nombre` a `pedir-nombre-completo` y se pulsa «Guardar»
- **THEN** en el flujo que recibe la API el `next` de `bienvenida` es `pedir-nombre-completo`, no queda ningún `pedir-nombre` y el flujo es válido

#### Scenario: Renombrar al id de otro nodo
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** se cambia el id de `pedir-nombre` a `pedir-email`
- **THEN** el campo dice que ese id ya lo tiene otro nodo y el flujo no cambia

### Requirement: Borrar un nodo
«Borrar nodo» SHALL pedir confirmación y quitar el nodo de `nodes` sin tocar los saltos que apuntaban a él: el lienzo los dibuja rotos y el validador los señala. Mientras no se guarde, «Descartar cambios» recupera el nodo.

#### Scenario: Borrar un nodo con saltos hacia él
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** se borra `aviso-error` y se confirma
- **THEN** el lienzo tiene 10 nodos y una conexión rota desde `enviar-crm`, y la lista de problemas tiene «onError apunta a un nodo inexistente: aviso-error» en `enviar-crm`

### Requirement: JSON de un nodo
«Editar como JSON» SHALL mostrar el JSON del nodo seleccionado en un campo de texto y, al aplicarlo, sustituir el nodo por el objeto escrito. Si el texto no es un objeto JSON, o si con él el flujo anidaría más de 1000 niveles (el máximo del validador), lo dice, lo conserva y no cambia nada; igual en los campos de texto JSON del inspector. Un `id` distinto se trata como en «Renombrar un nodo». Sirve para cualquier propiedad, también para cambiar `type`.

#### Scenario: Aplicar el JSON de un nodo
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en «Editar como JSON» de `bienvenida` se añade `"title": "Saludo"` al final y se aplica
- **THEN** el nodo `bienvenida` del lienzo muestra `Saludo`, y el texto JSON del flujo solo difiere del de `captacion-leads` en ese `title`

#### Scenario: JSON de un nodo roto
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en «Editar como JSON» de `bienvenida` se escribe `{"id":` y se aplica
- **THEN** el editor dice que el texto no es un objeto JSON, el campo conserva `{"id":` y el flujo no cambia

### Requirement: Validación mientras se edita
El editor SHALL validar el flujo en el navegador con `validateFlow` de `@franca/spec` tras cada cambio, sin llamar a la API, y mostrar en menos de un segundo una lista con cada problema y aviso (su mensaje y su nodo o parte del flujo) y una marca con texto, no solo color, en cada nodo afectado. Con problemas de forma, avisa de que el resto de comprobaciones llegará al corregirlos.

#### Scenario: Error al dejar un nodo sin conectar
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** en el inspector de `pedir-nombre` se elige «ninguno» como `next`
- **THEN** en menos de un segundo la lista tiene «falta la propiedad obligatoria 'next'» en `pedir-nombre`, el nodo `pedir-nombre` del lienzo lleva la marca de problemas y la lista avisa de que son problemas de forma

#### Scenario: Validar no llama a la API
- **GIVEN** la API simulada con `captacion-leads`
- **WHEN** se abre su editor, se cambian diez campos y se deshace a mano uno de ellos
- **THEN** la API simulada solo ha recibido `GET /flows/captacion-leads`

### Requirement: Ir a un problema
Elegir un problema o aviso de la lista SHALL seleccionar su nodo (`nodeId`), abrir su inspector, llevar el lienzo hasta él y pasar el foco al inspector. Uno sin `nodeId` abre el panel del flujo y le pasa el foco.

#### Scenario: Del problema al nodo
- **GIVEN** el editor de `captacion-leads` con `next` de `pedir-nombre` en «ninguno»
- **WHEN** se elige su problema en la lista
- **THEN** `pedir-nombre` queda seleccionado y visible en el lienzo, y el foco está en su inspector

### Requirement: Guardar el borrador
«Guardar» SHALL enviar el flujo con `PUT /flows/:flowId` e `If-Match` con la revisión leída o guardada por última vez y, con 200, mostrar la revisión nueva y anunciar que se guardó. No envía nada, dice por qué y lleva el foco a la lista de problemas si el flujo no es válido, tiene un aviso `credential_header_literal` o su texto JSON pasa de 1 048 576 bytes.

#### Scenario: Guardar un cambio
- **GIVEN** el editor de `captacion-leads` abierto (`revision` 1)
- **WHEN** en el panel del flujo se cambia el nombre a `Leads v2` y se pulsa «Guardar»
- **THEN** la API recibe `PUT /flows/captacion-leads` con `If-Match: "1"`, la página anuncia que se guardó y muestra la revisión 2, y `GET /flows/captacion-leads` da `name` `"Leads v2"`

#### Scenario: No se guarda un flujo inválido
- **GIVEN** el editor de `captacion-leads` con `next` de `pedir-nombre` en «ninguno»
- **WHEN** se pulsa «Guardar»
- **THEN** la página dice que hay que corregir los problemas antes de guardar, el foco está en la lista de problemas y la API no recibe ningún `PUT`

#### Scenario: Flujo de más de 1 MiB
- **GIVEN** el editor de un flujo válido cuyo texto JSON tiene 1 040 000 bytes
- **WHEN** se añade al texto de un mensaje un texto de 10 000 caracteres y se pulsa «Guardar»
- **THEN** la página dice que el flujo supera el tamaño máximo de 1 MiB y la API no recibe ningún `PUT`

### Requirement: Sin cambios que guardar
El editor SHALL considerar que hay cambios solo si el texto JSON del flujo difiere del último guardado: deshacer a mano un cambio deja el flujo sin cambios, salvo las posiciones que hayan fijado mover, añadir o conectar. Sin cambios, «Guardar» dice que no hay nada que guardar y no envía nada. Abrir un flujo sin tocarlo nunca envía nada, aunque el lienzo coloque nodos sin `position`.

#### Scenario: Cambio deshecho a mano
- **GIVEN** el editor de `captacion-leads` abierto
- **WHEN** se cambia el nombre a `Otro`, se vuelve a escribir `Captación de leads` y se pulsa «Guardar»
- **THEN** la página dice que no hay cambios que guardar y la API no recibe ningún `PUT`

### Requirement: Conflicto al guardar
Si guardar responde 412 `revision_mismatch`, el editor SHALL conservar los cambios y decir que el flujo cambió en otra pestaña o fuera del editor, con dos salidas: «Cargar el guardado», que descarta los cambios y vuelve a leer el borrador, y «Guardar encima», que repite el `PUT` con `If-Match` igual a la `currentRevision` recibida. Nunca usa `If-Match: *`.

#### Scenario: Dos pestañas editan el mismo flujo
- **GIVEN** `captacion-leads` en `revision` 1 abierto en el editor en dos pestañas
- **WHEN** la primera guarda el nombre `A`, la segunda guarda el nombre `B` y, tras el aviso de conflicto, pulsa «Guardar encima»
- **THEN** el segundo guardado recibe 412 y el tercero se envía con `If-Match: "2"` y responde 200, y `GET /flows/captacion-leads` da `revision` 3 y `name` `"B"`

#### Scenario: Cargar el guardado tras un conflicto
- **GIVEN** las dos pestañas del escenario anterior, con la segunda en el aviso de conflicto
- **WHEN** la segunda pulsa «Cargar el guardado»
- **THEN** la segunda muestra el nombre `A`, la revisión 2 y ningún cambio sin guardar

### Requirement: Respuesta perdida al guardar
Si guardar no recibe respuesta (fallo de red, `api_unreachable` o `invalid_api_response`) o recibe un 5xx, el editor SHALL releer el borrador antes de nada: si su texto JSON es el que se envió, lo da por guardado con la revisión leída; si no, o si no puede leerlo, conserva los cambios y dice que no consta que se guardaran. Nunca reenvía por su cuenta.

#### Scenario: Guardado con respuesta perdida
- **GIVEN** la API simulada delante de la API real, que reenvía el `PUT` a la API real y corta la conexión con el servidor de la web sin responderle
- **WHEN** se cambia el nombre de `captacion-leads` a `Leads v2` y se pulsa «Guardar»
- **THEN** el editor lee `GET /flows/captacion-leads`, anuncia que se guardó con la revisión 2 y la API real solo ha recibido un `PUT`

### Requirement: Errores al guardar, publicar o borrar
Los demás errores de guardar, publicar o borrar SHALL mostrarse con un mensaje propio por `error` (`flow_not_found`, `database_unavailable`, `invalid_flow`, `literal_credential` y uno genérico), nunca con el `message` de la API, y sin perder los cambios. Con `flow_not_found` dice que el flujo se borró fuera del editor y ofrece «Ver JSON» para copiar lo editado.

#### Scenario: Flujo borrado mientras se edita
- **GIVEN** el editor de `captacion-leads` abierto con el nombre cambiado a `Leads v2`
- **WHEN** se hace `DELETE /flows/captacion-leads` en la API y se pulsa «Guardar»
- **THEN** la página dice que el flujo se borró fuera del editor, sigue mostrando `Leads v2` y «Ver JSON» muestra el flujo con ese nombre

### Requirement: Descartar cambios
«Descartar cambios» SHALL, tras confirmarlo, volver a leer el borrador de la API y dejar el editor sin cambios. Es la única forma de deshacer del editor; cada campo de texto conserva el deshacer del navegador.

#### Scenario: Descartar cambios
- **GIVEN** el editor de `captacion-leads` con `aviso-error` borrado y el nombre cambiado a `Otro`
- **WHEN** se pulsa «Descartar cambios» y se confirma
- **THEN** el editor muestra `Captación de leads`, el lienzo tiene 11 nodos y no hay cambios sin guardar

### Requirement: Salir con cambios sin guardar
Con cambios sin guardar, salir del editor por un enlace de la web, recargar o cerrar la pestaña SHALL pedir confirmación. Si se confirma, los cambios se pierden: al volver, el editor lee el borrador de la API y no recupera nada de la visita anterior. Sin cambios, sale sin preguntar.

#### Scenario: Salir con cambios sin guardar
- **GIVEN** el editor de `captacion-leads` con el nombre cambiado a `Otro`
- **WHEN** se sigue el enlace a `/flujos`, se cancela la confirmación, se sigue otra vez, se acepta y se vuelve a abrir `/flujos/captacion-leads`
- **THEN** tras cancelar sigue en el editor con `Otro`, tras aceptar llega a `/flujos`, y al volver muestra `Captación de leads` sin cambios sin guardar

#### Scenario: Recargar con cambios
- **GIVEN** el editor de `captacion-leads` con el nombre cambiado a `Otro`
- **WHEN** se recarga la página
- **THEN** el navegador pide confirmación antes de salir

### Requirement: Publicar desde el editor
«Publicar» SHALL publicar el borrador guardado con `POST /flows/:flowId/versions` e `If-Match` con su revisión, y solo si no hay cambios sin guardar (si los hay, dice que hay que guardar antes). Con 201 anuncia la versión nueva y con 200 que esa versión ya tenía el borrador; en los dos casos actualiza la última versión y el aviso de cambios sin publicar. Con 412 ofrece «Cargar el guardado».

#### Scenario: Publicar un flujo desde el editor
- **GIVEN** el editor de `captacion-leads` abierto, sin versiones
- **WHEN** se pulsa «Publicar»
- **THEN** la API recibe `POST /flows/captacion-leads/versions` con `If-Match: "1"`, la página anuncia la versión 1 y ya no muestra el aviso de cambios sin publicar

#### Scenario: Publicar sin cambios desde el editor
- **GIVEN** el editor de `captacion-leads` publicado una vez y sin cambios
- **WHEN** se pulsa «Publicar»
- **THEN** la página dice que la versión 1 ya tiene este borrador y `GET /flows/captacion-leads/versions` tiene `total` 1

#### Scenario: Publicar con cambios sin guardar
- **GIVEN** el editor de `captacion-leads` con el nombre cambiado a `Otro`
- **WHEN** se pulsa «Publicar»
- **THEN** la página dice que hay que guardar antes de publicar y la API no recibe ningún `POST`

#### Scenario: Publicar tras mover un nodo
- **GIVEN** `captacion-leads` publicado una vez y su editor abierto
- **WHEN** se mueve `pedir-nombre`, se pulsa «Guardar» y después «Publicar»
- **THEN** la página anuncia la versión 2: las posiciones son parte del flujo

#### Scenario: Publicar un borrador cambiado fuera
- **GIVEN** el editor de `captacion-leads` abierto en `revision` 1 y, después, el borrador actualizado en la API
- **WHEN** se pulsa «Publicar»
- **THEN** la página dice que el flujo cambió fuera del editor y ofrece «Cargar el guardado», y no hay versiones

### Requirement: Probar desde el editor
«Probar» SHALL crear una conversación con la última versión publicada (`POST /conversations` con `{"flowId"}`) y llevar a su página del chat. Solo está disponible con alguna versión publicada y sin cambios sin guardar; si el borrador tiene cambios sin publicar, avisa de que se prueba la versión N. Si falla, se queda en el editor con los mensajes de «Errores al empezar» de `web-chat`.

#### Scenario: Probar tras publicar
- **GIVEN** el editor de `captacion-leads` publicado
- **WHEN** se pulsa «Probar»
- **THEN** la API recibe `POST /conversations` con `{"flowId":"captacion-leads"}` y el navegador llega a `/conversaciones/<id>`, que muestra «¡Hola! Te hago tres preguntas y te paso con la persona adecuada.»

#### Scenario: Probar sin versión publicada
- **GIVEN** el editor de `hola` sin versiones
- **WHEN** se pulsa «Probar»
- **THEN** la página dice que hay que publicar antes de probar y la API no recibe `POST /conversations`

#### Scenario: Probar con cambios sin publicar
- **GIVEN** `captacion-leads` publicado, actualizado después con el nombre `Leads v2` y su editor abierto
- **WHEN** se lleva el foco a «Probar»
- **THEN** «Probar» está disponible y la página avisa, junto a él, de que se probará la versión 1 y no el borrador

### Requirement: Ver el JSON del flujo
«Ver JSON» SHALL mostrar en un texto de solo lectura el texto JSON del flujo tal como está en el editor, con los cambios sin guardar: lo mismo que se enviaría al guardar. «Copiar» lo copia al portapapeles.

#### Scenario: Ver y copiar el JSON
- **GIVEN** el editor de `captacion-leads` con el nombre cambiado a `Leads v2`
- **WHEN** se pulsa «Ver JSON» y después «Copiar»
- **THEN** el texto mostrado y el del portapapeles son el texto JSON de `captacion-leads` con `name` `"Leads v2"`

### Requirement: Borrar un flujo desde el editor
«Borrar flujo» SHALL pedir confirmación explicando que el `id` queda reservado para siempre y que las versiones publicadas y sus conversaciones se conservan. Confirmado, envía `DELETE /flows/:flowId` con `If-Match` de la revisión; con 204 lleva a `/flujos`, donde ya no aparece. Con 412 no se borra y ofrece «Cargar el guardado»; con 404, lleva a `/flujos`.

#### Scenario: Borrar un flujo desde el editor
- **GIVEN** el editor de `hola` abierto (`revision` 1)
- **WHEN** se pulsa «Borrar flujo» y se confirma
- **THEN** la API recibe `DELETE /flows/hola` con `If-Match: "1"`, el navegador llega a `/flujos` y la lista no tiene `Hola`

#### Scenario: Borrar un flujo cambiado fuera
- **GIVEN** el editor de `hola` abierto en `revision` 1 y, después, `hola` actualizado en la API
- **WHEN** se pulsa «Borrar flujo» y se confirma
- **THEN** la página dice que el flujo cambió fuera del editor y ofrece «Cargar el guardado», y `GET /flows/hola` responde 200

### Requirement: Operaciones del editor en la API
El editor SHALL usar solo estas operaciones de la API, más `POST /conversations` para «Probar»: `GET /flows` (sin `published`), `GET /flows/:flowId`, `POST /flows`, y `PUT /flows/:flowId`, `POST /flows/:flowId/versions` y `DELETE /flows/:flowId` con `If-Match`. El navegador no elige `limit` ni `published`. Un id de flujo que no cumple el patrón de `id` de la spec no llega a la API.

#### Scenario: Recorrido del editor
- **GIVEN** la API simulada delante de la API real, reenviando y registrando cada petición
- **WHEN** se abre `/flujos`, se importa `captacion-leads`, se cambia y guarda su nombre, se publica, se pulsa «Probar», se vuelve a `/flujos/captacion-leads` y se borra el flujo
- **THEN** cada petición registrada es de una de esas siete operaciones o de las del chat, y ninguna es `POST /flows/validate`

#### Scenario: Id de flujo con una ruta dentro
- **GIVEN** la API simulada
- **WHEN** se pide a la web, desde el navegador, leer, guardar, publicar y borrar el flujo `..%2Fconversations` y el flujo `Hola`
- **THEN** las ocho peticiones se responden 404 `flow_not_found` y la API simulada no ha recibido ninguna

### Requirement: Cambios de flujos solo desde la propia web
Toda petición a la web que crea, guarda, publica o borra un flujo SHALL llevar un `Host` local y un `Origin` igual al de la propia petición (`http://` y su `Host`), como «Host local en la web» y «Operaciones solo desde la propia web» de `web-chat`. Si no, responde 403 sin llamar a la API y sin cabeceras `Access-Control-Allow-*`.

#### Scenario: Otra web intenta guardar un flujo
- **GIVEN** `hola` creado y la API simulada
- **WHEN** se pide a la web guardar, publicar y borrar `hola` con `Host: localhost:3000` y, por separado, `Origin: https://evil.example`, `Origin: null`, `Origin: http://127.0.0.1:3000` y sin `Origin`
- **THEN** las doce responden 403 sin cabeceras `Access-Control-Allow-*` y la API simulada no ha recibido ninguna petición

#### Scenario: Host ajeno en el editor
- **GIVEN** `hola` creado y la API simulada
- **WHEN** se hace `GET /flujos` y se pide guardar `hola`, las dos con `Host: evil.example:3000` (la segunda con `Origin: http://evil.example:3000`)
- **THEN** las dos responden 403, la primera no contiene `Hola` y la API simulada no ha recibido ninguna petición

### Requirement: Cuerpo de los flujos hacia la API
Al crear o guardar, el servidor de la web SHALL leer un cuerpo JSON de hasta 1 048 576 bytes que sea un objeto y enviar a la API su texto JSON, con las cabeceras de «Peticiones de la web a la API» de `web-chat` más `If-Match` donde toca. Publicar y borrar van sin cuerpo. Un cuerpo mayor responde 413 `payload_too_large`, uno que no es JSON 400 `invalid_json` y otro valor 400 `invalid_request`, sin llamar a la API.

#### Scenario: Cabeceras de un guardado
- **GIVEN** la API simulada con `captacion-leads`
- **WHEN** el navegador, con una cookie `sesion=1` para `localhost`, guarda el flujo con la cabecera `X-Extra: 1`
- **THEN** la API simulada recibe `PUT /flows/captacion-leads` con el texto JSON del flujo, el `Host` de `FRANCA_API_URL`, `content-type` `application/json` e `if-match`, y sin `origin`, `cookie`, `authorization`, `referer` ni `x-extra`

#### Scenario: Cuerpo de un flujo demasiado grande
- **GIVEN** la API simulada
- **WHEN** se pide a la web crear un flujo con un cuerpo de 1 048 577 bytes y, por separado, con el cuerpo `[]`
- **THEN** responden 413 `payload_too_large` y 400 `invalid_request`, y la API simulada no ha recibido ninguna petición

### Requirement: Respuestas de flujos en el navegador
Las respuestas correctas de las operaciones del editor SHALL llegar al navegador con el recurso de la API. Las de error llegan como `{error}`, más `currentRevision` en un 412, sin `message`, `issues` ni `warnings`: el editor explica los problemas con su propia validación.

#### Scenario: Error de la API sin su mensaje
- **GIVEN** la API simulada, que responde al `PUT` de `captacion-leads` 400 con `{message: "MARCA-MENSAJE", error: "invalid_flow", issues: [{layer: "semantic", path: "/start", message: "MARCA-ISSUE"}], warnings: []}`
- **WHEN** se guarda un cambio desde el editor
- **THEN** el navegador recibe exactamente `{"error":"invalid_flow"}`, la página dice que la API considera el flujo no válido y no contiene `MARCA-MENSAJE` ni `MARCA-ISSUE`

### Requirement: Privacidad del editor
La web SHALL no registrar el contenido de los flujos (solo método, plantilla de ruta, estado y código, como en el chat) ni guardar nada de un flujo en el navegador (cookies, `localStorage`, `sessionStorage` ni IndexedDB): los cambios sin guardar viven solo en la pestaña. El editor nunca pide ni muestra el valor de un secreto.

#### Scenario: Marcas fuera de los registros del editor
- **GIVEN** la salida de registro de la web capturada
- **WHEN** se crea un flujo con un mensaje `MARCA-FLUJO`, se guarda, se provoca un 412 y un 404 al guardar, se publica y se recarga la página
- **THEN** la salida de la web no contiene `MARCA-FLUJO`, y el navegador no tiene cookies, ni claves en `localStorage` o `sessionStorage`, ni bases de IndexedDB de `localhost:3000`

### Requirement: El editor no carga direcciones del flujo
El editor SHALL mostrar las URLs del flujo (multimedia, `imageUrl` y `url` de `http`) solo como texto: no las carga, no las enlaza ni las incrusta, y el navegador no hace ninguna petición a ellas mientras se edita. Los textos del flujo se pintan como texto plano.

#### Scenario: El editor no carga direcciones del flujo
- **GIVEN** `medios` creado
- **WHEN** se abre su editor y se selecciona el nodo `m`
- **THEN** el inspector muestra `https://example.com/logo.png` y `<b>Hola</b>` como texto, la página no tiene elementos `img`, `video`, `audio`, `iframe` ni enlaces con esas URLs, y el navegador no ha hecho ninguna petición a `example.com`

### Requirement: Accesibilidad del editor
El editor SHALL poderse usar solo con teclado: cada nodo del lienzo es enfocable, en el orden de `nodes`, con un nombre accesible que dice su `id`, su tipo y si tiene problemas; los saltos se eligen en el inspector; cada campo y botón tiene nombre accesible; el resultado de guardar y publicar y el número de problemas se anuncian en una región de estado.

#### Scenario: Crear un flujo solo con teclado
- **WHEN** desde `/flujos`, solo con el teclado, se crea `teclado` con el nombre `Teclado`, se añade un mensaje con el texto `Hola desde el teclado` y `next` `inicio`, se elige `message-1` como `start`, se guarda, se publica y se pulsa «Probar»
- **THEN** la conversación muestra «Hola desde el teclado» sin haber usado el ratón, y la página del editor tenía una región con el rol `status`

### Requirement: El foco no se pierde en el editor
Tras guardar, publicar, aplicar el JSON de un nodo, añadir o borrar un nodo, o un error, el foco SHALL quedar en un elemento con sentido (el botón pulsado, el nodo nuevo, el lienzo, la lista de problemas o el campo culpable), nunca en la página.

#### Scenario: El foco tras añadir y borrar un nodo
- **GIVEN** el editor de `hola` abierto
- **WHEN** con el teclado se añade un mensaje y después se borra y se confirma
- **THEN** tras añadirlo el foco está en `message-1` del lienzo, y tras borrarlo en el lienzo, no en la página

### Requirement: Editor en pantalla estrecha
El editor SHALL usarse desde 320 px de ancho sin desplazamiento horizontal de la página: el lienzo se desplaza dentro de su propia zona (es contenido en dos dimensiones) y el inspector, el panel del flujo y la lista de problemas quedan alcanzables.

#### Scenario: Editor en pantalla estrecha
- **GIVEN** `captacion-leads` creado, en una ventana de 320 px de ancho
- **WHEN** se abre su editor y se selecciona `enviar-crm`
- **THEN** la página no tiene desplazamiento horizontal, y el inspector de `enviar-crm`, «Guardar» y la lista de problemas se pueden alcanzar
