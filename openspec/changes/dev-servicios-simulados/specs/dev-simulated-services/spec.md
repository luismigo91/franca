## Purpose

La demo local de Franca: lo que necesita una persona que clona el repositorio para ver un flujo de ejemplo llegar a su final feliz en el chat de prueba, en su máquina, sin Internet ni credenciales reales. La forman un CRM simulado en loopback, una copia local de `captacion-leads` que apunta a él, una semilla que la publica en la API local y un arranque de un solo comando que configura la salida http de la API para esa ejecución. No forma parte de la API ni de la web, y la CI no la arranca.

Datos de los escenarios:

- `captacion-leads` es el de `packages/spec/examples/`; `captacion-leads-local` es su copia local (ver «Copia local de captacion-leads»). `faq-ia` es el de `packages/spec/examples/`. «Publicado» quiere decir lo mismo que en `conversations-api`.
- «La demo» es `pnpm dev:demo` ejecutado en la raíz del repositorio, con Postgres en marcha (`docker compose up -d`) y `DATABASE_URL` definida. Salvo que el escenario diga otra cosa, la shell no define `FRANCA_HTTP_LOCAL_NAMES`, `FRANCA_HTTP_ALLOWED_DESTINATIONS`, `FRANCA_HTTP_SECRET_ORIGINS`, `FRANCA_SECRET_CRM_TOKEN`, `FRANCA_ANTHROPIC_API_KEY` ni `FRANCA_API_URL`, y los puertos 3000, 3001 y 4010 de `127.0.0.1` están libres.
- «El token de la ejecución» es el valor de `FRANCA_SECRET_CRM_TOKEN` que la demo genera al arrancar. «El CRM simulado» es el de «CRM simulado».
- «Una conversación de `captacion-leads-local` lista para enviar» es una conversación suya a la que se ha enviado `{text: "Ana"}` y `{text: "ana@example.com"}`, esperando en `pedir-tamano`. En el chat, eso es responder «Ana» y «ana@example.com».
- «La salida de la demo» es todo lo que escriben, en la terminal de `pnpm dev:demo`, la demo, el CRM simulado, la API y la web.
- La API local está en `http://127.0.0.1:3001` y la web en `http://localhost:3000`.

## ADDED Requirements

### Requirement: Arranque de la demo local
`pnpm dev:demo` SHALL arrancar en la máquina local el CRM simulado y lo mismo que `pnpm dev` (la API y la web), con la configuración de «Configuración de la salida http de la demo». Después siembra la copia local y escribe en su salida la dirección de la web y el nombre del flujo que hay que probar. Necesita lo mismo que `pnpm dev`. `pnpm dev` no cambia.

#### Scenario: Lead de punta a punta en la demo
- **GIVEN** la demo en marcha
- **WHEN** se abre `http://localhost:3000`, se prueba «Captación de leads (local)» y se responde «Ana», «ana@example.com» y «Más de 50»
- **THEN** la conversación termina con `outcome` `"lead-empresa"` y el mensaje «Gracias, Ana. Alguien del equipo comercial te escribe hoy mismo.»
- **AND** el CRM simulado ha recibido una sola petición `POST /api/leads` y ha respondido 201
- **AND** otra conversación respondida con «1 a 10» termina con `outcome` `"lead-pyme"`

#### Scenario: Demo sin Internet
- **GIVEN** la máquina sin conexión a ninguna red salvo loopback
- **WHEN** se arranca la demo y una conversación de `captacion-leads-local` lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** la conversación termina con `outcome` `"lead-empresa"` y ni la API ni el CRM simulado han abierto una conexión fuera de loopback ni consultado el DNS por `crm.franca.test`

#### Scenario: Copia local sin la demo
- **GIVEN** `captacion-leads-local` publicado y la API arrancada con `pnpm dev`, sin ninguna variable `FRANCA_HTTP_*` ni `FRANCA_SECRET_*`
- **WHEN** una conversación suya lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** queda en `failed` con `error` `{code: "missing_secret", nodeId: "enviar-crm"}` y la API no ha abierto ninguna conexión

### Requirement: Configuración de la salida http de la demo
La demo SHALL dar a la API, solo en esa ejecución, `FRANCA_HTTP_LOCAL_NAMES` = `crm.franca.test=127.0.0.1`, `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:4010`, `FRANCA_HTTP_SECRET_ORIGINS` = `CRM_TOKEN=http://crm.franca.test:4010` y `FRANCA_SECRET_CRM_TOKEN` = `Bearer ` seguido de un token aleatorio nuevo de al menos 128 bits. El CRM simulado recibe el mismo token. La demo no escribe ningún fichero y el token no aparece en su salida.

