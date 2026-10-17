# Design: API de conversaciones (`api-conversations`)

**Fecha**: 2026-10-17 · **Rama**: `feat/api-conversations` · Motivación y alcance en `proposal.md`; comportamiento en `specs/conversations-api/spec.md` y `specs/flows-api/spec.md` (mandan sobre este documento). Diseño con la spec tal como está: nodo `http` → `unsupported_node` (la feature del host `http` real sigue siendo una pregunta abierta al usuario). Antes de este diseño se corrigieron en la spec los huecos que destapó la auditoría (commit `spec(api): huecos de api-conversations…`, ver la tabla).

## Context

- **`apps/api`** (Nest 12 sobre Express 5, ESM, Prisma 7.10.1 con `@prisma/adapter-pg`): un módulo `flows` con `FlowsRepository` como único que habla con Prisma, transacciones interactivas `withLockedFlow` (`SELECT … FOR UPDATE`, `maxWait` 5 s, `timeout` 10 s), tiempos de `pg` en `src/prisma/limits.ts` (`query_timeout` 4 s, `statement_timeout` 3,5 s, conexión 5 s), clasificador `isDatabaseUnavailable`, frontera HTTP común (`configureApp`: `localOnly` → sin lecturas condicionales → `readJsonBody()` con 1 MiB → router → `ApiExceptionFilter`), `API_ERROR_CODES` cerrada, `CLOCK` inyectable (proveído dentro de `FlowsModule`, no exportado), `loadConfig` leído en `main.ts` antes de crear la app.
- **`@franca/engine`**: `startSession({flow, contact})` y `continueSession({flow, state, input})` devuelven `SessionResult | Rejection` y nunca rechazan; `EngineHost` con `llm?`/`http?` opcionales (sin `http`, un nodo `http` falla con `unsupported_node`); `createLlmCapability(providers)` enruta por nombre exacto y da `not_configured` si no hay proveedor; `SessionState.contact` lleva **todas** las variables de contacto declaradas (`null` sin valor); una espera en `llm` emite un evento `input` como una en `input`; un `llm` en espera no emite su coste (vive en `state.conversation.costUsd`). `@franca/engine/conformance` exporta `HOST_CONFORMANCE_CASES` y el contrato `HostConformanceHarness`.
- **`@franca/llm-anthropic`**: `createAnthropicClient(options)` (log apagado, trazas sin contenido) y `createAnthropicProvider({client})`, que siempre resuelve, acota cada turno a 60 s y da `not_configured` ante 401/403/404.

### Auditoría de la spec contra el código fusionado

| Lo que decía o se podía suponer | Lo que dice el código | Dónde se corrige |
|---|---|---|
| «`createAnthropicClient` con `apiKey` y `baseURL` explícitas basta para ignorar las variables del SDK» | El constructor del SDK 0.135.0 (`client.js`) lee `ANTHROPIC_AUTH_TOKEN` si `authToken` es `undefined` (y la envía como `Authorization: Bearer`), y `ANTHROPIC_CUSTOM_HEADERS` siempre | D9: `authToken: null` explícito. `ANTHROPIC_CUSTOM_HEADERS` queda como riesgo y FOLLOW-UP de `llm-anthropic` (la spec solo nombra tres variables) |
| 64 KiB en dos rutas | `readJsonBody()` es un middleware global que lee hasta 1 MiB **antes** del router; el 413 tiene un único mensaje fijo por código («… de 1 MiB») y el filtro recalcula el mensaje desde el código | D13: límite por ruta dentro de `readJsonBody` y mensaje del máximo en el 413 |
| 412 `revision_mismatch` reutilizable tal cual | Su mensaje es «el borrador ha cambiado» y lo fija `api-exception.filter.spec.ts` | D13: mismo código, mensaje propio de la conversación |
| El motor podría correr dentro de la transacción que reclama | Una transacción interactiva caduca a los 10 s (`P2028`, 500) y retiene una conexión del pool; un avance con turnos `llm` dura hasta ~150 s | D4: el motor corre sin transacción ni conexión abiertas |
| El arnés de conformidad arranca sesiones por `flowId` | `ConformanceSessions.start(flow)` recibe el **flujo**; `una-continuacion` y `reclamacion-caducada` usan el mismo `id` (`llm-email`) | D16: el arnés crea y publica por HTTP, y `reset()` vacía la base entre casos |
| `deepEqual` del motor para comparar valores de contacto | Es interno (`src/json.ts`, no exportado) | D11: comparación propia en la API, con test |
| Un lector de versiones nuevo en `flows` | `FlowsRepository.findVersion` ya no filtra borrados, pero `FlowsModule` no exporta el repositorio | D2/D5: lector de solo lectura dentro del módulo nuevo, sin tocar `flows` |
| Clave foránea `conversations → flow_versions` | `resetDatabase` (`test/helpers/database.ts`) y `database.e2e-spec.ts` hacen `TRUNCATE flow_versions, flows` sin `CASCADE`: con cualquier FK hacia esas tablas, Postgres rechaza el `TRUNCATE` y caen los e2e existentes | D2: sin FK hacia `flows`; integridad por la aplicación (las versiones nunca se borran) |
| `parseListQuery` sirve para `GET /conversations` | También valida `published`, que en conversaciones es un parámetro desconocido (se ignora) | D13: se le pasan solo `limit` y `offset` |
| `createTestApp` fija el reloj escalonado | Lo hace con `overrideProvider(CLOCK)` antes de `configure`, y la última sustitución gana (mapa por token) | D16: los e2e sustituyen `CLOCK` por un reloj manual desde `configure`, sin tocar el helper |
| `REQUEST_TIMEOUT_MS` (30 s) cortaría un avance de 150 s | `server.requestTimeout` mide la **recepción** de la petición, no la respuesta | D15: se comprueba con un e2e (plazo de recepción de 1 s y un avance de 2 s reales → 200) |
| `pnpm check` en verde en la rama | Desde el commit de la spec (`65d2aa4`), `test/spec-coverage.spec.ts` falla en un caso: el escenario «Errores de las conversaciones» del delta de `flows-api` no tiene `it` (ejecutado el 2026-10-17: 1 fallo, 144 en verde) | tasks: los gates de las fases 1 y 2 lo admiten como único fallo; se cierra en 3.9 |
| Spec: escenarios con títulos repetidos | «Valores no admitidos» dos veces en `conversations-api` (el test de cobertura falla), y cuatro títulos iguales a otros de `flows-api`/`flow-engine` (un `it` ajeno los cubriría en falso) | Spec: renombrados |
| Spec: el borrado gana a un avance en curso | Una **creación** con turnos `llm` es un avance de hasta 90 s sin fila todavía: un `DELETE /contacts` durante ella no tenía efecto y la creación volvería a escribir lo borrado | Spec: requisito «Borrado durante la creación»; D5, D7 |
| Spec: solo `invalid_state`/`state_mismatch` dan 500 | El motor también puede rechazar con `session_not_active` (fila y estado incoherentes), un estado guardado que no es JSON hace lanzar a `JSON.parse`, y `startSession` da `invalid_contact` con un valor de contacto alterado | Spec: «Estado guardado que el motor rechaza» ampliado, con escenario de `invalid_contact` |

