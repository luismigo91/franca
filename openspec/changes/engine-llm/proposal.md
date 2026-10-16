# Proposal: nodo `llm` en el motor y proveedor de Claude (`engine-llm`)

**Fecha**: 2026-10-16 · **Estado**: Draft · **Rama**: `feat/engine-llm` · **Feature 4 de 8** del plan de ejecución de flujos (1 motor base, 2 input y 3 http, hechas).

## Why

El paso que distingue a Franca de un formulario, el `llm` acotado, todavía no se ejecuta: al llegar a él la sesión falla con `unsupported_node`. El ejemplo `faq-ia` muere en su segundo nodo. Esta feature hace que el motor (que sigue sin IO) mantenga una conversación de varios turnos con un proveedor que aporta el host. El modelo extrae los `slots` y declara cuándo se ha cumplido el objetivo. El motor convierte y valida cada valor, acota turnos, coste y llamadas, y sale por `next` o por `onExhausted`. Además, entrega el primer proveedor real, Claude de Anthropic, en un paquete aparte que la feature 6 aloja en la API.

## What Changes

- **`EngineHost` gana una capacidad opcional `llm`**: recibe la petición de **un turno** (objetivo, `system`, slots con su tipo, historial del nodo, modelo, idioma, turno) y devuelve un resultado: `turn` (texto, slots, `done`, `costUsd`), `refusal`, `failed` o `not_configured`. Sin la capacidad, el nodo sigue fallando con `unsupported_node`.
- **Proveedores por nombre**: `@franca/engine` exporta `createLlmCapability(providers)`. Compone la capacidad a partir de los proveedores que configura la instalación y entrega cada petición al proveedor cuyo nombre coincide con `llm.provider`. Un nombre desconocido da `not_configured` sin llamar a nadie.
- **Nodo `llm` ejecutable**:
  - Al llegar, el motor pide el primer turno y emite el texto del asistente como `message`, seguido de un `input` de tipo `text`.
  - Después espera (`waiting`). Cada mensaje válido del usuario es un turno más.
  - Si el turno trae `done` con los slots obligatorios recogidos, el motor guarda los slots en sus variables y sigue por `next`.
  - Si se agotan `maxTurns` o `costCapUsd`, o si el proveedor rechaza o falla, guarda lo recogido y sigue por `onExhausted`.
- **Conversión de los slots según el `type` declarado de la variable**, con los conversores de `input` (`email`, `phone`, `number`, `url`, `date`, `boolean`, `string` como `text`). `json` lleva límites de profundidad y tamaño. Un valor que no se puede convertir no se recoge, y un slot que el nodo no declara se ignora sin leerlo.
- **Mensaje del usuario**: `{text}`, de 4096 unidades como mucho, no vacío y sin U+0000 ni sustitutos sueltos. Un mensaje inválido no llama al proveedor ni consume turno. El motor solo vuelve a emitir el `input` con el motivo (`too_long`, `required`, `invalid_format`).
- **Texto del asistente**: de 4096 unidades como mucho, no vacío y con caracteres que se pueden guardar. Si no los cumple, el turno se descarta y el nodo sale por `onExhausted` (`invalid_turn`).
- **Autosalto** (`next` es el propio nodo): al cumplirse el objetivo, el motor guarda los slots y sigue la misma conversación. Conserva historial, turnos y coste, así que `maxTurns` y `costCapUsd` acotan también las vueltas ([[domain-llm-puede-saltar-a-si-mismo]]). Llegar al nodo desde otro nodo empieza una conversación nueva.
- **Regla nueva del validador** (**BREAKING** para esos flujos; se admite antes de la 1.0 y ningún ejemplo la usa): el `onExhausted` de un `llm` no puede apuntar a sí mismo. El `next` sí puede.
- **Evento nuevo `llm`** `{type, nodeId, turns, costUsd, reason}`, que se emite al salir del nodo. No lleva textos ni slots.
- **Errores de sesión nuevos**:
  - `llm_not_configured`: proveedor o modelo no configurados en la instalación.
  - `llm_host_error`: el host lanzó o devolvió algo fuera de contrato.
  - `llm_limit_exceeded`: un turno sería la llamada externa 11 del avance.
