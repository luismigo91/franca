# Proposal: chat web de prueba (`web-chat`)

**Fecha**: 2026-10-17 · **Estado**: Draft · **Rama**: `feat/web-chat` · **Feature 7 de 9** del plan (hechas: motor, `input`, `http`, `llm` con el adaptador de Claude, API de flujos, API de conversaciones y salida http real; después viene la 8, el editor visual).

## Why

La API ya ejecuta flujos publicados de punta a punta (conversaciones con estado custodiado, `input` de los ocho tipos, `http` y `llm`), pero solo se pueden probar con `curl`, leyendo eventos JSON a mano. `apps/web` sigue siendo el esqueleto de create-next-app. Quien escribe un flujo necesita conversar con él como lo haría un usuario final: ver los mensajes con su ritmo, responder, ver los reintentos y el final, y repetir la prueba tras publicar otra versión.

Además, varias features anteriores dejaron decisiones para el chat: cómo llega el navegador a una API que rechaza cualquier `Origin` y solo atiende a un `Host` local, qué no se pinta (`http`, el `message` de los `error`), el filtro de URLs peligrosas en multimedia y opciones, `If-Match` en cada avance y la paridad de los códigos de error.

## What Changes

- **Chat de prueba en `apps/web`**, con todo el texto en español y la marca «Franca»:
  - `/`: los flujos publicados (nombre, `id`, última versión, aviso de cambios sin publicar), un campo opcional «Identificador de contacto», «Probar» y las conversaciones recientes de la instalación, con paginación y estados de carga, vacío y error.
  - `/conversaciones/<id>`: la conversación. Al reabrirla se reconstruye desde la transcripción. Ofrece «Empezar de nuevo», «Borrar conversación» y un panel «Detalles de la prueba».
- **Conversación como la vería un usuario final**:
  - Mensajes de texto plano con un indicador de «escribiendo» que respeta `typingDelayMs`. Multimedia (`image`, `video`, `audio` y `embed` en un marco aislado) solo con URLs admitidas.
  - Un campo para los siete tipos de texto y para el `llm`. Botones para la selección única y casillas con «Enviar» para la múltiple.
  - El aviso del `reason` de un reintento, las respuestas del usuario como mensajes y los avisos de fin (terminada con su `outcome`, fallida o caducada).
- **Panel «Detalles de la prueba»**, separado de la conversación: el recurso conversación (estado, `outcome`, `error.code` y `nodeId`, intento, coste, revisión y fechas) y la actividad técnica (`http`, `llm` y el `code` de los `error`). Nunca el `message` de un `error`.
- **Frontera local de la web** (proxy en el servidor de Next, sin tocar la API):
  - El navegador nunca habla con la API. El servidor de la web la llama en loopback, sin `Origin` ni cabeceras del navegador, y solo con ocho operaciones fijas.
  - La web solo escucha en `127.0.0.1` y rechaza un `Host` ajeno (DNS rebinding). Una operación que cambia algo exige el `Origin` de la propia web (CSRF). No hay CORS ni caché, y no se registran ni guardan en el navegador datos de las conversaciones.
  - Variable nueva `FRANCA_API_URL`, por defecto `http://127.0.0.1:3001`, solo loopback; con otro valor, la web no arranca.
- **Concurrencia**: `If-Match` con la revisión pintada en cada respuesta. Ni reenvíos automáticos ni sondeos. 412, 409 `conversation_busy` y la respuesta perdida se resuelven releyendo la conversación.
- **Paridad**: la web espeja `API_ERROR_CODES` y un test falla si divergen.

