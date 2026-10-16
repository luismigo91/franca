# Proposal: nodo `http` en el motor (`engine-http`)

**Fecha**: 2026-10-16 · **Estado**: Draft · **Rama**: `feat/engine-http` · **Feature 3 de 8** del plan de ejecución de flujos (1 motor base y 2 input, hechas).

## Why

Un flujo de Franca ya conversa, pero no puede hacer nada con lo que recoge: al llegar a un nodo `http` la sesión falla con `unsupported_node`. Los dos ejemplos del formato (`captacion-leads`, que envía el lead a un CRM, y `faq-ia`, que crea un ticket) mueren justo en el paso que les da valor. Esta feature hace que el motor construya la petición a partir del nodo, la delegue en el host (el motor sigue sin IO), interprete la respuesta y siga por `next` o por `onError`. Además, fija ya el contrato de seguridad que debe cumplir el cliente HTTP real (feature 6), antes de que exista: en ese contrato manda quien escribe el flujo y el usuario final influye a través de las plantillas.

## What Changes

- **`EngineHost` gana una capacidad opcional `http`**: una función que recibe una petición ya construida y validada y devuelve el resultado de **un** intento. El motor nunca toca la red: solo llama a esa función.
- **Nodo `http` ejecutable** cuando el host ofrece `http`. Si no la ofrece, sigue fallando con `unsupported_node`, como hoy.
- **Construcción de la petición**: la `url`, los valores de cabecera y los strings del `body` se renderizan como plantillas. En la URL, cada valor insertado se codifica como componente (`/`, `?`, `#`, `&`, `@`… nunca llegan crudos). Las cabeceras `{ secret }` viajan **por nombre**. Si hay body, se serializa como JSON compacto y, si el autor no la puso, se añade `Content-Type: application/json`.
- **Validación de la petición en el motor** antes de llamar al host: URL `http`/`https` con dominio como host (sin IP, `localhost` ni credenciales), sin caracteres que el parser WHATWG cambie en silencio, sin segmentos `.`/`..` ni fragmento, con 8192 unidades como mucho; cabeceras con valores ASCII visibles; body de 65536 unidades como mucho. Si falla, no se llama al host y el nodo sigue por `onError`.
- **Configuración que no se puede ejecutar** (nombre de cabecera inválido, repetido o reservado como `Host` o `Content-Length`, más de 32 cabeceras, `GET` con body, JSON Pointer mal escapado): la sesión falla con el código nuevo `invalid_http_config`, como ya pasa con `invalid_rule` e `invalid_validation`.
- **Resultado y reintentos**: solo un 2xx es éxito. El motor decide qué se reintenta (hasta `retries`, por defecto 1): 408 y 429, y los fallos de conexión anteriores al envío, siempre; 500, 502, 503, 504, el timeout y la red cortada tras el envío, solo en `GET`, `PUT` y `DELETE`. `POST` y `PATCH` no se repiten si el servidor pudo haberlos procesado. El host aplica `timeoutMs` a cada intento. El motor no espera ni mide el tiempo.
- **`responseMap`**: con JSON Pointer (RFC 6901) sobre el cuerpo parseado. Un puntero que no encuentra nada deja la variable sin valor. Los valores se aplican todos o ninguno, y se rechazan (`onError`) si el cuerpo no es JSON, si son demasiado grandes o profundos, o si no se pueden guardar (U+0000, sustitutos sueltos, números no finitos).
- **Evento nuevo `http`** `{type, nodeId, attempts, status, error}`: se emite cuando el nodo sigue por `next` o por `onError`. Es útil para el editor y para depurar, y no lleva URL, cabeceras, body ni respuesta.
- **Errores de sesión nuevos**: `invalid_http_config`, `missing_secret` (el host no tiene el secreto o no puede enviarlo a ese destino), `http_host_error` (el host lanzó o devolvió algo fuera del contrato) y `http_limit_exceeded` (más de 10 llamadas al host en un avance, para que un ciclo no se convierta en un amplificador contra terceros). Hay también una lista cerrada y exportada de motivos de error de la llamada.
- **Arreglo de un fallo de la feature 1**: con un contacto de 999 niveles (aceptado), `startSession` deja la sesión en `waiting`, pero `continueSession` rechaza su propio estado con `invalid_state`, porque el estado suma un nivel sobre su `contact` y se medía entero contra `MAX_NESTING_DEPTH`. Ahora en un estado no cuenta el propio objeto del estado (cada campo admite 1000 niveles, como el contacto recibido) y todo estado que devuelve el motor se puede continuar.
- **Suite de conformidad del host**, exportada en `@franca/engine/conformance`: los escenarios «Host de producción: …» como casos ejecutables contra un `host.http` y un arnés que aporta servidores, DNS, secretos y registros. La feature 6 solo tiene que implementar el arnés y pasarla.
- **Contrato de seguridad del host de producción** (lo implementa y prueba la feature 6): bloquear destinos que no sean unicast global comprobando la dirección a la que realmente conecta, no seguir redirecciones, cortar la respuesta en 1 MiB ya descomprimida, aplicar el timeout por intento, ligar cada secreto a los orígenes a los que se puede enviar y no registrar en claro URL, cabeceras ni body cuando la petición lleve datos `pii` (el motor se lo indica con `containsPii`).