## Goals / Non-Goals

**Goals:**
- Cumplir los 48 requisitos de `conversations-api` y los dos `MODIFIED` de `flows-api` con un módulo nuevo `src/conversations/`, sin cambiar el comportamiento de `flows` ni sus tests, y sin tocar `packages/*/src`.
- Ninguna conexión de base de datos ni transacción abierta mientras corre el motor.
- `pnpm check` sin Postgres ni red; ningún test llama a Anthropic.

**Non-Goals:**
- Interfaces con token para servicio o repositorio: un consumidor, y los tests sustituyen clases o tokens con `overrideProvider`.
- Barridos periódicos (caducidad, reclamaciones huérfanas, purga): todo lo temporal se **deriva** al leer (D3, D10).
- Colas, cachés, workers, SSE: ningún requisito los pide.

## Decisions

### D1. Estructura y ficheros que abre el cambio

| Ruta | Estado | Contenido |
|---|---|---|
| `apps/api/src/conversations/conversations.module.ts` | nuevo | controladores, servicio, repositorio, `CLOCK`, `CONVERSATIONS_CONFIG`, `LLM_PROVIDERS`, línea de arranque (D9) |
| `…/conversations.controller.ts`, `contacts.controller.ts` | nuevos | rutas (D13), delegan en el servicio |
| `…/conversations.service.ts` | nuevo | casos de uso en el orden de la spec (D5, D6, D7) |
| `…/conversations.repository.ts` | nuevo | único acceso a Prisma del módulo, incluido el lector de versiones (D2, D4) |
| `…/conversation-body.ts`, `conversation-params.ts`, `conversation-query.ts` | nuevos | parsers puros (D13) |
| `…/conversation-resources.ts` | nuevo | fila → recurso, estado derivado, transcripción (D3, D12) |
| `…/conversation-timing.ts` | nuevo | `CLAIM_TTL_MS`, `LLM_WINDOW_MS`, `MAX_SESSION_TIMEOUT_MINUTES`, `expiresAtOf`, `isClaimActive` (D4, D10) |
| `…/contact-values.ts` | nuevo | vista inicial, diferencia y comparación JSON (D11) |
| `…/advance-llm.ts`, `engine-host.ts` | nuevos | capacidad `llm` de un avance y host sin `http` (D8) |
| `…/llm-providers.ts`, `conversations-config.ts` | nuevos | proveedor `principal` y configuración (D9) |
| `…/*.spec.ts` de cada pieza pura | nuevos | unit (D16) |
| `apps/api/src/http/body-limits.ts` (+ `spec`) | nuevo | `MAX_CONVERSATION_BODY_BYTES`, `bodyLimitFor` (D13) |
| `apps/api/prisma/migrations/<ts>_conversations/migration.sql` | nuevo | D2 |
| `apps/api/test/conversations-*.e2e-spec.ts`, `test/helpers/conversations*.ts` | nuevos | D16 |

**Ficheros existentes que se modifican (10 contando el lockfile, más los de meta):**

| Fichero | Cambio | Por qué no se puede evitar |
|---|---|---|
| `apps/api/src/app.module.ts` | importar `ConversationsModule` | registro del módulo (una línea) |
| `apps/api/src/main.ts` | `readConfig` llama también a `loadConversationsConfig` | un presupuesto inválido debe impedir arrancar **antes** de abrir el puerto, como `HOST`; un error en una factoría de Nest saldría con traza y tras crear la app |
| `apps/api/src/http/api-error.ts` | 8 códigos nuevos con estado y mensaje; `payloadTooLarge(limitBytes)` | `API_ERROR_CODES` es la lista cerrada del contrato (lo pide la proposal) |
| `apps/api/src/http/json-body.ts` | elige el lector de body-parser según `bodyLimitFor` y crea el 413 con `payloadTooLarge` | el cuerpo se lee antes del router: el 413 de 64 KiB debe salir antes que el 415 y `invalid_json` |
| `apps/api/prisma/schema.prisma` | modelos y enums nuevos al final (aditivo) | el esquema de Prisma es uno |
| `apps/api/package.json` | `@franca/engine` y `@franca/llm-anthropic` como `workspace:*` | dependencias del módulo |
| `apps/api/test/spec-coverage.spec.ts` | una entrada `conversations-api` en `capabilities` | el test único de cobertura de escenarios (una línea) |
| `turbo.json` | `FRANCA_ANTHROPIC_API_KEY` y `FRANCA_CONVERSATION_COST_LIMIT_USD` en `passThroughEnv` de `@franca/api#dev` | [[gotcha-turbo-filtra-variables-de-entorno]] |
| `CLAUDE.md` | nombres de las dos variables y que la API ignora `ANTHROPIC_API_KEY` | lo pide la proposal |
| `pnpm-lock.yaml` | dependencias de espacio de trabajo | generado |
| `apps/api/src/http/api-exception.filter.ts` | **no se toca** | el mensaje propio viaja en `extra.message` (D13) |

Meta: fichas de wiki nuevas (D16) y sus líneas en `.claude/rules/always/knowledge-wiki.md`; `.claude/rules/backend/architecture.md` (un repositorio por módulo; el patrón de reclamación) y `.claude/rules/backend/routes-and-errors.md` (los cuerpos de conversaciones también con parser puro). Ningún fichero de `src/flows/`, de `src/prisma/`, de `test/helpers/` existentes ni de otro paquete cambia. Criterio de aceptación de la fase 4: `git diff --stat main...HEAD` no lista nada fuera de esta sección.

Importaciones de solo lectura desde `flows` (sin tocarlos): `CLOCK`/`Clock`/`systemClock` (`flows/clock.ts`), `matchesIfMatch`/`etagOf` (`flows/if-match.ts`), `parseFlowId`/`MAX_VERSION` (`flows/flow-params.ts`), `parseListQuery`/`Page`/`toPage` (`flows/list-query.ts`, `flows/flow-resources.ts`).

### D2. Modelo de datos y migración

```prisma
enum ConversationStatus {
  waiting
  ended
  failed
  @@map("conversation_status")
}

enum TranscriptRole {
  user
  flow
  @@map("transcript_role")
}

model Contact {
  id            String         @id @map("contact_id")         // COLLATE "C" en la migración
  epoch         String         @db.Uuid                       // cambia si el contacto se borra y se vuelve a crear (D7)
  values        ContactValue[]
  conversations Conversation[]
  @@map("contacts")
}

model ContactValue {
  contactId String  @map("contact_id")                         // COLLATE "C"
  name      String                                             // COLLATE "C"; puede ser `__proto__`
  valueJson String  @map("value_json")                         // JSON.stringify del valor (nunca null: «sin valor» borra la fila)
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@id([contactId, name])
  @@map("contact_values")
}

model Conversation {
  id                 String              @id @db.Uuid
  flowId             String              @map("flow_id")       // COLLATE "C"; sin FK (ver abajo)
  version            Int
  contactId          String?             @map("contact_id")    // COLLATE "C"
  status             ConversationStatus                        // `expired` se deriva (D10)
  revision           Int
  state              String?                                   // JSON.stringify(SessionState); solo en waiting (D3)
  pendingInputJson   String?             @map("pending_input_json")
  outcome            String?
  errorCode          String?             @map("error_code")
  errorNodeId        String?             @map("error_node_id")
  costUsd            Float               @map("cost_usd")      // double precision
  costLimitReached   Boolean             @map("cost_limit_reached")
  transcriptLength   Int                 @map("transcript_length")
  claimToken         String?             @map("claim_token") @db.Uuid
  claimedAt          DateTime?           @map("claimed_at") @db.Timestamptz(3)
  createdAt          DateTime            @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime            @map("updated_at") @db.Timestamptz(3)
  expiresAt          DateTime?           @map("expires_at") @db.Timestamptz(3)
  contact            Contact?            @relation(fields: [contactId], references: [id], onDelete: Cascade)
  entries            ConversationEntry[]
  @@index([updatedAt(sort: Desc), id])
  @@index([contactId])
  @@map("conversations")
}

model ConversationEntry {
  conversationId String         @map("conversation_id") @db.Uuid
  seq            Int
  at             DateTime       @db.Timestamptz(3)
  role           TranscriptRole
  payload        String                                       // JSON.stringify del input o del evento
  conversation   Conversation   @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  @@id([conversationId, seq])
  @@map("conversation_entries")
}
```

