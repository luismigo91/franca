# Design: API de flujos con Postgres (`api-flows`)

**Fecha**: 2026-10-17 · **Rama**: `feat/api-flows` · Motivación y alcance en `proposal.md`; comportamiento en `specs/flows-api/spec.md` y `specs/flow-validation/spec.md` (mandan sobre este documento). Incorpora las decisiones del orquestador: rechazo en la API de la credencial escrita sin marcadores (`literal_credential`, aviso `credential_header_literal` en la spec), borrado lógico con `id` reservado, avisos de `temperature` y de `system`/`goal` fuera (FOLLOW-UP) y fichero de ejemplo de entorno creado por una persona. **Revisión 2** (tras el FAIL de `popi:architecture-reviewer`): ruta de errores de `validateFlow` lineal con tope de 100 issues (D11), **revisión 3**: semántica sin `flatMap` recursivo, `P2028` partido entre 503 y 500, `capWarnings` en las respuestas y `code` en el issue del tope, `HOST` estricto y dirección real en el registro (D9), 503 con Postgres mudo (D3, D8), y recorte de alcance del orquestador: sin `ignored_field` ni cambios de la CLI (FOLLOW-UP de la feature 8).

## Context

- **`apps/api`** (Nest 12.1.3 sobre `@nestjs/platform-express` con Express 5.2.1, ESM, Vitest 4, `oxlint --type-aware src/ test/`): solo existe `POST /flows/validate` (`src/flows/`), que devuelve `{valid, issues}` usando el body parser JSON por defecto de Nest (100 kB). `main.ts` hace `listen(PORT ?? 3001)` en todas las interfaces. No hay configuración, base de datos, filtro de errores ni guardas. `AppController` (`GET /` → `Hello World!`) y su e2e quedan como están.
- **`@franca/spec`**: `validateFlow(input)` devuelve `{valid: true, flow, issues: []} | {valid: false, issues}`; forma con ajv y semántica solo si la forma es correcta; ordena los issues de forma con `localeCompare(..., {numeric: true})`. La ruta de errores de forma es cuadrática (ver auditoría). `TEMPLATE_VAR` (`/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g`) define qué es un marcador. No comprueba profundidad. La CLI (`src/cli.ts`) no cambia en esta feature.
- **`@franca/engine`**: `checkFlow` (`src/session.ts`) comprueba `exceedsDepth(input, MAX_NESTING_DEPTH)` antes de `validateFlow(toJsonForm(input))`. Sus tests comparan `issues` y `valid`, nunca el resultado entero (`tests/scenarios/validation.test.ts`, `tests/fixtures.test.ts`, `tests/helpers/flows.ts`).
- **Herramientas**: turbo 2.11.8 (modo de entorno estricto por defecto), pnpm 10.18 (bloquea scripts de instalación de dependencias no aprobados; ya hay `ignoredBuiltDependencies`), `scripts/guard-mutate.mjs` antes de `check` y `build` (solo mira `packages/*`), un único job de CI sin servicios, Node 22.23.

### Auditoría de la spec contra el código fusionado y las dependencias reales

Medido el 2026-10-17 con Node 22.23.3, `packages/spec/dist`, `apps/api/node_modules/@nestjs/*` y `prisma@7.10.1` + `@prisma/adapter-pg@7.10.1` instalados en un directorio temporal contra `postgres:18.6-alpine` en Docker:

| Lo que decía o se podía suponer | Lo que dice el código / el runtime | Dónde se corrige |
|---|---|---|
| «Prisma, versión actual» | `npm view prisma version` da `8.0.0-rc.23`: la etiqueta `latest` de `prisma` apunta a una RC, mientras `@prisma/client` y `@prisma/adapter-pg` están en `7.10.1`. `pnpm add prisma` instalaría una CLI que no casa con el cliente | D2: las tres a `7.10.1` exacta |
| `prisma.config.ts` con `env('DATABASE_URL')` (lo que recomienda la skill) | `prisma generate` sin la variable falla: `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. `pnpm check`, el pre-push y el Stop hook corren sin base de datos | D2: `process.env.DATABASE_URL ?? ''` |
| El cliente se genera en `node_modules` | El generador `prisma-client` exige `output`, emite TypeScript con `// @ts-nocheck` e importa con `.js` si `importFileExtension = "js"` | D2: `src/generated/prisma`, ignorado por git y oxlint |
| La base caída da un error genérico | Error real con el puerto cerrado: `PrismaClientKnownRequestError`, `code` `P1001`, `meta.driverAdapterError.cause.kind` `DatabaseNotReachable`; su `message` incluye `127.0.0.1:59999` (host y puerto), no la contraseña | D8: se clasifica por `code`, nunca se registra `message` ni `meta` |
| Orden de `id` «ascendente» | La colación por defecto de la imagen (`en_US.utf8`) ignora `-` y `_` en primer nivel (`ab` < `a-c`, al revés que por código). Prisma no modela la colación de columnas: con `COLLATE "C"` añadido a mano a la migración, `prisma migrate diff --from-config-datasource --to-schema … --exit-code` dice «No difference detected» | D4; spec: «`id` ascendente por código de carácter» |
| El body parser JSON de Nest basta | `express.json` (body-parser 2): con `strict` por defecto rechaza `"hola"` (la spec lo quiere como flujo inválido); un cuerpo vacío con `Content-Length: 0` se convierte en `{}` (la spec quiere `invalid_json`); `text/plain` deja el cuerpo sin leer y sin error (la spec quiere 415); límite 100 kB | D7: lectura en bruto y parseo propio |
| `ETag` con la revisión | `res.send` de Express responde 304 si `If-None-Match` coincide con el `ETag`, y el recurso cambia al publicar sin cambiar de revisión (`latestVersion`, `unpublishedChanges`): un editor con caché vería datos viejos | Spec: «Lectura condicional ignorada»; D7 |
| Un `:flowId` raro da `flow_not_found` | `GET /flows/%FF`: el router de Express lanza `URIError` y `ExpressAdapter.mapException` lo convierte en `BadRequestException` con el texto del error, antes de llegar al controlador | Spec: «Ruta o método desconocidos» incluye `%FF` → `not_found`; D8 |
| `JSON.parse` y `JSON.stringify` son simétricos | `JSON.parse` acepta 524 000 niveles en 31 ms; `JSON.stringify` funciona con 5000 y lanza `RangeError` con 10 000. `validateFlow` no lanza con 524 000 niveles dentro del `default` de una variable `json` (ajv no desciende), pero sí con 5000 predicados `all` (medido por el analista) | D5 y D11 |
| El cuerpo de 1 MiB acota lo guardado | La forma JSON puede crecer: un array de `1e20` de 1 000 001 bytes da 4 400 001 bytes tras `JSON.stringify(JSON.parse(…))` (×4,4) | D5: hipótesis con test |
| `jsonb` solo reordena claves | Además deduplica claves y rechaza `\u0000`. `JSON.stringify` escapa controles y sustitutos sueltos, así que su texto es UTF-8 válido sin NUL; pero un `name` con U+0000 guardado tal cual en una columna `text` haría fallar el `INSERT` (500) | D4: texto de la forma JSON; `name` como literal JSON |
| `DATABASE_URL` llega a los e2e | Turbo 2 filtra las variables de entorno no declaradas de cada tarea (modo estricto): `DATABASE_URL`, `HOST` y `PORT` no llegarían a `test:e2e` ni a `dev` | D12: `passThroughEnv` |
| `pnpm install` deja Prisma listo | pnpm 10 no ejecuta scripts de instalación de dependencias sin aprobar (este repo ya lista `ignoredBuiltDependencies`) | D2: `onlyBuiltDependencies` con lo que pnpm declare ignorado |
| Imagen de Postgres con volumen en `/var/lib/postgresql/data` | Desde la 18, la imagen oficial guarda los datos en `/var/lib/postgresql/<versión>/docker` y espera el volumen en `/var/lib/postgresql` | D12 |
| «`validateFlow` es lineal» (D5, revisión 1) | Falso con flujos inválidos (revisor y medido aquí): N nodos `{}` → 1000: 172 ms, 2000: 906 ms, 4000: 3 s; N cabeceras con un número en un `http` → 4000: 1,8 s (`collapse` compara cada error con cada ruta `oneOf`). Y ajv con `allErrors` es cuadrático por sí solo: un `when` con 16 000 / 64 000 / 256 000 predicados `{}` tarda 0,49 s / 8,4 s / 259 s; la raíz sin nodos con 50 000 / 200 000 variables `{"x": 1}`, 2,7 s / 59 s. Con `allErrors: false` los mismos datos tardan 0 ms, y validar cada nodo contra la definición de su tipo con `allErrors` es lineal si el nodo es pequeño (16 000 nodos: 2 ms) | Spec: «Tope de issues» y «Coste acotado de la validación»; D11 |
| `HOST` vacío o `localhost` | `listen(port, '')` escucha en `::` (todas las interfaces); `localhost` resuelve a una sola familia; `app.getUrl()` reescribe `::` → `[::1]` y `0.0.0.0` → `127.0.0.1`, así que no sirve para comprobar dónde se escucha | Spec: «Escucha solo en la máquina local» y «Puerto de escucha»; D9 |
| Postgres caído = puerto cerrado | Con un servidor que acepta la conexión y no contesta (`net.createServer(() => {})`, `connectionTimeoutMillis` 2000), medido aquí: `findMany`, `create` y la transacción interactiva lanzan un `Error` plano sin `code` con `message` «Connection terminated due to connection timeout» (`cause`: «Connection terminated unexpectedly»); la transacción en lote da `PrismaClientKnownRequestError` `P2028` («Unable to start a transaction in the given time»). Ninguno lleva la contraseña | Spec: «Postgres mudo»; D3, D8 |
| Semántica de `validateFlow` lineal | `templateVars`/`predicateVars` (`src/validate.ts`) usan `flatMap` recursivo y copian en cada nivel todo lo de debajo: coste niveles × marcadores. Medido aquí: `body` con 990 niveles de arrays y un texto con 200 000 `{{a}}` (1 MB) → 1874 ms, flujo válido; un recorrido con pila y `Set`, 7 ms. La API lo pagaría dos veces por `POST`/`PUT` y la feature 6 en cada turno | Spec: escenario «Muchos marcadores en un body profundo» (< 500 ms); D11 |
| `P2028` = base no disponible | `P2028` cubre dos cosas: «Unable to start a transaction in the given time» (no hay conexión a tiempo: base muda o saturada) y «A query cannot be executed on an expired transaction» (una transacción interactiva superó su `timeout`: fallo del propio código) | Spec: «Transacción caducada por el propio código» (500); D8 |
| Toda respuesta de error tiene `{message, error}` | Una petición HTTP/1.1 sin `Host` la rechaza Node (`requireHostHeader`) con su propio 400 antes de llegar a Express | Spec: «Host local» y «Forma de los errores» lo dicen |
| Spec «Se guarda con avisos» con `"Bearer abc123"` (201) | Contradice la decisión 1 del orquestador | Spec: ese escenario pasa a `"Bearer {{segmento}}"` y nace «Credenciales escritas en el flujo» |
| Spec «Borrar un flujo» libera el `id` | Contradice la decisión 2 del orquestador | Spec: borrado lógico, `flow_id_reserved`, versiones conservadas |
| `test/flows.e2e-spec.ts` | Espera exactamente `{valid: true, issues: []}` | D13: pasa a esperar `warnings: []` (único test existente que cambia) |
| `test/app.e2e-spec.ts` | Importa `AppModule`, que ahora necesita `DATABASE_URL` | Sin cambios: el `globalSetup` de los e2e la define (D13) |