Ningún cambio es **BREAKING** para consumidores reales, porque no hay ninguno. Aun así, que `EngineEvent` y `SESSION_ERROR_CODES` ganen valores rompe en compilación un `switch` exhaustivo escrito sobre ellos. Sin capacidad `http`, los golden actuales no cambian de forma (siguen terminando en `unsupported_node`).

### Decisiones de comportamiento (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| El host ejecuta **un intento** por llamada; el motor decide si hay otro | «El proveedor provee, el consumidor decide»: el host aporta hechos (status, timeout, red) y la política de reintentos vive en un solo sitio, determinista y testable sin red |
| `timeoutMs` lo aplica el host en cada intento; el motor no mide tiempo ni espera entre intentos (el host puede aplicar un *backoff* porque recibe `attempt`) | El motor no puede leer el reloj ni usar temporizadores (determinismo y guarda estática). Un timeout dentro del motor haría que el resultado dependiera de la máquina |
| Sin capacidad `http`, `unsupported_node` | El host no soporta ese tipo de nodo, y es lo que ya significa el código. Así un host mal configurado (o el editor sin cliente HTTP) falla de forma visible y no se va en silencio por `onError` |
| Configuración imposible de ejecutar → sesión `failed` con `invalid_http_config`, comprobada al llegar y antes de renderizar | Es un defecto del flujo que no depende de los datos, igual que `invalid_rule` o `invalid_validation`. Mandarlo a `onError` lo escondería |
| Petición que no se puede construir **por los datos** (URL, cabecera o body inválidos tras renderizar) → `onError` sin llamar al host | El valor puede venir del usuario. El autor ya dio una salida para «la llamada no se pudo hacer», y la conversación sigue |
| Los valores insertados en la URL se codifican como componente (RFC 3986, solo quedan sin codificar `A-Z a-z 0-9 - . _ ~`) | Un usuario no puede cambiar el host, la ruta ni los parámetros: `../admin` llega como `..%2Fadmin`. Una URL base tiene que escribirse literal en el flujo |
| Se rechazan los segmentos `.`/`..` (también `%2e`), `\`, `#` y lo que el parser quitaría en silencio; el host tiene que ser un dominio (sin IP ni `localhost`) | Medido en Node 22: WHATWG convierte `/users/%2e%2e/admin` en `/admin`, `\` en `/` y `2130706433` en `127.0.0.1`. Son las mismas reglas que ya aplica el tipo `url` de `input` ([[gotcha-url-whatwg-normaliza]]) |
| Las IP literales se rechazan aunque la instalación permita redes privadas | Es la primera barrera contra SSRF y es barata. Quien necesite llamar a un servicio interno puede usar un nombre DNS y una lista de permitidos en el host |
| El motor no resuelve DNS ni puede impedir que un dominio apunte a `127.0.0.1`: eso es un **MUST** del host | Solo el host conoce la dirección real a la que conecta. Comprobarla en el momento de conectar cierra el *DNS rebinding* |
| No incluir un adaptador HTTP de referencia en esta feature | Un SSRF bien cerrado depende del runtime y de la red del despliegue (DNS fijado a la conexión, proxy, salida a Internet), que llegan con la feature 6. Un adaptador sin su consumidor se probaría contra dobles con la forma que imaginamos. El contrato y sus escenarios quedan escritos ahora y la feature 6 los convierte en tests |
| Secretos solo por nombre; los resuelve el host, que solo los inyecta en los orígenes autorizados para cada uno | El motor nunca tiene el valor, así que no puede filtrarlo. Ligar el secreto a sus orígenes evita que quien edita flujos lo saque apuntando la URL a un servidor suyo |
| Secreto inexistente o no permitido → sesión `failed` con `missing_secret`, sin reintento | Es un error de configuración de la instalación: tiene que verse. Por `onError` acabaría pareciendo un fallo del servicio remoto |
| El host lanza o devuelve algo fuera del contrato → `http_host_error`, sin reintento | Es un defecto del host, no del servicio. Un rechazo de promesa queda reservado a defectos del motor, y el mensaje del host (que puede llevar URL o PII) no se propaga |
| Éxito = 2xx. 3xx, 4xx y 5xx → error. El host no sigue redirecciones | Seguir una redirección se salta la validación de la URL (es SSRF de manual). Las API no suelen redirigir |
| Reintentables: 408, 429 y fallos antes de enviar, en cualquier método; 500, 502, 503, 504, el timeout y la red cortada tras el envío, solo en `GET`, `PUT` y `DELETE` | Son los métodos idempotentes de RFC 9110. Repetir un `POST` tras un timeout duplica leads y tickets, y `retries` vale 1 por defecto en todos los nodos |
| Cuerpo de la respuesta: solo se parsea si hay `responseMap`; las cabeceras de la respuesta no llegan al motor | Muchas API mandan un `Content-Type` incorrecto. El motor no usa las cabeceras, y no pasarlas evita llevar `Set-Cookie` y similares al motor |
| Un puntero que no encuentra nada (o encuentra `null`) deja la variable sin valor; los valores se aplican todos o ninguno | Los campos opcionales son normales en las API, y el autor puede comprobar `isSet`. Dejar la variable como estaba arrastraría valores de una vuelta anterior. Aplicar solo una parte dejaría el estado a medias |
| Valor mapeado: forma textual ≤ 16384 unidades, profundidad ≤ 100, sin U+0000 ni sustitutos sueltos, números finitos | Cierra la parte `http` del FOLLOW-UP 6.4 de `engine-base`: cabe en una plantilla, se puede guardar en `jsonb` y sobrevive a `stringify`. Medido: `JSON.parse` acepta 5·10⁶ niveles sin lanzar, pero `JSON.stringify` (que construye el estado) desborda la pila con 10⁵ |
| Respuesta de 1 MiB como mucho (bytes en el host, unidades de código en el motor) | Una respuesta de API real cabe de sobra, y así el motor nunca parsea ni retiene un cuerpo desmedido |
| 10 llamadas externas al host como mucho por avance (presupuesto que compartirá `llm`); un reintento que se pasaría del límite no se hace y el nodo sigue por `onError`, mientras que un primer intento que se pasaría hace fallar la sesión (`http_limit_exceeded`) | Sin este límite, un mensaje del usuario podría disparar 600 peticiones (100 vueltas × 6 intentos). Recortar reintentos es benigno, pero un nodo nuevo por encima del límite indica un ciclo |
| Strings del body con plantilla → texto (como en `set`); claves literales; `body: null` = sin body | Una sola regla de plantillas en todo el motor. Las claves ya son literales para el validador (`templateVars` solo recorre valores). La inserción con tipo queda como FOLLOW-UP |
| Evento `http` con intentos, último status y motivo, y nada de la petición ni de la respuesta | El editor y el host necesitan saber por qué un nodo fue por `onError`. El resto puede llevar PII o secretos, y el host ya lo tiene si quiere registrarlo |
| La petición lleva `containsPii` (alguna plantilla usa una variable `pii`) | El host es quien registra, y no sabe qué partes son personales. El motor le da el hecho y el host decide ([[domain-flujos-sin-secretos]]) |