#### Scenario: Línea de arranque de la API en la demo
- **WHEN** se arranca la demo
- **THEN** la salida de arranque de la salida http de la API contiene `CRM_TOKEN`, `http://crm.franca.test:4010`, `127.0.0.1:4010` y `crm.franca.test`

#### Scenario: Token de la ejecución fuera de la salida
- **GIVEN** dos ejecuciones seguidas de la demo, cada una con una conversación que termina en `lead-empresa`
- **WHEN** se leen sus salidas y `git status`
- **THEN** la salida de cada ejecución no contiene su token, los dos tokens son distintos y `git status` no muestra ficheros nuevos ni cambiados

### Requirement: Variables de la shell en conflicto
Si la shell define `FRANCA_HTTP_LOCAL_NAMES`, `FRANCA_HTTP_ALLOWED_DESTINATIONS`, `FRANCA_HTTP_SECRET_ORIGINS` o `FRANCA_SECRET_CRM_TOKEN`, aunque sea con `""`, la demo SHALL negarse a arrancar sin lanzar ningún proceso, terminar con un código distinto de 0 y nombrar cada una sin mostrar su valor. No las pisa ni las mezcla.

#### Scenario: Variables de la shell en conflicto
- **GIVEN** la shell con `FRANCA_HTTP_ALLOWED_DESTINATIONS` = `127.0.0.1:8080` y `FRANCA_SECRET_CRM_TOKEN` = `Bearer no-mostrar-3`
- **WHEN** se ejecuta `pnpm dev:demo`
- **THEN** termina con un código distinto de 0 sin escuchar en los puertos 3000, 3001 ni 4010, y su salida nombra las dos variables y no contiene `no-mostrar-3` ni `127.0.0.1:8080`

#### Scenario: Variable vacía en la shell
- **GIVEN** la shell con `FRANCA_HTTP_LOCAL_NAMES` = `""`
- **WHEN** se ejecuta `pnpm dev:demo`
- **THEN** termina con un código distinto de 0 sin lanzar ningún proceso y su salida nombra `FRANCA_HTTP_LOCAL_NAMES`

### Requirement: La demo no llama a Claude
La demo SHALL arrancar la API sin `FRANCA_ANTHROPIC_API_KEY` en su entorno, aunque la shell la defina, y decirlo en su salida sin mostrar la clave. En la demo, cada nodo `llm` falla con `llm_not_configured` y ningún proceso conecta con la API de Anthropic.

#### Scenario: Clave de Claude en la shell
- **GIVEN** la shell con `FRANCA_ANTHROPIC_API_KEY` = `clave-no-usar` y la demo en marcha con `faq-ia` publicado
- **WHEN** se crea una conversación de `faq-ia`
- **THEN** queda en `failed` con `error` `{code: "llm_not_configured", nodeId: "asistente"}`
- **AND** la salida de arranque de la API dice que no hay proveedor `principal`, la de la demo dice que la demo no usa Claude y ninguna contiene `clave-no-usar`

### Requirement: Puerto del CRM simulado
El CRM simulado SHALL escuchar solo en `127.0.0.1:4010`. Si no puede escuchar ahí, la demo SHALL terminar con un código distinto de 0 sin arrancar la API ni la web, con un mensaje que nombra el puerto 4010.

#### Scenario: Puerto del CRM ocupado
- **GIVEN** otro proceso escuchando en `127.0.0.1:4010`
- **WHEN** se ejecuta `pnpm dev:demo`
- **THEN** termina con un código distinto de 0, su salida nombra el puerto 4010 y no hay nada escuchando en los puertos 3000 ni 3001

#### Scenario: CRM solo en loopback
- **GIVEN** la demo en marcha en una máquina con una dirección de red local `L`
- **WHEN** se intenta conectar con `L:4010` y con `[::1]:4010`
- **THEN** las dos conexiones se rechazan

### Requirement: Peticiones que acepta el CRM simulado
A un `POST /api/leads` con `Authorization` igual al token de la ejecución, `Content-Type` `application/json` y un cuerpo que es un objeto JSON, el CRM simulado SHALL responder 201 con `Content-Type` `application/json` y el cuerpo `{"id":"L-<n>"}`. `n` empieza en 1 en cada ejecución y sube de uno en uno. No guarda nada en disco.

