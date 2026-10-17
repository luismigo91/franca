# Proposal: salida http de producción de la API (`api-http-host`)

**Fecha**: 2026-10-17 · **Estado**: Draft · **Rama**: `feat/api-http-host` · **Feature 6b de 9** del plan (hechas: motor, `input`, `http`, `llm` con el adaptador de Claude, API de flujos y API de conversaciones; después vienen 7, el chat web de prueba, y 8, el editor visual).

## Why

Hoy una conversación que llega a un nodo `http` falla con `unsupported_node`, porque la API da al motor un host sin capacidad `http` (`buildEngineHost` en `apps/api/src/conversations/engine-host.ts`; ficha `decision-http-deshabilitado-en-conversaciones`). Por eso ninguno de los dos ejemplos (`captacion-leads` en `enviar-crm`, `faq-ia` en `crear-ticket`) llega al final, y el chat de prueba (7) no podría enseñarlos de punta a punta.

El motor ya define qué tiene que cumplir un host `http` de producción: los requisitos «Host de producción: …» de `flow-engine` (destinos, resolución, redirecciones, TLS, tamaño, tiempo, fallos, secretos y registros). También trae la suite `HOST_CONFORMANCE_CASES` para comprobarlo. Pero ningún host real la pasa todavía.

Esta feature construye ese host en la API y fija lo que el motor deja a la instalación: cómo se configuran los secretos y su origen exacto, qué destinos internos se permiten y cómo, cómo se trata la resolución de nombres, el transporte sin TLS, el proxy y el TLS del entorno, qué cabeceras se añaden, qué se registra y qué se avisa, y cómo cuentan las llamadas en el plazo de un avance.

## What Changes

- **Nodos `http` activos en las conversaciones**: el motor recibe en cada avance la capacidad `http` de la salida http de la API. Un flujo que llega a un `http` hace la llamada y sigue por `next` o por `onError` según el motor. Un secreto no disponible hace fallar la conversación con `missing_secret`, el comportamiento que el motor ya define.
- **Política de destinos (anti-SSRF)**, por encima de lo que exige el motor:
  - Solo direcciones unicast global, según los registros de direcciones de propósito especial de IANA. Las mapeadas y las NAT64 se juzgan por la IPv4 que incrustan, y IPv4-compatible, 6to4, Teredo y NAT64 local nunca son globales.
  - Si **alguna** dirección de la resolución no está permitida, el intento se bloquea entero.
  - Se conecta con la dirección validada, sin volver a resolver, y se prueba la siguiente de la resolución solo si la conexión falla sin haber enviado nada.
  - Nunca se siguen redirecciones.
  - Se abre una conexión por intento.
  - `http://` sin TLS solo llega a los pares permitidos por la instalación.
- **Configuración por variables de entorno** (solo nombres; los valores los pone quien opera):

  | Variable | Qué fija | Por defecto | Valor no válido |
  |---|---|---|---|
  | `FRANCA_SECRET_<NOMBRE>` | Valor completo de la cabecera del secreto `<NOMBRE>` (p. ej. `Bearer …`): de 1 a 8192 caracteres ASCII visibles, espacios o tabuladores, sin blancos en los extremos | — | No arranca; el mensaje nombra la variable, nunca el valor |
  | `FRANCA_HTTP_SECRET_ORIGINS` | Entradas `NOMBRE=origen` separadas por comas: qué origen exacto puede recibir cada secreto. Un nombre se puede repetir | ninguna | No arranca |
  | `FRANCA_HTTP_ALLOWED_DESTINATIONS` | Pares `dirección:puerto` (IPv6 entre corchetes) separados por comas: destinos que se permiten aunque no sean unicast global, también con `http://` | ninguno | No arranca |

  Un `FRANCA_SECRET_*` sin origen se ignora. La salida de arranque dice qué secretos hay, con sus orígenes, cuáles se ignoran y qué destinos se permiten, sin valores.
