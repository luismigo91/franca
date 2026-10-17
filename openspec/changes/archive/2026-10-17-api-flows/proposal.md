# Proposal: API de flujos con Postgres (`api-flows`)

**Fecha**: 2026-10-17 · **Estado**: Draft · **Rama**: `feat/api-flows` · **Feature 5 de 8** del plan (1-4 hechas: motor, `input`, `http`, `llm` y adaptador de Claude; después vienen 6 conversaciones, 7 chat web de prueba y 8 editor visual).

## Why

Hoy un flujo de Franca solo existe como fichero: la API valida (`POST /flows/validate`) pero no guarda nada. La feature 6 necesita arrancar sesiones contra un flujo **guardado y fijado a una versión que no cambia** (FOLLOW-UP 6.7 de `engine-input` y 6.5 de `engine-base`): si el flujo cambiara bajo una sesión en espera, esta se atascaría o perdería valores. El editor (8) necesita un borrador que guardar sin pisar cambios. Esta feature da ese almacén (Postgres + Prisma), su contrato HTTP y los **avisos** del validador que los FOLLOW-UP aplazaron hasta tener un sitio donde mostrarlos al guardar (6.10 y 6.5 de `engine-http`; ficha `domain-flujos-sin-secretos`).

## What Changes

- **Persistencia en Postgres con Prisma**: `docker-compose.yml` con Postgres para local, migraciones versionadas y `DATABASE_URL`. La CI levanta Postgres como `services:` y ejecuta los e2e contra él.
- **Modelo borrador + versiones publicadas**: cada flujo tiene un **borrador** editable con un número de `revision`, y una lista de **versiones** numeradas 1, 2, 3… que son copias inmutables del borrador en el momento de publicar.
- **Contrato HTTP** (cuerpo = el JSON del flujo tal cual, sin sobre):

  | Método y ruta | Qué hace | Éxito | Errores propios |
  |---|---|---|---|
  | `POST /flows/validate` | Valida sin guardar (se mantiene) | 200 `{valid, issues, warnings}` | — |
  | `POST /flows` | Crea el flujo con su borrador (revisión 1) | 201 + `Location` + `ETag` | 400 `invalid_flow` / `literal_credential`, 409 `flow_already_exists` / `flow_id_reserved` |
  | `GET /flows` | Lista paginada (`limit`, `offset`, `published`) | 200 `{items, total, limit, offset}` | 400 `invalid_query` |
  | `GET /flows/:flowId` | Borrador + resumen de versiones | 200 + `ETag` | 404 `flow_not_found` |
  | `PUT /flows/:flowId` | Sustituye el borrador; `If-Match` obligatorio | 200 + `ETag` | 428 `precondition_required`, 412 `revision_mismatch`, 400 `invalid_flow` / `literal_credential` / `flow_id_mismatch`, 404 |
  | `DELETE /flows/:flowId` | Borrado lógico: oculta el flujo, reserva su `id` y conserva sus versiones; `If-Match` opcional | 204 | 404, 412 |
  | `POST /flows/:flowId/versions` | Publica el borrador; `If-Match` opcional | 201 nueva / 200 si no hay cambios | 400 `invalid_flow` / `literal_credential`, 404, 412 |
  | `GET /flows/:flowId/versions` | Lista paginada de versiones | 200 | 400 `invalid_query`, 404 |
  | `GET /flows/:flowId/versions/:version` | Una versión inmutable | 200 | 404 `flow_not_found` / `version_not_found` |

  Comunes: 400 `invalid_json`, 413 `payload_too_large`, 415 `unsupported_media_type`, 403 `forbidden_host` / `forbidden_origin`, 404 `not_found`, 500 `internal_error` y 503 `database_unavailable`. Todo error tiene el cuerpo `{message, error}` (más los campos documentados de cada código), y el cliente ramifica por `error`.