#### Scenario: Leads consecutivos
- **GIVEN** la demo recién arrancada
- **WHEN** dos conversaciones de `captacion-leads-local` listas para enviar reciben `{input: {choice: "grande"}}` y `{input: {choice: "pequena"}}`
- **THEN** el CRM simulado responde 201 con `{"id":"L-1"}` y después con `{"id":"L-2"}`, y las conversaciones terminan con `outcome` `"lead-empresa"` y `"lead-pyme"`

### Requirement: Peticiones que rechaza el CRM simulado
El CRM simulado SHALL responder, por este orden: 404 si el método o la ruta (sin la consulta) no son `POST /api/leads`; 401 sin `Authorization` o con un valor distinto del token de la ejecución; 400 si el `Content-Type` no es `application/json` o el cuerpo no es un objeto JSON. Cada error tiene un cuerpo JSON `{"error": "<motivo>"}` y no repite nada de la petición.

#### Scenario: Lead con otro token
- **GIVEN** el CRM simulado en marcha con el token `Bearer t-1` y la API arrancada a mano con la configuración de la demo pero `FRANCA_SECRET_CRM_TOKEN` = `Bearer t-2`
- **WHEN** una conversación de `captacion-leads-local` lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** el evento `http` de `enviar-crm` es `{attempts: 1, status: 401, error: "http_status"}` y la conversación termina con `outcome` `"lead-sin-enviar"`

#### Scenario: Rutas y cuerpos que rechaza
- **GIVEN** el CRM simulado en marcha con el token `Bearer t-1`
- **WHEN** recibe por separado `GET /api/leads`, `POST /otra` y `POST /api/leads?x=1` sin `Authorization`, y `POST /api/leads` con `Authorization` `Bearer t-1` y, uno a uno, `Content-Type` `text/plain` con `{}`, y `application/json` con `[]`, `"a"` y `{`
- **THEN** responde 404, 404, 401, 400, 400, 400 y 400, cada uno con un cuerpo `{"error": …}`, y no ha asignado ningún `id`

### Requirement: Registro del CRM simulado
El CRM simulado SHALL escribir en su salida una línea por petición con el método, la ruta sin consulta, el status y, en un 201, el `id` asignado. Nunca escribe cabeceras, la consulta ni el cuerpo de la petición.

#### Scenario: Lead fuera del registro del CRM
- **GIVEN** la demo en marcha
- **WHEN** una conversación de `captacion-leads-local` lista para enviar recibe `{input: {choice: "grande"}}`
- **THEN** la salida del CRM simulado tiene una línea con `POST`, `/api/leads`, `201` y `L-1`
- **AND** no contiene `Ana`, `ana@example.com`, `51+`, `empresa` ni el token de la ejecución

### Requirement: Copia local de captacion-leads
El repositorio SHALL incluir `captacion-leads-local`, fuera de `packages/spec/examples/`. Es igual que `captacion-leads` salvo `id` `captacion-leads-local`, `name` `Captación de leads (local)`, `description` y la `url` de `enviar-crm`, `http://crm.franca.test:4010/api/leads`. Es válida y sin avisos según `@franca/spec`. Los ejemplos de `packages/spec/examples/` no cambian.

#### Scenario: Paridad con el ejemplo canónico
- **GIVEN** `captacion-leads-local` y `packages/spec/examples/captacion-leads.json`
- **WHEN** se comparan sin `id`, `name`, `description` ni `nodes[6].request.url`, y se valida la copia con `validateFlow`
- **THEN** son iguales como JSON, la copia tiene esos cuatro valores y el veredicto es `valid` `true` con `warnings` `[]`

### Requirement: Semilla de la demo
`pnpm demo:seed` SHALL dejar `captacion-leads-local` publicada con el contenido de la copia en la API de `FRANCA_API_URL`, con las mismas reglas y el mismo valor por defecto que la web. Crea el flujo si no existe y lo publica si su borrador es igual a la copia como JSON; si no, no lo toca. Dice qué hizo con cada flujo y termina con 0 solo si todos quedan publicados con el contenido de la copia.

#### Scenario: Primera siembra
- **GIVEN** la API local sin `captacion-leads-local`
- **WHEN** se ejecuta `pnpm demo:seed`
- **THEN** termina con 0, su salida dice que `captacion-leads-local` se ha creado y publicado, y `GET /flows/captacion-leads-local/versions/1` devuelve un `flow` igual a la copia

#### Scenario: Siembra repetida
- **GIVEN** la API local con `captacion-leads-local` ya sembrado
- **WHEN** se ejecuta `pnpm demo:seed` dos veces
- **THEN** las dos terminan con 0 y dicen que ya estaba publicado, `GET /flows/captacion-leads-local/versions` tiene `total` 1 y la `revision` del borrador sigue en 1