## Goals / Non-Goals

**Goals:**
- Cumplir los dos deltas con un módulo `flows` ampliado y piezas nuevas en carpetas propias, sin tocar `packages/engine/src`, `packages/llm-anthropic`, `apps/web` ni el `AppController`.
- `pnpm check` (pre-push, Stop hook) sin Docker ni `DATABASE_URL`; `pnpm test:e2e` contra Postgres real, local y en CI.
- Cada hipótesis de coste, tamaño y profundidad con un test que la haría fallar.

**Non-Goals:**
- Interfaces con token de inyección (`IFlowsService`): un solo consumidor y ningún doble de producción; los tests sustituyen clases con `overrideProvider`.
- OpenAPI exportado, endpoint de salud, registro de peticiones, cabeceras de endurecimiento (`X-Powered-By`), reintentos de conexión y caché: ningún requisito los pide.
- Lector interno de versiones para la feature 6 (incluidas las de flujos borrados): el modelo lo permite; el método llega con la 6 (FOLLOW-UP).

## Decisions

### D1. Estructura y ficheros que abre el cambio

| Ruta | Estado | Contenido |
|---|---|---|
| `packages/spec/src/depth.ts` | nuevo | `MAX_FLOW_DEPTH`, `exceedsFlowDepth` (D11) |
| `packages/spec/src/template.ts` | nuevo | `TEMPLATE_VAR` y `hasMarker`, compartidos por `validate.ts` y `warnings.ts` |
| `packages/spec/src/warnings.ts` | nuevo | `FLOW_WARNING_CODES`, `FlowWarning`, `flowWarnings(flow)` |
| `packages/spec/src/shape.ts` | nuevo | validación de forma por piezas, presupuesto de detalle y `collapse` lineal (D11) |
| `packages/spec/src/validate.ts`, `src/index.ts`, `README.md` | modificados | profundidad, forma por piezas, tope de issues, `warnings`, exportaciones (`src/cli.ts` no cambia) |
| `packages/spec/tests/{warnings,depth,shape-cost,issue-cap}.test.ts` | nuevos | D11, D13 |
| `packages/engine/tests/flow-depth-parity.test.ts` | nuevo | paridad del límite y del issue (sin tocar `src/`) |
| `apps/api/prisma/schema.prisma`, `prisma/migrations/<timestamp>_init/`, `prisma.config.ts`, `.gitignore` | nuevos | D2, D4 |
| `apps/api/src/config/{app-config.ts,app-config.spec.ts,config.module.ts}` | nuevos | D9 |
| `apps/api/src/prisma/{prisma.service.ts,prisma.module.ts,database-errors.ts,database-errors.spec.ts}` | nuevos | D3, D8 |
| `apps/api/src/http/{app-setup.ts,limits.ts,local-only.ts,json-body.ts,api-error.ts,api-exception.filter.ts}` + sus `*.spec.ts` | nuevos | D7, D8 |
| `apps/api/src/flows/{flows.repository.ts,flow-body.ts,flow-params.ts,if-match.ts,list-query.ts,flow-resources.ts,clock.ts}` + `*.spec.ts` de las piezas puras | nuevos | D5, D6 |
| `apps/api/src/flows/{flows.controller.ts,flows.service.ts,flows.module.ts}`, `src/main.ts`, `src/app.module.ts` | modificados | registro y orquestación |
| `apps/api/test/global-setup.ts`, `test/helpers/*`, `test/*.e2e-spec.ts` nuevos, `test/spec-coverage.spec.ts` (la única copia nueva de `spec-text.ts` está en `test/helpers/`) | nuevos | D13 |
| `apps/api/test/flows.e2e-spec.ts`, `vitest.config.e2e.ts`, `package.json`, `.oxlintrc.json` | modificados | `warnings: []`, `globalSetup`, scripts y dependencias, ignorar el cliente generado |
| `docker-compose.yml` | nuevo | D12 |
| `turbo.json`, `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `CLAUDE.md` | modificados | **ficheros ajenos** (D12) |
| `.claude/wiki/*`, `.claude/rules/always/{knowledge-wiki,gotchas}.md`, `.claude/rules/backend/{architecture,routes-and-errors}.md` | meta | fichas y punteros |

**Ficheros ajenos: 4 más el lockfile**, todos de configuración compartida y cada uno con un motivo de una línea: `turbo.json` (generar el cliente antes de compilar y dejar pasar `DATABASE_URL`), `ci.yml` (Postgres para los e2e), `pnpm-workspace.yaml` (scripts de instalación de Prisma) y `CLAUDE.md` (variables, lo pide el orquestador). Ningún fichero de código de otra capacidad cambia salvo `test/flows.e2e-spec.ts` (la respuesta de `validate` gana `warnings`). Criterio de aceptación de la fase 6: `git diff --stat main...HEAD` no lista nada fuera de esta tabla.

### D2. Prisma: versiones, cliente generado y tarea de turbo

- **Dependencias de `apps/api`, versiones exactas** (sin `^`): `@prisma/client` `7.10.1` y `@prisma/adapter-pg` `7.10.1` (trae `pg`) en `dependencies`; `prisma` `7.10.1` en `devDependencies`. Exactas porque la etiqueta `latest` de `prisma` es una RC y CLI y cliente deben coincidir. Sin `pg` directo: el `globalSetup` usa `PrismaClient` para crear y borrar la base de los e2e.
- **Por qué Prisma 7 con adaptador** y no SQL a mano con `pg`: lo fija el plan aprobado (Postgres + Prisma). El cliente de Prisma 7 no usa motor binario de consultas (no hay que descargar nada para `generate`) y se conecta con `@prisma/adapter-pg`.
- **Generador** en `prisma/schema.prisma`: `provider = "prisma-client"`, `output = "../src/generated/prisma"`, `moduleFormat = "esm"`, `importFileExtension = "js"`. Dentro de `src/` porque `nest build` compila con `rootDir: ./src` y Vitest lo resuelve sin alias. El `datasource` solo lleva `provider = "postgresql"` (en Prisma 7 la URL vive en la configuración).
- **`prisma.config.ts`** (raíz de `apps/api`): `schema`, `migrations.path` y `datasource.url: process.env.DATABASE_URL ?? ''`, con un comentario que explica por qué no `env()`. `migrate` sin la variable falla con el error de Prisma; `generate` no la necesita.
- **Tarea `db:generate`** (`prisma generate`) en `apps/api/package.json` y en `turbo.json` con `inputs: ["prisma/schema.prisma", "prisma.config.ts"]` y `outputs: ["src/generated/prisma/**"]`; `build`, `dev`, `lint`, `typecheck`, `test` y `test:e2e` añaden `"db:generate"` (mismo paquete) a su `dependsOn`. Los paquetes sin ese script la ignoran. Alternativas descartadas: `postinstall` (no se vuelve a ejecutar tras un `git pull` que cambie el esquema y depende de los scripts que pnpm bloquea) y meterla solo en el script `build` (`typecheck`, `lint` y `test` también importan el cliente). Así `pnpm check`, el pre-push, el Stop hook y la CI generan el cliente sin red ni base de datos, y el candado de mutación no cambia (`guard-mutate.mjs` sigue antes de `turbo`).
- **Ignorados**: `apps/api/.gitignore` nuevo con `src/generated/` (no se toca el `.gitignore` raíz); `.oxlintrc.json` con `ignorePatterns: ["src/generated/**"]`. `tsc` lo compila sin quejarse (`@ts-nocheck`).
- **Scripts de instalación**: tras `pnpm install`, si pnpm declara ignorados los de `prisma` o `@prisma/engines`, se añaden a `onlyBuiltDependencies` en `pnpm-workspace.yaml` (solo los que declare; el motor de esquema de `migrate` los necesita). Gate: `pnpm install` sin aviso de scripts ignorados de Prisma y `pnpm --filter @franca/api db:migrate` funcionando.
- **Scripts de `apps/api`**: `db:generate`, `db:migrate` (`prisma migrate deploy`: aplica migraciones, en local tras un `pull` y en los e2e) y `db:migrate:dev` (`prisma migrate dev`: solo para escribir migraciones nuevas, nunca en CI).

### D3. `PrismaService`: conexión y ciclo de vida

- `PrismaService extends PrismaClient` construido con `new PrismaPg({ connectionString: config.databaseUrl, connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS, query_timeout: DATABASE_QUERY_TIMEOUT_MS })` (5000 y 4000, más `statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS` 3500, en `src/prisma/limits.ts`) y `errorFormat: 'minimal'`, sin opción `log` (Prisma no registra consultas). Los dos tiempos porque los de `pg` por defecto son 0 (esperar para siempre): con un servidor que acepta la conexión y no contesta, la conexión falla a los 5 s (medido: «Connection terminated due to connection timeout») y la petición acaba en 503 antes de los 10 s de la spec; una consulta que se queda colgada a mitad, también esperando un bloqueo de fila de otra transacción, falla a los 3,5 s por `statement_timeout` del servidor (SQLSTATE `57014`, la conexión queda sana; escenario «Bloqueo que no se suelta») o, si el servidor ni contesta, a los 4 s por `query_timeout` («Query read timeout», D8). El motivo de que sean 4 s y no 8 s: Prisma envía el `ROLLBACK` de una transacción interactiva por la misma conexión, y si el servidor está mudo ese `ROLLBACK` espera otro `query_timeout` entero (medido con un proxy TCP que enmudece al llegar `FOR UPDATE`: 16 s con 8 s). Con 4 s, el peor caso es 2 × 4 s = 8 s, menos de los 10 s de la spec (escenario «Postgres que enmudece a mitad de una transacción»); `statement_timeout` queda por debajo de `query_timeout` para que una espera de bloqueo la corte Postgres y no el cliente. `query_timeout` (4 s) es menor que el `timeout` de la transacción interactiva (10 s), así que una espera de bloqueo larga da 503 y no la transacción caducada (500). `maxWait` de las transacciones interactivas (5000) coincide con el de conexión.
- **Conexión perezosa**: sin `$connect()` en `onModuleInit`. La API arranca con Postgres parado, `POST /flows/validate` funciona y el CRUD da 503 (requisito «Base de datos no disponible»); cuando Postgres vuelve, la siguiente consulta conecta sola. `onModuleDestroy` hace `$disconnect()` y `main.ts` llama a `app.enableShutdownHooks()` para que `SIGINT`/`SIGTERM` cierren el pool.
- `PrismaModule` es `@Global()` y exporta `PrismaService`; `FlowsModule` inyecta `FlowsRepository`, que es el único que lo usa. Transacciones interactivas con `{ maxWait: 5000, timeout: 10000 }`.

### D4. Modelo de datos y migración

```prisma
model Flow {
  id                 String        @id                       // id del JSON; COLLATE "C" en la migración
  nameJson           String        @map("name_json")         // JSON.stringify(flow.name)
  draft              String                                  // texto de la forma JSON del borrador
  revision           Int
  latestVersion      Int?          @map("latest_version")
  unpublishedChanges Boolean       @map("unpublished_changes")
  createdAt          DateTime      @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime      @map("updated_at") @db.Timestamptz(3)
  deletedAt          DateTime?     @map("deleted_at") @db.Timestamptz(3)
  versions           FlowVersion[]

  @@index([updatedAt(sort: Desc), id])
  @@map("flows")
}

model FlowVersion {
  flowId      String   @map("flow_id")                       // COLLATE "C" en la migración
  version     Int
  nameJson    String   @map("name_json")
  definition  String                                         // texto de la forma JSON publicada
  publishedAt DateTime @map("published_at") @db.Timestamptz(3)
  flow        Flow     @relation(fields: [flowId], references: [id], onDelete: Restrict)

  @@id([flowId, version])
  @@map("flow_versions")
}
```

- **Flujo como `text` con el resultado de `JSON.stringify`**, no `jsonb` ni `json`: `jsonb` reordena y deduplica claves (rompería «Orden de las propiedades» y el orden de cabeceras que el motor envía, FOLLOW-UP 6.2 de `engine-http`) y rechaza `\u0000`. `json` conserva el texto, pero a través del tipo `Json` de Prisma el valor pasa por su (de)serialización en JS (`Prisma.JsonNull`, sin control del texto exacto) y Postgres lo reparsearía con otras reglas. Con `text` hay **un único** `JSON.stringify` (D5), la comparación «sin cambios» es igualdad de cadenas y el texto es UTF-8 válido sin NUL. Ningún requisito consulta el contenido del flujo en SQL. Lo protege un test de columnas (D13) y la ficha `gotcha-jsonb-reordena-claves`.
- **`name_json`**: el `name` se guarda como literal JSON (`"Captación de leads"` con comillas) y se decodifica al leer. Un `name` con U+0000 o un sustituto suelto (el esquema solo limita la longitud) rompería un `INSERT` en `text` o se guardaría alterado; el literal JSON llega escapado. Se guarda aparte para que el listado no lea borradores de megabytes.
- **`revision`, `latest_version` y `unpublished_changes`** se mantienen bajo el bloqueo de la fila (D6) en las dos únicas escrituras que los cambian (`PUT` y publicar). `latest_version` sirve el filtro `published` y el campo `latestVersion` del listado sin leer versiones; `unpublished_changes` es exactamente «no hay versiones o el texto del borrador difiere del de la última versión».
- **Borrado lógico**: `deleted_at`. Las filas no se borran nunca, de ahí `onDelete: Restrict` (protege las versiones si alguien borra a mano). El `id` reservado sale gratis de la clave primaria.
- **Colación `"C"`** en `flows.id` y `flow_versions.flow_id` (las dos para que la clave foránea compare igual): orden por código de carácter en el desempate del listado. Se añade a mano al SQL de la migración inicial; Prisma no la ve como diferencia (medido) y un test de columnas la comprueba.
- **Índices**: clave primaria de `flows`; `(updated_at DESC, id)` para el orden del listado; la clave primaria `(flow_id, version)` sirve el historial (recorrido hacia atrás) y la lectura de una versión. Sin índices parciales (Prisma los vería como deriva) ni índices sobre `deleted_at`/`latest_version` (una instalación local).
- **Fechas** `timestamptz(3)` (milisegundos, como `Date`), escritas por el servicio con un reloj inyectable (`CLOCK`, D6), nunca con `now()` de Postgres ni `@updatedAt`: un `PUT` sin cambios no escribe y publicar no toca `updated_at`.
- **Migración**: `prisma migrate dev --name init --create-only` contra el Postgres de `docker compose`, añadir `COLLATE "C"`, revisar el SQL y aplicarla con `db:migrate`. Se versiona `prisma/migrations/` entero (con `migration_lock.toml`). En los e2e se aplica desde cero en una base nueva y se comprueba la deriva (D13).

### D5. Forma JSON, profundidad y tamaño (`flows/flow-body.ts`)

```ts
/** Valida la forma JSON del cuerpo; `text` es lo que se guardaría (ausente si es demasiado profundo). */
export function inspectFlowBody(value: unknown): { verdict: FlowValidationResult; text?: string } {
  if (exceedsFlowDepth(value)) return { verdict: validateFlow(value) }; // solo el issue de profundidad, sin recursión
  const text = JSON.stringify(value);
  return { verdict: validateFlow(JSON.parse(text)), text };
}
```

- `value` viene de `JSON.parse` (D7), así que `stringify` siempre produce texto. Se valida **la forma JSON** y no lo parseado: `1e400` se parsea como `Infinity`, que ajv acepta como `number`; tras `stringify` es `null` (escenarios «Número no representable…»).
- **Profundidad**: el límite se comprueba antes de cualquier recursión, con la función de `@franca/spec` (la API no redefine la regla). Lo guardado tiene como mucho 1000 niveles, lo que se devuelve envuelto en el recurso 1001 o 1002, y `JSON.stringify` aguanta 5000 (medido): sin `RangeError` al responder. Leer el texto guardado devuelve la misma profundidad que se validó, así que un `GET` seguido de un `PUT` (el editor) o de `startSession` (feature 6, mismo límite 1000, test de paridad) nunca cruza el límite que no cruzó al guardar.
- **Tamaño**: cuerpo ≤ 1 048 576 bytes; texto guardado ≤ ~4,4 MiB (expansión de números como `1e20`, medida); respuestas de hasta ~4,5 MiB. Se acepta (local) y lo fija un test.
- **Coste lineal**: lectura en bruto, decodificación, `JSON.parse`, `exceedsFlowDepth` (iterativa), `stringify` y avisos recorren el flujo una vez; la comparación «sin cambios» es O(n). `validateFlow` **no lo era** con flujos inválidos (auditoría): D11 lo hace lineal con validación por piezas, presupuesto de detalle y tope de issues, y lo prueban los tests de tiempo de `flow-validation` y el escenario «Flujo inválido de un mega» en el e2e. No se añade ninguna expresión regular con cuantificadores anidados (el origen de la `url` se corta con `indexOf`).
- **Hipótesis con test**: (a) el cuerpo más profundo que cabe en 1 MiB (524 287 arrays) da 400 `invalid_flow` con el issue de profundidad, no 500; (b) un cuerpo de ~1 MiB de `1e20` dentro del `default` de una variable `json` se crea (201) y `GET` devuelve el mismo texto, de menos de 4,5 MiB; (c) el predicado `all` anidado hasta el límite no hace lanzar a `validateFlow` (escenario «Predicado anidado hasta el límite»); (d) 100 000 niveles en `POST /flows` y `/validate` (escenario «Anidamiento extremo»); (e) ~1 MiB de nodos `{}` en `/validate` responde 200 con 101 issues en menos de 5 s (escenario «Flujo inválido de un mega»), y el mismo cuerpo en `POST /flows` da 400 con un cuerpo de `invalid_flow` acotado por el tope.

### D6. Operaciones y concurrencia (`flows.service.ts`, `flows.repository.ts`)

`FlowsRepository` es el único que habla con Prisma: `create`, `findActive(id)`, `list(filter, page)`, `withLockedFlow(id, fn)`, `findVersion`, `listVersions`, `insertVersion`, `updateDraft`, `markDeleted`. `withLockedFlow` abre una transacción interactiva, ejecuta `SELECT id, revision, draft, latest_version, deleted_at FROM flows WHERE id = $1 FOR UPDATE` con `$queryRaw` (Prisma no tiene `FOR UPDATE` en su API de consultas) y pasa la fila a `fn` (o `null` si no existe o está borrada). Todos los escritores de un flujo toman antes ese bloqueo; con `READ COMMITTED` basta.

`FlowsService` orquesta en el orden de la spec. `inspectFlowBody` se ejecuta **fuera** de la transacción (no depende de la base) y su veredicto solo se **informa** cuando le toca:

| Operación | Secuencia |
|---|---|
| `POST /flows` | `invalid_json` (D7) → `inspectFlowBody` → `invalid_flow` → `literal_credential` → `INSERT`; si Prisma da `P2002`, se lee `deleted_at` del existente: `flow_id_reserved` si está borrado, `flow_already_exists` si no |
| `PUT /flows/:flowId` | `invalid_json` (D7; `@JsonBody()` se resuelve antes del manejador) → `flow_not_found` si `:flowId` no cumple el patrón → `inspectFlowBody` → bloqueo: `flow_not_found` → 428 sin `If-Match` → 412 si no coincide → `invalid_flow` → `literal_credential` → `flow_id_mismatch` → si `text === draft`, 200 sin escribir → si no, `revision + 1`, `updated_at`, `draft`, `name_json` y `unpublished_changes` (`true` sin versiones; si no, `text !== definition` de la última versión, leída bajo el bloqueo) |
| `POST /flows/:flowId/versions` | bloqueo: `flow_not_found` → 412 si `If-Match` viene y no coincide → `validateFlow(JSON.parse(draft))` → `invalid_flow` → `literal_credential` → si hay última versión y su `definition === draft`, 200 con ella → si no, `INSERT` de `latest_version + 1` (o 1) y `latest_version`/`unpublished_changes = false` en `flows` (sin tocar `updated_at`) → 201 |
| `DELETE /flows/:flowId` | bloqueo: `flow_not_found` → 412 si `If-Match` viene y no coincide → `deleted_at = now` → 204 |
| Lecturas | `findActive` (sin bloqueo) → `flow_not_found`; versiones: después, `:version` con `^[1-9][0-9]*$` y ≤ 2147483647 o `version_not_found` (así nunca llega a Postgres un número que desborda `int4`) |

- **Publicar compara textos**, no el indicador: el indicador sirve para mostrar; la decisión de crear versión usa la fuente de verdad (también con un borrador escrito a mano en la base, como en los escenarios de revalidación).
- **Dos `PUT` con el mismo `If-Match`**: el segundo espera al bloqueo, ve `revision` 2 y responde 412. **Dos publicaciones**: la segunda ve la versión recién creada con el mismo texto y responde 200. La clave primaria `(flow_id, version)` es el respaldo: si alguna vez se violara, sería un fallo (500), no un número repetido.
- **Dos `POST` del mismo `id`**: la clave primaria decide; el perdedor recibe `P2002` → 409.
- **Listado**: `findMany` sin `draft` (`select`), `where: { deletedAt: null, latestVersion: … }`, `orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]`, `skip`/`take`, y `count` en dos consultas simultáneas, sin transacción: con `READ COMMITTED` el lote de Prisma no daba una instantánea común (cada sentencia ve la suya), y su `timeout` por defecto de 5 s caducaba con `P2028` antes que el corte de la base (500 en vez de 503 con la tabla retenida). Un desplazamiento de páginas con escrituras simultáneas se acepta (proposal).
- **Reloj**: `CLOCK` (`{ now(): Date }`, por defecto `new Date()`); los e2e lo sustituyen por uno que avanza 1 ms por llamada para que «instantes distintos» y `updatedAt` posterior a `createdAt` sean deterministas.
- **Piezas puras con unit tests**: `if-match.ts` (`matchesIfMatch(header, revision)`: `*`; lista separada por comas; solo etiquetas fuertes `"<n>"`, comparación textual sin convertir a número; `W/"1"`, `1` o vacío no coinciden), `list-query.ts` (`limit`, `offset`, `published`; repetidos o fuera de rango → `invalid_query`; parser puro y no `ValidationPipe` + class-validator como dice `.claude/rules/backend/routes-and-errors.md`: exigiría dos dependencias nuevas, su error tiene otra forma (`{message: [...], error: "Bad Request", statusCode}`) y no rechaza parámetros repetidos sin más código; la regla se actualiza con esta excepción), `flow-params.ts` (`:flowId` con el patrón `schema.$defs.id.pattern` de `@franca/spec`, no copiado; `:version`), `flow-body.ts`, `flow-resources.ts` (mapeo fila → recurso, `warnings` recalculados con `validateFlow` al responder).

### D7. Tubería HTTP (`http/app-setup.ts`)

`configureApp(app)` la usan `main.ts` y los e2e, así que los tests ejercitan la misma tubería. La app se crea con `bodyParser: false`. En orden:

1. `app.set('etag', false)`: Express no añade ETags débiles propios (el contrato solo define el de la revisión) ni hashea respuestas de megabytes.
2. **`localOnly`** (`local-only.ts`): `Host` sin el puerto (`[::1]` con corchetes), en minúsculas, debe ser exactamente `localhost`, `127.0.0.1` o `[::1]`; si no (o si falta, lo que solo puede pasar con HTTP/1.0: Node responde por su cuenta 400 a una petición HTTP/1.1 sin `Host`), 403 `forbidden_host`. Después, cualquier cabecera `Origin` (también `null` o vacía) → 403 `forbidden_origin`. Va antes de leer el cuerpo: «sin hacer nada más». Sin CORS: no se llama a `enableCors` y ninguna capa añade `Access-Control-Allow-*`.
3. **Sin lecturas condicionales**: borra `if-none-match` e `if-modified-since` de la petición, así `res.send` nunca responde 304.
4. **Cuerpo en bruto** (`json-body.ts`): guarda `Content-Encoding`, lo quita de la petición y llama a `express.raw({ type: () => true, limit: MAX_BODY_BYTES, inflate: false })`. Así el límite cuenta los bytes tal como llegan y el 413 sale antes que el 415 también con un cuerpo comprimido. Errores de body-parser por su `type`: `entity.too.large` → 413 `payload_too_large`; `request.aborted`/`request.size.invalid` → 400 `invalid_json`. Después, si había `Content-Encoding` distinta de `identity` → 415. `MAX_BODY_BYTES = 1_048_576` en `http/limits.ts`.
5. **JSON**: cuerpo vacío o ausente → «sin cuerpo». Con cuerpo: el tipo de medio debe ser `application/json` y el único parámetro admitido `charset=utf-8` (sin distinguir mayúsculas, con o sin comillas); si no, 415. Se decodifica con `TextDecoder('utf-8', { fatal: true })` y se parsea con `JSON.parse`; cualquier fallo → 400 `invalid_json`. El valor queda en la petición; el decorador `@JsonBody()` lo entrega a `validate`, `POST` y `PUT`, y lanza `invalid_json` si no hay cuerpo. Publicar no lo usa (cuerpo ignorado, pero ya pasó por 413/415/`invalid_json`).
5b. **Petición que no termina de llegar**: `configureApp` fija `server.requestTimeout` en 30 s (`REQUEST_TIMEOUT_MS`, `http/limits.ts`; el de Node son 300 s), `headersTimeout` en 10 s y `connectionsCheckingInterval` en 5 s (Node solo comprueba los plazos a intervalos: con los 30 s por defecto, 30 s de plazo valen hasta 60 s). Una petición que declara `Content-Length: 1048577` y envía 7 bytes recibe 408 y se cierra a los 30-35 s, no a los 300. Con cuerpos de 1 MiB como máximo en bucle local sobra tiempo. `configureApp` acepta un `requestTimeoutMs` solo para que el e2e lo reduzca; no hay variable de entorno.
6. Router de Nest (rutas específicas antes que las de parámetro: `POST /flows/validate` está declarada antes y no colisiona con `/flows/:flowId/versions`).
7. `ApiExceptionFilter` global (D8). Los errores de los middlewares llegan con `next(err)` al manejador que Nest registra en `init()` (`RoutesResolver.registerExceptionHandler`), que aplica los filtros globales; por eso `configureApp` se llama antes de `init()`/`listen()`.

### D8. Errores, base de datos no disponible y registros

- `ApiException extends HttpException` con `code: ApiErrorCode`, estado, mensaje en español, campos extra y cabeceras extra (el `ETag` del 412). `API_ERROR_CODES` es la lista cerrada del contrato y su tipo impide un código no documentado.
- `ApiExceptionFilter` (`@Catch()`, captura todo; el `ExceptionsHandler` de Nest, que registra trazas, nunca ve nada):
  - `ApiException` → `{message, error, ...extra}` y sus cabeceras.
  - `NotFoundException` de Nest (ruta o método sin manejador) → 404 `not_found`.
  - `BadRequestException` que no es nuestra → 404 `not_found`: la única fuente es el `URIError` de una ruta con `%` mal formado (no hay `ValidationPipe` ni body parser de Nest). Unit test con el error que produce `mapException` y e2e con `GET /flows/%FF`.
  - `isDatabaseUnavailable(err)` (`prisma/database-errors.ts`) → 503 `database_unavailable`. Clasifica las formas reales capturadas (auditoría), cada una con su fixture copiado en el unit test:
    - `PrismaClientInitializationError`;
    - `PrismaClientKnownRequestError` con `code` `P1001` (puerto cerrado, medido), `P1002`, `P1017`, o `P2024`; `P2028` **solo** si su `message` contiene «Unable to start a transaction in the given time» (medido con el servidor mudo en la transacción en lote del listado). El otro `P2028`, «A query cannot be executed on an expired transaction» (una transacción interactiva que supera su `timeout` de 10 s), es un fallo del código y da 500 con la clase y el código en el registro. O con `meta.driverAdapterError.cause.kind` `DatabaseNotReachable`. Fixtures de los dos `P2028` capturados con la versión instalada (el caducado: transacción con `timeout` 50 ms que espera 100 ms antes de su consulta);
    - **Conexión cortada por el servidor** (`pg_terminate_backend`, reinicio, conmutación): SQLSTATE `57P01` (`admin_shutdown`), `57P02` (`crash_shutdown`) o `57P03` (`cannot_connect_now`) en `meta.driverAdapterError.cause.originalCode`, sea cual sea el código de Prisma que lo envuelva (medido: `P2039` en `findMany`, `count`, `create` y `update`; `P2010` en `$queryRaw`). Son los tres SQLSTATE de clase 57 que significan «el servidor se va o no está listo»; no se acepta toda la clase 57 (`57014` ya está arriba y `57000`/`57P04` no significan caída);
    - **Base mal configurada** (`DATABASE_URL`): `P1000` (autenticación), `P1003` (base inexistente; medido con `DatabaseDoesNotExist`), `P1010` (usuario sin acceso; medido con `DatabaseAccessDenied`) y `P1011` (TLS; medido con `TlsConnectionError`). Para la API son «base no disponible» (503): no es un fallo del código ni algo que el cliente pueda arreglar. El mensaje de Prisma lleva el nombre de la base, así que nunca se registra; el registro del 503 añade solo el código `P####` para que quien opera vea que es configuración;
    - un `Error` de `pg` sin `code` cuyo `message` es exactamente uno de los de conexión o tiempo de `pg`/`pg-pool`: «Connection terminated due to connection timeout» (medido con el servidor mudo en consultas, `create` y transacción interactiva), «Connection terminated unexpectedly», «timeout exceeded when trying to connect» y «Query read timeout». Comparar el texto exacto es frágil ante una subida de `pg`; por eso hay e2e que producen estas formas de verdad (puerto cerrado y `net.createServer(() => {})`) y cualquier cambio de forma los pone en rojo.
  - Cualquier otra cosa → 500 `{message: "error interno", error: "internal_error"}`.