- **Todo lo JSON es `text` con un único `JSON.stringify`** (estado, entrada, eventos, valores de contacto, `pendingInput`): conserva el orden de las claves y las claves `__proto__`, y su texto es UTF-8 válido sin NUL ([[gotcha-jsonb-reordena-claves]]). El estado admite los 1001 niveles de `parseState` (`JSON.stringify` aguanta ~10 000). `outcome`, `errorNodeId` y `flowId` cumplen el patrón de `id` de la spec y van como texto plano.
- **`COLLATE "C"` a mano** en `conversations.flow_id`, `contacts.contact_id`, `contact_values.contact_id`, `contact_values.name` y `conversations.contact_id` ([[gotcha-prisma-no-modela-colacion]]): igualdad byte a byte y las dos puntas de cada FK con la misma colación. El test de columnas nuevo (`conversations-database.e2e-spec.ts`) lo comprueba.
- **`id` como `uuid`** generado por la API (`randomUUID()` de `node:crypto`, v4 en minúsculas). El orden «`id` ascendente» del listado sobre `uuid` coincide con el del texto hexadecimal en minúsculas (Postgres compara los 16 bytes). El parámetro de ruta se valida antes de llegar a la base, así que un texto que no es UUID nunca produce `22P02` (500).
- **Sin FK hacia `flows`/`flow_versions`** (alternativa descartada: FK `(flow_id, version)` con `RESTRICT`). La FK haría fallar el `TRUNCATE flow_versions, flows` de `resetDatabase` y de `database.e2e-spec.ts` (Postgres exige truncar en el mismo comando las tablas que referencian), y habría que tocar dos ficheros de test ajenos. La integridad la da la aplicación: la conversación se inserta tras leer su versión, y las versiones nunca se borran (borrado lógico de flujos y `onDelete: Restrict`).
- **FK en cascada dentro del módulo**: `conversation_entries → conversations`, `contact_values → contacts` y `conversations.contact_id → contacts`. Así `DELETE /contacts/:id` es un único `DELETE FROM contacts` que se lleva valores, conversaciones y transcripciones (D7), y una conversación con `contactId` siempre tiene su fila de contacto.
- **Enums de Prisma** para `status` y `role` (Postgres los modela y `migrate diff` no ve deriva); sin `CHECK` a mano, que Prisma no modela.
- **Índices**: claves primarias; `(updated_at DESC, id)` para el listado; `(contact_id)` para la cascada. Sin índice por `flow_id` (una instalación local).
- **`cost_usd` en `double precision`**: es la suma de números de JS y vuelve idéntica (la spec compara con tolerancia 1e-12).
- **Migración**: `pnpm --filter @franca/api db:migrate:dev --name conversations --create-only`, añadir los `COLLATE "C"`, revisar el SQL, `db:migrate`; el `globalSetup` de los e2e la aplica desde cero y comprueba la deriva con `migrate diff --exit-code`.

### D3. Qué se guarda de una conversación según su estado

| `status` guardado | `state` | `pendingInputJson` | `outcome` / `error*` | `expiresAt` |
|---|---|---|---|---|
| `waiting` | texto del estado | el último evento `input` del avance | `null` | `updatedAt` + plazo (D10) |
| `ended` | `null` | `null` | `outcome` del `end` | `null` |
| `failed` | `null` | `null` | `error.code`, `error.nodeId` | `null` |

- El estado se descarta al terminar o fallar (minimización; requisito «Datos personales de una conversación»).
- **Se derivan al leer**, con `clock.now()`: `status` `expired` = guardado `waiting` y `now >= expiresAt` (entonces `pendingInput` es `null`); `processing` = `claimToken` no nulo y `now - claimedAt < CLAIM_TTL_MS`. Alternativa descartada: un barrido que marque caducadas o libere reclamaciones (un proceso más, y un hueco entre que vence y se barre). El listado filtra lo derivado en SQL con el mismo `now` (D10).
- Una conversación caducada conserva su estado hasta que se borra (sin purga en v0, FOLLOW-UP).

### D4. Reclamación: el motor fuera de toda transacción

Tres pasos cortos alrededor del motor:

1. **Reclamar** (transacción interactiva de milisegundos, `withLockedConversation(id, fn)`, mismo patrón que `withLockedFlow`): `SELECT … FROM conversations WHERE id = $1::uuid FOR UPDATE`; el servicio decide en el orden de la spec (404 → 412 → 409 `conversation_expired`/`conversation_not_active` → 409 `conversation_busy` si `isClaimActive`) y, si pasa, `UPDATE … SET claim_token = <uuid nuevo>, claimed_at = now` y lee la `definition` de su versión en la misma transacción.
2. **Ejecutar el motor** sin transacción y sin conexión retenida: el pool de `pg` no se agota con avances largos, y la transacción interactiva no caduca (10 s) con turnos `llm` de hasta 60 s.
3. **Aplicar** (otra transacción corta): bloquea primero la fila del contacto, si hay (D7), después la conversación con `FOR UPDATE`; si la fila no existe → se descarta y 404 `conversation_not_found`; si `claim_token` no es el propio o `now - claimed_at >= CLAIM_TTL_MS` → se descarta entero (estado, eventos, coste, contacto) y 409 `conversation_busy`; si no, escribe todo y pone `claim_token`/`claimed_at` a `null` en el mismo `UPDATE`.

- **`CLAIM_TTL_MS` = 300 000**, medidos con `CLOCK`. Un rechazo del motor (`invalid_input`, `invalid_flow`, estado rechazado) o un error inesperado antes de aplicar **libera** la reclamación con `UPDATE … SET claim_token = NULL WHERE id = $1 AND claim_token = $2` (si esa liberación falla, se ignora y gana el error original; caduca sola). Un fallo **al aplicar** no la libera: no se sabe si el `COMMIT` llegó, y la entrada se repite cuando caduca (escenario «Fallo al guardar un avance»).
- Por qué un testigo y no comparar `revision`: dos reclamaciones sucesivas de la misma revisión (la primera caducada) se distinguen; un resultado tardío nunca se aplica aunque nadie haya vuelto a reclamar.
- Tiempos de `pg` ([[gotcha-pg-query-timeout-duplica-con-rollback]]): cada paso tiene como mucho tres o cuatro sentencias, cada una acotada por `statement_timeout` 3,5 s y `query_timeout` 4 s; una fila bloqueada por otro y que no se suelta da 503 en ~3,6 s; una base muda, 503 en 8 s. No cambia ningún tiempo de `src/prisma/limits.ts`.