- **Plazo de un avance compartido**: los 90 s que hoy limitan los turnos `llm` valen también para los intentos `http`. Un intento empezado dentro del plazo termina, como mucho, al acabar el plazo, y pasado el plazo un intento se resuelve como `timeout` sin conectar. La reclamación de 300 s no cambia.
- **TLS y entorno**:
  - El certificado se verifica contra el nombre del host de la URL, con SNI.
  - `NODE_TLS_REJECT_UNAUTHORIZED` no desactiva la verificación.
  - `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` y `NODE_USE_ENV_PROXY` no desvían nada.
  - No se añaden cookies ni credenciales.
- **Cabeceras que añade la API**: `Host`, `Content-Length` (si hay body) y `Connection: close`. Además, `Accept-Encoding: gzip, deflate, br` y `User-Agent: Franca` si el nodo no las define.
- **Registros**:
  - De una llamada `http` no se registra nada: ni URL, ni origen, ni dirección, ni cabeceras, ni cuerpos, ni secretos, tenga o no `containsPii`.
  - Solo hay dos avisos de operación:
    - `missing_secret`, con el nombre del secreto y `not_configured` u `origin_not_allowed`.
    - `blocked`, con `internal_destination` o `insecure_transport`.
- **Conformidad completa**: la API pasa **todos** los casos de `HOST_CONFORMANCE_CASES` (hoy pasa 4 de 21), con servidores locales reales, sin Internet ni privilegios, en Linux y en macOS.
- **`flow-engine`, delta pequeño** (FOLLOW-UP 6.9 de `engine-http`): «Host de producción: destinos de red» nombra NAT64, IPv4-compatible, 6to4 y Teredo, y su escenario (`CONFORMANCE_INTERNAL_ADDRESSES`) suma 7 direcciones: `::ffff:169.254.169.254`, `64:ff9b::a9fe:a9fe`, `64:ff9b::7f00:1`, `::127.0.0.1`, `64:ff9b:1::a9fe:a9fe`, `2002:7f00:1::1` y `2001::1`. El número de casos no cambia.