- **Registros**: solo los 5xx, con una línea `método ruta estado código` (`req.path`, sin consulta) y, en 500, el nombre de la clase del error y su `code` si tiene la forma `P####`. Nunca `message`, `meta`, `stack`, cuerpos ni cabeceras: el `message` de P1001 lleva host y puerto, y el de otros errores de Prisma puede llevar argumentos de la consulta (contenido del flujo). Las rutas y los 4xx no se registran. Nest sigue registrando el arranque y el mapa de rutas (sin valores).

### D9. Configuración y arranque (`config/app-config.ts`, `main.ts`)

- `loadConfig(env)` → `{ host, port, databaseUrl }` o `ConfigError` cuyo mensaje nombra la variable y nunca su valor. **Ausente** (`undefined`) y **definida** son casos distintos: `HOST` ausente → `127.0.0.1`; definida, debe ser exactamente `127.0.0.1` o `::1` (`""`, `" 127.0.0.1"`, `localhost`, `::ffff:127.0.0.1`, `0.0.0.0`, `::` → `ConfigError`). `listen(port, '')` escucharía en `::` (todas las interfaces), y `localhost` puede resolver a una sola familia: por eso no se admiten. El mensaje explica que la API de Franca no tiene autenticación y no se puede exponer en otra dirección. `PORT` ausente → 3001; definida, `^[0-9]{1,5}$` y ≤ 65535 (`""` y `" 3001"` → `ConfigError`; 0 elige uno libre y lo usan los tests de arranque). `DATABASE_URL`: obligatoria y no vacía.
- `ConfigModule` `@Global()` provee `APP_CONFIG` con `useFactory: () => loadConfig(process.env)`: importar `AppModule` no ejecuta nada; la configuración se lee cuando Nest instancia los proveedores. Los e2e lo sustituyen (`overrideProvider`) para apuntar a un puerto cerrado o a un servidor mudo.
- `main.ts`: `loadConfig` **antes** de crear la app (no se instancia nada ni se abre ningún puerto con una configuración inválida); con `ConfigError`, escribe el mensaje en `stderr`, `process.exitCode = 1` y termina. Si no: `NestFactory.create(AppModule, { bodyParser: false })`, `configureApp`, `enableShutdownHooks`, `listen(config.port, config.host)` con exactamente los valores validados, y una línea `Franca API escuchando en <dirección>:<puerto>` construida con `app.getHttpServer().address()` (dirección real del socket, `[::1]` entre corchetes si es IPv6). No se usa `app.getUrl()`, que reescribe `::` → `[::1]` y `0.0.0.0` → `127.0.0.1` y escondería justo el error que se quiere ver. La línea muestra `HOST`/`PORT` efectivos, nunca `DATABASE_URL`. Un `EADDRINUSE` hace fallar la promesa de nivel superior con código distinto de 0.