### Formato de flujo

- **`packages/spec/flow.schema.json` no cambia**, no hay que regenerar los tipos y ningún flujo existente se rompe. Ningún ejemplo de `packages/spec/examples/` usa una construcción que el motor rechace.
- **El esquema ya admite flujos que el motor rechazará** con `invalid_http_config` (comprobado con `packages/spec/dist`): nombres de cabecera como `"X Bad"` o `""`, cabeceras repetidas con distinta capitalización, más de 32 cabeceras, `GET` con body y punteros como `/a~2`. Pasarlo al validador es un FOLLOW-UP de `packages/spec`, igual que con `matches` y `validation.pattern`.
- **Semántica que esta feature fija y que conviene anotar en RFC-0001** (amplía los FOLLOW-UP 6.3 de `engine-base` y 6.6 de `engine-input`):
  - `url`, los valores de cabecera y los strings del `body` son plantillas.
  - Las claves del `body` y los `pointer` son literales.
  - Los valores insertados en la `url` se codifican.
  - `body: null` equivale a no tener body.
  - `Content-Type: application/json` va por defecto si hay body.
  - Los valores por defecto `timeoutMs` 10000 y `retries` 1 los aplica el motor.
- **Rareza del validador** (no bloquea): `templateVars` trata los `pointer` como plantillas, así que `"/{{x}}"` obliga a declarar `x` aunque el motor lo lea literal. Es el mismo caso que `rule.value` (FOLLOW-UP 6.2 de `engine-base`).

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `flow-engine`:
  - Lo nuevo: capacidad `http` del host, construcción y validación de la petición, contrato de cada intento, éxito y errores, reintentos e idempotencia, `responseMap`, evento `http`, límite de llamadas por avance, privacidad de la llamada y requisitos de seguridad del host de producción.
  - Requisitos que se modifican: «Nodos aún no soportados» (`http` solo lo es sin capacidad), «Eventos de salida» (evento `http`), «Ejecución determinista y sin efectos externos» (la red, solo a través del host; determinismo dado el host) y «Profundidad máxima de anidamiento» (el estado no cuenta su propio objeto: arreglo del fallo de la feature 1). Los límites de cabeceras y body van en un requisito propio («Tamaño máximo de los textos de un http»).