- **Presupuesto compartido**: cada turno consume una llamada de las 10 por avance que ya usa `http` (`reserveExternalCall`), sin contador propio.
- **Estado**:
  - El estado en espera en un `llm` lleva la conversación del nodo: mensajes, coste y slots recogidos. Sigue siendo `stateVersion` 1, porque el cambio solo añade datos.
  - La conversación se descarta al salir del nodo.
  - `continueSession` pasa de un `if` a una tabla de reanudación por tipo de nodo, `input` y `llm` (FOLLOW-UP 6.10 de `engine-input`).
- **Paquete nuevo `@franca/llm-anthropic`** (`packages/llm-anthropic`):
  - Proveedor de Claude con `@anthropic-ai/sdk` (`^0.135.0`) y salida estructurada (`messages.create` con el esquema de `zodOutputFormat` y lectura propia validada con `zod` 4; ver `design.md` D20).
  - Modelo por defecto `claude-opus-5-5`. Tabla de modelos y precios ampliable por la instalación.
  - Calcula `costUsd` por turno. Prefijo estable cacheable.
  - Fallback de rechazo en el servidor activado por defecto en los modelos que lo admiten (Opus 5.5 y Sonnet 5.5; Haiku 5.5 no lo tiene).
  - Reintentos del SDK dentro de un tiempo total por turno, y errores mapeados al contrato.
  - Cliente inyectable y probado sin red. Test en vivo opcional.

Salvo esa regla, ningún cambio es **BREAKING** para consumidores reales, porque no hay ninguno. `EngineEvent`, `SESSION_ERROR_CODES` y `EngineHost` ganan valores, y eso rompe en compilación un `switch` exhaustivo. Sin capacidad `llm`, los golden actuales no cambian (siguen terminando en `unsupported_node`).