### Decisiones (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| Proxy en el servidor de la web, **no** una lista de orígenes en la API | La API no cambia: «Sin acceso desde navegadores» sigue siendo cierto. Una lista de orígenes abriría la API a cualquier página que llegue a ese origen y obligaría a CORS. El servidor de Next ya es local y puede llamar sin `Origin` |
| La web escucha solo en `127.0.0.1`, comprueba `Host` en todas las peticiones y `Origin` en las que cambian algo | `next dev` escucha en `0.0.0.0` por defecto (medido en `node_modules/next/dist/docs`). Un proxy hacia una API sin autenticación la expondría a la red local, al DNS rebinding y a formularios de otras webs. Las Server Actions de Next dejan pasar peticiones sin `Origin` y comparan con el `Host`, que en un rebinding es el del atacante, así que no bastan |
| Ocho operaciones fijas de la API, sin un proxy genérico, y el id de conversación validado como UUID antes de formar la ruta | El chat no debe poder crear, publicar ni borrar flujos, ni borrar contactos: eso es de la feature 8 o de quien opera. Un proxy genérico lo permitiría con una ruta del navegador |
| El chat no valida ni recorta las respuestas (tampoco un `number` o un `date` de texto libre, ni la respuesta vacía) | Lo que se prueba es la validación del flujo: un `type="number"` o un selector de fecha impedirían escribir `1.500` o `16/10/2026` y ver el `reason`. Los teclados de móvil se ajustan al tipo sin validar |
| Selección única con botones que envían al pulsar; múltiple con casillas, «Enviar» y la posibilidad de enviar sin marcar | Es la forma que exige el motor (`{choice}` / `{choices}`). Enviar vacío deja ver el `required` del flujo |
| Aviso del `reason` siempre que lo hay, además del `retryMessage` del flujo | En un `llm`, un mensaje rechazado solo produce un `input` con `reason` y sin ningún mensaje (FOLLOW-UP 8.4 de `engine-llm`). Sin el aviso no se vería nada |
| `http`, `llm` y el `message` de los `error` fuera de la conversación; `http`, `llm` y el `code` y `nodeId` de los `error` en el panel de detalles | Cumple 6.6 de `engine-base` y 6.3 de `engine-http` (el usuario final no los ve) sin dejar a quien prueba sin saber por qué un lead acabó en `lead-sin-enviar`. Los eventos ya vienen sin URL, cabeceras ni cuerpos. El `message` es para el autor y el host, y no sale en ningún sitio |
| URLs admitidas: absolutas, sin credenciales, `https:` o `http:` (`embed` solo `https:`), y se pinta su `href` | `new URL` quita tabuladores y saltos de línea y normaliza en silencio ([[gotcha-url-whatwg-normaliza]]). Por eso se decide sobre lo parseado y se pinta lo mismo que se decidió. `data:`, `blob:` y `javascript:` no tienen uso legítimo en un flujo publicado. Sin `Referer`, la URL de la conversación no sale hacia terceros |
| Textos siempre en texto plano, sin enlaces automáticos | El formato no tiene enlaces ni marcado (las plantillas son texto plano), así que no hay nada que filtrar. Autoenlazar abriría una vía de enlaces peligrosos que el flujo no pidió |
| `embed` en un marco aislado, no como enlace | Es lo que vería un usuario final de un widget. El aislamiento impide que navegue la página del chat |
| `typingDelayMs` en los avances en directo, no al reabrir | Es el ritmo que decidió el autor (el motor deja el retardo al cliente). Reabrir una conversación larga con retardos sería esperar en balde |
| La respuesta del usuario se pinta al enviarla y desaparece si la API no la aplica | Es la respuesta inmediata que espera cualquiera en un chat, y no deja rastro falso: lo aplicado es lo que dice la API |
| `If-Match` siempre, sin reenvíos automáticos. Una respuesta perdida se resuelve releyendo; 412 y `conversation_busy` releen y dejan la respuesta en su campo | La API hace idempotente el reenvío con `If-Match` («Entrada repetida»). Releer es la única forma de saber si se aplicó sin aplicarla dos veces |
| «Empezar de nuevo» usa la última versión publicada y el mismo contacto | Probar otra vez tras publicar es el uso principal. Elegir otra versión es del editor |
| `contactId` opcional al empezar, sin recordarlo | Permite probar las variables `scope: contact` entre flujos (`domain-contacto-compartido-entre-flujos`) con una API que ya lo admite. No se guarda en el navegador para no dejar datos de prueba atrás |
| «Borrar conversación» dentro; borrar un contacto, fuera | Las transcripciones son datos personales sin purga automática (5.2 de `api-conversations`), así que quien prueba debe poder borrar lo suyo. Borrar un contacto borra sus conversaciones de todos los flujos: es una operación de quien opera |
| Sin almacenamiento en el navegador, sin caché y `Cache-Control: no-store` | Lo que se ve es lo que dice la API: hay conversaciones en varias pestañas, la API las cambia y su contenido es personal. Además, `next.config.ts` tiene `cacheComponents` activado, así que la lectura fresca hay que pedirla explícitamente |
| `FRANCA_API_URL` solo loopback `http://`; si no, la web no arranca | Mismo patrón que las variables de la API (un valor no válido impide arrancar y el mensaje nombra la variable). El proxy no debe poder apuntar a otra máquina con datos de conversaciones |
| La web espeja `API_ERROR_CODES` con un test de paridad, en vez de importar de `apps/api` | Una app no depende de otra. La lista es cerrada y el test hace que divergir rompa la CI |

### Qué ve cada consumidor

