# Proposal: servicios simulados para ver los ejemplos terminar en local (`dev-servicios-simulados`)

**Fecha**: 2026-10-17 · **Estado**: Draft · **Rama**: `feat/dev-servicios-simulados` · **Feature 7b** del plan: va entre el chat de prueba (7, hecha) y el editor visual (8). Cierra la «pregunta abierta 1» y el FOLLOW-UP 7.1 de `web-chat`, y el FOLLOW-UP 5.1 de `api-http-host`.

## Why

Una persona que clona Franca, levanta Postgres y ejecuta `pnpm dev` puede conversar en el chat de prueba, pero ningún ejemplo llega a su final feliz. `captacion-leads` termina en `failed` con `missing_secret`, porque su nodo `http` apunta a `https://crm.example.com` con el secreto `CRM_TOKEN`. `faq-ia` termina en `llm_not_configured` sin clave de Claude. Para ver un lead que llega a un CRM y una conversación que acaba en `lead-empresa` hace falta un CRM de verdad, un secreto y tres variables de la salida http con valores exactos. Hoy nadie puede montar eso sin leer la spec de `http-host`.

El objetivo es que funcione en local con un comando, **sin Internet y sin credenciales reales**. Auditado contra el código fusionado, esto tiene un obstáculo que la recomendación del chat no resolvía:

- **El motor rechaza en la `url` de un nodo `http` las IP literales, `localhost` y `*.localhost`** (`invalid_url`, `packages/engine/src/http/url.ts`). Hace falta un nombre de dominio.
- **La salida http resuelve con el `lookup` del sistema** (`apps/api/src/http-host/network.ts`) y no tiene otra fuente de nombres en producción.
- **`localtest.me` resuelve a `::1` y `127.0.0.1`, pero lo hace el DNS público** (medido el 2026-10-17 con `dns.promises.lookup`). Sin Internet no resuelve, y algunos routers filtran las respuestas públicas que apuntan a loopback. `crm.franca.test` y `x.localhost` dan `ENOTFOUND`.
- **La alternativa sin tocar la API es editar `/etc/hosts`**, que exige permisos de administrador y cambia la máquina de la persona.

Por eso este cambio añade a la salida http una lista de **nombres locales**, que la API resuelve sin preguntar al sistema y que está acotada a `.test` y a loopback. Es la «variable de resolución estática solo para desarrollo» que la pregunta abierta 1 de `web-chat` dejaba como alternativa (ver Preguntas abiertas, 1).

## What Changes

- **Nombres locales en la salida http** (`http-host`, variable nueva `FRANCA_HTTP_LOCAL_NAMES`):
  - Entradas `nombre=dirección`. El nombre termina en `.test` y la dirección es de loopback (`127.0.0.0/8` o `[::1]`).
  - Un nombre local se resuelve a sus direcciones, en el orden escrito, sin consultar el DNS.
  - La política de destinos no cambia: la dirección solo es alcanzable si su par está en `FRANCA_HTTP_ALLOWED_DESTINATIONS`.
  - Un valor mal escrito impide arrancar. La línea de arranque muestra los nombres locales.
- **CRM simulado**:
  - Un servidor HTTP de desarrollo que escucha solo en `127.0.0.1:4010`.
  - Responde 201 `{"id":"L-<n>"}` a `POST /api/leads` con el secreto de la ejecución, y 401, 404 o 400 al resto.
  - Escribe una línea por petición, sin datos del lead ni cabeceras. No guarda nada en disco.
- **Copia local de `captacion-leads`** (`captacion-leads-local`, «Captación de leads (local)»):
  - Vive fuera de `packages/spec/examples/` y es igual al ejemplo salvo `id`, `name`, `description` y la `url` de `enviar-crm` (`http://crm.franca.test:4010/api/leads`).
  - Un test de paridad falla si diverge del ejemplo canónico. Los ejemplos de la spec no cambian.
- **Semilla** (`pnpm demo:seed`):
  - Crea y publica la copia local en la API local. Es idempotente: no crea versiones repetidas.
  - No pisa un borrador cambiado a mano y explica el caso del `id` reservado por un borrado lógico.