### Decisiones de comportamiento (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| Un turno es una llamada al host: el host aporta el resultado y el coste, y el motor decide la salida | «El proveedor provee, el consumidor decide». Los límites y la elección de salida viven en un solo sitio, determinista y testable sin red |
| El **adaptador** calcula `costUsd` con su tabla de precios, y el **motor** solo suma y compara con `costCapUsd` | Los precios (prompt largo, caché, fallback a otro modelo) son propios de cada proveedor. El motor solo necesita el hecho «cuánto costó este turno» |
| Modelo sin precio conocido: no se llama (`not_configured`, fallo visible). Si la respuesta viene de un modelo sin precio (fallback del servidor), se cobra con el precio más alto de la tabla | El tope es verificable solo si el host custodia el estado («Host de producción: custodia del estado» y «… una continuación por estado»): si el cliente pudiera reenviar un estado anterior, reiniciaría turnos y coste. La cota superior mantiene `costCapUsd` del lado seguro respecto a lo contabilizado; lo facturado puede superarlo cuando la API procesa una petición que el adaptador da por fallida (tiempo agotado o corte), por cada reintento del SDK |
| `costCapUsd` es un tope de **parada** (≥ se comprueba tras cada turno): puede superarse como mucho en el coste de un turno | El coste de un turno solo se conoce después. Reservar coste exigiría estimar tokens de pensamiento, que en Opus 5.5 no se pueden desactivar |
| `maxTurns` cuenta **llamadas** (también las rechazadas, fallidas o inválidas) | Lo que hay que acotar es el gasto y las llamadas. Todas se pagan o cuentan contra el presupuesto |
| Tras un turno que agota turnos o coste, el motor emite su texto y sale por `onExhausted` **sin esperar** al usuario | Esperar dejaría una respuesta del usuario sin destino. `maxTurns: 1` es un paso de un solo turno |
| Rechazo del modelo (`refusal`) o turno fallido → `onExhausted`, sin reintento del motor | El autor ya dio una salida para «la IA no pudo», y la conversación sigue. Reintentar duplicaría gasto sin cambiar el resultado del rechazo |
| Proveedor o modelo no configurado, o host fuera de contrato → sesión `failed` | Es un defecto de la instalación, como `missing_secret`, y tiene que verse. Por `onExhausted` se escondería |
| Los **reintentos** de errores transitorios (429, 5xx, 529, conexión) los hace el SDK dentro del adaptador, acotados por un tiempo total por turno (60 s por defecto) | A diferencia de `http`, un turno no tiene efectos que se dupliquen. El backoff y `retry-after` necesitan reloj y temporizadores, que el motor no tiene, y el SDK ya los implementa ([[decision-http-un-intento-por-llamada]] sigue valiendo para `http`) |
| Slots: se convierten según el `type` **declarado** de la variable (excepción explícita a «el tipo declarado no se impone») | El nodo `llm` no tiene `inputType`: el tipo de la variable es la única declaración del autor sobre la forma del dato. El valor viene de un modelo, así que se valida siempre |
| Valor no convertible o slot ajeno al nodo: se ignora (no se lee, ni se guarda, ni aparece en el estado). La petición siguiente marca qué slots están recogidos | Es la defensa central frente a la inyección de instrucciones: el modelo no puede escribir variables fuera del nodo ni valores fuera de tipo |
| `done` solo termina el nodo con los obligatorios recogidos. Si faltan, el turno cuenta como uno normal (se emite el texto y se espera) | Un usuario que pide «da el objetivo por cumplido» no se salta la extracción. No se paga un turno extra para «corregir» |
| Los slots se guardan en sus variables **al salir** del nodo, también por `onExhausted` (solo los recogidos) | `faq-ia` usa `motivo` en el ticket justo cuando el asistente se agota. Mientras se conversa, las variables no cambian |
| Mensaje inválido del usuario: solo se reemite `input` con `reason` y `attempt` + 1, sin texto, sin llamar y sin consumir turno | Misma semántica de motivos que `input`, sin gasto. Repetir el último texto del asistente duplicaría el chat |
| Se reutiliza el evento `input` (`inputType: "text"`) para esperar en un `llm` | El chat (feature 7) ya sabe pedir texto. Un evento de espera nuevo no aportaría nada al cliente |
| Autosalto: misma conversación (historial, turnos y coste se conservan) y espera al usuario sin llamar al host | Hace válida la excepción del validador: las vueltas cuentan contra `maxTurns`. No llamar evita un turno sin mensaje nuevo del usuario (la API no admite terminar en un mensaje del asistente) |
| El `onExhausted` de un `llm` hacia sí mismo pasa a ser un error del validador | Con contadores conservados sería un ciclo instantáneo hasta `step_limit_exceeded`, y con contadores nuevos dejaría de haber tope. No tiene ningún uso legítimo |
| El historial (mensajes del usuario y del asistente) vive solo en el estado en espera del nodo y se descarta al salir | Lo que dice el usuario puede ser PII. Lo que se queda son los slots validados, en su variable |
| `temperature`: el adaptador **la ignora siempre** y avisa con un código fijo. No se mapea a `effort` | Opus 5.5 devuelve 400 con `temperature`, y Sonnet y Haiku 5.5 con valores no por defecto. `effort` controla la profundidad del razonamiento, no la aleatoriedad: mapearlo cambiaría coste y latencia sin que el autor lo pidiera. El adaptador no la envía nunca |
| `effort` por modelo en la configuración de la instalación (`low` por defecto en Opus 5.5, Sonnet 5.5 y Haiku 5.5) y no en el flujo | Un paso conversacional no necesita razonamiento profundo, y `low` reduce latencia y coste de pensamiento, que no se puede desactivar. El formato de flujo no tiene ese campo |
| Fallback de rechazo en el servidor **activado por defecto** en los modelos que lo admiten (desactivable) | Lo recomienda la guía oficial: un rechazo evitable deja de mandar al usuario a `onExhausted` |
| Salida estructurada (`messages.create` con `output_config.format` y lectura propia), sin herramientas ni `tool_choice` | `tool_choice` forzado da 400 en Opus y Sonnet 5.5, y la salida estructurada da directamente texto, slots y `done` |
| `system` estable y cacheable (instrucciones, `system`, `goal`, slots); el estado del turno va al final del último mensaje del usuario, con una marca de caché justo antes | La caché de prompt abarata cada turno: el `system` se comparte entre sesiones del mismo nodo y el historial entre turnos de la misma conversación |
| Texto del asistente y del usuario: 4096 unidades como mucho | Mismo límite que la respuesta de un `input` (`MAX_INPUT_LENGTH`). Acota el estado: como mucho 99 mensajes de 4096 unidades |
| Proveedor por defecto de modelo `claude-opus-5-5` (exacto). La instalación lista los modelos permitidos | Un autor no puede elegir un modelo que la instalación no aprobó ni pagó. Un `model` con sufijo no coincide |

### Formato de flujo