### D5. Crear una conversación (`POST /conversations`)

1. `@JsonBody()` (413/415/`invalid_json`, D13) → `parseCreateBody` (400 `invalid_request`) → `parseFlowId` (404 `flow_not_found`).
2. Lector de versiones (sin transacción): flujo vivo (`deleted_at IS NULL`) o 404 `flow_not_found`; sin `version`: `latest_version` o 409 `flow_not_published`; con `version`: la fila de `flow_versions` o 404 `version_not_found`.
3. Con `contactId`: `INSERT INTO contacts (contact_id, epoch) VALUES ($1, $2::uuid) ON CONFLICT (contact_id) DO UPDATE SET epoch = contacts.epoch RETURNING epoch` (asegura la fila y devuelve su `epoch` en una sentencia) y lectura de **todos** sus valores (el motor ignora los no declarados; el número de nombres de contacto de una instalación es pequeño).
4. `id = randomUUID()`, `startedAt = now`, host (D8) y `startSession({ flow: JSON.parse(definition), contact: Object.fromEntries(valores) })`.
5. Rechazo `invalid_flow` → 409 `flow_version_invalid` con `issues` (ya recortados por `validateFlow`); `invalid_contact` → registro y 500 (D14).
6. Éxito → transacción de inserción: con contacto, `SELECT epoch FROM contacts … FOR UPDATE`; ausente o distinto del leído en 3 → se descarta y 404 `conversation_not_found` («Borrado durante la creación»). Después `SELECT deleted_at FROM flows WHERE id = $1 FOR SHARE` (espera a un borrado en curso, que toma `FOR UPDATE`); borrado → se descarta y 404 `flow_not_found`. Si no, inserta la conversación (`revision` 1, `createdAt` = `updatedAt` = `now` de este paso), sus entradas y los cambios de contacto (D11).
7. 201 con `Location`, `ETag: "1"` y `{conversation, events}`; si falló con `llm_not_configured`, aviso en el registro (D14).

- Una creación con `flow_version_invalid` o que falla después del paso 3 deja la fila `contacts` vacía (solo el `contactId` opaco y su `epoch`). Se acepta: no es un dato personal por diseño y la supresión la borra (FOLLOW-UP de purga). Alternativa descartada: no asegurar la fila hasta el final; entonces un `DELETE /contacts` en mitad de la creación de un contacto nuevo no se detectaría.

### D6. Enviar una entrada (`POST /conversations/:conversationId/inputs`)

| Paso | Respuesta si falla |
|---|---|
| `@JsonBody()` | 413 (64 KiB), 415, 400 `invalid_json` |
| `parseInputBody`: objeto plano con la propiedad propia `input` (cualquier valor, también `null`); el resto se ignora, `state` incluido | 400 `invalid_request` |
| `parseConversationId`: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` | 404 `conversation_not_found` |
| Reclamar (D4): fila, `If-Match`, estado, reclamación activa | 404, 412 `revision_mismatch` (`currentRevision`, `ETag`), 409 `conversation_expired` / `conversation_not_active`, 409 `conversation_busy` |
| `JSON.parse(state)` (si lanza, se trata como `invalid_state`) y `continueSession` con el host del avance (D8) | 409 `flow_version_invalid` (`issues`), 400 `invalid_input`, 500 (D14); los tres liberan la reclamación |
| Aplicar (D4) | 404 (borrada durante el avance), 409 `conversation_busy` (reclamación perdida), 503 |
| — | 200 `{conversation, events}` con `ETag` de la nueva `revision` |

El avance aplicado suma 1 a `revision`, fija `updatedAt` y renueva `expiresAt` (también un reintento por respuesta inválida, que el motor devuelve como éxito). `If-Match` reutiliza `matchesIfMatch` (`*`, lista, solo etiquetas fuertes).

### D7. Borrados que ganan y orden de los bloqueos

- `DELETE /conversations/:id` → `DELETE FROM conversations WHERE id = $1::uuid` (cascada a la transcripción); 0 filas → 404. No espera a ninguna reclamación: el paso «aplicar» de un avance en curso ya no encuentra la fila y responde 404.
- `DELETE /contacts/:contactId` → `DELETE FROM contacts WHERE contact_id = $1` (cascada a valores, conversaciones y transcripciones); 204 exista o no. Un avance en curso de esas conversaciones no encuentra su fila; una creación en curso ve el `epoch` ausente o cambiado (D5).
- **Orden fijo de bloqueos**: contacto → conversación; y en la creación, contacto → flujo. `DELETE /contacts` bloquea el contacto y después, por la cascada, sus conversaciones; «aplicar» bloquea el contacto antes que la conversación; reclamar y `DELETE /conversations` solo bloquean la conversación; el borrado de un flujo solo bloquea el flujo. Sin ciclos. Si «aplicar» bloqueara la conversación primero, la cascada del borrado de contacto y la comprobación de FK (`FOR KEY SHARE` sobre el contacto al escribir `contact_values`) formarían un ciclo: Postgres abortaría una con `40P01` (un 500). Lo protege el e2e «borrar un contacto mientras se aplica un avance» con barrera.
- Si una entrada se aplica antes de que llegue el borrado, el borrado espera milisegundos al `COMMIT` y borra lo aplicado: la supresión sigue siendo completa.

### D8. Host del motor: capacidad `llm` de un avance y sin `http`

`buildEngineHost(llm)` devuelve `{ llm }`: **sin la propiedad `http`**, así un nodo `http` falla con `unsupported_node` y no hay secretos ni conexiones salientes que resolver (unit test: el host no tiene la clave `http`). Alternativa descartada: un `http` que responda `blocked` (llevaría el flujo por `onError` y mentiría al usuario; proposal).

`createAdvanceLlm({ providers, now, startedAtMs, budgetUsd, priorCostUsd })` → `{ capability, spentUsd(), limitReached() }`, una por avance (también en la creación). Por cada turno, en este orden:

1. `providers` no tiene `request.provider` → `{kind: "not_configured"}` sin tocar presupuesto ni plazo (es configuración; el motor falla con `llm_not_configured`).
2. `now() - startedAtMs >= LLM_WINDOW_MS` (90 000) → `{kind: "failed", costUsd: 0}` sin llamar.
3. `priorCostUsd + spent >= budgetUsd` → `{kind: "failed", costUsd: 0}` sin llamar, y `limitReached` pasa a `true`.
4. Si no, `await routed(request)` con `routed = createLlmCapability(providers)` (la composición del motor) y, del resultado, se lee **una vez** `kind` y `costUsd` (dentro de `try`): con `kind` `turn`/`refusal`/`failed` y un coste finito ≥ 0, `spent += costUsd`. El resultado se devuelve **tal cual**: el motor sigue siendo quien decide si es válido.

- La capacidad no captura el rechazo de un proveedor ni lo registra: el motor lo convierte en `llm_host_error` («el proveedor provee, el consumidor decide»). El adaptador real nunca rechaza.
- Nada de esta capa registra nada (requisito «registros de llm»): ni peticiones, ni resultados, ni errores.
- El coste de la conversación es `priorCostUsd + spentUsd()` (el evento `llm` no basta: un `llm` en espera no lo emite). `costLimitReached` se queda en `true` una vez puesto.
- Peor caso de un avance: el último turno empieza antes de los 90 s y el adaptador lo corta a los 60 s, ~150 s < `CLAIM_TTL_MS`.

### D9. Proveedor de Claude y configuración

- `conversations-config.ts`: `loadConversationsConfig(env)` → `{ anthropicApiKey: string | null, costLimitUsd: number }` y token `CONVERSATIONS_CONFIG`. Reutiliza `ConfigError` de `config/app-config.ts` (importa; no lo cambia), así `main.ts` lo trata igual que `HOST`. `FRANCA_ANTHROPIC_API_KEY` ausente o `""` → `null`; si no, el texto tal cual (nunca se registra). `FRANCA_CONVERSATION_COST_LIMIT_USD` ausente → 0.5; definida debe cumplir `^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$` («dígitos y como mucho un punto»: `0.5`, `2`, `.5`, `5.`) y quedar en `(0, 1000]`; si no, `ConfigError` que nombra la variable sin el valor (`""`, `" 1"`, `1e3`, `-1`, `abc`, `0`, `1001`, `.`).
- `llm-providers.ts`: `ANTHROPIC_API_URL = 'https://api.anthropic.com'`; `createPrincipalClient(apiKey)` = `createAnthropicClient({ apiKey, authToken: null, baseURL: ANTHROPIC_API_URL })` (`authToken: null` explícito: si no, el SDK lee `ANTHROPIC_AUTH_TOKEN`); `createLlmProviders(config)` → `Map` vacío sin clave, o `Map([['principal', createAnthropicProvider({ client })]])` con las demás opciones por defecto del adaptador. Token `LLM_PROVIDERS` (los tests lo sustituyen). Construir el cliente no abre conexiones.
- **Línea de arranque**: `ConversationsModule` (`OnApplicationBootstrap`) registra con `Logger('Conversations')` «proveedor llm principal: Claude» o «sin proveedor llm principal: falta FRANCA_ANTHROPIC_API_KEY; los nodos llm fallarán con llm_not_configured». Nunca la clave.
- `turbo.json`: las dos variables en `passThroughEnv` de `@franca/api#dev` (no en `test:e2e`: así una clave de la shell nunca llega a los e2e; los de arranque pasan su entorno a mano). `CLAUDE.md`: nombres y que la API no lee `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` ni `ANTHROPIC_BASE_URL`. El fichero de ejemplo de variables lo actualiza una persona ([[harness-guard-env-falsos-positivos]]).