### Decisiones (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| Secretos en variables de entorno: el valor en `FRANCA_SECRET_<NOMBRE>` y los orígenes en una sola variable aparte, `FRANCA_HTTP_SECRET_ORIGINS` | Es el patrón que el repo ya usa (`FRANCA_ANTHROPIC_API_KEY`): pasan por nombre y ningún agente crea ficheros de entorno. Un fichero JSON con los valores dentro del árbol de un repo público acabaría commiteado tarde o temprano, y las guardas solo protegen ficheros de entorno. Separar valor y orígenes evita la ambigüedad de `FRANCA_SECRET_X_ORIGIN` (¿el origen de `X` o el valor de `X_ORIGIN`?). Además, la lista de orígenes no es secreta y se puede imprimir al arrancar |
| Origen escrito exactamente como su serialización WHATWG; si no, no arranca | `https://crm.example.com:443` y `HTTPS://CRM…` se normalizarían en silencio ([[gotcha-url-whatwg-normaliza]]). Quien opera debe ver lo mismo que se compara: esquema, host y puerto exactos (ficha `domain-flujos-sin-secretos`) |
| Un nombre en `FRANCA_HTTP_SECRET_ORIGINS` sin su `FRANCA_SECRET_*` impide arrancar; un `FRANCA_SECRET_*` sin origen solo se ignora y se avisa | Listar un origen es una intención explícita de configurar ese secreto, así que el fallo debe verse al arrancar y no en mitad de una conversación. Una variable suelta puede estar en la shell por otras razones |
| Sin secreto disponible, la conversación falla con `missing_secret` y la API registra un aviso con el nombre y el motivo | Es lo que define el motor (falla la sesión, sin `onError`). Seguir por `onError` diría al usuario «hemos guardado tus datos» sin enviarlos. El aviso es la alerta de operación, como `llm_not_configured` |
| Los secretos se comprueban **antes** de resolver el nombre | Una petición que no va a salir no debe ni filtrar el nombre al DNS. Además, cuadra con la conformidad: `secreto-origen-no-autorizado` exige no abrir ninguna conexión |
| La instalación es el único tenant | La API no tiene autenticación ni propietarios (solo loopback). El arnés de conformidad crea un host por tenant, cada uno con su almacén, y así pasa `secreto-otro-tenant` sin inventar tenants en la API |
| Lista de destinos permitidos por pares `dirección:puerto` exactos, vacía por defecto, sin nombres, rangos ni comodines | Es lo que fija «Host de producción: destinos permitidos y resolución». Un nombre exigiría resolverlo, que es justo lo que se valida, y un rango abre más de lo que se quiso |
| Una resolución con **alguna** dirección no permitida se bloquea entera, aunque el motor admitiría filtrarla | Un servicio público legítimo no publica direcciones internas. Mezclarlas es el patrón del *DNS rebinding*. Bloquear es más simple de verificar y no hay que elegir qué dirección «vale» |
| Si la conexión con una dirección falla sin enviar nada, se prueba la siguiente de la misma resolución, dentro del mismo `timeoutMs` | Todas están ya validadas, así que es seguro. Sin esto, un nombre con IPv6 en una máquina sin IPv6 fallaría siempre |
| Una conexión por intento, con `Connection: close` y sin *pool* | Cada intento se resuelve y se valida de nuevo. Ninguna conexión abierta para una conversación sirve después a otra |
| `http://` sin TLS solo hacia pares permitidos; hacia un destino público, `blocked` (`insecure_transport`) | `captacion-leads` envía nombre y email. Mandarlos sin cifrar por Internet porque el autor escribió `http://` no debería pasar en silencio, y en local la lista de permitidos cubre los servidores de prueba. Ver Preguntas abiertas |
| Plazo de 90 s compartido por `llm` y `http`: un intento empezado dentro del plazo termina, como mucho, al acabar el plazo, y pasado el plazo es `timeout` sin conectar | Con 10 llamadas de hasta 30 s, un avance podría pasar de 300 s y perder la reclamación con el resultado ya pagado. Así, el peor avance sigue en unos 150 s (un turno de 60 s empezado en el segundo 89). `timeout` es lo que pasó (se acabó el tiempo), y en `POST` no se reintenta |
| El evento `http` se guarda y se devuelve tal cual (como ya fija «Contenido de la transcripción») | Solo lleva `nodeId`, `attempts`, `status` y `error`, sin URL, cabeceras ni cuerpos. Así una URL con datos personales en la consulta no llega a ningún sitio. Qué se pinta al usuario final lo decide el chat (7) |
| De una llamada no se registra nada (ni origen ni dirección), aunque el motor permitiría registrar el origen | El host de una URL puede salir de una plantilla con datos del usuario (`https://{{sub}}.example.com`). `nodeId` y versión ya identifican el destino en el flujo, y así no hay nada que filtrar (mutante `logUrl`) |
| Avisos solo para `missing_secret` y `blocked`, con motivo y sin nombre ni direcciones | Son los dos fallos de configuración que quien opera puede arreglar (secreto, origen, lista de permitidos). Un `timeout` o un 5xx son del servidor remoto y ya los cuenta el evento |
| `User-Agent: Franca` y `Accept-Encoding: gzip, deflate, br` por defecto, que el nodo puede sustituir | Algunas API rechazan peticiones sin `User-Agent`. La compresión ahorra red, y el límite de 1 MiB se aplica a lo descomprimido |
| Proxy del entorno ignorado; `NODE_EXTRA_CA_CERTS` sí cuenta y `NODE_TLS_REJECT_UNAUTHORIZED` no | Un proxy no aplica la política de destinos (MUST del motor). Las autoridades extra son configuración legítima de la máquina (CA corporativa), mientras que desactivar la verificación incumple «Certificado no válido» |
| Las IPv6 mapeadas cuentan como su IPv4 también en la lista de permitidos | Son el mismo destino en un socket de doble pila. Compararlas como texto bloquearía o dejaría pasar según cómo resuelva el sistema |
| `invokeCapability<Req>` común **fuera** | Es un refactor interno del motor sin cambio de conducta. Mezclarlo con un componente de seguridad agranda el diff que hay que revisar a fondo. Va como `refactor(engine)` aparte |