### D10. Credenciales escritas en el flujo

- `@franca/spec` informa; la API decide (decisión 1 del orquestador): `create`, `update` y `publish` rechazan con 400 `literal_credential` si `verdict.valid` y algún aviso tiene `code === 'credential_header_literal'` (comparación tipada con `FlowWarningCode`). Decide con la lista **completa** de avisos; el cuerpo es `{message, error, warnings}` con **solo** los `credential_header_literal` (pasados por `capWarnings`), porque son la causa y así no se pierden detrás de otros 100 avisos. Los mensajes solo nombran la cabecera, así que la respuesta no repite el valor. `POST /flows/validate` responde 200 con el aviso.
- Va después de `invalid_flow` y antes de `flow_id_mismatch`, de los 409 y de la comparación «sin cambios», en las tres operaciones (tabla de D6).
- La ficha `domain-flujos-sin-secretos` se reescribe: aviso neutral en la spec (dos códigos), rechazo del literal en la API, aviso del texto con marcadores. Dice expresamente que `literal_credential` es una **heurística, no una garantía**: se esquiva con un marcador (`"{{x}}abc123"` da `credential_header_not_secret`), con una cabecera fuera de la lista o poniendo el token en la query de la `url`. Enforcement: los tests de la spec y el e2e «Token pegado al crear».