- **Quien prueba flujos**: la web en `http://localhost:3000` con `pnpm dev`. Los ejemplos sin configuración terminan en `failed` (`missing_secret` en `captacion-leads`, `llm_not_configured` en `faq-ia` sin clave), y el panel dice por qué.
- **API**: sin cambios. Recibe peticiones del servidor de la web como de cualquier cliente local.
- **Feature 8 (editor)**: hereda la frontera local de la web (`Host`, `Origin`, cliente único de la API) y le añadirá sus propias operaciones. La vista previa con host simulado sigue siendo suya.

### Formato de flujo

**`packages/spec/flow.schema.json` no cambia**, ni los tipos ni `validateFlow`. Ningún flujo se rompe. La web importa los tipos de `@franca/spec` y de `@franca/engine` (eventos, `InputType`, `INVALID_ANSWER_REASONS`) y no redefine ninguno.

## Capabilities

### New Capabilities

- `web-chat`: el chat de prueba de la web. Cubre la página de inicio (flujos publicados, contacto y conversaciones recientes), la página de una conversación (reconstrucción desde la transcripción, ritmo, texto plano, multimedia y URLs admitidas, preguntas de los ocho tipos, `reason`, respuestas del usuario, fin), la concurrencia (`If-Match`, 412, ocupada, respuesta perdida), empezar de nuevo, borrar, el panel de detalles y la actividad técnica, y la frontera local de la web (escucha, `Host`, `Origin`, operaciones fijas, cabeceras hacia la API, `FRANCA_API_URL`, caché, privacidad y paridad de códigos).

### Modified Capabilities

Ninguna. `flows-api`, `conversations-api`, `http-host`, `flow-engine`, `flow-validation` y `llm-anthropic` no cambian: el chat usa la API tal como está fusionada (auditado contra `apps/api/src/conversations/`, `apps/api/src/flows/`, `apps/api/src/http/` y los tipos de `@franca/engine`).

## Impact

- **`apps/web`**:
  - Páginas `/` y `/conversaciones/[id]`, componentes del chat en `src/components/chat/`, un cliente único de la API y `ENDPOINTS` en `src/config/` (`.claude/rules/frontend/architecture.md`).
  - La frontera local, probablemente en `proxy.ts` (Next 16 renombra *middleware*; hay que leer `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`).
  - `package.json`: `--hostname 127.0.0.1` en `dev` y `start`, dependencias `workspace:*` de `@franca/spec` y `@franca/engine` y, previsiblemente, un runner de tests unitarios (Vitest, como el resto del repo) y uno de E2E en navegador: dependencias nuevas que el diseño debe justificar.
- **`turbo.json`**: `@franca/web#dev` con `FRANCA_API_URL` en `passThroughEnv` ([[gotcha-turbo-filtra-variables-de-entorno]]). Si los E2E de la web van en `test:e2e`, también su orden respecto a la API.
- **CI** (`.github/workflows/ci.yml`): los tests de la web en `pnpm check`. Los E2E de navegador necesitan la API, Postgres y los navegadores del runner.
- **`CLAUDE.md`**: `FRANCA_API_URL` (solo el nombre) y el comando de los E2E de la web.
- **Meta**: fichas de wiki nuevas con su enforcement: la frontera local de la web (por qué proxy y no lista de orígenes, y por qué `Host` más `Origin`) y el filtro de URLs sobre lo parseado.
- **Sin cambios** en `apps/api`, `packages/*`, el esquema de Prisma ni el formato de flujo. Fuera de `apps/web`, `turbo.json`, la CI, `CLAUDE.md`, la wiki y `openspec/`, el diff no debería tocar nada.

## Non-goals / Out of scope

- **Cambiar la API**: ni lista de orígenes, ni CORS, ni endpoints nuevos.
- **Servidor simulado de CRM y soporte para ver los ejemplos terminar en local** (FOLLOW-UP 5.1 de `api-http-host`): fuera de esta feature, ver Preguntas abiertas. Es infraestructura de desarrollo de la API, no del chat:
  - Copias de los ejemplos con otra URL.
  - Un proceso más.
  - Tres variables de la API con valores exactos.
  - Un nombre público que resuelva a loopback (`localtest.me`, del que depende el DNS de un tercero y que algunos routers filtran).

  El chat se prueba igual con los caminos que ya llegan al final: `failed` con `missing_secret` y `llm_not_configured`, el flujo `preguntas` y los E2E con la API simulada.