### D10. Caducidad

- `expiresAtOf(updatedAt, flow)` = `updatedAt + min(settings.sessionTimeoutMinutes ?? 1440, 525600) × 60 000` ms, calculado tras un avance aplicado con el flujo que el motor acaba de aceptar (el `1e300` del escenario es un entero válido para el esquema).
- Caducada si `now >= expiresAt` (en `T + 30 min` ya caduca; en `T + 29:59` no). La entrada a una caducada da 409 `conversation_expired` sin escribir nada; el `GET` la muestra `expired` con el mismo `expiresAt`.
- Listado: `status=waiting` → `status = 'waiting' AND expires_at > now`; `status=expired` → `status = 'waiting' AND expires_at <= now`; `ended`/`failed` tal cual. Orden `updated_at DESC, id ASC` (caducar no cambia `updatedAt`).

### D11. Valores de contacto (`contact-values.ts`)

- **Vista inicial al crear** (la que el motor construye en `createVariableStore`): para cada variable `scope: contact` de la versión (primera declaración por nombre), el valor guardado o, si no hay, su `default`, o `null`.
- **Antes de un avance de entrada**: `state.contact` del estado guardado (lleva todas las de contacto, `null` sin valor).
- **Cambios** = cada nombre de `result.state.contact` cuyo valor difiere del de antes (comparación estructural JSON propia, `jsonEqual`, sin importar el orden de las claves, con `Object.keys`/`Object.hasOwn`): valor → `upsert` de `contact_values` (`value_json = JSON.stringify(valor)`); `null` → `DELETE` de esa fila. Lo no cambiado no se escribe (dos conversaciones del mismo contacto no se pisan), y un `default` igual al inicial no se guarda. No se comprueba el `type`.
- **Nombres como `__proto__`**: los objetos vienen de `JSON.parse` o de `Object.fromEntries` (propiedades propias); se recorren con `Object.keys` y se construyen con `Object.fromEntries`, nunca con `obj[name] = v` ([[gotcha-variables-nombre-proto]]). El nombre es una columna `text`.
- Los valores que se inyectan son siempre valores que produjo el motor (≤ 999 niveles dentro de un estado de ≤ 1001), así que `checkContact` los acepta; uno alterado a mano da `invalid_contact` (D14).

### D12. Transcripción

- En cada avance aplicado, `transcript_length` (bajo el bloqueo) da los `seq` siguientes: primero la entrada del usuario si la hay (`role` `user`, `payload = JSON.stringify(input)`, la forma JSON de lo que llegó), después cada evento (`role` `flow`, `payload = JSON.stringify(evento)`), todos con `at` = el `now` del paso «aplicar». Una entrada aceptada por el motor es un objeto de una sola propiedad (texto o lista de ids acotada por las opciones del nodo), así que su `JSON.stringify` nunca desborda la pila.
- `GET …/transcript`: `parseListQuery({limit, offset})` → 404 si la conversación no existe → `findMany` por `(conversation_id, seq)` con `skip`/`take`; `total = transcript_length`. Cada item, con las claves en este orden: `{seq, at, role: "user", input}` o `{seq, at, role: "flow", event}`.
- Rechazos y avances descartados no escriben nada (todo va en la transacción de «aplicar»).

### D13. Frontera HTTP: cuerpos, parámetros y códigos