### D11. `@franca/spec`: profundidad, forma acotada y avisos

- **`depth.ts`**: `MAX_FLOW_DEPTH = 1000` y `exceedsFlowDepth(value)`, iterativa con la misma medida que `exceedsDepth` del motor (un escalar vale 0, `[[1]]` vale 2; recorre `Object.keys`; un ciclo cuenta como demasiado profundo). Copia y no import: el motor depende de la spec, al revés sería un ciclo. Que el motor importe la de la spec es FOLLOW-UP (como el de `TEMPLATE_VAR`, 6.7 de `engine-base`) para no tocar `packages/engine/src` en esta feature.
- **`validateFlow`**: (1) profundidad → `{valid: false, issues: [issue de profundidad], warnings: []}`; (2) forma (`shape.ts`) → si falla, `{valid: false, issues: capped(shape), warnings: []}`; (3) `warnings = flowWarnings(flow)`; (4) semántica → `{valid: false, issues: capped(semantic), warnings}` o `{valid: true, flow, issues: [], warnings}`. Tipo: `warnings: FlowWarning[]` obligatorio en las dos ramas (aditivo para quien lee; nadie fuera construye resultados).
- **Forma por piezas (`shape.ts`)**, porque la ruta de errores era cuadrática en dos sitios (auditoría): `collapse` (O(errores × rutas `oneOf`)) y el propio ajv con `allErrors` sobre arrays anchos de elementos que fallan (en la raíz y dentro de un nodo). Ajv con `allErrors: false` y la validación nodo a nodo sí son lineales (medido). Dos instancias de ajv sobre el mismo `flow.schema.json`, `fast` (`allErrors: false`) y `detailed` (`allErrors: true`), y tres familias de validadores: el esquema completo, la **raíz sin nodos** (copia del esquema raíz hecha al cargar el módulo con `properties.nodes` sustituido por `{type: "array", minItems: 1}`, sin reglas copiadas a mano) y la definición de cada tipo de nodo. El algoritmo:
  1. `fast` con el esquema completo. Si pasa, no hay errores de forma (la ruta de un flujo válido no cambia de coste).
  2. **Raíz**: validar el flujo con el validador de raíz sin nodos (ajv no recorre `nodes`).
  3. **Nodos**, en orden de índice: un no objeto o un `type` desconocido da su issue sin ajv, como hoy; si no, `fast` contra la definición de su tipo y, si pasa, al siguiente.
  4. **Presupuesto de detalle**: una pieza con errores (la raíz o un nodo) se revalida con `detailed` y aporta todos sus errores solo si `JSON.stringify` de la pieza (para la raíz, una copia superficial sin `nodes`) tiene como mucho `SHAPE_DETAIL_MAX_CHARS` = 8192 caracteres y las piezas detalladas suman como mucho `SHAPE_DETAIL_BUDGET_CHARS` = 65536. Si no, aporta un solo issue: el primero de los errores de `fast` tras `collapse`. Peor caso medido para fijar los números: 8192 caracteres de predicados `{}` (unos 2700) cuestan ~14 ms con `allErrors`, y el presupuesto admite como mucho 8 piezas así (~110 ms). Un nodo normal ocupa menos de 2 KiB, así que un flujo normal mal escrito conserva el detalle de hoy (lo comprueban los tests existentes de `validate.test.ts`, que no cambian).
  5. **Tope** (`MAX_FLOW_ISSUES = 100`, exportado): deja de revisar nodos cuando los issues ya reunidos que se ordenan antes del siguiente nodo (los de la raíz con `path` menor que `/nodes/` y los de los nodos ya vistos) pasan de 100. Después ordena con `byPath` (el comparador de hoy, extraído) y, si hay más de 100, se queda con los 100 primeros y añade `{layer: "shape", path: "", code: "too_many_issues", message: "hay más errores: solo se muestran los 100 primeros"}`. La semántica se calcula entera (es lineal, ver el punto siguiente) y se recorta igual con `layer: "semantic"`.
  7. **Semántica y avisos lineales**: `templateVars` y `predicateVars` pasan a un recorrido con pila explícita que mete los nombres en un `Set` del nodo (un `matchAll` por texto, sin `flatMap` ni arrays intermedios por nivel); `flowWarnings` recorre igual. Coste O(tamaño del nodo). Lo prueba «Muchos marcadores en un body profundo» (< 500 ms; hoy 1874 ms, con pila 7 ms), y la mutación que restaura el `flatMap` lo pone en rojo.
- **`code` en el issue del tope**: `FlowIssue` gana el campo opcional `code?: 'too_many_issues'`; solo lo lleva el issue final del tope. Es aditivo: quien no lo lee no cambia, y el motor copia los issues tal cual. El issue de profundidad **no** lleva `code`: el motor construye el suyo en `checkFlow` sin código y `packages/engine/src` no se toca, así que añadirlo rompería «Mismo issue que el motor». Se distinguen por la presencia de `code`. Dar `code: "max_depth"` a los dos es FOLLOW-UP con el que hace que el motor importe la profundidad de la spec (7.2).
  6. **`collapse` lineal** por pieza: un `Set` con las rutas de los errores `oneOf`; cada error sube por sus antecesores (`lastIndexOf('/')`) hasta el primer `oneOf` o la raíz de la pieza. Las reglas de hoy no cambian: fuera los `if`; un `oneOf` se queda si no tiene otro `oneOf` antecesor; cualquier otro error se va si está dentro de un `oneOf`. Su coste está acotado por el presupuesto de detalle: solo ve errores de piezas de ≤ 8192 caracteres o el puñado de errores de `fast`.