## Impact

- **`packages/engine`**:
  - Ejecutor de `http`.
  - Tipos públicos: `EngineHost.http`, la petición, el resultado de un intento y el evento `http`.
  - Códigos y motivos nuevos, más constantes públicas de los límites.
  - Se reutilizan los conversores de `src/input/parsers/` (`isDomainName`, caracteres invisibles, `%` en el host), `renderTemplate` y `cloneJsonStrict`/`exceedsDepth`.
  - La guarda estática sigue prohibiendo `fetch`, temporizadores y `node:` en `src/`: el motor no gana IO.
  - Golden nuevos con un host simulado. Las peticiones que recibe el host forman parte del golden porque son el contrato.
- **Sin cambios** en `packages/spec`, `apps/api` ni `apps/web`.
- **Consumidores futuros**:
  - Feature 6: aloja el cliente HTTP real, cumple el contrato de seguridad y lo prueba, y guarda los secretos con sus orígenes.
  - Feature 7: no pinta el evento `http` al usuario final.
  - Feature 8: puede mostrarlo en la vista previa del editor con un host simulado.
- **Dependencias**: ninguna nueva.
- **Hallazgo en el código fusionado** (entra en esta feature por decisión del orquestador): con un contacto de 999 niveles (aceptado), `startSession` deja la sesión en `waiting`, pero `continueSession` rechaza su propio estado con `invalid_state`. Reproducido con `packages/engine/dist`. El límite de profundidad de los valores mapeados (100) queda en cualquier caso muy por debajo de 1000.

## Non-goals / Out of scope

- **Cliente HTTP real, resolución DNS, almacén de secretos y su configuración por origen**: feature 6, que debe cumplir los requisitos de host de esta spec. Esta feature tampoco publica un adaptador de referencia.
- **Nodo `llm`** (feature 4): sigue fallando con `unsupported_node`, aunque el host ofrezca `http`.
- **Persistencia, transcripción y registro**: qué guarda el host de cada llamada es de la feature 6, con las restricciones de privacidad de esta spec.
- **UI**: cómo muestra el editor el evento `http` (feature 8) y que el chat no lo pinte (feature 7).
- **Formato de flujo**:
  - Ni `statusVariable`, ni mapear cabeceras de la respuesta, ni secretos en la URL o el body.
  - Ni métodos `HEAD`/`OPTIONS`, ni cuerpos que no sean JSON (formularios, multipart).
  - Ni inserción con tipo en el body (`"{{n}}"` → number), ni opción para reintentar `POST`.
- **Claves de idempotencia** (`Idempotency-Key`): exigirían un identificador único por sesión, y el motor no genera aleatoriedad. Queda como FOLLOW-UP con el host.
- **Ejecución en paralelo** de varios `http` y streaming de respuestas.
- **Autenticación y aislamiento por tenant**: el motor no conoce usuarios. Que cada instalación o tenant solo resuelva sus propios secretos es un requisito del host (feature 6). La privacidad que sí depende del motor está en la spec: sin valores en eventos ni errores, sin secretos en el motor y `containsPii` para el host.
- **Tope de tiempo total por avance**: el motor no mide el tiempo. Lo pone el host (FOLLOW-UP 6.5 de `engine-base`). En el peor caso, un avance son 10 llamadas de hasta 30 s, siempre que el host aplique `timeoutMs` como tope total de cada intento y no como tiempo de inactividad (MUST del host, con casos en la suite de conformidad).
- **Regla del validador contra tokens pegados como texto** en `Authorization` ([[domain-flujos-sin-secretos]]): es de `packages/spec` o de la API de flujos (feature 5). El motor no la impone, porque una plantilla `Bearer {{token}}` con un token obtenido en un `http` anterior es legítima.