- **Arranque de la demo** (`pnpm dev:demo`), un solo comando:
  - Arranca el CRM simulado y lo mismo que `pnpm dev` (API y web), siembra y dice qué abrir.
  - Da a la API, solo en esa ejecución, las cuatro variables de la salida http. El token es aleatorio por ejecución y no se escribe ni se muestra.
  - Se niega a arrancar si la shell ya define alguna de esas variables. Quita `FRANCA_ANTHROPIC_API_KEY` del entorno de la API: la demo no llama a Claude.
  - `pnpm dev` no cambia.
- **Documentación**: `README.md` (sección de desarrollo), `apps/api/README.md` y `CLAUDE.md` (el nombre de `FRANCA_HTTP_LOCAL_NAMES` y los dos comandos). Ningún valor de secreto se versiona: el único valor es el token aleatorio que la demo genera en cada ejecución.

### Decisiones (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| Nombres locales en la API, no `localtest.me` ni `/etc/hosts` | Es la única vía que funciona sin Internet y sin permisos de administrador. `localtest.me` depende del DNS de un tercero; `/etc/hosts` cambia la máquina |
| Solo nombres terminados en `.test` | `.test` está reservado (RFC 6761) y nunca resuelve en el DNS público. Un nombre local no puede tapar un dominio real como `crm.example.com` |
| Solo direcciones de loopback | La variable sirve para llegar a servicios de la propia máquina. Una dirección pública o de la red local saltaría la resolución real sin necesidad |
| La política de destinos no cambia con un nombre local | La lista de nombres solo sustituye la resolución. Llegar a loopback sigue exigiendo el par en `FRANCA_HTTP_ALLOWED_DESTINATIONS`: no se abre ninguna vía nueva hacia direcciones internas |
| `http://` hacia el CRM simulado, sin TLS | La política ya lo admite hacia un par permitido. TLS local exigiría generar una autoridad y pasarla con `NODE_EXTRA_CA_CERTS`, y no aporta nada en loopback |
| Solo `127.0.0.1`, no también `[::1]` | Con un nombre local la resolución la fija la demo, así que basta una dirección y un par. Lo de los dos pares venía de `localtest.me` |
| Token aleatorio por ejecución, en memoria | Así el repositorio no lleva ningún valor de secreto, ni siquiera uno falso. Las guardas de ficheros de entorno no intervienen ([[harness-guard-env-falsos-positivos]]) |
| Copia con otro `id`, no el ejemplo cambiado | Los ejemplos canónicos los usan los tests de la spec, del motor y de la API con `https://crm.example.com`. Con otro `id`, la copia convive con un `captacion-leads` publicado a mano |
| Semilla que no pisa un borrador cambiado | Si alguien edita la copia en la API, perder ese cambio en silencio es peor que pedirle que decida. Las versiones publicadas son inmutables, pero el borrador no |
| `pnpm dev:demo` aparte, `pnpm dev` intacto | `pnpm dev` es el contrato de `CLAUDE.md` y de los E2E (puerto 3000 libre). Un cuarto proceso y variables impuestas sorprenderían a quien no quiere la demo |
| Negarse si la shell define una variable de la demo | Pisarla o mezclarla en silencio dejaría a la API con una configuración que nadie escribió. Mismo patrón que la API: un valor que no encaja impide arrancar y el mensaje nombra la variable |
| La demo quita la clave de Claude | La demo promete que ni la llamada http del flujo ni Claude salen de la máquina. Además desactiva la telemetría de Next y de turbo, pero no promete cortar las comprobaciones de otras herramientas, como Prisma o pnpm. Quien tenga clave puede seguir usando `pnpm dev` |

### Qué ve cada consumidor

- **Quien clona el repo**: con `DATABASE_URL` exportada, cuatro comandos: `pnpm install`, `docker compose up -d`, `pnpm --filter @franca/api db:migrate` y `pnpm dev:demo`. Abre `http://localhost:3000`, prueba «Captación de leads (local)» y la conversación termina en `lead-empresa` o `lead-pyme`. El panel «Detalles de la prueba» muestra el evento `http` con status 201.
- **API**: una variable opcional más en la salida http. Sin ella, nada cambia.
- **Web**: sin cambios. Recibe un flujo publicado más.
- **CI y E2E**: no arrancan la demo. Los tests nuevos usan puertos que elige el sistema, así que tampoco dependen de que el 4010 esté libre.
- **Feature 8 (editor)**: puede reutilizar el CRM simulado y la semilla para su vista previa con host real, si lo necesita.