- **64 KiB por ruta**: `http/body-limits.ts` exporta `MAX_CONVERSATION_BODY_BYTES = 65_536` y `bodyLimitFor(method, path)`: 65 536 si `method === 'POST'` y `path` cumple `/^\/conversations(?:\/[^/]+\/inputs)?\/?$/i` (el router de Express no distingue mayúsculas ni la barra final), 1 MiB en el resto. `readJsonBody` crea dos lectores `express.raw` (uno por límite) y elige por petición; el 413 sale de `payloadTooLarge(limit)`: con 1 MiB, exactamente la `ApiException('payload_too_large')` de hoy (los tests de flujos no cambian); con 64 KiB, la misma con `extra.message` «el cuerpo supera el tamaño máximo de 64 KiB». El constructor y el filtro esparcen `extra` después de `message`, así que el mensaje se sustituye sin tocar el filtro; un unit test nuevo fija ese contrato con `toErrorResponse`.
- **412 de una conversación**: `ApiException('revision_mismatch', { message: 'la conversación ha cambiado', currentRevision }, { ETag })`; el orden de las claves sigue siendo `message`, `error`, `currentRevision`.
- **Parsers puros**, no `ValidationPipe` (mismas razones que D6 de `api-flows`: dependencias nuevas, otra forma de error, sin rechazo de repetidos); se actualiza la excepción en `.claude/rules/backend/routes-and-errors.md`.
  - `parseCreateBody(body)`: objeto plano (no array ni `null`); `flowId` string propia; `version` ausente/`null` o entero de 1 a `MAX_VERSION`; `contactId` ausente/`null` o string con `^[A-Za-z0-9_-]{1,64}$`. Cualquier fallo → `invalid_request`. Después, `parseFlowId(flowId)` (404).
  - `parseContactId` (ruta de `DELETE /contacts`): mismo patrón o 400 `invalid_request`.
  - `parseConversationListQuery(query)`: `flowId` (string con el patrón de `schema.$defs.id.pattern`), `status` (`waiting|ended|failed|expired`); un array (parámetro repetido) o un valor fuera → `invalid_query`; `limit`/`offset` con `parseListQuery({ limit: query.limit, offset: query.offset })`. El resto se ignora.
- **Rutas** (específicas antes que de parámetro): `POST /conversations`, `GET /conversations`, `GET /conversations/:conversationId`, `DELETE /conversations/:conversationId`, `POST /conversations/:conversationId/inputs`, `GET /conversations/:conversationId/transcript`, `DELETE /contacts/:contactId`. `localOnly` y la tubería común las cubren sin cambios. En las lecturas con consulta, la consulta se valida antes que el `id` (como `GET /flows/:flowId/versions`).
- **Códigos nuevos** en `API_ERROR_CODES` (estado, mensaje): `invalid_request` (400, «el cuerpo de la petición no es válido»), `invalid_input` (400, «la entrada no tiene la forma que pide la conversación»), `conversation_not_found` (404, «conversación no encontrada»), `flow_not_published` (409, «el flujo no tiene ninguna versión publicada»), `flow_version_invalid` (409, «la versión ya no es válida con el validador vigente»), `conversation_busy` (409, «la conversación está procesando otra entrada»), `conversation_not_active` (409, «la conversación ya terminó»), `conversation_expired` (409, «la conversación caducó por inactividad»).

### D14. Rechazos del motor, errores y registros

| Resultado del motor | Respuesta | Registro |
|---|---|---|
| `invalid_flow` | 409 `flow_version_invalid` con `issues` | — |
| `invalid_input` | 400 `invalid_input` | — |
| `invalid_state`, `state_mismatch`, `session_not_active` (continuar) / `invalid_contact` (crear) | 500 `internal_error` | `error`: «conversación <id>: el motor rechazó lo guardado (<código>)» + la línea 500 del filtro |
| éxito con `failed` y `llm_not_configured` | 201/200 | `warn`: «conversación <id>: llm_not_configured en el nodo <nodeId>, proveedor <JSON.stringify(provider)>» (el `provider` del nodo de la versión; `JSON.stringify` evita inyectar saltos de línea) |

- Nada más se registra: ni entradas, ni eventos, ni variables, ni valores de contacto (requisito «Privacidad de los registros de conversaciones»). Los 5xx siguen pasando por `ApiExceptionFilter` (método, ruta con el `id` opaco, código). Los 503 salen de `isDatabaseUnavailable` como en `flows`.

### D15. Reloj y tiempos

- `ConversationsModule` provee su propio `{ provide: CLOCK, useValue: systemClock }` con el símbolo de `flows/clock.ts`. Cada paso toma **un** `now`: el de «aplicar» es `updatedAt`, `at` de las entradas y base de `expiresAt` (`createdAt = updatedAt` al crear).
- `startedAtMs` del plazo de 90 s se toma justo antes del motor; las comprobaciones de reclamación usan el `now` de su transacción.
- `server.requestTimeout` (30 s) mide la recepción; un avance de 150 s responde igual. Se fija con un e2e con `requestTimeoutMs: 1000` y un proveedor que tarda 2 s reales.
- Reinicio de la API a mitad de un avance: la reclamación queda huérfana hasta 300 s (`conversation_busy`, proposal: riesgo aceptado).

### D16. Tests sin Anthropic, conformidad y meta

- **Proveedor simulado**: los e2e sustituyen `LLM_PROVIDERS` por `Map([['principal', delegado]])`, donde `delegado` llama al proveedor guionizado del test (`test/helpers/conversations-llm.ts`: registra peticiones con `structuredClone`, resuelve cuando el test lo indica, puede mover el reloj). `CONVERSATIONS_CONFIG` se sustituye para el presupuesto. Ningún test construye el proveedor real salvo el unit de `createPrincipalClient`, que no hace peticiones. `test:e2e` no recibe `FRANCA_ANTHROPIC_API_KEY` (turbo, D9).
- **Reloj manual** (`test/helpers/conversations-clock.ts`): `now()` = base + desplazamiento + 1 ms por llamada; `advance(ms)`. Se instala con `configure: b => b.overrideProvider(CLOCK).useValue(clock)`.
- **Base**: `resetConversations(prisma)` hace `TRUNCATE conversation_entries, conversations, contact_values, contacts, flow_versions, flows` (helper nuevo; `resetDatabase` no cambia y sigue funcionando porque nada referencia a `flows`).
- **Concurrencia y fallos**: subclases de test de `ConversationsRepository` con barrera (como `BarrierFlowsRepository`) para «aplicar» y borrados simultáneos, y una que lanza una vez un `PrismaClientKnownRequestError` `P1001` copiado de `database-errors.spec.ts` al aplicar («Fallo al guardar un avance»). Sin ganchos de test en producción.
- **Sin conexiones salientes**: unit de `buildEngineHost` (sin `http`); en los e2e de proceso real, `ANTHROPIC_BASE_URL` apunta a un servidor TCP local que cuenta conexiones (debe contar 0) y `ANTHROPIC_API_KEY=sk-no-usar` no aparece en la salida.
- **Conformidad** (`test/conversations-conformance.e2e-spec.ts`): un `HostConformanceHarness` cuyo `sessions(provider)` fija el delegado y devuelve `start(flow)` = `POST /flows` + publicar + `POST /conversations`; `continue(id, input, clientState)` = `POST …/inputs` con `{input, state: clientState}` (200 → `{kind: "applied", status}`; 409 `conversation_busy` → `{kind: "conflict"}`; otra cosa lanza); `expireClaims()` = `clock.advance(CLAIM_TTL_MS)`. `llm(provider)` = `createAdvanceLlm` con `Map([['principal', provider]])`, el reloj y el presupuesto de la API (la composición de producción). `logs()` = salida capturada desde `reset()`; `now()`/`sleep()` reales; los métodos de `http` lanzan «fuera de esta feature». `reset()` vacía la base y la salida. Se ejecutan los casos con `id` `registros-llm`, `custodia-estado`, `una-continuacion` y `reclamacion-caducada` (el test falla si alguno no existe) y cada uno debe devolver `[]`. La petición que nunca termina de `reclamacion-caducada` se aborta en el `afterAll` (`AbortController` y `server.closeAllConnections()` antes de `app.close()`).
- **Mutantes del host** (manuales, como en `api-flows`, porque `apps/api` no tiene arnés de mutación): aceptar `state` del cuerpo → `custodia-estado`; no comprobar la reclamación activa → `una-continuacion` y «Dos entradas simultáneas»; `CLAIM_TTL_MS` infinito → `reclamacion-caducada`; registrar el `request` en `advance-llm.ts` → `registros-llm`. Más los propios: bloquear conversación antes que contacto (D7), no comprobar `epoch`, no comparar el testigo al aplicar.
- **Wiki** (fichas nuevas con su línea en el índice): `domain-contacto-compartido-entre-flujos` (compartido por nombre en toda la instalación, solo se escribe lo cambiado, el `default` no se guarda, vista fijada al crear; enforcement: `test/conversations-contacts.e2e-spec.ts`), `decision-http-deshabilitado-en-conversaciones` (por qué `unsupported_node` y no `blocked`; enforcement: «Escalado en el ejemplo de FAQ»), `decision-reclamacion-fuera-de-transaccion` (testigo, `epoch`, orden de bloqueos contacto → conversación; enforcement: `test/conversations-concurrency.e2e-spec.ts`), `gotcha-sdk-anthropic-lee-el-entorno` (`ANTHROPIC_AUTH_TOKEN` y `ANTHROPIC_CUSTOM_HEADERS` aunque haya `apiKey`; enforcement: `src/conversations/llm-providers.spec.ts`).