- **Cargar o publicar los ejemplos desde la web** (semilla): crear y publicar flujos es de la API y del editor (8). La página vacía dice cómo hacerlo.
- **Valores de contacto** (FOLLOW-UP 5.4 de `api-conversations`): leerlos, inyectarlos o listarlos, filtrar conversaciones por `contactId` y un panel de variables. La API no tiene esos endpoints. Además, «El estado del motor no sale de la API» prohíbe exponer las variables: un panel así exigiría cambiar ese contrato.
- **Borrar un contacto desde la web** (ver Decisiones).
- **Elegir la versión** al empezar, ver el flujo o su grafo, y la vista previa con host simulado: son de la feature 8.
- **Selectores nativos** de fecha, número o sí/no, y respuestas rápidas para `boolean`: ocultarían la validación del flujo (ver Decisiones).
- **Ajustes del chat** (saltar los retardos, tema, idioma de la interfaz distinto del español) y **autoenlazado o Markdown** en los textos.
- **Autenticación, exposición fuera de loopback y despliegue de la web**: la web es una herramienta local mientras la API no tenga autenticación (5.2 de `api-conversations`).
- **Tiempo real**: el chat no sondea ni usa *streaming*. Una conversación avanzada en otra pestaña se ve al releer.

## FOLLOW-UP pendientes etiquetados para esta feature

| FOLLOW-UP | Veredicto | Dónde o por qué |
|---|---|---|
| `api-conversations` 5.3 y `api-flows` 7.4: `API_ERROR_CODES` espejado con test de paridad | **Dentro** | «Códigos de error conocidos» |
| `api-conversations` 5.3 y `api-flows` 7.4: acceso del navegador (proxy o lista de orígenes, nunca `*`) | **Dentro: proxy** | «Operaciones del chat en la API», «Peticiones de la web a la API», «Host local en la web», «Operaciones solo desde la propia web», «La web solo escucha en la máquina local» y «Dirección de la API» |
| `api-flows` 7.4: OpenAPI exportado | **Fuera** | Solo si hay consumidores externos. La web es interna |
| `engine-base` 6.6, `engine-http` 6.3 y `api-conversations` 5.3: no pintar `http` ni el `message` de los `error` | **Dentro** | «Eventos técnicos fuera de la conversación». Van al panel sin `message` («Actividad técnica en los detalles») |
| `engine-base` 6.6 y `engine-input` 6.8: filtrar esquemas de URL en `url` de multimedia y `choices[].imageUrl` | **Dentro** | «Direcciones admitidas», «Contenido multimedia» y «Opciones con imagen». El formato no tiene otros enlaces: «Texto de los mensajes» los prohíbe |
| `engine-input` 6.8: pintar el `input` con cada `inputType` en E2E y las tres formas de entrada | **Dentro** | «Preguntas de texto», «Selección única» y «Selección múltiple», con el flujo `preguntas` |
| `engine-input` 6.8: pedir pistas de validación al motor | **Fuera** | Sería un cambio aditivo del motor. El chat no valida en el cliente (ver Decisiones) |
| `engine-llm` 8.4: texto del asistente en texto plano, motivo de un mensaje rechazado e indicador de «escribiendo» | **Dentro** | «Texto de los mensajes», «Motivo de una respuesta inválida» y «Ritmo de los mensajes» |
| `If-Match` en los avances | **Dentro** | «Revisión esperada en cada respuesta» |
| `api-conversations` 5.4: valores de contacto, filtro por `contactId` y panel de variables | **Fuera** | Non-goals. Sí se puede crear con `contactId` («Contacto de la prueba») |
| `api-http-host` 5.1: servidor simulado de CRM y soporte | **Fuera** | Non-goals y Preguntas abiertas |

## Plan de verificación por capas

- **Unit (aplica)**:
  - Filtro de URLs: cada caso de «Direcciones admitidas», con la serialización.
  - De eventos y transcripción a la vista: qué se pinta, el `label` de las respuestas de opción y la actividad técnica sin `message`.
  - Aviso por cada valor de `INVALID_ANSWER_REASONS` más uno desconocido, y el mensaje de cada código de error.
  - Comprobación de `Host` y `Origin`, lectura de `FRANCA_API_URL` y formación de rutas con el UUID validado.
  - Todo test negativo se valida haciendo fallar su fixture a propósito.
- **Paridad (aplica)**: lista espejada frente a `API_ERROR_CODES` de `apps/api`.
- **Golden/contractual (no aplica)**: la web no genera salida contractual. Los eventos vienen del motor real a través de la API.
- **Integración HTTP (aplica)**: el servidor de la web contra la API simulada:
  - `Host` y `Origin`, sin `Access-Control-Allow-*`, y `Cache-Control: no-store`.
  - Las cabeceras exactas que recibe la API, las ocho operaciones, ids con rutas dentro, `If-Match`, avance largo y respuesta perdida.
  - El arranque con valores de `FRANCA_API_URL` no admitidos.
  - La escucha solo en `127.0.0.1`.