### Formato de flujo

**`packages/spec/flow.schema.json` no cambia**, ni los tipos ni `validateFlow`, y ningún flujo se rompe. La copia local es un flujo v0 válido y sin avisos: `http://` no produce ningún aviso de `packages/spec/src/warnings.ts`.

## Capabilities

### New Capabilities

- `dev-simulated-services`: la demo local. Cubre el arranque con un comando, la configuración de la salida http de esa ejecución, las variables de la shell en conflicto, que no se llame a Claude, el CRM simulado (puerto, peticiones aceptadas y rechazadas, registro), la copia local de `captacion-leads`, la semilla y la parada.

### Modified Capabilities

- `http-host`: requisitos nuevos para los nombres locales (forma de `FRANCA_HTTP_LOCAL_NAMES`, resolución y línea de arranque). Ningún requisito vigente cambia de texto. `flow-engine`, `conversations-api`, `flows-api`, `web-chat`, `flow-validation` y `llm-anthropic` no cambian; la demo usa sus contratos tal como están fusionados.

## Impact

- **`apps/api/src/http-host/`**:
  - Lectura y validación de `FRANCA_HTTP_LOCAL_NAMES` en la configuración.
  - Resolución de un nombre local antes del resolutor de la costura. La red del test sigue sustituyendo solo `HTTP_NETWORK`, así que los nombres locales son código de producción en los e2e.
  - La línea de arranque, el arnés de mutación (`apps/api/test/mutations.json`) y la guarda estática si el diseño añade ficheros.
- **Herramientas de desarrollo** (dónde viven, lo decide el diseño): el CRM simulado, la copia local, la semilla y el arranque, con sus tests en `pnpm check` y, si hace falta, en `test:e2e`.
- **`package.json` raíz**: los scripts `dev:demo` y `demo:seed`. **`turbo.json`**: `FRANCA_HTTP_LOCAL_NAMES` en el `passThroughEnv` de `@franca/api#dev` ([[gotcha-turbo-filtra-variables-de-entorno]]).
- **Documentación**: `README.md`, `apps/api/README.md` y `CLAUDE.md` (variables y comandos, sin valores).
- **Meta**: la ficha `decision-salida-http-politica` gana un apartado «nombres locales» (por qué `.test` y loopback, y por qué no `localtest.me`). Si el arranque tiene trampas de procesos o señales, irán a una ficha `harness-*` con su enforcement.
- **Sin cambios** en `apps/web`, `packages/*`, `packages/spec/examples/`, el esquema de Prisma, la CI ni el formato de flujo. Si el diff toca algo fuera de `apps/api/src/http-host/`, `apps/api/test/`, las herramientas de desarrollo, `package.json`, `turbo.json`, la documentación, la wiki y `openspec/`, el PR tiene que justificarlo.

## Non-goals / Out of scope

- **`faq-ia` hasta su final feliz**:
  - Necesita un proveedor `llm` simulado, y la API solo ofrece `principal` con `createAnthropicProvider` contra `https://api.anthropic.com`. La puerta de salida rechaza cualquier otra dirección ([[gotcha-sdk-anthropic-lee-el-entorno]]).
  - Un proveedor simulado cambia el contrato «Proveedor de Claude» de `conversations-api` y el arranque de la API. Es un cambio aparte (Preguntas abiertas, 2).
  - En la demo, `faq-ia` sigue terminando en `llm_not_configured`, que el chat ya explica.
- **Soporte simulado y copia local de `faq-ia`**: el nodo `crear-ticket` solo se alcanza después del `llm`, así que sin proveedor no recibiría ninguna petición. Entra con el proveedor simulado.
- **TLS en local** (`https://` hacia el CRM simulado con una autoridad propia): `http://` hacia un par permitido ya es la política vigente.
- **Modos de fallo del CRM simulado** (429, 503, lentitud, cortes) para ver reintentos y `lead-sin-enviar`: los cubren los e2e de `http-host` y el motor. Puede ser un FOLLOW-UP si el editor lo necesita.
- **Cambiar la web**: ni el texto del estado vacío ni un botón para sembrar (Preguntas abiertas, 5).
- **Integrar la demo en `pnpm dev`** o en la CI.
- **Nombres locales fuera de `.test` o hacia direcciones que no son de loopback** (servicios de la red local, contenedores con IP propia).
- **Windows**: el arranque se verifica en macOS y Linux. En Windows no se garantiza la parada por señales.
- **Recuperar un `id` reservado**: un flujo borrado deja su `id` reservado para siempre (`flows-api`). La semilla lo explica; no lo resuelve.