## Contrato de API

Base URL: `http://127.0.0.1:${PORT}` (por defecto 3001). Sin autenticación en v0: `Host` local, sin `Origin`, sin CORS (`flows-api`). Errores `{message, error, …}` con los campos documentados. Cuerpos `application/json` en UTF-8, como mucho 64 KiB en las dos rutas `POST` de conversaciones. Fechas ISO 8601 UTC con milisegundos.

**Recurso conversación** (claves en este orden; el listado omite `pendingInput`):

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string (UUID v4, minúsculas) | lo genera la API |
| `flowId` / `version` | string / entero | versión fijada al crear |
| `contactId` | string \| null | opaco, `^[A-Za-z0-9_-]{1,64}$` |
| `status` | `waiting` \| `ended` \| `failed` \| `expired` | `expired` derivado |
| `revision` | entero ≥ 1 | +1 por avance aplicado; es el `ETag` |
| `processing` | boolean | hay una entrada en curso (reclamación viva) |
| `pendingInput` | evento `input` \| null | solo en `waiting` |
| `outcome` | string \| null | solo en `ended` |
| `error` | `{code, nodeId}` \| null | solo en `failed` |
| `costUsd` | number | suma de turnos `llm` resueltos |
| `costLimitReached` | boolean | el presupuesto bloqueó algún turno |
| `createdAt` / `updatedAt` | string | `updatedAt` = último avance aplicado |
| `expiresAt` | string \| null | en `waiting` y `expired` |

```json
{"id": "4f1c2b7e-9d3a-4e8b-a1f0-6c5d2e3b4a90", "flowId": "captacion-leads", "version": 1, "contactId": null, "status": "waiting", "revision": 1, "processing": false, "pendingInput": {"type": "input", "nodeId": "pedir-nombre", "inputType": "text", "attempt": 1, "reason": null}, "outcome": null, "error": null, "costUsd": 0, "costLimitReached": false, "createdAt": "2026-10-17T10:00:00.000Z", "updatedAt": "2026-10-17T10:00:00.000Z", "expiresAt": "2026-10-18T10:00:00.000Z"}
```

### `POST /conversations`
Crea y ejecuta hasta la primera parada. No idempotente. Request: `flowId` (string, obligatorio; patrón de `id` o 404), `version` (entero 1..2147483647; `null` = omitido), `contactId` (patrón; `null` = omitido); el resto se ignora. Ejemplo: `{"flowId": "captacion-leads", "contactId": "c-1"}`.
Response 201 + `Location: /conversations/<id>` + `ETag: "1"`: `{"conversation": {…}, "events": [{"type": "message", "nodeId": "bienvenida", "content": [{"kind": "text", "text": "¡Hola! Te hago tres preguntas y te paso con la persona adecuada."}], "typingDelayMs": 600}, {"type": "message", "nodeId": "pedir-nombre", "content": [{"kind": "text", "text": "¿Cómo te llamas?"}], "typingDelayMs": 600}, {"type": "input", "nodeId": "pedir-nombre", "inputType": "text", "attempt": 1, "reason": null}]}`.
Errores, en orden: 413 `payload_too_large`, 415 `unsupported_media_type`, 400 `invalid_json`, 400 `invalid_request`, 404 `flow_not_found`, 409 `flow_not_published` / 404 `version_not_found`, 409 `flow_version_invalid` (`{message, error, issues}`); durante el avance, 404 `flow_not_found` o `conversation_not_found` («Borrado durante la creación»); 500 (`invalid_contact`), 503.

### `GET /conversations`
Query: `flowId`, `status`, `limit` (1..100, 20), `offset` (0..2147483647, 0); repetidos o fuera de rango → 400 `invalid_query`. 200 `{"items": [ …sin pendingInput… ], "total": 1, "limit": 20, "offset": 0}`, orden `updatedAt` desc, `id` asc. 503.

### `GET /conversations/:conversationId`
200 + `ETag` con el recurso. 404 `conversation_not_found` (no UUID en minúsculas, inexistente o borrada). 503.

### `POST /conversations/:conversationId/inputs`
Request `{"input": {"text": "Ana"}}` (o `{"choice": "id"}`, `{"choices": ["a", "b"]}`); el resto del cuerpo se ignora. `If-Match` opcional (`*` o `"<revision>"`). No idempotente sin `If-Match`; con él, una repetición da 412.
Response 200 + `ETag: "<revision>"`: `{"conversation": {…, "revision": 2, …}, "events": [{"type": "message", "nodeId": "fin", "content": [{"kind": "text", "text": "Adiós, ."}], "typingDelayMs": 600}, {"type": "end", "nodeId": "fin", "outcome": "ok"}]}`.
Errores, en orden: 413, 415, 400 `invalid_json`, 400 `invalid_request`, 404 `conversation_not_found`, 412 `revision_mismatch` (`{"message": "la conversación ha cambiado", "error": "revision_mismatch", "currentRevision": 2}` + `ETag: "2"`), 409 `conversation_expired` / `conversation_not_active`, 409 `conversation_busy`, 409 `flow_version_invalid`, 400 `invalid_input`; al aplicar, 404 (borrada) o 409 `conversation_busy` (resultado tardío); 500, 503.

### `GET /conversations/:conversationId/transcript`
Query `limit`/`offset`. 200 `{"items": [{"seq": 4, "at": "2026-10-17T10:00:05.000Z", "role": "user", "input": {"text": " Ana "}}, {"seq": 5, "at": "2026-10-17T10:00:05.000Z", "role": "flow", "event": {"type": "message", "nodeId": "pedir-email", "content": [{"kind": "text", "text": "Encantado, Ana. ¿A qué email te escribimos?"}], "typingDelayMs": 600}}], "total": 9, "limit": 2, "offset": 3}`. 400 `invalid_query`, 404, 503.