- **`POST /flows/validate` gana `warnings`** en su respuesta (aditivo: `{valid, issues}` → `{valid, issues, warnings}`).
- **Avisos en `@franca/spec`**: `validateFlow` devuelve además `warnings: FlowWarning[]` (`{code, path, nodeId?, message}`) con tres códigos: `url_template_in_origin`, `credential_header_not_secret` (cabecera de credenciales construida con variables) y `credential_header_literal` (cabecera de credenciales con el valor escrito, sin marcadores). Los avisos nunca cambian `valid` ni `issues`. La CLI `franca-validate` no cambia.
- **`validateFlow` no lanza con datos JSON**: un flujo de más de 1000 niveles de anidamiento da un único issue de forma, el mismo que ya da el motor. Hoy, 5000 predicados `all` anidados hacen lanzar a `validateFlow` un `RangeError` (medido con `packages/spec/dist`), y la API respondería 500.
- **`validateFlow` acotado con flujos inválidos**: como mucho 100 issues más uno final que avisa de que hay más, y detalle completo de errores de forma solo en piezas pequeñas (raíz y nodos de hasta 8192 caracteres, 65536 en total); en las demás, un error. Hoy la ruta de errores es cuadrática: 4000 nodos con el mismo error tardan 3 s, y ajv con `allErrors` también lo es dentro de un solo nodo (200 000 predicados vacíos, minutos) o en la raíz (200 000 variables rotas, 59 s). Con 1 MiB, una petición bloquearía la API minutos.
- **Exposición solo local mientras no haya autenticación**: la API escucha en loopback (`HOST`: `127.0.0.1`, por defecto, o `::1`) y se niega a arrancar con otra dirección. También rechaza las peticiones con un `Host` que no sea local (DNS rebinding) y las que traen `Origin` (cualquier navegador), y no emite cabeceras CORS.

