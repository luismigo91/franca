# Proposal: nodo `input` en el motor (`engine-input`)

**Fecha**: 2026-10-16 · **Estado**: Draft · **Rama**: `feat/engine-input` · **Feature 2 de 8** del plan de ejecución de flujos (1 motor base, hecha).

## Why

El motor de la feature 1 ejecuta un flujo de principio a fin sin preguntar nada: en cuanto llega a un nodo `input` falla con `unsupported_node`, así que ningún flujo conversacional real (el ejemplo `captacion-leads` incluido) pasa de su primera pregunta. `continueSession` existe, pero hoy siempre rechaza. Esta feature hace que el motor pregunte, espere, valide y convierta la respuesta del usuario. Sin ella, las features 6 (persistir conversaciones) y 7 (web chat) no tienen nada que persistir ni que pintar.

## What Changes

- **Nodo `input` ejecutable.** Al llegar a él, el motor emite el `prompt` renderizado como evento `message`, después un evento nuevo `input` que describe la respuesta esperada, y la sesión queda en el estado nuevo `waiting`.
- **Camino feliz de `continueSession`.** Recibe la respuesta, comprueba su forma, la valida, la convierte según `inputType`, la guarda en `variable` y sigue ejecutando desde el `next` del nodo o desde el `next` de la opción elegida.
- **Entrada del usuario tipada.** `{ "text": string }` para todos los tipos salvo `choice`; `{ "choice": id }` en selección única; `{ "choices": [ids] }` en selección múltiple. Una entrada con otra forma se rechaza con el código nuevo `invalid_input`, sin consumir intento.
- **Validación y conversión por `inputType`** (`text`, `email`, `phone`, `number`, `url`, `date`, `boolean`, `choice`) con reglas cerradas y deterministas, sin reloj y sin tablas de numeración ni de países. Más `validation.min`/`max` (según el tipo), `validation.pattern` (con el mismo matcher lineal que `matches`) y un límite fijo de 4096 unidades de código por respuesta (cierra la parte de `input` del FOLLOW-UP 6.4 de `engine-base`).
- **Reintentos.** Si la respuesta no es válida, el motor emite `retryMessage` (o repite el `prompt`) y un `input` con el número de intento y el motivo del rechazo. Cuando se agotan los `maxRetries`, la sesión falla con el código nuevo `retries_exhausted`.
- **Códigos nuevos**: errores de sesión `invalid_validation` (el patrón o el rango del nodo no se pueden aplicar) y `retries_exhausted`; rechazo `invalid_input`.
- **Estado**: `status` gana `waiting` y el estado guarda el número de intento. `stateVersion` sigue en 1: el cambio es aditivo y los estados de la versión anterior se siguen aceptando.
- `input` deja de ser un nodo no soportado (`http` y `llm` lo siguen siendo).

Ningún cambio es **BREAKING** para consumidores reales, porque todavía no hay ninguno. Aun así, que `SessionStatus` y `EngineEvent` admitan valores nuevos rompe en compilación un `switch` exhaustivo que alguien hubiera escrito sobre ellos. Los golden del motor que terminaban en `pedir-nombre` se regraban.

### Decisiones de comportamiento (el porqué, en una línea)