## Plan de verificación por capas

| Capa | Veredicto | Razón |
|---|---|---|
| Unit | **Aplica** | Lógica pura con muchas ramas: construcción y validación de la URL (codificación, tabla de rechazos), nombres y valores de cabecera, serialización y tamaño del body, lectura del resultado del host (formas válidas y mal formadas), tabla de reintentos método × resultado, resolución de JSON Pointer y validez de los valores mapeados |
| Escenarios de la spec | **Aplica** | Un `it` por `#### Scenario`, con flujos que pasan `validateFlow` y un host simulado con guion (lista de resultados por intento) que registra las peticiones |
| Golden / contractual | **Aplica** | Las peticiones que recibe el host y el evento `http` son el contrato con las features 6 y 8. Se añaden las transcripciones de `captacion-leads` hasta el final (éxito, error sin reintento en `POST`, 429 con reintentos) y de un `GET` con `responseMap`, y se revisa el diff. Los golden actuales, sin capacidad `http`, no cambian de forma |
| Paridad | **Aplica** | El `enum` de `method` del esquema debe coincidir con la tabla de reintentos del motor. Todo código y motivo emitido debe estar en sus listas exportadas, y `http` debe tener ejecutor |
| Propiedades | **Aplica** | Determinismo con el mismo guion de host (mismos resultados y mismas peticiones en el mismo orden); flujo, estado y peticiones ya entregadas no se mutan; ningún valor de variable, cuerpo de respuesta no mapeado ni mensaje del host aparece en eventos o errores (tests negativos validados mutando el código); el motor no espera (temporizadores simulados y detenidos, también con reintentos); guarda estática sin `fetch` ni temporizadores |
| Integración HTTP | No aplica aquí | El motor no tiene red ni endpoints. Los escenarios de host (SSRF, redirecciones, tamaño, timeout, secretos por origen) quedan como catálogo de conformidad exportado; aquí se comprueba que cada caso está ligado a su escenario, y la feature 6 lo pasa contra servidores locales reales y lo valida con mutantes de su host (FOLLOW-UP con dueño) |
| E2E opción-al-menos-una-vez | No aplica | No hay UI. La feature 8 cubrirá el evento `http` en la vista previa |
| Smoke de ruta | No aplica | No hay rutas |
| Mutación | **Aplica** | Sin dependencia nueva: un script del paquete aplica una tabla de mutaciones dirigidas (cada hipótesis de coste o tamaño, cada filtro de formas codificadas, la tabla de reintentos) y exige que algún test falle con cada una |

## FOLLOW-UP que deja esta feature

- `packages/spec`: reglas semánticas para las configuraciones que hoy rechaza el motor (nombre de cabecera, cabeceras repetidas o reservadas, más de 32, `GET` con body, puntero mal escapado) y para que `templateVars` no trate `pointer` como plantilla.
- Feature 6: implementar el contrato del host y convertir en tests de integración los escenarios «Host de producción: …»; tope de tiempo total por avance; persistir o no el evento `http`; secretos por instalación o tenant ligados a orígenes.
- Feature 7: no pintar el evento `http` al usuario final.
- Formato (aditivo): `statusVariable`, inserción con tipo en el body y opción explícita (con `Idempotency-Key` del host) para reintentar `POST`/`PATCH`.

## Preguntas abiertas

Todas resueltas por el orquestador (2026-10-16):

- [x] Un `POST` o `PATCH` no se reintenta tras un timeout o un 500, 502, 503 o 504 aunque el nodo tenga `retries` (sí con 408, 429 y fallos antes de enviar): no duplicar leads ni tickets.
- [x] Un secreto inexistente o no permitido hace fallar la sesión con `missing_secret`: un error de configuración tiene que verse.
- [x] Los strings del body se envían siempre como texto (`"{{edad}}"` → `"30"`) hasta que exista la inserción con tipo (FOLLOW-UP).
- [x] Las IP literales se rechazan en la URL aunque el host de un despliegue *self-hosted* permita redes privadas.
- [x] (Surgida en el diseño) El origen de la `url` puede salir de una plantilla, como aprobó la spec; el validador avisará de marcadores en el esquema, en el host o pegados a él (FOLLOW-UP de `packages/spec`).