- **`packages/spec/flow.schema.json` no cambia** y no hay que regenerar los tipos.
- **Cambia `validateFlow`** (capa `semantic`): un `llm` cuyo `onExhausted` es su propio id deja de ser válido. Es una rotura para ese flujo concreto, admitida antes de la 1.0. Ningún ejemplo de `packages/spec/examples/` lo usa y el `next` hacia sí mismo sigue siendo válido. Se anota en `docs/rfcs/` como FOLLOW-UP.
- **Semántica que fija esta feature y que conviene anotar en RFC-0001**: `system` y `goal` son plantillas. `maxTurns` cuenta llamadas al proveedor. Los slots se convierten según el `type` de su variable. Se fija también la semántica del autosalto y que `temperature` es una preferencia que el proveedor puede ignorar.
- Todos los flujos de los escenarios se han comprobado con `packages/spec/dist` (`validateFlow`): `faq-ia`, un `llm` mínimo, autosalto, ciclo indirecto `llm` → `set` → `llm`, diez `http` seguidos de un `llm`, `input` → `llm` y slots de todos los tipos de variable.

## Capabilities

### New Capabilities
- `llm-anthropic`: proveedor de Claude que implementa la capacidad `llm` del motor. Cubre el cliente y las credenciales, los modelos permitidos, los precios y el coste por turno, la forma de la petición a la API (caché, parámetros prohibidos), la salida estructurada, los motivos de parada, el fallback del servidor, los errores, los reintentos y el tiempo por turno, y la privacidad.

### Modified Capabilities
- `flow-engine`:
  - Lo nuevo: capacidad `llm` del host, proveedores por nombre, petición y resultado de un turno, conversación del nodo, mensaje del usuario, conversión y recogida de slots, objetivo cumplido, límites de turnos, coste y llamadas, rechazo y fallo del proveedor, salida y evento `llm`, autosalto, estado de la conversación, privacidad, la regla del validador y el registro en el host de producción.
  - Requisitos que se modifican:
    - «Nodos aún no soportados»: `llm` solo lo es sin capacidad.
    - «Valores de variable y ausencia de valor»: los slots sí se convierten.
    - «Ejecución hasta que la sesión se detiene», «Eventos de salida», «Límite de pasos por avance», «Estado de sesión serializable» y «Continuar una sesión»: se espera también en un `llm`.
    - «Ejecución determinista y sin efectos externos»: también con `llm`.
    - «Límite de llamadas al host por avance»: `llm` comparte el presupuesto.

## Impact

- **`packages/engine`**:
  - Ejecutor y reanudación de `llm` y tabla de reanudación en `continueSession`.
  - Tipos públicos: `EngineHost.llm`, la petición, el resultado y el evento `llm`.
  - `createLlmCapability`, códigos y motivos nuevos, y validación del estado de la conversación.
  - Reutiliza `PARSERS` y los comprobadores de `src/input/`, `renderTemplate`, `exceedsDepth`/`cloneJsonWithinDepth` y `reserveExternalCall`.
  - La guarda estática sigue prohibiendo red, reloj y temporizadores en `src/`.
  - Proveedor falso programable en `tests/helpers/` (guion de resultados por turno que registra las peticiones), al estilo de `scriptedHost`.
- **`packages/spec`**: la regla semántica del `onExhausted` hacia sí mismo y su test. El esquema no cambia.
- **Paquete nuevo `packages/llm-anthropic`** (`@franca/llm-anthropic`):
  - Depende de `@anthropic-ai/sdk` `^0.135.0`, de `zod` `^4` y de los tipos de `@franca/engine` (no los redefine).
  - tsdown y Vitest, como el resto de paquetes. Entra en `pnpm check`.
- **Sin cambios** en `apps/api` ni `apps/web`.
- **Consumidores futuros**:
  - Feature 6: configura los proveedores por instalación o tenant (credenciales, modelos permitidos, precios, `effort`), compone `createLlmCapability` con el adaptador, persiste el estado en espera como dato personal y cumple el registro sin contenido.
  - Feature 7: pinta el texto del asistente como texto plano y el motivo de un mensaje rechazado.
  - Feature 8: vista previa con un proveedor simulado.
- **Coste real**: el test en vivo gasta céntimos y solo corre con credenciales. La CI no las tiene.

## Non-goals / Out of scope