### `DELETE /conversations/:conversationId`
204 sin cuerpo; borra conversación, estado y transcripción, también durante un avance. 404, 503. `If-Match` se ignora.

### `DELETE /contacts/:contactId`
204 sin cuerpo, existan o no datos; borra valores, conversaciones y transcripciones del contacto, también en curso o en creación. 400 `invalid_request` (patrón), 503.

### Checklist de coherencia

- [x] Cada campo del recurso tiene consumidor (el chat de la feature 7): `pendingInput` y `processing` para pintar y bloquear el envío, `revision` para `If-Match`, `status`/`outcome`/`error`/`expiresAt` para el final, `costUsd`/`costLimitReached` para quien prueba un flujo `llm`; el arnés de conformidad usa `status`.
- [x] Cada error nuevo tiene un escenario de spec y un e2e; `API_ERROR_CODES` aún no se espeja en la web (test de paridad con la 7, FOLLOW-UP 7.4 de `api-flows`).
- [x] Sin propietarios: todas las conversaciones son de la instalación (spec «Frontera local de las conversaciones»); `localOnly` cubre las rutas nuevas sin cambios.
- [x] Cambios en `flows-api` solo aditivos: códigos nuevos y un mensaje de 413 propio de dos rutas; ninguna respuesta existente cambia.
- [x] Constantes espejadas: ninguna nueva entre capas; `MAX_VERSION`, el patrón de `id` y `DEFAULT_LIMIT` se importan, no se copian.

## Plan de verificación por capas

- **Unit (aplica)**: parsers (cuerpos, `contactId`, UUID, consulta), `loadConversationsConfig` (todos los valores del escenario, `.5`, `5.`, `.`), `createPrincipalClient` con `ANTHROPIC_*` definidas, `expiresAtOf` (1440, 30, `1e300` → 525600), `isClaimActive` (299 999 / 300 000 ms), `contact-values` (cambio, `null`, `default`, `__proto__`, orden de claves, 999 niveles), `createAdvanceLlm` (enrutado, plazo, presupuesto, suma, no captura rechazos, no registra), `buildEngineHost` (sin `http`), recursos (claves exactas, `expired`, `processing`), `bodyLimitFor` y `payloadTooLarge` con `toErrorResponse`. Cada test negativo se valida haciendo fallar su fixture.
- **Golden/contractual (aplica, ligero)**: `toEqual` con todas las claves del recurso, de `{conversation, events}`, de las entradas de la transcripción y de cada error; sin baselines protegidos.
- **Integración HTTP (aplica, el grueso)**: e2e con supertest contra Postgres real (D16), un fichero por área, cada `#### Scenario` con su `it` de título exacto (lo exige `spec-coverage.spec.ts`), más los de implementación: borrar un contacto mientras se aplica (barrera), creación con el flujo borrado a mitad, plazo de recepción frente a avance largo, columnas `text` y colación `C`.
- **Proceso real (aplica)**: arranque con presupuestos inválidos y válidos, «Solo la variable del SDK» y «Cliente con la configuración explícita» (salida sin la clave), con el servidor TCP que cuenta conexiones.
- **Conformidad (aplica)**: los cuatro casos contra la API y Postgres reales, y los mutantes de D16 una vez a mano.
- **E2E opción-al-menos-una-vez y smoke de ruta (no aplica)**: no hay UI ni páginas.
- **Paridad (no aplica todavía)**: llega con la 7.
- **Mutación con arnés (no aplica)**: `apps/api` no lo tiene; mutantes manuales de D16.
- **Manual (aplica)**: curl contra `pnpm dev` sin `FRANCA_ANTHROPIC_API_KEY` (tasks 4.2).

## Plan de Ejecución

Fases y gates en `tasks.md`: 1 Backend Core (`popi:backend-developer`: dependencias, esquema y migración, configuración, piezas puras, repositorio) → 2 Backend API (`popi:backend-developer`: frontera HTTP, servicio, controladores, registro, turbo, `CLAUDE.md`, reglas y wiki) → 3 Tests backend (`popi:backend-developer`: e2e, proceso real, conformidad, cobertura) → 4 Verificación (`popi:qa-tester`, modo backend: e2e, adversarial, mutantes, curl) → 5 Seguimiento. No hay fases de frontend: no hay UI en esta feature (la 7 es el chat).

**Recomendación: `apply normal`** por fases con gate y QA, como `api-flows`. El espacio de comportamiento es amplio (48 requisitos, concurrencia) pero está cerrado en la spec y en este diseño; un bucle aislado sin revisión entre fases arriesga divergir justo en las costuras de concurrencia. La elección es del usuario.

## Risks / Trade-offs

- **Reclamación huérfana** tras reiniciar la API o caer la base al aplicar: 409 `conversation_busy` hasta 300 s (aceptado en la proposal).
- **Fila `contacts` vacía** tras una creación fallida con `contactId` (D5): solo el identificador opaco; la borra `DELETE /contacts` y la purga futura.
- **Último en aplicar gana** si dos conversaciones del mismo contacto cambian la misma variable: es la semántica de «solo lo que cambió» (proposal); documentado en la ficha de wiki.
- **`ANTHROPIC_CUSTOM_HEADERS`** del entorno se añade a las peticiones del SDK aunque la clave sea explícita: no cambia proveedor, clave ni URL, pero añade cabeceras. FOLLOW-UP en `llm-anthropic` (neutralizarla en `createAnthropicClient`).
- **Borrado de un contacto enorme**: la cascada es una sentencia; con miles de conversaciones podría superar `statement_timeout` (3,5 s) y dar 503. Es idempotente y se repite. Aceptable en una instalación local.
- **`bodyLimitFor` conoce rutas de conversaciones** dentro de `src/http`: acoplamiento pequeño, fijado por e2e (mayúsculas y barra final incluidas).
- **Sin FK a `flow_versions`**: la integridad depende de la aplicación y de que las versiones no se borren nunca.
- **Coste en coma flotante** acumulado en `double precision`: el presupuesto compara con `>=`; tolerancia de la spec 1e-12.

## Migration Plan

Migración aditiva (`<ts>_conversations`): tablas, enums, índices, FKs internas y `COLLATE "C"`. No toca `flows` ni `flow_versions`. Rollback: borrar las cuatro tablas y los dos enums (no hay datos que conservar en v0). En local, `pnpm --filter @franca/api db:migrate` tras el `pull`; en los e2e, el `globalSetup` la aplica desde cero.

## Open Questions

1. **Host `http` de producción** (pendiente del usuario): este diseño mantiene `unsupported_node`; cambiarlo es sustituir `buildEngineHost` por uno con `http` y no toca el resto.
2. **Deltas de spec añadidos en la auditoría** (commit `spec(api)` de esta rama): «Borrado durante la creación» (404 `conversation_not_found` o `flow_not_found`), 500 también con `session_not_active`, estado no JSON e `invalid_contact`, y títulos renombrados. Requieren la aprobación del usuario junto con este diseño.
3. **Estado de las conversaciones caducadas**: se conserva hasta que se borran (no hay requisito que lo descarte). ¿Basta con la purga futura?
4. **Fila de contacto vacía** tras una creación fallida (D5): ¿aceptable hasta la purga?