| Decisión | Por qué |
|---|---|
| El prompt va en un evento `message` y el evento `input` va aparte, siempre como último evento | El cliente pinta todas las burbujas igual (con `typingDelayMs`). `input` cierra la operación, igual que `end` y `error` |
| `input` expone `inputType`, `choices` (`id`, `label` e `imageUrl` renderizados), `multiple`, `placeholder`, `attempt` y `reason`. No expone `value`, `validation` ni el nombre de la variable | Es lo que la feature 7 necesita para pintar. El cliente responde por `id` y la validación vive en un solo sitio, el motor |
| Una entrada con la forma equivocada, con un id desconocido o con un id repetido es un rechazo (`invalid_input`), no un reintento | Solo un cliente defectuoso produce esas entradas, nunca el usuario final. Un rechazo no gasta intentos ni toca el estado |
| Toda respuesta es obligatoria: un texto vacío tras recortar espacios o una selección múltiple vacía es inválida (`required`) | No hay noción de pregunta opcional en el formato. El autor puede ofrecer una opción «Ninguna» |
| Se recortan los espacios exteriores y se guarda el texto recortado; U+0000 y los sustitutos sueltos se rechazan | Es lo que espera quien escribe en un chat. Los espacios interiores y los saltos de línea se conservan. El texto guardado tiene que caber en cualquier almacén JSON (`jsonb` de Postgres no admite ninguno de los dos) |
| Límite de 4096 unidades de código UTF-16 por respuesta, medido antes de nada (`too_long`) | Es la cuarta parte del límite de renderizado (16384): la respuesta cabe en cualquier plantilla razonable. La comprobación es O(1) y protege al matcher |
| `email`: gramática WHATWG de `input type=email`, con al menos dos etiquetas en el dominio; el dominio se guarda en minúsculas | Es una definición pública, precisa y testable. El dominio no distingue mayúsculas, y normalizarlo ayuda a la feature 6 a identificar al contacto |
| `phone`: laxo. Admite dígitos, espacios, `-`, `.`, `()` y un `+` inicial, con entre 7 y 15 dígitos, y se guarda como `+` y dígitos | Sin datos de numeración por país (o una dependencia) no se puede garantizar E.164. Quien necesite E.164 puede exigir `^\+` con `pattern`, que se aplica al valor ya normalizado |
| `number`: `.` o `,` como separador decimal en cualquier `locale`, sin separador de miles. `1.500` y `1,500` se rechazan por ambiguos, igual que más de 15 cifras significativas o un valor fuera del rango normal de un number | En un chat en español se escribe tanto `1,5` como `1.500`. Guardar `1.5` cuando el usuario quería 1500 sería un error silencioso, como redondear `1234567890123456` o convertir `1e-400` en 0. Pedirlo otra vez es seguro |
| `url`: solo `http` o `https`; sin esquema se antepone `https://`; el host serializado debe ser un nombre de dominio (misma regla que el dominio del email, así que no se admiten IP); sin credenciales, espacios, controles, caracteres invisibles ni sustitutos sueltos; la serialización WHATWG, que es lo que se guarda, tiene 4096 unidades como mucho | En un chat se escribe `example.com`. Así se descartan `javascript:`, `mailto:`, las URL con usuario y contraseña y lo que el parser convertiría en otra cosa sin avisar (`12345` → `0.0.48.57`, `ex\u00adample.com` → `example.com`) |
| `date`: solo `AAAA-MM-DD` con fecha de calendario real | ISO es lo que ordenan bien `lt`/`gt`, y el formato local depende de la región (`es` frente a `en-US`). El cliente puede ofrecer un selector de fecha |
| `boolean`: `true`/`false` en cualquier idioma, más `sí`/`si`/`no` en `es` y `yes`/`y`/`no`/`n` en `en`; el idioma sale de `locale` (por defecto `es`) | Un cliente con botones envía siempre `true`/`false`, y quien escribe lo hace en el idioma del flujo. Añadir idiomas es un cambio aditivo |
| `min`/`max`: longitud en code points en `text`, valor en `number` y número de opciones en `choice` múltiple. Se ignoran en los demás tipos | Son los únicos tipos con una lectura numérica natural y sin reloj (en `date` habría que comparar con «hoy»). Ver preguntas abiertas |
| `pattern` se aplica a la forma textual del valor ya convertido, igual que `matches` | `validation.pattern` equivale a evaluar `variable matches pattern` después de guardar. Es la misma semántica y el mismo matcher lineal, sin ReDoS |
| Un `pattern` inválido o un `min` > `max` hacen fallar la sesión con `invalid_validation` antes de mostrar el prompt | No tiene sentido pedir una respuesta que nunca podrá validarse. Hasta que el validador lo detecte (FOLLOW-UP 6.1), lo hace el motor |
| Agotar `maxRetries` hace fallar la sesión con `retries_exhausted` y la variable no cambia | El formato no tiene salida `onExhausted` para `input`. Seguir con la variable vacía haría que un `http` posterior enviara datos incompletos sin avisar. En selección única ni siquiera hay un `next` al que seguir. Añadir `onExhausted` queda como FOLLOW-UP aditivo |
| Selección múltiple: se guarda un array de `value` (o `id`) en el orden del flujo y se sigue por el `next` del nodo | El orden no depende de en qué orden se pulsaron las opciones, así que `eq` y los golden son estables |
| Al reanudar, cada variable declarada toma su valor del estado (en la parte de su ámbito actual) y no se reaplican los `default`; lo que el flujo ya no declara se descarta | Reaplicar un `default` resucitaría valores que un `set` había vaciado. D9 de `engine-base` dejaba esta decisión a esta feature |
| Al continuar, el `input` que recibe la respuesta cuenta como el primer nodo del límite de 200 | Es coherente con «contando el primero» y mantiene acotado cada avance |