- **Por qué 100 issues**: 100 errores sobran para corregir un flujo de arriba abajo (el editor los muestra en lista). El tope acota el cuerpo de `invalid_flow` (100 issues cuyos mensajes salen de la plantilla del esquema o repiten un `type`/`id` del propio cuerpo, así que no supera unas pocas veces el cuerpo recibido) y el trabajo de la fase de detalle. **`validateFlow` no recorta `warnings`**: la API necesita verlos todos para decidir `literal_credential` (D10), y un recorte escondería una credencial escrita después del aviso 100. Para no devolver megas, la spec exporta `capWarnings(warnings)` (`MAX_FLOW_WARNINGS = 100` + aviso final `too_many_warnings`, que entra en `FLOW_WARNING_CODES`) y la API lo aplica a toda lista `warnings` que responde. Descartado agrupar por nombre de cabecera: no acota los avisos de `url` (uno por nodo `http`). «El proveedor provee, el consumidor decide»: la spec da la lista completa y la herramienta de recorte; cada consumidor elige cuándo recortar.
- **Impacto en el motor**: `invalid_flow` del motor lleva `validateFlow(...).issues`, así que también queda acotado a 101. Sus tests comparan `issues` con `validateFlow(flow).issues` o miran `some`/`valid`, y ningún flujo de sus tests tiene más de 100 issues (`roto-semantica` tiene 12). Gate de la fase 1: `pnpm --filter @franca/engine test` sin tocar sus tests.
- **`warnings.ts`**: recorre los nodos ya con la forma correcta. `url_template_in_origin`: el origen escrito se corta con `indexOf` según la definición de la spec (primer `://`; después, el primero de `/ ? # \`) y se busca un marcador con `hasMarker` (`TEMPLATE_VAR` sin `g`); uno por `url`. Credenciales: nombres en minúsculas `authorization`, `proxy-authorization`, `cookie`, `x-api-key`, `api-key`, `x-auth-token`; valor texto con marcador → `credential_header_not_secret`, sin marcador → `credential_header_literal`; `secretRef` → nada. El puntero escapa `~` y `/` (RFC 6901). Orden con `byPath`; como cada regla emite como mucho un aviso por campo, no hay duplicados. `ignored_field` queda fuera (FOLLOW-UP de la feature 8).
- **Exportaciones** nuevas de `index.ts`: `FLOW_WARNING_CODES`, `type FlowWarning`, `type FlowWarningCode`, `MAX_FLOW_DEPTH`, `exceedsFlowDepth`, `MAX_FLOW_ISSUES`, `MAX_FLOW_WARNINGS`, `capWarnings`.
- **CLI**: sin cambios de código (sigue mostrando solo `issues`); mostrar avisos es FOLLOW-UP de la feature 8. Gana sola el no lanzar con flujos profundos y el tope.
- **Compatibilidad**: `flow.schema.json` y `types.ts` no cambian; `specVersion` sigue en `0.1`. Cambia el resultado de flujos inválidos con más de 100 issues (recortados) o con piezas grandes (un error por pieza), y rompe los flujos de más de 1000 niveles, que el motor ya rechazaba con el mismo issue. **Motor**: sin cambios en `src/`; `checkFlow` comprueba la profundidad dos veces (barato). `flow-depth-parity.test.ts` comprueba `MAX_FLOW_DEPTH === MAX_NESTING_DEPTH` y el escenario «Mismo issue que el motor». `llm-anthropic` y `apps/web` no usan `validateFlow`.

### D12. Infraestructura: Docker, turbo, variables y CI

- **`docker-compose.yml`** (raíz): servicio `postgres`, imagen `postgres:18.6-alpine` fijada, `POSTGRES_USER`/`POSTGRES_DB` `franca`, `POSTGRES_HOST_AUTH_METHOD: trust`, puerto `127.0.0.1:${FRANCA_POSTGRES_PORT:-5432}:5432`, volumen con nombre en `/var/lib/postgresql` (ruta de la 18) y `healthcheck` con `pg_isready`. Sin contraseña: el repo es público, no hay nada que filtrar ni que gitleaks marque, y el puerto solo escucha en loopback (mismo modelo de amenaza que la API).
- **Variables** (solo nombres, en `CLAUDE.md`): `DATABASE_URL` (obligatoria; con Docker, la del servicio `postgres`: usuario y base `franca`, sin contraseña, `127.0.0.1:5432`), `HOST`, `PORT` y `FRANCA_POSTGRES_PORT` (opcional, puerto local de Docker). `pnpm dev` y `pnpm test:e2e` leen `DATABASE_URL` del entorno de la shell; el fichero de ejemplo lo crea una persona (las guardas lo bloquean).
- **`turbo.json`**: tarea `db:generate` (D2); `test:e2e` con `dependsOn: ["^build", "build", "db:generate"]` (los tests de arranque ejecutan `dist/main.js`), `cache: false` (depende del estado de una base) y `passThroughEnv: ["DATABASE_URL"]`; una tarea propia `@franca/api#dev` (`dependsOn: ["^build", "db:generate"]`, `cache: false`, `persistent: true`, `passThroughEnv: ["DATABASE_URL", "HOST", "PORT"]`); la tarea `dev` genérica no cambia, porque `HOST`/`PORT` también los lee `next dev` de `apps/web` y no deben llegarle. `passThroughEnv` y no `env` para que el valor no entre en el hash de caché.
- **CI** (`.github/workflows/ci.yml`): `services.postgres` con la misma imagen, `trust`, puerto `5432:5432` y `options` de salud con `pg_isready`; `DATABASE_URL` **solo** en el `env` del paso `pnpm test:e2e`. Así los pasos `lint`, `typecheck`, `build` y `test` demuestran en cada PR que `pnpm check` no necesita la variable (enforcement del gotcha de `prisma.config.ts`). No hace falta un paso de migración: el `globalSetup` la aplica.

### D13. Arnés de tests

- **`vitest.config.e2e.ts`**: `globalSetup: ['./test/global-setup.ts']`, `fileParallelism: false` (todos los ficheros comparten una base y los escenarios cuentan totales), `testTimeout` 30 s.
- **`global-setup.ts`**: sin `DATABASE_URL` falla con un mensaje que la nombra y remite a `docker compose up -d` (sin su valor); con `PrismaClient` sobre esa URL crea `franca_e2e_<pid>_<aleatorio>` (si no conecta en 5 s: «¿está levantado Postgres?»); ejecuta `prisma migrate deploy` y `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (exige 0: esquema y migraciones no divergen) contra la base nueva; deja su URL en `process.env.DATABASE_URL` (los workers la heredan) y la ofrece con `provide`; en el `teardown`, `DROP DATABASE … WITH (FORCE)`.
- **Ayudas** (`test/helpers/`): `createTestApp({ overrides })` (mismo `AppModule`, `bodyParser: false`, `configureApp`, reloj que avanza, registro capturado); `resetDatabase()` (`TRUNCATE flow_versions, flows` antes de cada test); `writeDraftDirectly(id, text)` para los escenarios de borrador escrito a mano; flujos `hola`, `captacion-leads` y `faq-ia` leídos de `@franca/spec/examples` y variantes en texto (`1e400`, `__proto__`) enviadas tal cual con `Content-Type` explícito; `spec-text.ts` copiado de `llm-anthropic`, **una sola copia nueva** (compartirlo es FOLLOW-UP).
- **Concurrencia determinista**: `BarrierFlowsRepository extends FlowsRepository` sobrescribe `withLockedFlow` para esperar en una barrera de dos antes de `super.withLockedFlow`. Garantiza que las dos peticiones pasaron la validación y compiten por el bloqueo: sin `FOR UPDATE` las dos leerían `revision` 1 y las dos responderían 200, y el test fallaría. No hay ganchos de test en producción.
- **500, 503 y privacidad**: el 500 sustituye `FlowsRepository.findActive` por uno que lanza un `Error` cuyo mensaje contiene SQL y texto del flujo. El 503 sustituye `APP_CONFIG` por una URL con la contraseña `no-mostrar-1234` apuntando a un puerto cerrado y, en «Postgres mudo», a un `net.createServer(() => {})` del propio test (acepta y nunca contesta): `GET /flows`, `POST /flows` y `PUT /flows/hola` responden 503 y se mide que cada una tarde menos de 10 s. Todos comprueban la respuesta exacta y la salida capturada (logger de Nest y `process.stdout`/`stderr`).
- **Arranque**: `startup.e2e-spec.ts` lanza `node dist/main.js` con un entorno controlado (sin heredar `DATABASE_URL`): códigos de salida y mensajes de `HOST`, `PORT` y `DATABASE_URL`; `HOST` `""`, `" 127.0.0.1"`, `"::ffff:127.0.0.1"`, `"0.0.0.0"`, `"::"`, `localhost` y `PORT` `""`; con `PORT=0`, lee la línea «escuchando en» (dirección real del socket) y comprueba `127.0.0.1` y, con `HOST=::1`, `[::1]` (`it.skipIf` si la máquina no tiene loopback IPv6); y el escenario del valor que no aparece con la base caída lee la salida del proceso real.
- **Columnas**: `database.e2e-spec.ts` consulta `information_schema.columns`: `draft`, `definition` y `name_json` son `text`, y `flows.id`/`flow_versions.flow_id` tienen colación `C`.
- **Cobertura de la spec**: un solo test, `apps/api/test/spec-coverage.spec.ts` (unit, sin base, corre en `pnpm check`): cada `#### Scenario` de `flows-api` tiene un `it('<título>'` en `apps/api/test/**/*.e2e-spec.ts` o `apps/api/src/**/*.spec.ts`, cada uno de `flow-validation` lo tiene en `packages/spec/tests/` o en `packages/engine/tests/flow-depth-parity.test.ts` (rutas relativas al repo), y no hay títulos repetidos en ninguna de las dos.
- **Tests negativos validados mutando** (a mano, sin arnés de mutación en `apps/api` ni en `packages/spec`; se anota el resultado en la fase de QA): columna a `jsonb` → fallan el orden de cabeceras y el test de columnas; quitar `FOR UPDATE` → falla «Dos pestañas guardan a la vez»; quitar la profundidad de `validateFlow` → fallan los tests de `RangeError`; `Host` con `includes`/`startsWith` → falla `localhost.evil.example`; aceptar `W/"1"` → falla «Etiqueta débil»; no borrar `If-None-Match` → falla «Lectura condicional ignorada»; quitar el rechazo `literal_credential` → fallan sus escenarios; límite `+1` → falla «Justo en el límite y por encima»; publicar comparando el indicador en vez del texto → falla el escenario de borrador escrito a mano; validar siempre con `detailed` (sin presupuesto) → fallan por tiempo «Un nodo enorme con errores» y «Muchas variables rotas»; volver al `collapse` cuadrático → falla «Un mega de nodos vacíos»/«Un error real repetido»; quitar el tope → fallan «Más errores que el tope» y «Flujo inválido de un mega»; quitar del clasificador el `Error` de `pg` o el `P2028` «Unable to start…» → falla «Postgres mudo»; clasificar todo `P2028` como 503 → falla «Transacción caducada por el propio código»; restaurar el `flatMap` recursivo en `templateVars`/`predicateVars` → falla «Muchos marcadores en un body profundo»; quitar `capWarnings` de las respuestas → falla «Muchos avisos al validar»; decidir `literal_credential` con la lista recortada → falla «Credencial escrita después del aviso 100»; `HOST` con `trim()` o admitiendo `""` → fallan los arranques rechazados.

## Contrato de API

**Base URL**: `http://<HOST>:<PORT>` (por defecto `http://127.0.0.1:3001`). **Auth**: ninguna; la frontera es «solo esta máquina»: `Host` local (403 `forbidden_host`) y sin `Origin` (403 `forbidden_origin`), en este orden, antes de todo lo demás. Sin CORS. Una cabecera `Authorization` de la petición se ignora.

**Cuerpo**: como mucho 1 048 576 bytes (413); `Content-Type: application/json` con `charset=utf-8` opcional y sin compresión (415); JSON bien formado en UTF-8 (400 `invalid_json`). Respuestas `application/json; charset=utf-8`. Sin 304: `If-None-Match` e `If-Modified-Since` se ignoran.

**Errores**: cuerpo con exactamente `message` (español, para personas) y `error` (código estable), más los campos de su código. El cliente decide por `error`.

| HTTP | `error` | Cuándo | Campos extra |
|---|---|---|---|
| 400 | `invalid_json` | cuerpo vacío donde se exige, no UTF-8 o no JSON | — |
| 400 | `invalid_flow` | `validateFlow` no es válido (también profundidad) | `issues`, `warnings` |
| 400 | `literal_credential` | válido con algún aviso `credential_header_literal` en la lista completa (crear, actualizar, publicar) | `warnings` (solo los `credential_header_literal`) |
| 400 | `flow_id_mismatch` | `PUT` con un `id` distinto del de la ruta | — |
| 400 | `invalid_query` | `limit`/`offset`/`published` mal formados, fuera de rango o repetidos | — |
| 403 | `forbidden_host` | `Host` ausente o no local | — |
| 403 | `forbidden_origin` | petición con `Origin` | — |
| 404 | `not_found` | ruta o método desconocidos, `%` mal formado en la ruta | — |
| 404 | `flow_not_found` | `:flowId` que no cumple el patrón, inexistente o borrado | — |
| 404 | `version_not_found` | `:version` mal formado, > 2147483647 o inexistente | — |
| 409 | `flow_already_exists` | `POST /flows` con un `id` en uso | — |
| 409 | `flow_id_reserved` | `POST /flows` con el `id` de un flujo borrado | — |
| 412 | `revision_mismatch` | `If-Match` que no es `*` ni contiene `"<revisión actual>"` | `currentRevision`; cabecera `ETag` actual |
| 413 | `payload_too_large` | cuerpo > 1 MiB | — |
| 415 | `unsupported_media_type` | tipo de medio, `charset` o compresión no admitidos | — |
| 428 | `precondition_required` | `PUT` sin `If-Match` | — |
| 500 | `internal_error` | fallo inesperado; `message` es exactamente `"error interno"` | — |
| 503 | `database_unavailable` | Postgres no acepta conexiones, no contesta, corta la conexión a mitad o `DATABASE_URL` está mal configurada; en menos de 10 s (CRUD; `validate` no) | — |

**Recursos**

| Recurso | Campos (en este orden) |
|---|---|
| Flujo | `id` string · `name` string · `revision` int ≥ 1 · `latestVersion` int \| null · `unpublishedChanges` bool · `createdAt` ISO 8601 UTC · `updatedAt` ISO 8601 UTC · `flow` (forma JSON del borrador) · `warnings` `FlowWarning[]` |
| Resumen de flujo (listado) | el flujo sin `flow` ni `warnings` |
| Versión | `flowId` · `version` int ≥ 1 · `name` · `publishedAt` ISO 8601 UTC · `flow` · `warnings` |
| Resumen de versión | `flowId` · `version` · `name` · `publishedAt` |
| Página | `items` · `total` · `limit` · `offset` |
| `FlowWarning` | `code` (`FLOW_WARNING_CODES`) · `path` (JSON Pointer) · `nodeId?` · `message` |
| `FlowIssue` | `layer` · `path` · `nodeId?` · `code?` (solo `too_many_issues` en el issue final del tope) · `message` |

### `POST /flows/validate`
Valida sin guardar ni tocar la base. Cuerpo: el flujo. **200** siempre que el cuerpo sea JSON: `{"valid": true, "issues": [], "warnings": []}` o, con avisos, `{"valid": true, "issues": [], "warnings": [{"code": "url_template_in_origin", "path": "/nodes/6/request/url", "nodeId": "enviar-crm", "message": "el origen de la url (esquema, host o puerto) depende de una variable: un valor puede cambiar el destino de la petición"}]}`. Errores: 400 `invalid_json`, 403, 413, 415. Con un flujo inválido, `issues` tiene como mucho 101 entradas (100 y la final con `code` `too_many_issues`), lo mismo que el `invalid_flow` de las demás rutas. Toda lista `warnings` de cualquier respuesta tiene como mucho 101 entradas (`capWarnings`: 100 y `too_many_warnings`).

### `POST /flows`
Crea el flujo. Cuerpo: el flujo. **201** con `Location: /flows/<id>`, `ETag: "1"` y el recurso flujo:

```json
{"id": "hola", "name": "Hola", "revision": 1, "latestVersion": null, "unpublishedChanges": true, "createdAt": "2026-10-17T10:30:00.000Z", "updatedAt": "2026-10-17T10:30:00.000Z", "flow": {"specVersion": "0.1", "id": "hola", "name": "Hola", "start": "fin", "nodes": [{"id": "fin", "type": "end"}]}, "warnings": []}
```

Errores, en este orden: 413, 415, 400 `invalid_json`, 400 `invalid_flow`, 400 `literal_credential`, 409 `flow_already_exists` / `flow_id_reserved`. Ejemplos:

```json
{"message": "el flujo no es válido", "error": "invalid_flow", "issues": [{"layer": "shape", "path": "/nodes/0", "nodeId": "bienvenida", "message": "propiedad no permitida 'color'"}], "warnings": []}
{"message": "una cabecera de credenciales lleva el valor escrito en el flujo: usa una referencia a un secreto", "error": "literal_credential", "warnings": [{"code": "credential_header_literal", "path": "/nodes/6/request/headers/Authorization", "nodeId": "enviar-crm", "message": "la cabecera Authorization lleva el valor escrito en el flujo: las credenciales van como referencia a un secreto ({\"secret\": \"NOMBRE\"})"}]}
{"message": "ese id perteneció a un flujo borrado y no se puede reutilizar", "error": "flow_id_reserved"}
```

### `GET /flows`
Consulta: `limit` 1-100 (20), `offset` 0-2147483647 (0), `published` `true`/`false` (sin filtro si falta); desconocidos se ignoran. **200** con página de resúmenes, sin borrados, orden `updatedAt` desc e `id` asc por código: `{"items": [{"id": "hola", "name": "Hola", "revision": 1, "latestVersion": null, "unpublishedChanges": true, "createdAt": "2026-10-17T10:30:00.000Z", "updatedAt": "2026-10-17T10:30:00.000Z"}], "total": 1, "limit": 20, "offset": 0}`. Errores: 400 `invalid_query`, 503.

### `GET /flows/:flowId`
**200** con el recurso flujo y `ETag: "<revision>"`. Errores: 404 `flow_not_found`, 503.

### `PUT /flows/:flowId`
Sustituye el borrador. Cabecera **`If-Match` obligatoria** (`"<revision>"`, lista, o `*`). Cuerpo: el flujo completo (mismo `id`). **200** con el recurso y el `ETag` nuevo; sin cambios de texto, 200 con la misma `revision`, `ETag` y `updatedAt`. Errores, en este orden: 413, 415, 400 `invalid_json`, 404 `flow_not_found`, 428 `precondition_required`, 412 `revision_mismatch` (`{"message": "el borrador ha cambiado", "error": "revision_mismatch", "currentRevision": 2}` + `ETag: "2"`), 400 `invalid_flow`, 400 `literal_credential`, 400 `flow_id_mismatch`, 503.

### `DELETE /flows/:flowId`
Borrado lógico. `If-Match` opcional. **204** sin cuerpo. Errores: 404 `flow_not_found` (también si ya estaba borrado), 412 `revision_mismatch`, 503.

### `POST /flows/:flowId/versions`
Publica el borrador. `If-Match` opcional; cuerpo opcional e ignorado (pasa por 413/415/`invalid_json`). **201** con `Location: /flows/<id>/versions/<n>` y el recurso versión, o **200** con la última versión si el borrador tiene su mismo texto:

```json
{"flowId": "hola", "version": 1, "name": "Hola", "publishedAt": "2026-10-17T10:31:00.000Z", "flow": {"specVersion": "0.1", "id": "hola", "name": "Hola", "start": "fin", "nodes": [{"id": "fin", "type": "end"}]}, "warnings": []}
```

Errores, en este orden: 404 `flow_not_found`, 412, 400 `invalid_flow`, 400 `literal_credential`, 503.

### `GET /flows/:flowId/versions`
Mismos `limit`/`offset` que el listado. **200** con página de resúmenes de versión, de la más nueva a la más antigua: `{"items": [{"flowId": "hola", "version": 2, "name": "Hola 2", "publishedAt": "2026-10-17T10:32:00.000Z"}], "total": 2, "limit": 1, "offset": 0}`. Errores: 400 `invalid_query`, 404 `flow_not_found`, 503.

### `GET /flows/:flowId/versions/:version`
**200** con el recurso versión. Errores: 404 `flow_not_found`, 404 `version_not_found`, 503.

### Checklist de coherencia

- [x] Cada campo de respuesta tiene consumidor: `revision`/`ETag`, `unpublishedChanges`, `warnings` y fechas (editor, 8); `latestVersion` y `published` (chat, 7); `flowId`/`version` (sesiones, 6); los e2e los comprueban todos con `toEqual`.
- [x] Cada error tiene un escenario de la spec y un e2e; cada código está en `API_ERROR_CODES`. Los clientes (7, 8) aún no existen: espejar `API_ERROR_CODES` en la web con test de paridad es FOLLOW-UP de la 8.
- [x] Tipos y validación del flujo solo desde `@franca/spec` (`validateFlow`, `exceedsFlowDepth`, `FlowWarningCode`, `schema.$defs.id.pattern`); la API no copia reglas. Constantes espejadas con paridad: `MAX_FLOW_DEPTH` ↔ `MAX_NESTING_DEPTH` (test en el motor).
- [x] Permisos: sin usuarios ni owner (non-goal); la única frontera (loopback, `Host`, `Origin`) se aplica a todas las rutas, incluidas las desconocidas y `OPTIONS`.
- [x] Convivencia: 4 ficheros ajenos más el lockfile, justificados en D1; criterio de diff en la fase 6.

## Plan de verificación por capas

- **Unit (aplica)**: `packages/spec` (avisos positivos, negativos y orden; profundidad 997/998, 5000 predicados y el predicado en el límite; tope de issues; detalle por piezas); `apps/api` sin base: `loadConfig`, `isLocalHost`/`localOnly`, lectura y parseo del cuerpo, `matchesIfMatch`, `parseListQuery`, `flow-params`, `inspectFlowBody`, filtro de excepciones (incluido el `BadRequestException` de `URIError`), `isDatabaseUnavailable` con las formas reales de P1001, los dos `P2028` (503 y 500) y el `Error` de conexión de `pg`; `capWarnings`; y el test único de cobertura de escenarios de las dos capacidades. Todo test negativo se valida haciéndolo fallar a propósito.
- **Golden/contractual (aplica, ligero)**: cuerpos de respuesta y de error con `toEqual` de todas las claves; texto JSON crudo para el orden de cabeceras y `__proto__` (lo que rompería `jsonb`); test de tipos de columna y colación. Sin baselines protegidos.
- **Integración HTTP (aplica, el grueso)**: e2e con supertest contra Postgres real, un `it` por escenario de `flows-api`: happy path, 400 (`invalid_json`, `invalid_flow`, `literal_credential`, `flow_id_mismatch`, `invalid_query`), 403 (`Host`, `Origin`, CORS), 404 (`not_found`, `flow_not_found`, `version_not_found`), 409 (existente y reservado), 412, 413, 415, 428, 500, 503, concurrencia con barrera, borrado lógico y privacidad de registros; arranque con el proceso real.
- **Hipótesis de tamaño, coste y profundidad (aplica)**: los tests de D5; los de tiempo de `flow-validation` (~1 MiB de nodos `{}`, de nodos con un error real, de predicados en un solo nodo y de variables rotas, cada uno en menos de 2 s; medido hoy: de 3 s a minutos); «Flujo inválido de un mega» en el e2e (menos de 5 s); «Postgres mudo» y «Bloqueo que no se suelta» (menos de 10 s); «Muchos marcadores en un body profundo» (menos de 500 ms); y el orden 413 antes de 415 con un cuerpo comprimido de más de 1 MiB. Los topes de tiempo son holgados (un orden de magnitud por encima de lo medido con la implementación lineal) para no dar falsos rojos en CI.
- **Paridad (aplica)**: `MAX_FLOW_DEPTH` y el issue de profundidad iguales en spec y motor.
- **E2E de UI opción-al-menos-una-vez (no aplica)**: no hay UI.
- **Smoke de ruta (no aplica)**: no hay páginas.
- **Mutación (aplica en manual)**: ni `apps/api` ni `packages/spec` tienen arnés; la lista de mutaciones de D13 se ejecuta a mano en la fase de QA y se anota.
- **Manual con curl (aplica)**: fase 6, con `docker compose`, incluida la base parada y la que se para con la API en marcha.

## Plan de Ejecución

Fases secuenciales; cada una empieza cuando la anterior pasa su gate. Detalle de tareas en `tasks.md`. Recomendación: **`apply normal`**. El espacio de comportamiento es un CRUD con escenarios enumerados y una tubería HTTP fija, sin producto cartesiano grande. Un `bucle aislado` (`popi:loop`) no aporta frente al coste de levantar Postgres en cada iteración. La elección es del usuario.

| Fase | Agente | Ficheros | Criterio de salida |
|---|---|---|---|
| 1. Validador (`@franca/spec`) | `popi:backend-developer` | D11 (profundidad, forma por piezas, tope, avisos) + test de paridad del motor + README + ficha `domain-flujos-sin-secretos` | tests, build y `validate` de la spec y tests del motor en verde; `git diff --stat` sin `flow.schema.json`, `types.ts` ni `packages/engine/src` |
| 2. Persistencia | `popi:backend-developer` | D2, D3, D4, D9 (config), D12 (Docker, turbo, workspace, `CLAUDE.md`), arnés `globalSetup` + test de columnas | `pnpm check` sin `DATABASE_URL`; migración aplicada desde cero y sin deriva; test de columnas en verde |
| 3. Frontera HTTP | `popi:backend-developer` | D7, D8, D9 (`main.ts`), `validate` con `warnings` | unit en `pnpm check`; e2e de frontera y de arranque que no necesitan el CRUD (500, 503, privacidad y el resto de frontera van en la fase 4) |
| 4. Módulo `flows` | `popi:backend-developer` | D5, D6, D10; controlador y servicio; e2e por endpoint; cobertura de escenarios; fichas de wiki y reglas | `pnpm check` + `pnpm test:e2e` en verde; cobertura de `flows-api` y `flow-validation` completa |
| 5. CI | `popi:backend-developer` | `ci.yml` (D12) | YAML revisado; el verde en la PR es `DEPLOY-TIME` |
| 6. Verificación | `popi:qa-tester` (modo backend: e2e + adversarial + manual) | ninguno (solo tests que falten) | curl, mutaciones de D13, diff de alcance, privacidad de registros; informe |

Frontend y tests de frontend: **no aplican** (sin UI; las features 7 y 8 consumen este contrato).

## Risks / Trade-offs

- [Sin autenticación: cualquier proceso local lee y borra flujos] → loopback obligatorio, `Host`, `Origin` y negativa a arrancar; la deuda queda escrita: nada de despliegues hasta la feature de autenticación. Riesgo residual: un `GET` simple entre sitios (`<script src>`) no lleva `Origin`, pero sin CORS la página no puede leer la respuesta y los `GET` no cambian nada.
- [Prisma 7 + Nest 12 ESM: el cliente generado podría chocar con `isolatedModules`/decoradores] → `@ts-nocheck` en lo generado, `typecheck` y `build` como gate de la fase 2. Si fallara, se para la fase y se consulta (no se cambia de ORM en silencio).
- [La etiqueta `latest` de `prisma` es una RC] → versiones exactas; actualizar las tres a la vez.
- [pnpm bloquea los scripts de instalación de Prisma] → gate de instalación (D2).
- [Respuestas de hasta ~4,5 MiB] → aceptado en local; test de hipótesis (D5).
- [Postgres se cae con la API en marcha: un `error` del pool de `pg` sin oyente podría tumbar el proceso] → prueba manual en la fase 6 (parar el contenedor y pedir `GET /flows`); si el proceso muere, se para y se consulta antes de cerrar la fase (afecta al requisito «Base de datos no disponible»).
- [Datos de flujos borrados siguen en la base] → decisión 2 del orquestador; ninguna credencial escrita llega a guardarse (D10). Purga y papelera son FOLLOW-UP.
- [Colación `C` añadida a mano: una migración regenerada desde cero la perdería] → test de columnas.
- [Docker obligatorio para los e2e en local] → `pnpm check` no lo necesita; el `globalSetup` falla pronto y con un mensaje claro.
- [Contención: una transacción no consigue conexión en `maxWait`] → `P2028` «Unable to start…» → 503. [Una transacción interactiva supera su `timeout`] → `P2028` caducado → 500 con clase y código en el registro (es un fallo nuestro). Una espera de bloqueo larga se corta antes por `statement_timeout` (3,5 s) o `query_timeout` (4 s) < 10 s → 503.
- [El clasificador del 503 compara textos exactos de `pg`] → fixtures reales y dos e2e que producen las formas de verdad; una subida de `pg` que cambie un texto pone la CI en rojo, no da un 500 silencioso.
- [Un flujo inválido con piezas grandes pierde detalle (un error por pieza)] → solo pasa con nodos de más de 8192 caracteres o más de 64 KiB de piezas con errores; el editor (8) valida en vivo y corrige pieza a pieza.
- [Los topes de tiempo de los tests dependen de la máquina] → holgados (D13); se revisan en la primera ejecución de la CI (tarea 5.2) y, si alguno queda a menos del doble de su tope, se amplía antes del merge.

## Migration Plan

Base nueva, sin datos previos ni despliegues. Local: `docker compose up -d`, exportar `DATABASE_URL`, `pnpm --filter @franca/api db:migrate`, `pnpm dev`. Marcha atrás: `docker compose down -v` borra el volumen. Migraciones futuras: `db:migrate:dev --create-only`, revisión del SQL y `db:migrate`; nunca se edita una migración ya fusionada.

## Open Questions

Ninguna que cambie las specs, el enfoque o las tareas. Las decisiones de producto pendientes de la proposal las cerró el orquestador.