### Qué ve cada consumidor

- **Feature 7 (chat de prueba)**:
  - Ve conversaciones que terminan en `lead-empresa`, `lead-pyme`, `lead-sin-enviar` o `escalado`, y fallos `missing_secret` cuando falta configuración.
  - El evento `http` llega en `events` y en la transcripción, y el chat decide no pintarlo al usuario final (FOLLOW-UP 5.3 de `api-conversations`).
  - Los ejemplos apuntan a `crm.example.com` y `soporte.example.com`, que no existen. Para verlos acabar en local hace falta un servidor simulado (ver Preguntas abiertas).
- **Feature 8 (editor)**: sin cambios. La vista previa sigue con un host simulado en el navegador.
- **Quien opera la instalación**: tres variables nuevas, una línea de arranque con lo configurado (sin valores) y dos avisos en el registro.

### Formato de flujo

- **`packages/spec/flow.schema.json` no cambia**, ni `validateFlow` ni los tipos generados. Ningún flujo se rompe.
- `secretRef` ya nombra secretos con `^[A-Z][A-Z0-9_]{0,63}$`, y la configuración usa ese mismo patrón.
- RFC-0001 debería anotar que el valor de un secreto es el valor completo de la cabecera y que un secreto solo viaja a sus orígenes autorizados. Queda como FOLLOW-UP, junto a los demás de `docs/rfcs/`.

## Capabilities

### New Capabilities
- `http-host`: la salida `http` de la API. Cubre secretos de la instalación por origen exacto y su configuración, destinos permitidos, clasificación de direcciones IPv4 e IPv6, resolución de nombres, transporte sin TLS, certificado, proxy del entorno, cabeceras añadidas, una conexión por intento, fallos de red, registros y avisos.

### Modified Capabilities
- `conversations-api`:
  - «Nodos http deshabilitados» pasa a llamarse **«Nodos http en las conversaciones»** (`RENAMED`) y su contenido cambia. Conserva el título del escenario «Escalado en el ejemplo de FAQ», que ahora termina en `escalado` con el ticket creado.
  - «Estado de una conversación» y «Enviar una entrada»: el nodo `http` de los ejemplos sin secretos configurados da `missing_secret`, no `unsupported_node`.
  - «Tiempo máximo de un avance»: el plazo de 90 s vale también para `http`.
  - «Privacidad de los registros de conversaciones»: remite a los registros de `http-host`.
  - «Conformidad del host de conversaciones»: todos los casos, no solo los 4 de `llm`.
- `flow-engine`: «Host de producción: destinos de red» nombra NAT64, IPv4-compatible, 6to4 y Teredo y amplía su escenario a 32 direcciones (FOLLOW-UP 6.9 de `engine-http`). El número de casos de conformidad no cambia.
- `flows-api` y `llm-anthropic`: sin cambios.

## Impact

- **`apps/api`**:
  - Módulo nuevo de la salida http (resolución, política de destinos, conexión, lectura con límites y descompresión, secretos, avisos), que convive con el de conversaciones.
  - El contacto con el código existente es una cláusula en `buildEngineHost` (y su llamada en `ConversationsService`), que pasa a recibir también `http` con el `id` de la conversación y el inicio del avance.
  - Configuración nueva en el arranque, con su línea de salida.
  - Arnés de conformidad completo: `serve`, `resolve`, `refusing`, `connectionsTo`, `setSecret` por tenant, `logs` y autoridad TLS del test.
  - **Sin dependencias nuevas** previstas: `node:dns`, `node:net`, `node:tls`, `node:http(s)` y `node:zlib` bastan. Si el diseño propone alguna, debe justificarla.