### Decisiones (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| Borrador editable + versiones publicadas inmutables, en vez de una versión por cada guardado | Una sesión fija una versión que no cambia nunca (FOLLOW-UP 6.7 de `engine-input`), y el autoguardado del editor no llena la tabla de versiones que nadie quiso publicar |
| La identidad pública es el `id` del JSON (`/flows/captacion-leads`); no hay otro id expuesto | El estado del motor guarda `flowId` y `continueSession` lo compara con `flow.id`: si el `id` cambiara, las sesiones no podrían continuar. Además, exportar e importar el JSON conserva la identidad sin traducir ids |
| El `id` no cambia: un `PUT` con otro `id` es 400 `flow_id_mismatch`; crear uno que ya existe es 409 `flow_already_exists` | Renombrar la identidad rompería las referencias de las sesiones. Para «renombrar», se crea otro flujo y se borra el viejo (`name` sí se puede cambiar) |
| El cuerpo es el flujo tal cual, y la concurrencia va en `If-Match`/`ETag` con la `revision` (`"3"`) | Así el mismo JSON vale para validar, guardar, exportar e importar. Un sobre `{revision, flow}` obligaría a cada cliente a envolver y desenvolver |
| `If-Match` es obligatorio en `PUT` (428 si falta). `*` lo admite de forma explícita | Sin la cabecera, dos pestañas del editor se pisarían en silencio. `*` deja que un script de importación sobrescriba diciéndolo |
| Precondiciones antes del contenido: 404 → 428 → 412 → 400 | RFC 9110 §13.2.1: las precondiciones se evalúan antes de procesar el contenido. Así un cliente desfasado se entera de que lo está aunque su flujo sea inválido |
| Guardar o publicar sin cambios no crea revisión ni versión (200 con lo que ya había) | El autoguardado y el doble clic en «Publicar» son idempotentes, y no aparecen versiones duplicadas |
| Publicar revalida el borrador con el validador actual | Un borrador guardado antes de una regla nueva puede haber dejado de ser válido, y una versión publicada siempre fue válida al publicarse |
| Un flujo inválido no se guarda nunca (400 con `issues` y `warnings`) | Lo pide el alcance aprobado y garantiza que todo lo guardado es ejecutable. El editor (8) conserva en el cliente lo que aún no valida |
| Se valida y guarda la **forma JSON** del cuerpo, y se conserva el orden de sus propiedades (columna `json` o texto, nunca `jsonb`) | El motor ejecuta la forma JSON y envía cabeceras y claves del body en el orden del flujo («Orden de cabeceras y claves del body»; FOLLOW-UP 6.2 de `engine-http`). `jsonb` reordena las claves |
| Avisos en `@franca/spec`, en `validateFlow`, con un `code` estable y no en la API | El editor (8) los mostrará en el navegador sin llamar a la API. «El proveedor provee, el consumidor decide»: la spec da hechos, y la API y el editor deciden qué hacer con ellos |
| Avisos solo con la forma correcta (también si hay errores semánticos) | Necesitan recorrer nodos bien formados. Con errores semánticos siguen siendo útiles en el editor |
| En `@franca/spec` las dos reglas de credenciales son **avisos**; la API **rechaza** (400 `literal_credential`) el literal sin marcadores y solo avisa del texto con marcadores | Decisión del orquestador sobre la pregunta abierta. Hacerlo error en `validateFlow` cambiaría el contrato del formato (el motor rechazaría flujos que su spec admite, como `"Authorization": "Bearer {{t}}"`). Un valor sin marcadores (`"Bearer abc123"`) está escrito en el flujo: guardarlo copia una credencial a la base de datos y a cada exportación, y la ficha `domain-flujos-sin-secretos` dice que la API nunca debe aceptarlo. Con marcador, el valor llega de una variable y puede ser legítimo. «El proveedor provee, el consumidor decide»: la spec da el hecho con un código distinto y la API decide |
| Tope de 100 issues y detalle de errores de forma solo en piezas de hasta 8192 caracteres (65536 en total) | El tiempo de validar un flujo inválido era cuadrático (medido) y su lista de issues, sin fin: con 1 MiB, una petición bloquearía la API minutos y el cuerpo de `invalid_flow` sería enorme. 100 issues sobran para corregir un flujo de arriba abajo; un flujo normal mal escrito conserva el detalle de hoy. `warnings` no tiene tope: solo se calculan con la forma correcta, crecen como mucho una por campo, y la API necesita verlos todos para decidir `literal_credential` |
| `HOST` solo `127.0.0.1` o `::1` (no `localhost`) y ausente → `127.0.0.1` | `localhost` puede resolver a una sola familia, y un `HOST` vacío haría escuchar en todas las interfaces (`::`), lo contrario de lo que se pide |
| Fuera de esta feature: el aviso `ignored_field` y los cambios de la CLI | Decisión del orquestador: pasan a la feature 8 (validación en vivo del editor), que es quien los muestra. Siguen abiertos el FOLLOW-UP 6.4 y parte del 6.2 de `engine-input` |
| No se añaden los avisos de `temperature` ni de `system`/`goal` con variables de un `input` (FOLLOW-UP 8.6 de `engine-llm`) | El de `temperature` saltaría en el ejemplo oficial `faq-ia`. El de inyección necesita decidir qué orígenes de variables cuentan (contacto, `http`, slots). Siguen pendientes |
| Profundidad máxima (1000) dentro de `validateFlow` | La API y el editor reciben JSON arbitrario, y ningún consumidor debería poder tumbar el validador. El motor ya aplica el mismo límite y mensaje, así que su comportamiento no cambia. Ojo: `JSON.parse` acepta 100000 niveles pero `JSON.stringify` lanza `RangeError` (medido en Node 22), así que la API comprueba la profundidad antes de calcular la forma JSON |
| Cuerpo máximo de 1 MiB (1 048 576 bytes), sin compresión (415) | El valor por defecto de Nest (100 kB) se queda corto: un flujo de 300 mensajes de 2000 caracteres ocupa ~625 kB. Sin compresión no hay bombas de descompresión |
| Sin tope de número de flujos ni de versiones; listados paginados (`limit` 1-100, 20 por defecto) | En v0 hay una sola instalación local. Las versiones solo crecen cuando alguien publica a mano y publicar sin cambios no crea ninguna |
| Orden del listado: `updatedAt` descendente y después `id`; versiones de la más nueva a la más antigua; paginación por `offset` con `total` | El editor muestra primero lo reciente y el `total` sirve para la UI. El desplazamiento de páginas con escrituras concurrentes se acepta en local |
| `DELETE` es un **borrado lógico**: el flujo desaparece del listado y da 404, su `id` queda reservado (409 `flow_id_reserved`), su numeración nunca se reinicia y sus versiones se conservan | Decisión del orquestador. La feature 6 fija sesiones a `(flowId, version)`: si borrar liberara el `id` o las versiones, una sesión en espera podría continuar con otro flujo con el mismo nombre o quedarse sin el suyo. Reservar el `id` para siempre es el precio |
| **Sin autenticación** en v0: solo loopback, `Host` local, sin `Origin`, sin CORS, y se niega a arrancar en otra interfaz | No hay sistema de usuarios en el plan. La única frontera es «solo esta máquina», y el DNS rebinding y el CSRF desde un navegador la saltarían. Bloquearlo de forma mecánica hace imposible exponerla por descuido |
| La base de datos caída da 503 en el CRUD, y `POST /flows/validate` sigue funcionando | Validar no necesita la base de datos. Un error claro («¿está levantado Postgres?») ahorra depurar un 500 |
| Sin `DATABASE_URL`, la API no arranca y nombra la variable | Fallar al arrancar es mejor que fallar en la primera petición. Nunca se imprime su valor |
| e2e contra Postgres real: `docker compose` en local y `services: postgres` en CI, con un esquema aislado por ejecución | Los dobles de base de datos esconden lo que esta feature debe probar: el orden de claves que `jsonb` rompería, la atomicidad del 412 y la numeración concurrente de versiones. Testcontainers añadiría una dependencia para lo mismo que ya da `services:` |
| `pnpm check` no necesita Postgres (los unit no tocan la base de datos); `pnpm test:e2e` sí | El Stop hook y el pre-push ejecutan `pnpm check` y no deben depender de que Docker esté levantado. La CI ejecuta los e2e |