## FOLLOW-UP heredados que cierra o deja

| Origen | Estado en este cambio |
|---|---|
| `web-chat` pregunta abierta 1 y 7.1 | **Cerrado** con la demo local de `captacion-leads` |
| `api-http-host` 5.1 (servidor simulado de CRM y soporte) | **Cerrado** para el CRM; el soporte queda fuera (non-goal) |
| `web-chat` 7.6 (`inputs` de turbo del `test` de la API que leen `openspec/`) | **Cerrado**: la tarea `@franca/api#test` declara `openspec/**` en sus `inputs` (`design.md`, D6) |

## Plan de verificación por capas

- **Unit (aplica)**:
  - El analizador de `FRANCA_HTTP_LOCAL_NAMES`, cada caso de «Forma de los nombres locales».
  - La resolución de un nombre local frente al resolutor de la costura (local, no local y orden de las direcciones).
  - El manejador del CRM simulado: cada status, el contador de `id` y la línea de registro sin datos.
  - La decisión de la semilla por cada estado del flujo en la API (no existe, sin publicar, al día, borrador cambiado, reservado, API caída, base de datos caída).
  - Las variables en conflicto del arranque.
- **Golden / contractual (aplica)**: test de paridad entre `captacion-leads-local` y `packages/spec/examples/captacion-leads.json`. Solo pueden diferir las cuatro propiedades; la copia es válida y sin avisos con `@franca/spec` compilado.
- **Integración HTTP / e2e de la API (aplica)**:
  - Cada escenario del delta de `http-host` en `apps/api/test/`, con la red del test (la sustitución sigue siendo solo `HTTP_NETWORK`) y con un `it` por título, como exige `spec-coverage.spec.ts`.
  - Un e2e con la red de producción (`systemNetwork()`, como `http-host-system-network.e2e-spec.ts`): la copia local, el CRM simulado en un puerto libre y el nombre local terminan en `lead-empresa` sin consultar el DNS.
  - La semilla contra la API de los e2e.
- **E2E opción-al-menos-una-vez (no aplica)**: la web no cambia y sus E2E ya cubren un flujo que termina. El recorrido de punta a punta de la demo se comprueba a mano en la verificación final (siguiente línea).
- **Verificación manual (aplica, en la verificación final)**: `pnpm dev:demo` con la red conectada y después desconectada.
  - Dos conversaciones en el navegador (`lead-empresa` y `lead-pyme`), la consola limpia y la pestaña de red solo hacia `localhost:3000`.
  - Las conexiones de la API y del CRM observadas con la red conectada.
  - Ctrl+C a través de `pnpm dev:demo`, sin procesos huérfanos, y `git status` limpio.
- **Smoke de ruta (no aplica)**: no hay rutas nuevas en la web ni en la API.
- **Mutación (aplica)**: mutantes nuevos en `apps/api/test/mutations.json`. Uno ignora el sufijo `.test`, otro deja que un nombre local salte la política de destinos y otro consulta el resolutor también para un nombre local; cada uno lo debe matar un escenario del delta.

## Métricas de éxito

- Desde un clon limpio, una persona completa `captacion-leads-local` hasta `lead-empresa` con `DATABASE_URL` exportada y cuatro comandos (`pnpm install`, `docker compose up -d`, `pnpm --filter @franca/api db:migrate` y `pnpm dev:demo`), sin leer la spec de `http-host`.
- Durante la demo, la API y el CRM simulado no abren conexiones fuera de loopback. Se observa con la red **conectada**, porque desconectada un intento de salir fallaría en silencio. Con la red desconectada, la demo llega igual a `lead-empresa`.
- `pnpm check` y `pnpm test:e2e` siguen verdes y no tardan más de un 5 % que en `main`.

## Riesgos