- **`packages/engine`**: solo `src/conformance/cases.ts` (`CONFORMANCE_INTERNAL_ADDRESSES`, de 25 a 32 entradas) y `tests/conformance.test.ts`. Ese test cuenta 25 y lee la **primera** aparición del escenario en el texto (la de la spec vigente, no la del delta), así que debe pasar a leer la spec efectiva. Ni tipos ni contrato.
- **Tests de cobertura de la spec**:
  - `apps/api/test/spec-coverage.spec.ts` suma la capacidad `http-host`.
  - `apps/api/test/helpers/spec-text.ts` (`effectiveSpec`) aprende `RENAMED` y `REMOVED`. Hoy solo aplica `ADDED`/`MODIFIED` por título, y con el `RENAMED` seguiría exigiendo «Nodos http deshabilitados».
- **Configuración y documentación**:
  - `turbo.json`: `@franca/api#dev` suma `FRANCA_SECRET_*`, `FRANCA_HTTP_SECRET_ORIGINS` y `FRANCA_HTTP_ALLOWED_DESTINATIONS` en `passThroughEnv`, con comodín ([[gotcha-turbo-filtra-variables-de-entorno]]).
  - `CLAUDE.md`: los nombres de las variables nuevas.
  - El fichero de ejemplo de variables lo crea una persona ([[harness-guard-env-falsos-positivos]]).
- **Meta**:
  - La ficha `decision-http-deshabilitado-en-conversaciones` queda superada: se reescribe o se retira, con su línea del índice.
  - Fichas nuevas, con su enforcement:
    - Secretos por variables y origen exacto.
    - Resolución mezclada bloqueada y `http://` solo hacia permitidos.
    - macOS sin `127.0.0.2` y la red del test.
- **Sin cambios** en `packages/spec`, `packages/llm-anthropic`, `apps/web` ni en el esquema de Prisma (los secretos no se guardan en la base de datos).

## Non-goals / Out of scope

- **Redirigir destinos desde la configuración** (DNS estático, reasignar puertos o un «modo demo» que haga que `crm.example.com` llegue a un servidor local). Los ejemplos llegan al final en los e2e, con la red del test. Para el chat, ver Preguntas abiertas.
- **Gestionar secretos** sin reiniciar: rotación en caliente, almacén externo (Vault, KMS), secretos en la base de datos o editables desde la API o la web, y secretos por flujo. El editor (8) solo ofrecerá elegirlos por nombre.
- **Tenants, propietarios y autenticación**: la instalación es el único tenant mientras la API esté solo en loopback.
- **Reintentar `POST`/`PATCH` con `Idempotency-Key`** y `statusVariable` (FOLLOW-UP 6.6 de `engine-http`): son aditivos al formato.
- **Límites globales de salida**: llamadas simultáneas entre conversaciones, cuotas por destino o por día y limitación de peticiones.
- **HTTP/2, certificados de cliente (mTLS), una autoridad TLS propia por variable y salir por un proxy corporativo**. Para una CA corporativa sirve `NODE_EXTRA_CA_CERTS`, que es de la máquina.
- **Cuerpos binarios o en *streaming*** y codificaciones distintas de `gzip`, `deflate` y `br`: la respuesta se entrega como texto UTF-8 con el límite del motor.
- **Tope de CPU por avance** (FOLLOW-UP 5.6 de `api-conversations`).
- **Pintar o esconder el evento `http` en el chat** (feature 7) y **avisos del validador** sobre orígenes con plantilla (FOLLOW-UP 6.5 y 6.10 de `engine-http`).
- **`invokeCapability<Req>` común** en el motor (refactor sin conducta, ver Decisiones).

## FOLLOW-UP pendientes etiquetados para esta feature