- **E2E opción-al-menos-una-vez (aplica)**: navegador contra la API real con Postgres:
  - `preguntas` con los ocho `inputType` y las tres formas de entrada, y `captacion-leads` (reintento, agotamiento y `missing_secret`).
  - `faq-ia` sin clave, `medios`, contacto entre flujos, dos pestañas (412), empezar de nuevo, borrar, teclado y 320 px.
  - Ritmo con `typingDelayMs`.
  - Los casos de API ocupada, caducada, código desconocido, evento desconocido y transcripción de 150 entradas, contra la API simulada.
- **Smoke de ruta (aplica)**: `/`, `/conversaciones/<id>` existente y «Conversación no encontrada», con el 403 de un `Host` ajeno.
- **Mutación (aplica, manual)**: sobre los componentes de seguridad. Cada mutante debe hacer fallar al menos un test:
  - `allowJavascriptScheme`, `renderRawUrl` (pinta el texto original en vez del `href`), `allowDataInImage`, `allowHttpEmbed` y `autolinkText`.
  - `skipHostCheck`, `allowMissingOrigin`, `compareOriginToFixedHost`, `forwardBrowserHeaders`, `genericPassthrough` y `unvalidatedConversationId`.
  - `noIfMatch`, `autoResendOnLoss`, `showErrorMessage` y `paintHttpEvent`.
- **Cobertura de la spec (aplica)**: como en la API (`apps/api/test/spec-coverage.spec.ts`), cada `#### Scenario` de este delta tiene un test con su título exacto.

## Riesgos

- **Next 16 cambia APIs** (`proxy.ts` en vez de *middleware*, `cacheComponents` activo, Server Actions con su propia comprobación de `Origin`). Una suposición de versiones anteriores puede dejar la frontera sin comprobar o los datos en caché. El diseño debe citar la guía de `node_modules/next/dist/docs/` para cada pieza, y la mutación de la frontera lo comprueba.
- **`fetch` del servidor obedece `NODE_USE_ENV_PROXY`** ([[gotcha-node-http-createconnection-y-proxy]]). Una petición de la web a la API en loopback podría acabar en un proxy del entorno con datos de conversaciones. El diseño decide cómo evitarlo (abridor sin proxy o comprobación al arrancar) y el test de cabeceras lo cubre.
- **La web pasa a ser la frontera de una API sin autenticación.** Cualquier proceso local sigue pudiendo usar la API directamente (como hoy). Lo que se evita es que una web ajena o la red local lleguen a través del chat.
- **Contenido de terceros**: imágenes, audio, vídeo y marcos de un flujo hacen que el navegador de quien prueba pida a esos servidores (su IP y el momento), y un marco ejecuta código ajeno aislado. Es inherente a probar el flujo. Sin `Referer`, no sale la URL de la conversación.
- **Coste y duración de los E2E de navegador en CI** (navegadores, Postgres, API y web a la vez). Hay que medirlo en el runner, no en el portátil (`lecciones-equipo`). Los escenarios lentos (avance de 150 s, retardos) deben ir en la capa más barata que los cubra.
- **Avances largos**: un avance con `llm` puede durar unos 150 s (90 s de plazo más un turno de 60 s). Si el servidor de desarrollo de Next o el navegador cortan antes, la respuesta se pierde. Está cubierto por «Una respuesta a la vez» (releer, nunca reenviar), pero sería mala experiencia.

## Preguntas abiertas

1. **¿Los ejemplos deben terminar con éxito en local con el chat?** Aplicado: no en esta feature (non-goal). En local, `captacion-leads` acaba en `failed` con `missing_secret` y `faq-ia` sin clave en `llm_not_configured`. Las dos cosas se ven bien en el chat y en el panel. **Recomendación**: un cambio pequeño `dev-servicios-simulados` justo después de este y antes del editor. Llevaría un script de desarrollo con un CRM y un soporte simulados en `127.0.0.1` y `[::1]` (los dos pares en `FRANCA_HTTP_ALLOWED_DESTINATIONS`, porque `localtest.me` resuelve a ambos y una resolución mezclada se bloquea entera), copias de los ejemplos que apunten a él, una semilla que los publique y las instrucciones de las variables. Si depender de `localtest.me` no convence, la alternativa es una variable de resolución estática solo para desarrollo en la API, que es un cambio de `http-host`.