- **API, persistencia y UI**: alojar el motor, guardar sesiones y configurar proveedores, credenciales y precios por tenant es de la feature 6. Pintar el chat es de la 7 y la vista previa del editor, de la 8.
- **Streaming** del texto del asistente al cliente (y del SDK): el turno se entrega completo.
- **Herramientas** (tool use), RAG, memoria entre conversaciones y acceso del modelo a variables que no estén en `system` o `goal`.
- **Historial de otros nodos**: el proveedor solo ve la conversación del propio `llm`. El contexto previo lo pone el autor en `system` o `goal` con plantillas.
- **Otros proveedores** (OpenAI, modelos locales): el contrato los admite, pero aquí solo se entrega Claude.
- **Redacción de PII** antes de enviar al proveedor: enviar lo que dice el usuario a un tercero es inherente al nodo. Lo decide la instalación al configurar el proveedor.
- **Ventana deslizante o resumen del historial**: el historial está acotado por `maxTurns` (como mucho 99 mensajes de 4096 unidades). Recortarlo en silencio cambiaría lo que ve el modelo.
- **Cambios en el formato de flujo**: ni `effort`, ni tiempo por turno, ni tope de tokens en el nodo; tampoco un `onError` distinto de `onExhausted`.
- **Precios actualizados automáticamente**: la tabla por defecto es la de hoy y la instalación la sustituye por configuración.
- **Autenticación y aislamiento por tenant**: el motor no conoce usuarios. Que cada tenant use sus credenciales y sus proveedores es un requisito de la feature 6.

## Plan de verificación por capas

| Capa | Veredicto | Razón |
|---|---|---|
| Unit | **Aplica** | Lógica pura con muchas ramas: lectura del resultado del host (formas válidas y mal formadas), conversión de slots por cada `type` de variable, recogida y `done` con obligatorios, límites de turnos y coste (bordes `≥`), mensaje del usuario, validación del estado de la conversación, `createLlmCapability` (nombres con forma de propiedad de `Object`); y en el adaptador, el cálculo de coste (prompt largo de Haiku, caché, modelo desconocido), el mapeo de `stop_reason` y de errores y la construcción de la petición |
| Escenarios de la spec | **Aplica** | Un `it` por `#### Scenario` de los dos deltas, con flujos que pasan `validateFlow`. En el motor, con el proveedor falso con guion; en el adaptador, con el **SDK real** y un `fetch` inyectado que devuelve cuerpos con la forma real de la API (sin red) |
| Golden / contractual | **Aplica** | Las peticiones de turno que recibe el host y el evento `llm` son el contrato con el adaptador y con las features 6 y 8. Se añaden transcripciones de `faq-ia` (resuelta, agotada por coste con ticket y rechazo) con sus peticiones. En el adaptador, golden del cuerpo enviado a la API (prefijo estable, mensajes, `output_config`, betas). Los golden actuales no cambian |
| Paridad | **Aplica** | El `enum` de `variable.type` del esquema debe coincidir con la tabla de conversión de slots, y el `default` de `maxTurns` con la constante del motor. Todo código y motivo emitido debe estar en sus listas exportadas, `llm` debe tener ejecutor y reanudación, y los tipos del adaptador deben venir de `@franca/engine` |
| Propiedades | **Aplica** | Determinismo con el mismo guion (resultados y peticiones). Entradas congeladas. Ida y vuelta JSON del estado en espera en un `llm`. Marcadores negativos (mensaje del usuario no recogido, slot inválido, slot ajeno, lo que lanza el host) que no aparecen en eventos, errores ni estado tras salir, validados mutando el código. Consola sin llamadas. Temporizadores detenidos. Estado siempre continuable (profundidad ≤ 999) |
| Integración HTTP | No aplica aquí | El motor no tiene red. El adaptador se prueba con el SDK real y `fetch` inyectado, sin red. El test en vivo contra la API (opcional, solo con credenciales, `claude-haiku-5-5`) comprueba la costura real y queda fuera de la CI (FOLLOW-UP). Los endpoints son de la feature 6 |
| E2E opción-al-menos-una-vez | No aplica | No hay UI (features 7 y 8) |
| Smoke de ruta | No aplica | No hay rutas |
| Mutación | **Aplica** | Tabla dirigida de `scripts/mutate.mjs` ampliada: `done` sin obligatorios, slot ajeno guardado, contadores reiniciados en el autosalto, `>` en vez de `≥` en el coste, historial conservado al salir, turno sin `reserveExternalCall`, conversión por `inputType` en vez de por `type`, mensaje del error del host propagado. En el adaptador, `temperature` enviada a Opus 5.5, `cache_control` ausente y coste de un modelo desconocido a 0 |