| FOLLOW-UP | Veredicto | Dónde o por qué |
|---|---|---|
| `engine-http` 6.1: host real con resolutor, lista de permitidos por par, almacén de secretos por tenant y origen exacto, y registro inyectables | **Dentro** | `http-host` entero; las piezas inyectables, en el arnés de «Conformidad del host de conversaciones» |
| `engine-http` 6.1: `HostConformanceHarness` con servidores locales reales fuera de `CONFORMANCE_INTERNAL_ADDRESSES` y `HOST_CONFORMANCE_CASES` en CI | **Dentro** | «Conformidad del host de conversaciones», con todos los casos. `127.0.0.2` **no** se puede usar en macOS (medido: `EADDRNOTAVAIL`, Darwin 24.6 y Node 22.23), así que el requisito pide «sin privilegios, en Linux y en macOS» y el diseño decide cómo (ver Riesgos) |
| `engine-http` 6.1: mutantes `followRedirects`, `reResolveOnConnect`, `allowAnyAddressOnResolution`, `allowAddressAnyPort`, `noSizeCap`, `unboundedDecompression`, `networkBytesCapOnly`, `firstAnswerOnly`, `idleTimeoutOnly`, `ignoreTimeout`, `secretsAnyOrigin`, `secretsAnyTenant`, `logUrl`, `rejectOnRefused`, `keepCookies` y `acceptBadTls` | **Dentro** | Plan de verificación (mutación manual), más los mutantes propios de esta feature |
| `engine-http` 6.9: NAT64, v4 mapeada de metadatos e IPv4-compatible en `CONFORMANCE_INTERNAL_ADDRESSES` y `destinos-internos` | **Dentro, ampliado** | Delta de `flow-engine` «Host de producción: destinos de red», que suma también NAT64 local, 6to4 y Teredo |
| `engine-http` 6.2: tope de tiempo total por avance | **Dentro** | «Tiempo máximo de un avance» (90 s compartidos por `llm` y `http`) |
| `engine-http` 6.2: persistir o no el evento `http` | **Dentro, ya resuelto** | «Contenido de la transcripción» ya lo guarda tal cual. «Nodos http en las conversaciones» lo confirma y el evento no lleva URL ni cuerpos |
| `engine-http` 6.2: tope de CPU | **Fuera** | Igual que en `api-conversations` (FOLLOW-UP 5.6): antes de los flujos de terceros |
| `api-conversations` 5.1: sustituir `buildEngineHost` por uno con `http` | **Dentro** | «Nodos http en las conversaciones» y «Salida http de la API» |
| `api-conversations` 5.1 y `engine-llm` 9.2: `invokeCapability<Req>` común | **Fuera** | Refactor del motor sin conducta (Decisiones) |
| `api-conversations` 5.3: no pintar `http` ni el `message` de los `error` en el chat | **Fuera** | Es de la feature 7. Esta feature solo garantiza que el evento no lleve nada sensible |

## Plan de verificación por capas

- **Unit (aplica, el grueso de la lógica)**:
  - Clasificación de direcciones IPv4 e IPv6: cada fila de los registros de IANA que se use, mapeadas, NAT64, compatibles, 6to4 y Teredo, y las formas escritas distintas.
  - Comparación con la lista de permitidos.
  - Lectura y rechazo de las tres variables (nombres, orígenes exactos, valores y pares).
  - Recorte del intento por el plazo del avance.
  - Orden de comprobación de un intento.
  - Todo test negativo se valida haciendo fallar su fixture a propósito.
- **Golden/contractual (aplica, ligero)**: el resultado de cada intento pasa por `readAttemptResult` del motor (lo hace `call` de la conformidad), y los eventos de los escenarios se comparan exactos (`toEqual`) con los del motor real. Sin baselines protegidos.
- **Conformidad (aplica, crítico)**: todos los `HOST_CONFORMANCE_CASES` contra la API y Postgres reales, con servidores locales reales y sin Internet. El test falla si el catálogo trae un caso que no se ejecutó.
- **Integración HTTP (aplica)**: e2e con supertest para cada escenario de `http-host` y los modificados de `conversations-api`:
  - Los dos ejemplos de punta a punta con «el CRM del test» y el soporte.
  - `blocked`, `missing_secret`, `network_error` con y sin envío, certificado, proxy y TLS del entorno.
  - Cabeceras recibidas, una conexión por intento y plazo del avance con el reloj de la API.
  - Arranques de proceso real para las variables no admitidas y la línea de arranque.
  - Privacidad del registro con marcadores.