### Qué ve cada consumidor

- **Feature 6 (conversaciones)**: arranca sesiones sobre una versión publicada `(flowId, version)` y la fija en la sesión, sin usar nunca el borrador. Como la versión es inmutable, una sesión en espera siempre continúa con el mismo flujo con el que empezó.
- **Feature 7 (chat de prueba)**: lista los flujos con `published=true` y conversa con la última versión, o con la que se elija. No ve borradores. Para probar cambios sin publicar está la vista previa del editor.
- **Feature 8 (editor)**: edita el borrador (`GET` + `PUT` con `If-Match`), muestra los avisos, publica, y enseña el historial de versiones en solo lectura. Para «restaurar» una versión, lee la versión y hace `PUT` de su contenido. La vista previa ejecuta el motor en el navegador con un host simulado (FOLLOW-UP 8.5 de `engine-llm` y 6.4 de `engine-http`).

### Formato de flujo

- **`packages/spec/flow.schema.json` no cambia** y no hay que regenerar los tipos.
- **`validateFlow` cambia**:
  - Añade `warnings` al resultado (aditivo). Ningún consumidor actual lo rompe: el motor solo lee `valid`, `flow` e `issues`.
  - Un flujo con más de 1000 niveles de anidamiento pasa a ser inválido. Es **BREAKING** solo para flujos que el motor ya rechazaba con el mismo issue, y ningún ejemplo se ve afectado.
- **Ejemplos**: `captacion-leads` y `faq-ia` siguen siendo válidos y no producen avisos (comprobado con `packages/spec/dist`, igual que todos los flujos de los escenarios).
- Se anota en `docs/rfcs/` como FOLLOW-UP: los avisos y su semántica de «origen escrito» de la `url`.

## Capabilities