- **R1. Una variable nueva en un componente de seguridad.** `FRANCA_HTTP_LOCAL_NAMES` cambia la resolución de la salida http. Mitigación: solo `.test` y loopback, la política intacta, los mutantes y la revisión adversarial del diseño. Si alguien la copia a otra instalación, no abre nada que `FRANCA_HTTP_ALLOWED_DESTINATIONS` no abra ya.
- **R2. `pnpm check` en rojo entre la spec y el backend.** `apps/api/test/spec-coverage.spec.ts` aplica los deltas activos y exige un `it` por escenario de `http-host`. Desde el commit de esta spec y hasta que la fase de backend añada los tests, `pnpm check` falla, y el Stop hook lo dirá. Es lo esperado en spec-first; nadie debe tomarlo como regresión ni empujar en ese estado. La caché de turbo ya no lo oculta: este cambio cierra el FOLLOW-UP 7.6 de `web-chat` (`design.md`, D6).
- **R3. Orquestar procesos.** `nest start --watch` y `next dev` no terminan solos cuando algo falla, y una señal mal propagada deja puertos ocupados (el 3000 bloquea los E2E de la web). Mitigación: el arranque es dueño de los procesos que lanza, «Parada de la demo» lo exige y la verificación final lo comprueba.
- **R4. Primera compilación lenta.** En un clon limpio, `pnpm dev` compila la spec y la API antes de escuchar. Si pasa de 120 s, la semilla no corre en el arranque. Mitigación: la demo sigue en marcha y dice que se puede repetir con `pnpm demo:seed`.
- **R5. Deriva de la copia.** Si alguien cambia `captacion-leads`, la copia se queda atrás. Mitigación: el test de paridad está en `pnpm check`.
- **R6. Puerto 4010 ocupado.** La demo no arranca y lo dice. Los tests no usan ese puerto.
- **R7. El token vive en el entorno de los procesos.** Cualquier proceso del mismo usuario puede leerlo. Es el límite aceptado para todos los secretos ([[decision-salida-http-politica]]), y aquí el token solo abre un CRM simulado de una ejecución.

## Preguntas abiertas

1. **¿Nombres locales en la API, `localtest.me` o `/etc/hosts`?** Aplicado: nombres locales en la API (`FRANCA_HTTP_LOCAL_NAMES`, solo `.test` y loopback). **Recomendación**: mantenerlo. Es lo único que cumple «sin Internet y sin permisos». Con `localtest.me` no haría falta tocar la API, pero la demo dependería del DNS de un tercero y fallaría en redes que filtran respuestas públicas hacia loopback. Si se prefiere no tocar `http-host`, el cambio se reduce a la herramienta de desarrollo con `localtest.me`, los dos pares (`127.0.0.1:4010` y `[::1]:4010`) y el CRM escuchando en ambos, y el objetivo pasa a ser «sin credenciales reales», no «sin Internet».
2. **¿Cuándo un proveedor `llm` simulado para `faq-ia`?** Aplicado: fuera de este cambio. **Recomendación**: un cambio aparte, `dev-llm-simulado`, después del editor (8) o con él si su vista previa lo necesita. Sería un segundo proveedor solo de desarrollo, activado por variable y con respuestas guionizadas sin red, más el soporte simulado y la copia local de `faq-ia`. Modifica «Proveedor de Claude» y «Sin credenciales de Claude» de `conversations-api`.
3. **¿La demo debe usar la clave de Claude si la shell la tiene?** Aplicado: no; la quita y lo dice. **Recomendación**: mantenerlo. «Nada sale de la máquina» es una garantía simple de explicar. Quien tenga clave usa `pnpm dev`, y la copia local de `faq-ia` llegaría con la pregunta 2.
4. **Ante un borrador cambiado, ¿la semilla lo deja o lo sobrescribe?** Aplicado: lo deja, termina con un código distinto de 0 y lo dice. **Recomendación**: mantenerlo. Sobrescribir borraría trabajo del editor (8) sin avisar. Si molesta, se puede añadir una opción explícita para sobrescribir.
5. **¿El estado vacío de la web debe mencionar `pnpm dev:demo`?** Aplicado: no; la web no cambia. **Recomendación**: revisarlo en el editor (8), que cambiará esa página. Mientras, el README lo explica.
6. **Nombres y puerto**: `crm.franca.test`, `127.0.0.1:4010`, `captacion-leads-local`, «Captación de leads (local)», `pnpm dev:demo` y `pnpm demo:seed`. **Recomendación**: aceptarlos. Son visibles para quien usa la demo y cambiarlos después rompe instrucciones; si se cambian, que sea antes del diseño.