- **Mutación (aplica, manual)**: `apps/api` no tiene arnés de mutación (FOLLOW-UP 5.9 de `api-conversations`). Cada mutante se aplica a mano, se anota qué test lo mata y se restaura:
  - Los 16 de 6.1 de `engine-http`.
  - Los propios de esta feature: `plainHttpToPublic`, `filterMixedResolution`, `noAddressFallback`, `mappedAsText`, `nat64Global`, `resolveBeforeSecrets`, `reuseConnections`, `useEnvProxy`, `honorTlsRejectEnv`, `tlsAgainstAddress` (sin SNI ni nombre), `noAdvanceWindow`, `windowNotCapping`, `logOrigin` y `envHeaders`.
  - Un mutante que no haga fallar nada añade el test que falta.
- **E2E opción-al-menos-una-vez (no aplica)**: no hay UI.
- **Smoke de ruta (no aplica)**: no hay rutas nuevas.
- **Paridad (no aplica)**: no hay constantes espejadas en la web.

## Riesgos

- **La red del test es la costura más delicada.** En macOS no hay `127.0.0.2` y el puerto 443 de los ejemplos exige privilegios. Por eso los tests tienen que llevar a sus servidores locales las conexiones que la API abre hacia un par `dirección:puerto`.
  - Si esa sustitución se hace **por encima** de la política (antes de resolver o de validar), la suite pasa sin probar nada.
  - El diseño debe sustituir solo la apertura del socket, después de todas las comprobaciones, y los mutantes deben correr con esa costura.
- **Autoridad TLS del test**: la API solo debe aceptar la CA del test en los tests. Ninguna variable ni configuración debe poder activarla.
- **Fragilidad por tiempo**: los casos de 500 ms y el recorte por el plazo dependen de la carga de la máquina. Se usa la tolerancia del entorno, como en la conformidad del motor.
- **Valores de secretos en el entorno**: cualquier proceso del mismo usuario puede leerlos (`ps`, `/proc`). Es aceptable en una instalación local de un único usuario, pero no para una exposición (feature de autenticación).
- **Un servidor puede devolver el secreto o datos sensibles** en un campo que `responseMap` asigna, y entonces se guardan en el estado (que se borra al terminar). La API no puede impedirlo: es el contrato con ese servidor.
- **`http://` bloqueado hacia Internet** puede sorprender a quien prueba con un *webhook* sin TLS: lo verá como `blocked` con el aviso `insecure_transport`.
- **Resolución del sistema**: un DNS lento consume el `timeoutMs` del intento, y un `/etc/hosts` que apunte a direcciones internas se bloquea (es lo correcto, pero puede extrañar).

## Preguntas abiertas (con la recomendación ya aplicada en la spec)

1. **¿`http://` sin TLS hacia destinos públicos?** Aplicado: se bloquea (`blocked`, aviso `insecure_transport`); solo llega a pares permitidos. La alternativa es permitirlo siempre, como admite el motor, y dejar que el autor decida. Es más flexible, pero los ejemplos envían datos personales y no habría ninguna señal de que viajan sin cifrar.
2. **¿Cómo ve el chat (7) los ejemplos terminar en local?** Aplicado aquí: no hay forma de redirigir destinos por configuración (non-goal). Recomendación para la 7: un servidor simulado de CRM y soporte en loopback, con copias de los ejemplos que apunten a un nombre que resuelva a él y su par en `FRANCA_HTTP_ALLOWED_DESTINATIONS`. Si eso no basta, una variable de resolución estática (`nombre=dirección:puerto`), solo para desarrollo, se puede añadir después sin tocar este contrato.
3. **¿Resolución mezclada: bloquear entera o filtrar las internas?** Aplicado: bloquear entera. El motor admite las dos, y filtrar ganaría disponibilidad en redes raras a costa de aceptar respuestas DNS que mezclan Internet y red interna.