### New Capabilities
- `flows-api`: guardar, listar, obtener, actualizar, publicar y borrar flujos en la API. Cubre la identidad, el borrador y las versiones inmutables, la concurrencia con `If-Match`, la paginación, los límites del cuerpo, la forma de los errores, la exposición solo local sin autenticación, la base de datos no disponible y la privacidad de los registros.
- `flow-validation`: lo que `validateFlow` de `@franca/spec` informa más allá de las reglas que ya fija `flow-engine`: los avisos (códigos, forma, orden y sus reglas), la profundidad máxima sin lanzar y el coste y el tamaño acotados del resultado con flujos inválidos.

### Modified Capabilities
- Ninguna. `flow-engine` no cambia: el motor ya rechaza los flujos de más de 1000 niveles con el mismo issue e ignora los avisos.

## Impact

- **`apps/api`**:
  - Módulo de flujos ampliado (controlador, servicio y acceso a datos), con Prisma y migraciones en `apps/api/prisma/`.
  - Filtro de excepciones global para la forma `{message, error}`, configuración del body parser (1 MiB, sin compresión) y guardas de `Host` y `Origin`.
  - `main.ts` lee `HOST` y `PORT` y valida `DATABASE_URL`.
  - El e2e actual de `POST /flows/validate` pasa a esperar `warnings: []`.
  - La generación del cliente de Prisma tiene que correr antes de `typecheck`, `build` y `test` (tarea de turbo).
- **`packages/spec`**:
  - Reglas de avisos, el tipo `FlowWarning` y la lista `FLOW_WARNING_CODES`, la profundidad máxima, el tope de issues y la validación de forma por piezas en `validateFlow`, con sus tests en `tests/` (incluidos los de tiempo con ~1 MiB inválido).
  - Test de paridad del límite de profundidad con el motor, en un fichero nuevo de `packages/engine/tests/` (sin tocar `packages/engine/src/`).
- **Raíz**: `docker-compose.yml`. `.github/workflows/ci.yml` con `services: postgres` y `DATABASE_URL` solo en el paso de `pnpm test:e2e`. `turbo.json` (tarea `db:generate` y variables que pasan a las tareas), `pnpm-workspace.yaml` (scripts de instalación de Prisma permitidos) y `CLAUDE.md` con las variables `DATABASE_URL`, `HOST` y `PORT` (solo nombres). Detalle en `design.md` (D1).
- **Meta**:
  - Actualizar la ficha `domain-flujos-sin-secretos` (aviso en la spec, rechazo del literal en la API) y `.claude/rules/backend/architecture.md` («aún no hay base de datos»).
  - Ficha nueva de wiki sobre `jsonb` y el orden de claves, con su test como enforcement.
  - El fichero de ejemplo de variables de entorno lo crea una persona, porque las guardas lo bloquean ([[harness-guard-env-falsos-positivos]]).
- **Dependencias nuevas**: Prisma (CLI y cliente) y el driver de Postgres en `apps/api`. Ninguna en los paquetes.
- **Sin cambios** en `packages/engine/src`, `packages/llm-anthropic` ni `apps/web`.

## Non-goals / Out of scope

- **Conversaciones y sesiones** (arrancar, continuar, custodiar el estado, hosts reales `http` y `llm`): feature 6.
- **UI**: el chat de prueba es la 7 y el editor visual, la 8. Tampoco se configura CORS para la web: lo decidirán 7 y 8 (proxy desde el servidor de Next o una lista explícita de orígenes, nunca `*`).
- **Autenticación, usuarios, propietarios y multi-tenant**: no hay owner ni tenant en los datos. Cuando lleguen, el owner sale del usuario autenticado (`.claude/rules/backend/architecture.md`) y habrá que migrar los flujos existentes.
- **Exposición pública o despliegue**: bloqueados hasta que exista autenticación.
- **Guardar borradores inválidos**, autoguardado en el servidor e historial de revisiones del borrador (solo hay versiones publicadas).
- **Despublicar, borrar o editar una versión concreta**, etiquetas de versión, comparar versiones y restaurar en el servidor.
- **Renombrar el `id`** de un flujo, importar en bloque, duplicar y buscar por texto.
- Papelera, restaurar un flujo borrado, retención y purga de los borrados.
- **Migración de flujos guardados** cuando cambie `specVersion`: FOLLOW-UP, cuando exista una 0.2.
- Avisos de `temperature` y de variables de `input` en `system`/`goal`, y las reglas pendientes de `invalid_http_config` (FOLLOW-UP 6.5 de `engine-http`): siguen pendientes.
- El aviso `ignored_field` y mostrar avisos en la CLI `franca-validate`: pasan a la feature 8.