### Formato de flujo

- **`packages/spec/flow.schema.json` no cambia** y no hay que regenerar los tipos.
- **Una regla semántica nueva en `packages/spec/src/validate.ts`**: un `input` `choice` con `multiple: true` necesita `next`. Hoy el esquema solo exige `next` en los tipos que no son `choice`, y el validador solo exige el `next` de cada opción en la selección única, así que un flujo así valida pero no se puede ejecutar. La regla solo invalida flujos que ya no eran ejecutables, y ningún ejemplo de `packages/spec/examples/` se ve afectado. Es un fichero ajeno al motor que se abre por decisión explícita, junto a la regla gemela de la selección única.
- **Semántica que esta feature fija y que conviene anotar en RFC-0001** (amplía el FOLLOW-UP 6.3):
  - `placeholder` se renderiza como plantilla, como `alt`.
  - `validation.pattern` es literal.
  - Se ignoran los `choices[].next` en la selección múltiple, el `next` del nodo en la selección única y `multiple` fuera de `choice`.
  - `min`/`max` se ignoran en `email`, `phone`, `url`, `date`, `boolean` y `choice` única.

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `flow-engine`: nodo `input` (pregunta, evento `input`, espera, forma de la entrada, conversión y validación por tipo, reintentos), camino feliz de `continueSession`, estado `waiting`, códigos nuevos, reanudación de variables y privacidad de las respuestas. Se modifican los requisitos que hoy hacen fallar `input` con `unsupported_node`, los que excluyen la espera (ejecución, eventos, estado y continuación), el límite de pasos, el determinismo y los errores sin valores.

## Impact

- **`packages/engine`**: ejecutor de `input`, `continueSession`, lectura y escritura del estado, tipos públicos (estado `waiting`, evento `input`, códigos nuevos) y una constante pública con el límite de la respuesta. Las piezas existentes se reutilizan: `renderTemplate` y el matcher de `regex/` para `pattern`. Hay que regrabar los golden que terminaban en `pedir-nombre`.
- **`packages/spec`**: una regla semántica y su test en `tests/validate.test.ts`. No cambian el esquema ni los tipos.
- **Sin cambios** en `apps/api` ni en `apps/web`.
- **Consumidores futuros**: la feature 6 persiste el estado `waiting` y mapea `invalid_input` a un 4xx; la feature 7 pinta el evento `input` y envía las tres formas de entrada.
- **Dependencias**: ninguna nueva. El parser WHATWG de URL y `String.prototype.normalize` son del propio runtime y deterministas.

## Non-goals / Out of scope

- **Persistencia y ciclo de vida**: guardar estados, `sessionTimeoutMinutes`, almacenar contactos, concurrencia e idempotencia de dos `continueSession` sobre el mismo estado (feature 6, FOLLOW-UP 6.5).
- **Nodos `http` y `llm`** (features 3 y 4): siguen fallando con `unsupported_node`.
- **UI**: cómo se pintan el selector, los botones o el selector de fecha, y la validación en el cliente (feature 7). El motor no expone las reglas de validación.
- **Transcripción**: el motor no emite un evento que repita la respuesta del usuario. La transcripción la guarda el host.
- **Elegir una opción escribiendo** su etiqueta o su número (canales sin botones): lo resuelve el host traduciendo a `{choice}`.
- **Preguntas opcionales u omitibles**, adjuntos y ficheros.
- **Formatos locales**: fechas que no sean ISO, separadores de miles, booleanos en idiomas distintos de `es` y `en`, teléfonos E.164 deducidos del país, emails con caracteres no ASCII (IDN/EAI).
- **Cambios de esquema**: `onExhausted` en `input`, límites de fecha y avisos del validador por `min`/`max` ignorados o por un `pattern` inválido (FOLLOW-UP).
- **Autenticación y aislamiento por tenant**: no aplican al motor. Quién puede continuar una sesión lo decide el host (feature 6). La privacidad que sí depende del motor está en la spec: las respuestas inválidas no se guardan, y ni los errores ni los rechazos contienen la entrada.
- **Límite de longitud de lo que entra por `http` y por el contacto**: es el resto del FOLLOW-UP 6.4 y corresponde a las features 3 y 6.