## FOLLOW-UP que deja esta feature

- **Feature 6**:
  - Configuración de proveedores por instalación o tenant (credenciales propias, modelos permitidos, precios, `effort`, `maxOutputTokens`).
  - Persistir el estado en espera en un `llm` como dato personal, con retención y borrado.
  - Custodiar el estado en el servidor (nunca aceptarlo del cliente) reclamándolo antes de ejecutar el motor: una sola continuación por estado, con reclamaciones que caducan.
  - Presupuesto de coste por sesión o tenant: un ciclo `llm` → `set` → `llm` empieza conversaciones nuevas y reinicia `costCapUsd`.
  - Crear el cliente con `apiKey` y `baseURL` explícitos y comprobar las credenciales al arrancar.
  - Cumplir «Host de producción: registros de llm».
  - Tope de tiempo total por avance (un turno de hasta 60 s más 10 llamadas `http`).
  - Mapear `llm_not_configured` a una alerta de operación.
- **Feature 7**: pintar el texto del asistente como texto plano, mostrar el motivo de un mensaje rechazado y un indicador de «escribiendo» mientras dura el turno.
- **Feature 8**: vista previa con proveedor simulado y el evento `llm`.
- **`packages/spec` y RFC-0001**: anotar la semántica de esta feature (sección «Formato de flujo»). Valorar un aviso del validador cuando `temperature` aparece en un flujo, porque los modelos por defecto la ignoran.
- **Adaptador**:
  - Ejecutar el test en vivo en una CI con secreto (DEPLOY-TIME).
  - Revisar la tabla de precios contra la página oficial antes de cada release.
  - Valorar acotar `max_tokens` con el coste que queda hasta `costCapUsd`.

## Preguntas abiertas

Decididas con criterio en esta proposal (sin consultar):

- [x] `temperature` se ignora con aviso en los modelos que la rechazan y no se mapea a `effort` (tabla de decisiones).
- [x] Fallback de rechazo en el servidor activado por defecto.
- [x] Los reintentos los hace el SDK, dentro de 60 s por turno. El motor no repite turnos.
- [x] Coste calculado en el adaptador, y tope de parada en el motor.

Para verificar en el diseño (no cambian el comportamiento especificado; si lo cambiaran, se vuelve a la spec):

- [x] Precios **derivados**, no dados por la referencia (confirmados por el orquestador con la referencia oficial): la escritura de caché a 1,25 × la entrada en los tres modelos y la lectura de caché de Haiku 5.5 a 0,1 × su entrada ($0.01 con la tarifa base y $0.05 con la de prompt largo). Se comprueban contra la página oficial de precios antes de fusionar.
- [x] Umbral de 100K tokens de Haiku 5.5 (confirmado: todo el turno a la tarifa que corresponda; la caché sigue los mismos multiplicadores sobre la tarifa aplicada): se supone que cuenta entrada, lectura y escritura de caché, y que por encima todo el turno va al precio alto. Se comprueba con la misma página.
- [x] Que `client.beta.messages.parse` admita a la vez `output_config.format`, `betas` y `fallbacks`. Los tipos lo admiten, pero `parse` lanza con texto no JSON (pierde `usage` y `stop_reason` en un rechazo) y su salida pierde `__proto__`: el diseño usa `create` con lectura propia y la spec se ha corregido (`design.md`, Auditoría y D20).
- [x] Que `output_config.effort` exista en Sonnet 5.5 y Haiku 5.5: existe en los tres (orquestador). Decisión del orquestador tras la revisión: la tabla por defecto lo fija en `low` en los tres y la instalación puede cambiarlo por modelo («Profundidad de razonamiento»).
- [ ] Coste del ejemplo: con Opus 5.5 por defecto y `effort` `low`, un turno de `faq-ia` puede costar entre $0.01 y $0.05 (el pensamiento no se puede desactivar), así que su `costCapUsd` de 0.05 podría agotarse en uno o dos turnos. El flujo es correcto (sale por `onExhausted`). La instalación de la feature 6 decide si `principal` usa Haiku 5.5 por defecto.