## Plan de verificación por capas

- **Unit (aplica)**: cada regla de aviso de `packages/spec` en `tests/`, mutando `captacion-leads`, con los casos positivos, los negativos (sin marcador en el origen, `secretRef`) y el orden. También la profundidad (997/998 niveles y 5000 predicados sin lanzar), el tope de issues, el tiempo con ~1 MiB inválido y la configuración de arranque de la API (`HOST` y `PORT` permitidos y rechazados, `DATABASE_URL` ausente). Todo test negativo se valida haciendo fallar su fixture a propósito.
- **Golden/contractual (aplica, ligero)**: la forma exacta de cada cuerpo de respuesta y de error (`toEqual` con todas las claves) y el orden de claves del flujo devuelto (cabeceras `X-B` antes de `X-A`, claves `__proto__`). Es el test que fallaría con `jsonb`. No hay generador con baseline protegido.
- **Integración HTTP (aplica, el grueso)**: e2e con supertest contra Postgres real, por endpoint: happy path, 400, 404, 409, 412, 428, 413, 415 e `invalid_query`. Sin autenticación, en su lugar van `forbidden_host`, `forbidden_origin` y la ausencia de CORS. También concurrencia (dos `PUT` con la misma revisión y dos publicaciones simultáneas), 503 con la base de datos inaccesible y privacidad (registros sin cuerpos ni valores de cabecera).
- **E2E opción-al-menos-una-vez (no aplica)**: no hay UI en esta feature.
- **Smoke de ruta (no aplica)**: no hay páginas nuevas.
- **Paridad (aplica)**: el límite de profundidad de `@franca/spec` es igual a `MAX_NESTING_DEPTH` de `@franca/engine`, y el issue de profundidad es idéntico en los dos.
- **Mutación (no aplica)**: `packages/spec` no tiene arnés de mutación y las reglas son pocas y cortas. La disciplina de tests negativos cubre el riesgo.

## Riesgos

- **Sin autenticación**: cualquier proceso o usuario de la propia máquina puede leer, cambiar o borrar flujos. Se mitiga con loopback, `Host`, `Origin` y la negativa a arrancar en otra interfaz. Queda visible como deuda: ningún despliegue sin una feature de autenticación.
- **Rotura de la regla de profundidad**: solo afecta a flujos que el motor ya no ejecutaba.
- **Desplazamiento de páginas con `offset`** si alguien guarda mientras otro pagina. Aceptable en local.
- **Un `id` borrado queda reservado para siempre** y su contenido (borrador y versiones) sigue en la base de datos: para reutilizarlo hay que esperar a una purga (fuera de alcance). Se acepta: los `id` son baratos y la feature 6 necesita las versiones.
- **Avisos ruidosos** (`credential_header_not_secret` con un token que llega de una variable a propósito): son avisos, no bloquean.
- **Docker obligatorio para los e2e en local**: `pnpm check` no lo necesita, y los e2e fallan pronto con un mensaje claro si Postgres no responde.

## Preguntas abiertas (decididas con criterio; revisables)

- [x] ¿Una cabecera de credenciales con texto **sin marcador** (`"Bearer abc123"`) debería bloquear el guardado en la API? Decidido por el orquestador: sí, 400 `literal_credential` sin eco del valor; `validateFlow` lo informa con el aviso `credential_header_literal` y no cambia `valid`.
- [x] ¿Borrar libera el `id`? Decidido por el orquestador: no, borrado lógico con `id` reservado y versiones conservadas.
- [ ] ¿Hace falta un alias `GET /flows/:flowId/versions/latest` para el chat? Decidido: no. `latestVersion` viene en el resumen del flujo.