#### Scenario: Copia creada sin publicar
- **GIVEN** `captacion-leads-local` creado con el contenido de la copia y sin versiones
- **WHEN** se ejecuta `pnpm demo:seed`
- **THEN** termina con 0 y el flujo tiene la versión 1 igual a la copia

#### Scenario: Borrador cambiado a mano
- **GIVEN** `captacion-leads-local` sembrado y después actualizado con `name` `"Mío"`
- **WHEN** se ejecuta `pnpm demo:seed`
- **THEN** termina con un código distinto de 0, su salida nombra `captacion-leads-local` y dice que su borrador no es la copia y no se ha tocado
- **AND** el borrador sigue con `name` `"Mío"` y la misma `revision`, y no hay versiones nuevas

#### Scenario: Id reservado por un borrado
- **GIVEN** `captacion-leads-local` sembrado y después borrado con `DELETE /flows/captacion-leads-local`
- **WHEN** se ejecuta `pnpm demo:seed`
- **THEN** termina con un código distinto de 0 y su salida dice que el `id` `captacion-leads-local` está reservado por un borrado y que solo se recupera borrando la base de datos local (`docker compose down -v`)

#### Scenario: API no disponible para la semilla
- **GIVEN** nada escuchando en `127.0.0.1:3001`, y en otra ronda la API en marcha con Postgres parado
- **WHEN** se ejecuta `pnpm demo:seed` en cada ronda
- **THEN** las dos terminan con un código distinto de 0 en menos de 15 segundos
- **AND** la primera dice que no puede conectar con la API de Franca en `http://127.0.0.1:3001`, y la segunda que la base de datos no responde y que se arranca con `docker compose up -d`

#### Scenario: Dirección de la API no admitida en la semilla
- **WHEN** se ejecuta `pnpm demo:seed` con `FRANCA_API_URL` = `http://192.168.1.10:3001`, y en otra ronda con `""`
- **THEN** las dos terminan con un código distinto de 0 sin hacer ninguna petición y su salida nombra `FRANCA_API_URL`

### Requirement: Semilla sin migraciones
Si la API responde con un error interno (500) a la primera lectura del flujo, `pnpm demo:seed` SHALL terminar con un código distinto de 0 y decir que puede faltar aplicar las migraciones de la base de datos, nombrando `pnpm --filter @franca/api db:migrate`.

#### Scenario: Base de datos sin migraciones para la semilla
- **GIVEN** la API en marcha contra una base de Postgres vacía, a la que no se le han aplicado las migraciones
- **WHEN** se ejecuta `pnpm demo:seed`
- **THEN** termina con un código distinto de 0 y su salida nombra `pnpm --filter @franca/api db:migrate`

### Requirement: Siembra al arrancar la demo
La demo SHALL esperar hasta 120 segundos a que la API local responda y entonces ejecutar la semilla. Si la API no responde a tiempo o la semilla falla, la demo sigue en marcha y su salida dice el motivo y que se puede repetir con `pnpm demo:seed`.

#### Scenario: Siembra fallida al arrancar
- **GIVEN** `captacion-leads-local` borrado en la API local (su `id` está reservado)
- **WHEN** se arranca la demo
- **THEN** su salida dice que el `id` está reservado y nombra `pnpm demo:seed`, y el CRM simulado, la API y la web siguen escuchando

### Requirement: Parada de la demo
Cuando la demo recibe `SIGINT` o `SIGTERM`, cuando el CRM simulado termina o cuando termina lo que arrancó de `pnpm dev` (la API y la web), SHALL parar todos los procesos que arrancó y terminar. En los dos últimos casos termina con un código distinto de 0 y su salida dice qué se ha parado. No deja nada escuchando en los puertos 3000, 3001 ni 4010.

#### Scenario: Parada con Ctrl+C
- **GIVEN** la demo en marcha
- **WHEN** se pulsa Ctrl+C en su terminal
- **THEN** la demo termina en menos de 10 segundos y no hay nada escuchando en los puertos 3000, 3001 ni 4010 de `127.0.0.1`

#### Scenario: CRM simulado que termina
- **GIVEN** la demo en marcha
- **WHEN** el proceso del CRM simulado termina
- **THEN** la demo para la API y la web, termina con un código distinto de 0 y su salida dice que el CRM simulado se ha parado

#### Scenario: Arranque de la API y la web que termina
- **GIVEN** la demo en marcha
- **WHEN** termina el proceso que la demo arrancó para hacer lo mismo que `pnpm dev`
- **THEN** la demo para el CRM simulado, termina con un código distinto de 0 y su salida dice que `pnpm dev` ha terminado