## Plan de verificación por capas

| Capa | Veredicto | Razón |
|---|---|---|
| Unit | **Aplica** | La lógica pura nueva tiene muchas ramas: tablas de entrada por `inputType` (válidas, inválidas y normalización), `min`/`max` por tipo, orden de comprobación y motivo, forma de la entrada (`invalid_input`) y lectura del estado `waiting` con el contador roto |
| Escenarios de la spec | **Aplica** | Un `it` por cada `#### Scenario` del delta, con flujos que pasan `validateFlow` |
| Golden / contractual | **Aplica** | Los eventos `input` y el estado `waiting` son el contrato de las features 6 y 7. Hay que regrabar los dos golden de arranque de `captacion-leads` y añadir su conversación completa (arranque, nombre, email inválido, email válido, opción, fallo en `http`), una con rechazo y agotamiento y una de selección múltiple, revisando el diff. El resto de tipos lo cubren los unit y los escenarios |
| Paridad | **Aplica** | El `enum` de `inputType` del esquema debe coincidir con los tipos que convierte el motor, y todo código emitido (incluidos los motivos de `reason`) debe estar en su lista exportada |
| Propiedades | **Aplica** | Determinismo; flujo, estado y entrada congelados no se mutan; el estado `waiting` hace ida y vuelta por JSON; ninguna respuesta inválida aparece en el estado, los eventos o los errores (el test negativo se valida mutando el código) |
| Validador (`packages/spec`) | **Aplica** | La regla semántica nueva lleva su test mutando `captacion-leads.json`, como exige `.claude/rules/spec/flow-spec.md` |
| Integración HTTP | No aplica | No hay endpoints; llegan en las features 5 y 6 |
| E2E opción-al-menos-una-vez | No aplica | No hay UI; la feature 7 cubrirá cada `inputType` al menos una vez |
| Smoke de ruta | No aplica | No hay rutas |
| Mutación | No aplica ahora | No hay herramienta en el repo (FOLLOW-UP 6.8). Los conversores por tipo serán buenos candidatos cuando la haya |

## FOLLOW-UP que deja esta feature

- `onExhausted` opcional en `inputNode` (aditivo): si existe, agotar los reintentos sigue por esa salida en lugar de fallar.
- Límites de fecha en el formato (por ejemplo `minDate`/`maxDate` en ISO) y avisos del validador cuando hay `min`/`max` en un tipo que los ignora.
- Detectar en `validateFlow` un `validation.pattern` inválido o no admitido (amplía el FOLLOW-UP 6.1) y un `min` > `max`.
- Que el validador avise de `choices[].next` en una selección múltiple: hoy hace alcanzables nodos que nunca se ejecutan.
- Palabras booleanas en más idiomas, a medida que haya flujos con otros `locale`.

## Preguntas abiertas

Ninguna bloquea el diseño; las dos primeras son decisiones de producto que conviene confirmar:

- [ ] ¿Es aceptable que agotar los reintentos haga fallar la sesión (`retries_exhausted`) hasta que exista `onExhausted`? La alternativa era seguir con la variable vacía; se descartó por los datos incompletos y porque la selección única no tiene un `next` al que seguir.
- [ ] ¿Es aceptable rechazar `1.500` y `1,500` por ambiguos en `number`? Se pierde algún número con tres decimales y parte entera de 1 a 3 cifras, pero nunca se guarda un número equivocado.
- [ ] ¿Debe el evento `input` exponer pistas para el cliente (longitud máxima, `min`/`max`)? Se ha decidido que no, para que la validación viva en un solo sitio. La feature 7 puede pedirlas como cambio aditivo.
