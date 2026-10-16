# flow-engine Specification

## Purpose
Ejecutar flujos conversacionales de `@franca/spec` de forma pura, determinista y serializable: arranca y continúa sesiones, mantiene las variables, renderiza plantillas, aplica la semántica de cada nodo y emite eventos que el host persiste y el cliente muestra.

## Requirements

### Requirement: Solo se ejecutan flujos válidos
El motor MUST validar con `validateFlow` de `@franca/spec` la forma JSON del flujo recibido (ver «Forma JSON del flujo») en cada operación, aunque el host ya lo haya validado. Si no es válido, la operación se rechaza con el código `invalid_flow` y la lista `issues` que devolvió el validador, sin producir eventos ni estado.

#### Scenario: Flujo con error de forma
- **GIVEN** un flujo sin la propiedad `start`
- **WHEN** el host arranca una sesión con ese flujo
- **THEN** la operación se rechaza con código `invalid_flow`
- **AND** `issues` es igual a `validateFlow(flujo).issues`
- **AND** no se devuelven eventos ni estado

#### Scenario: Flujo con error semántico
- **GIVEN** un flujo bien formado cuyo nodo `jump` apunta a un nodo inexistente
- **WHEN** el host arranca una sesión
- **THEN** la operación se rechaza con código `invalid_flow` y al menos un issue de capa `semantic`

#### Scenario: Versión de formato no soportada
- **GIVEN** un flujo con `specVersion` `"0.2"`
- **WHEN** el host arranca una sesión
- **THEN** la operación se rechaza con código `invalid_flow`

### Requirement: Valores de variable y ausencia de valor
El valor de una variable SHALL ser un valor JSON: string, number, boolean, array u objeto. Una variable puede estar "sin valor"; `null` equivale a "sin valor" en todo el motor (en `default`, en valores de contacto y en `set`). El motor MUST NOT comprobar que un valor coincide con el `type` declarado: lo guarda tal cual.

#### Scenario: Default null equivale a sin valor
- **GIVEN** una variable `motivo` con `default: null` y un `condition` con la regla `motivo isSet`
- **WHEN** se ejecuta el `condition`
- **THEN** la regla es falsa

#### Scenario: El tipo declarado no se impone
- **GIVEN** una variable `edad` de tipo `number` y un `set` que le asigna `"abc"`
- **WHEN** se ejecuta el `set` y después un `message` con el texto `"{{edad}}"`
- **THEN** el mensaje contiene el texto `"abc"` y la sesión no falla

### Requirement: Forma JSON del flujo
El motor SHALL validar y ejecutar la forma JSON del flujo (la que produce `JSON.stringify`), de modo que lo validado es exactamente lo ejecutado. Un dato del flujo que no es representable en JSON, como un `default` `Infinity` en un flujo construido en memoria o el literal `1e400` en un fichero, se toma según esa forma.

#### Scenario: Default no representable en JSON
- **GIVEN** un flujo construido en memoria con la variable `n` y `default: Infinity`, y un `condition` con la regla `n isSet`
- **WHEN** se ejecuta el `condition`
- **THEN** la regla es falsa (la forma JSON de `Infinity` es `null`)
- **AND** el estado se puede serializar y volver a parsear como JSON sin cambios

#### Scenario: Se valida la forma JSON, no el objeto en memoria
- **GIVEN** un flujo construido en memoria cuyo `message` tiene como `text` un objeto con un método `toJSON` que devuelve `"Hola"`
- **WHEN** el host arranca una sesión
- **THEN** la operación no se rechaza y el evento `message` contiene el texto `"Hola"`

### Requirement: Profundidad máxima de anidamiento
El motor SHALL rechazar, antes de validarlos, copiarlos o ejecutarlos, los datos recibidos cuyo anidamiento supere 1000 niveles, con un resultado independiente de la pila disponible. La profundidad es el número de arrays y objetos anidados en el camino más largo (un escalar vale 0, `[[1]]` vale 2). Un flujo se rechaza con `invalid_flow` y un único issue de capa `shape`, `path` `""` y un mensaje que nombra el límite; un contacto, con `invalid_contact`; un estado, con `invalid_state`.

#### Scenario: Flujo demasiado anidado
- **GIVEN** un flujo con una variable `json` cuyo `default` tiene 5000 niveles de arrays anidados
- **WHEN** el host arranca una sesión o intenta continuarla con ese flujo
- **THEN** la operación se rechaza con `invalid_flow` y un único issue de capa `shape` con `path` `""` que nombra el límite
- **AND** la promesa no se rechaza

#### Scenario: Predicado demasiado anidado
- **GIVEN** un `condition` cuya regla `when` anida 5000 predicados `all` de un elemento
- **WHEN** el host arranca una sesión
- **THEN** la operación se rechaza con `invalid_flow`, sin lanzar

#### Scenario: Flujo justo en el límite de anidamiento
- **GIVEN** un flujo con una variable `json` cuyo `default` es un array con 997 niveles de anidamiento (el flujo tiene profundidad 1000), y otro con 998 niveles (profundidad 1001)
- **WHEN** el host arranca una sesión con cada uno
- **THEN** el primero no se rechaza y el segundo se rechaza con `invalid_flow`

#### Scenario: Contacto demasiado anidado
- **WHEN** el host arranca con un valor de contacto de 100000 niveles de arrays anidados, o con uno de 999 niveles (el contacto tiene profundidad 1000) y otro de 1000 niveles (profundidad 1001)
- **THEN** el de 100000 y el de 1000 niveles se rechazan con `invalid_contact` y el de 999 no se rechaza
- **AND** ninguna promesa se rechaza

#### Scenario: Estado demasiado anidado
- **GIVEN** un estado cuyo valor de una variable anida 100000 niveles de arrays
- **WHEN** el host intenta continuar la sesión
- **THEN** la operación se rechaza con `invalid_state`, sin lanzar

### Requirement: Arranque de sesión
Al arrancar, el motor SHALL crear una sesión nueva en la que cada variable declarada toma su `default` (copia independiente del flujo) o queda sin valor, y SHALL empezar a ejecutar en el nodo `start`. La operación es asíncrona (devuelve una promesa) y su resultado contiene `status`, la lista ordenada `events` y `state`.

#### Scenario: Se empieza en start, no en el primer nodo de la lista
- **GIVEN** un flujo cuyo `start` es el segundo nodo de `nodes`, de tipo `message`
- **WHEN** el host arranca una sesión
- **THEN** el primer evento es un `message` con `nodeId` igual a `start`

#### Scenario: Los defaults inicializan las variables
- **GIVEN** la variable `resuelto` con `default: false` y un `condition` con la regla `resuelto eq false` hacia un `end` con `outcome` `"pendiente"`
- **WHEN** el host arranca una sesión
- **THEN** la sesión termina con `outcome` `"pendiente"`

#### Scenario: Variable sin default empieza sin valor
- **GIVEN** la variable `nombre` sin `default` y un `message` con el texto `"Hola {{nombre}}."`
- **WHEN** el host arranca una sesión
- **THEN** el evento `message` contiene el texto `"Hola ."`

#### Scenario: Un default json se copia
- **GIVEN** una variable de tipo `json` con `default: {"items": []}`
- **WHEN** el host arranca una sesión y modifica el objeto devuelto en el estado
- **THEN** el `default` del objeto flujo no cambia

### Requirement: Valores iniciales de contacto
El motor SHALL aceptar al arrancar un objeto opcional de valores de contacto (nombre de variable → valor); omitirlo o pasar `null` equivale a `{}`. Cada variable con `scope: contact` toma el valor inyectado si está presente y no es `null`; si no, su `default`. Las claves que no corresponden a una variable `contact` del flujo se ignoran. Si el objeto o alguno de sus valores no es representable en JSON, la operación se rechaza con `invalid_contact`.

#### Scenario: El valor inyectado gana al default
- **GIVEN** la variable `email` con `scope: contact` y `default: "sin-email"`
- **WHEN** el host arranca con los valores de contacto `{"email": "ana@example.com"}`
- **THEN** `email` vale `"ana@example.com"` en la sesión

#### Scenario: Un valor inyectado null deja el default
- **GIVEN** la variable `email` con `scope: contact` y `default: "sin-email"`
- **WHEN** el host arranca con `{"email": null}`
- **THEN** `email` vale `"sin-email"`

#### Scenario: Se ignoran claves ajenas al flujo
- **GIVEN** un flujo cuya única variable de contacto es `email`
- **WHEN** el host arranca con `{"email": "ana@example.com", "empresa": "Acme"}`
- **THEN** la operación no se rechaza y el estado no contiene `empresa`

#### Scenario: No se inyecta en variables de sesión
- **GIVEN** la variable `segmento` con `scope: session` (o sin `scope`) y `default: "pyme"`
- **WHEN** el host arranca con `{"segmento": "empresa"}`
- **THEN** `segmento` vale `"pyme"`

#### Scenario: Valor de contacto no representable en JSON
- **WHEN** el host arranca con un valor de contacto `NaN`, `Infinity`, una función o una instancia de `Date`
- **THEN** la operación se rechaza con código `invalid_contact` y no se devuelven eventos ni estado

#### Scenario: Valores de contacto que no son un objeto
- **WHEN** el host arranca pasando como valores de contacto un array o un string
- **THEN** la operación se rechaza con código `invalid_contact`

#### Scenario: Valores de contacto omitidos o null
- **GIVEN** la variable `email` con `scope: contact` y `default: "sin-email"`
- **WHEN** el host arranca sin valores de contacto, con `null` o con `{}`
- **THEN** la operación no se rechaza y `email` vale `"sin-email"` en los tres casos

#### Scenario: Nombres de variable que coinciden con propiedades de Object
- **GIVEN** las variables de sesión `constructor` sin `default` y `__proto__`, y un `set` que asigna `"x"` a `__proto__`
- **WHEN** se ejecutan `constructor isSet`, `__proto__ eq "x"` y un `message` con el texto `"[{{constructor}}]"`
- **THEN** la primera regla es falsa, la segunda verdadera y el mensaje es `"[]"`
- **AND** el estado, serializado y vuelto a parsear como JSON, conserva `__proto__` como una variable más

### Requirement: Valores de contacto expuestos en el estado
El estado SHALL exponer los valores actuales de todas las variables `scope: contact` declaradas en el flujo, con `null` para las que estén sin valor, para que el host pueda persistirlas. Las asignaciones de `set` a una variable de contacto se reflejan ahí. Las variables de sesión no aparecen en esa vista.

#### Scenario: Un set actualiza el valor de contacto
- **GIVEN** la variable `email` con `scope: contact` y un `set` que le asigna `"nuevo@example.com"`
- **WHEN** la sesión termina
- **THEN** los valores de contacto del estado contienen `email: "nuevo@example.com"`

#### Scenario: Una variable de contacto vaciada aparece como null
- **GIVEN** la variable de contacto `email` inyectada con un valor y un `set` que le asigna `null`
- **WHEN** la sesión termina
- **THEN** los valores de contacto del estado contienen `email: null`

#### Scenario: Las variables de sesión no se exponen como contacto
- **GIVEN** un flujo con la variable de sesión `segmento` y la de contacto `email`
- **WHEN** la sesión termina
- **THEN** los valores de contacto del estado tienen exactamente la clave `email`

### Requirement: Ejecución hasta que la sesión se detiene
Cada operación de avance SHALL ejecutar nodos encadenados, sin intervención externa, hasta que la sesión termina en un `end` (`status` `ended`) o falla (`status` `failed`). En esta feature ninguna operación deja la sesión esperando al usuario.

#### Scenario: Cadena completa hasta el fin
- **GIVEN** un flujo `message` → `set` → `condition` → `end`
- **WHEN** el host arranca una sesión
- **THEN** el resultado tiene `status` `ended` y los eventos `message` y `end`, en ese orden

### Requirement: Eventos de salida
El motor SHALL producir eventos con estas formas: `{type: "message", nodeId, content, typingDelayMs}`, `{type: "end", nodeId, outcome}` y `{type: "error", nodeId, code, message}`. Los eventos se devuelven en el orden en que ocurren. Cada operación produce como mucho un `end` o un `error`, y siempre es el último evento.

#### Scenario: El fin es el último evento
- **GIVEN** un flujo con dos `message` seguidos de un `end`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son `message`, `message`, `end` y no hay ningún `error`

#### Scenario: El error es el último evento
- **GIVEN** un flujo cuyo segundo nodo es de tipo `http`
- **WHEN** el host arranca una sesión
- **THEN** el último evento es de tipo `error` y no hay ningún evento `end`

### Requirement: Retardo de escritura expuesto en los mensajes
Cada evento `message` SHALL incluir `typingDelayMs`, igual a `settings.typingDelayMs` del flujo o a 600 si no está definido. El motor MUST NOT esperar ese tiempo: aplicar el retardo es responsabilidad del cliente.

#### Scenario: Retardo definido en el flujo
- **GIVEN** un flujo con `settings.typingDelayMs` 400
- **WHEN** se emite un evento `message`
- **THEN** su `typingDelayMs` es 400

#### Scenario: Retardo por defecto
- **GIVEN** un flujo sin `settings`
- **WHEN** se emite un evento `message`
- **THEN** su `typingDelayMs` es 600

#### Scenario: Retardo cero
- **GIVEN** un flujo con `settings.typingDelayMs` 0
- **WHEN** se emite un evento `message`
- **THEN** su `typingDelayMs` es 0

#### Scenario: El motor no espera
- **GIVEN** un flujo con tres `message` y `settings.typingDelayMs` 10000, con los temporizadores simulados y detenidos
- **WHEN** el host arranca una sesión
- **THEN** la operación se resuelve sin avanzar los temporizadores

### Requirement: Nodo message
Un nodo `message` SHALL renderizar sus elementos de `content` en orden, emitir un único evento `message` con ellos y continuar en `next`. Un elemento `text` se emite como `{kind: "text", text}`; uno multimedia como `{kind, url}` más `alt` solo si el flujo lo define. `text`, `url` y `alt` se renderizan como plantillas.

#### Scenario: Varios elementos en un solo evento
- **GIVEN** un `message` con un elemento `text` y un elemento `image`
- **WHEN** se ejecuta
- **THEN** se emite un único evento `message` cuyo `content` tiene los dos elementos en el mismo orden

#### Scenario: Multimedia con plantillas
- **GIVEN** `nombre` = `"Ana"` y un elemento `{kind: "image", url: "https://example.com/{{nombre}}.png", alt: "Foto de {{nombre}}"}`
- **WHEN** se ejecuta el `message`
- **THEN** el elemento emitido es `{kind: "image", url: "https://example.com/Ana.png", alt: "Foto de Ana"}`

#### Scenario: Multimedia sin alt
- **GIVEN** un elemento `{kind: "video", url: "https://example.com/v.mp4"}`
- **WHEN** se ejecuta el `message`
- **THEN** el elemento emitido no tiene la propiedad `alt`

### Requirement: Sustitución de plantillas
El motor SHALL sustituir cada marcador `{{nombre}}` (con espacios opcionales dentro de las llaves y `nombre` con la forma de `varName`) por la forma textual del valor actual de esa variable; una variable sin valor se sustituye por cadena vacía. Cualquier otro texto entre llaves se deja literal.

#### Scenario: Marcador con espacios
- **GIVEN** `nombre` = `"Ana"`
- **WHEN** se renderiza `"Hola {{ nombre }}, ¿qué tal {{nombre}}?"`
- **THEN** el resultado es `"Hola Ana, ¿qué tal Ana?"`

#### Scenario: Variable sin valor
- **GIVEN** `nombre` sin valor
- **WHEN** se renderiza `"Gracias, {{nombre}}."`
- **THEN** el resultado es `"Gracias, ."`

#### Scenario: Patrones que no son marcadores
- **WHEN** se renderizan `"{{a.b}}"`, `"{nombre}"` y `"{{ 1x }}"`
- **THEN** cada resultado es idéntico a su entrada

### Requirement: Forma textual de los valores
La forma textual de un valor SHALL ser: el propio string; para un number, su representación en la serialización JSON estándar; `"true"` o `"false"` para un boolean; la serialización JSON compacta para arrays y objetos; cadena vacía si no hay valor. No se aplica formato por `locale`.

#### Scenario: Números sin formato local
- **GIVEN** `importe` = 1500.5
- **WHEN** se renderiza `"{{importe}}"`
- **THEN** el resultado es `"1500.5"` (no `"1.500,5"`)

#### Scenario: Booleanos
- **GIVEN** `resuelto` = true
- **WHEN** se renderiza `"{{resuelto}}"`
- **THEN** el resultado es `"true"`

#### Scenario: Objetos y arrays
- **GIVEN** `datos` = `{"a": "x", "b": [1, 2]}`
- **WHEN** se renderiza `"{{datos}}"`
- **THEN** el resultado es `{"a":"x","b":[1,2]}`

### Requirement: Plantillas en una pasada y como texto plano
El motor SHALL renderizar en una sola pasada: el texto insertado desde una variable no se vuelve a interpretar como plantilla. La salida es texto plano: el motor MUST NOT escapar ni interpretar HTML o Markdown; el cliente debe presentarla como texto.

#### Scenario: Un valor con marcadores no se expande
- **GIVEN** `comentario` = `"{{email}}"` y `email` = `"ana@example.com"`
- **WHEN** se renderiza `"Dijiste: {{comentario}}"`
- **THEN** el resultado es `"Dijiste: {{email}}"`

#### Scenario: El HTML pasa sin tocar
- **GIVEN** `nombre` = `"<b>Ana</b>"`
- **WHEN** se renderiza `"Hola {{nombre}}"`
- **THEN** el resultado es `"Hola <b>Ana</b>"`

### Requirement: Tamaño máximo de un texto renderizado
El resultado de renderizar una plantilla (cada `text`, `url` y `alt` de un `message` o de un `end`, y cada string que asigna `set`) SHALL tener como mucho 16384 unidades de código UTF-16. Si una plantilla lo supera, la sesión MUST fallar con el error `value_too_large` y el `nodeId` del nodo que la renderiza, sin emitir el `message` de ese nodo ni aplicar esa asignación. Los eventos anteriores y las asignaciones anteriores del mismo `set` se conservan. El error no incluye el texto ni los valores.

#### Scenario: Crecimiento por duplicación
- **GIVEN** la variable `a` con `default: "x"` y un ciclo `set` (`a` = `"{{a}}{{a}}"`) → `condition` → mismo `set`, donde la regla del `condition` nunca se cumple y lleva a un `end` (para que el flujo sea válido) y su `else` vuelve al `set`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `value_too_large` y el `nodeId` del `set` en su decimoquinta ejecución, no con `step_limit_exceeded`
- **AND** el estado conserva `a` con 16384 caracteres
- **AND** ni el evento `error` ni el error del estado contienen `"xx"`

#### Scenario: Justo en el límite
- **GIVEN** la variable `a` con un `default` de 16384 caracteres
- **WHEN** se ejecuta un `message` con el texto `"{{a}}"` y después otro con el texto `"{{a}}!"`
- **THEN** se emite el primer `message` y la sesión falla con `value_too_large` y el `nodeId` del segundo

#### Scenario: Los valores no renderizados no se limitan
- **GIVEN** la variable de contacto `notas` inyectada con un string de 20000 caracteres y un `condition` con la regla `notas isSet` hacia un `end`
- **WHEN** el host arranca una sesión
- **THEN** la sesión termina con `status` `ended` y el estado conserva `notas` íntegra

### Requirement: Nodo set
Un nodo `set` SHALL aplicar sus asignaciones en orden, de modo que cada una ve el resultado de las anteriores, y continuar en `next` sin emitir eventos. Un number o un boolean se guardan tal cual; un string se renderiza como plantilla y se guarda el texto resultante; `null` deja la variable sin valor.

#### Scenario: Asignaciones secuenciales
- **GIVEN** un `set` con `a` = `"x"` seguido de `b` = `"{{a}}-y"`
- **WHEN** se ejecuta
- **THEN** `b` vale `"x-y"`

#### Scenario: Literales con tipo
- **GIVEN** un `set` con `n` = 3 y `ok` = true
- **WHEN** se ejecuta y después se evalúan `n gt 2` y `ok eq true`
- **THEN** ambas reglas son verdaderas y `n` es de tipo number en el estado

#### Scenario: Un string con plantilla produce texto
- **GIVEN** `n` = 3 y un `set` con `copia` = `"{{n}}"`
- **WHEN** se ejecuta
- **THEN** `copia` vale el string `"3"`

#### Scenario: Null vacía la variable
- **GIVEN** `motivo` = `"precio"` y un `set` con `motivo` = null
- **WHEN** se ejecuta y después se evalúa `motivo isSet`
- **THEN** la regla es falsa

#### Scenario: Set no emite eventos
- **GIVEN** un flujo `set` → `end` sin `content`
- **WHEN** el host arranca una sesión
- **THEN** el único evento es `end`

### Requirement: Nodo jump
Un nodo `jump` SHALL continuar en su `target` sin emitir eventos ni modificar variables.

#### Scenario: Salto transparente
- **GIVEN** un flujo `jump` → `message` → `end`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son `message` y `end`, y el `message` tiene el `nodeId` del destino del salto

### Requirement: Nodo condition
Un nodo `condition` SHALL evaluar sus `rules` en el orden del array y continuar en el `next` de la primera cuyo `when` sea verdadero; si ninguna lo es, continúa en `else`. Tras la primera regla verdadera no se evalúan las siguientes. No emite eventos.

#### Scenario: Gana la primera regla verdadera
- **GIVEN** un `condition` con dos reglas verdaderas hacia `a` y `b`, en ese orden
- **WHEN** se ejecuta
- **THEN** la sesión continúa en `a`

#### Scenario: Ninguna regla verdadera
- **GIVEN** un `condition` cuyas reglas son todas falsas
- **WHEN** se ejecuta
- **THEN** la sesión continúa en `else`

#### Scenario: Las reglas posteriores a la ganadora no se evalúan
- **GIVEN** un `condition` cuya primera regla es verdadera y la segunda usa `matches` con la regex inválida `"("`
- **WHEN** se ejecuta
- **THEN** la sesión continúa en el `next` de la primera regla y no hay error

### Requirement: Predicados all y any
Un predicado `all` SHALL ser verdadero si y solo si todos sus elementos lo son, y `any` si y solo si alguno lo es. Se evalúan de izquierda a derecha con cortocircuito (`all` se detiene en el primer falso, `any` en el primer verdadero) y pueden anidarse hasta la profundidad máxima de anidamiento (ver «Profundidad máxima de anidamiento»).

#### Scenario: all con un elemento falso
- **GIVEN** `segmento` = `"pyme"` y el predicado `all` de `segmento eq "pyme"` y `segmento eq "empresa"`
- **WHEN** se evalúa
- **THEN** es falso

#### Scenario: any con un elemento verdadero
- **GIVEN** `segmento` = `"pyme"` y el predicado `any` de `segmento eq "empresa"` y `segmento eq "pyme"`
- **WHEN** se evalúa
- **THEN** es verdadero

#### Scenario: El cortocircuito evita errores
- **GIVEN** un `all` cuyo primer elemento es falso y cuyo segundo es una regla `eq` sin `value`
- **WHEN** se evalúa
- **THEN** es falso y no hay error

#### Scenario: Predicados anidados
- **GIVEN** `a` = 1, `b` = 2 y el predicado `any` de [`all` de [`a eq 1`, `b eq 3`], `all` de [`a eq 1`, `b eq 2`]]
- **WHEN** se evalúa
- **THEN** es verdadero

### Requirement: Lectura numérica de valores
Un valor se puede leer como número si es un number, o si es un string que, sin los espacios en blanco iniciales y finales, cumple la gramática de número de JSON (punto como separador decimal). El motor SHALL usar esta lectura en las coerciones de los operadores de comparación.

#### Scenario: Strings numéricos y no numéricos
- **WHEN** se comparan con `eq` contra el number 42 los strings `"42"`, `" 42 "`, `"42.0"`, `"4.2e1"`, `"42abc"`, `"0x2A"` y `""`
- **THEN** los cuatro primeros dan verdadero y los tres últimos falso

#### Scenario: Coma decimal no es número
- **WHEN** se evalúa `"1,5" eq 1.5`
- **THEN** es falso

### Requirement: Operadores eq y neq
`eq` SHALL ser verdadero cuando: ambos son strings idénticos (distingue mayúsculas); ambos son number iguales; ambos son boolean iguales; ambos son arrays u objetos estructuralmente iguales; uno es number y el otro un string legible como número del mismo valor; uno es boolean y el otro el string `"true"`/`"false"` correspondiente; o la variable no tiene valor y `value` es `null`. En otro caso es falso. `neq` es siempre la negación de `eq`.

#### Scenario: Strings con mayúsculas distintas
- **GIVEN** `segmento` = `"Pyme"`
- **WHEN** se evalúan `segmento eq "pyme"` y `segmento neq "pyme"`
- **THEN** `eq` es falso y `neq` verdadero

#### Scenario: Boolean frente a string
- **GIVEN** `resuelto` = `"true"` (string)
- **WHEN** se evalúa `resuelto eq true`
- **THEN** es verdadero

#### Scenario: Tipos distintos sin coerción
- **GIVEN** `flag` = true
- **WHEN** se evalúan `flag eq 1` y `flag eq "1"`
- **THEN** ambas son falsas

#### Scenario: Igualdad estructural
- **GIVEN** `datos` = `{"a": 1, "b": [1, 2]}`
- **WHEN** se evalúan `datos eq {"b": [1, 2], "a": 1}` y `datos eq {"a": 1, "b": [2, 1]}`
- **THEN** la primera es verdadera (el orden de claves no importa) y la segunda falsa (el orden de los arrays sí)

#### Scenario: Sin coerción dentro de estructuras
- **GIVEN** `lista` = `[1, 2]`
- **WHEN** se evalúa `lista eq ["1", "2"]`
- **THEN** es falso

#### Scenario: Variable sin valor
- **GIVEN** `motivo` sin valor
- **WHEN** se evalúan `motivo eq null`, `motivo eq ""` y `motivo neq "precio"`
- **THEN** la primera es verdadera, la segunda falsa y la tercera verdadera

#### Scenario: Valor presente frente a null
- **GIVEN** `motivo` = `""`
- **WHEN** se evalúa `motivo eq null`
- **THEN** es falso

### Requirement: Operadores de orden gt, gte, lt y lte
Si la variable y `value` se pueden leer como número, `gt`, `gte`, `lt` y `lte` SHALL compararlos numéricamente. Si no, y ambos son strings, se comparan por orden de unidades de código (sin `locale`), lo que ordena bien fechas ISO 8601 con el mismo formato. En cualquier otro caso (boolean, array, objeto, sin valor, `null`) la regla es falsa.

#### Scenario: Comparación numérica
- **GIVEN** `empleados` = 51
- **WHEN** se evalúan `empleados gt 50`, `empleados gte 51`, `empleados lt 51` y `empleados lte 51`
- **THEN** son verdadera, verdadera, falsa y verdadera

#### Scenario: Strings numéricos se comparan como números
- **GIVEN** `empleados` = `"10"`
- **WHEN** se evalúan `empleados gt 9` y `empleados gt "9"`
- **THEN** ambas son verdaderas

#### Scenario: Fechas ISO
- **GIVEN** `fecha` = `"2026-10-16"`
- **WHEN** se evalúa `fecha lt "2026-11-01"`
- **THEN** es verdadero

#### Scenario: String no numérico frente a number
- **GIVEN** `nombre` = `"abc"`
- **WHEN** se evalúan `nombre gt 5` y `nombre lt 5`
- **THEN** ambas son falsas

#### Scenario: Sin valor o tipos no ordenables
- **GIVEN** `edad` sin valor y `ok` = true
- **WHEN** se evalúan `edad gt 0`, `edad lt 0` y `ok gt false`
- **THEN** las tres son falsas

### Requirement: Operadores contains y startsWith
Si la variable es un array, `contains` SHALL ser verdadero cuando algún elemento es `eq` a `value`. Si es un string, number o boolean, `contains` y `startsWith` operan sobre su forma textual y sobre la de `value` (que debe ser string, number o boolean), distinguiendo mayúsculas; un `value` de texto vacío da verdadero. En cualquier otro caso la regla es falsa.

#### Scenario: Subcadena
- **GIVEN** `motivo` = `"Precio del envío"`
- **WHEN** se evalúan `motivo contains "envío"`, `motivo contains "precio"` y `motivo startsWith "Precio"`
- **THEN** son verdadera, falsa y verdadera

#### Scenario: Pertenencia a un array con coerción de eq
- **GIVEN** `opciones` = `["a", "b"]` y `numeros` = `[1, 2]`
- **WHEN** se evalúan `opciones contains "b"`, `numeros contains "2"` y `opciones startsWith "a"`
- **THEN** son verdadera, verdadera y falsa

#### Scenario: Forma textual de un number
- **GIVEN** `cp` = 28001
- **WHEN** se evalúa `cp startsWith "28"`
- **THEN** es verdadero

#### Scenario: Value vacío
- **GIVEN** `motivo` = `"x"`
- **WHEN** se evalúa `motivo contains ""`
- **THEN** es verdadero

#### Scenario: Casos que dan falso
- **GIVEN** `datos` = `{"a": 1}`, `motivo` sin valor y `texto` = `"abc"`
- **WHEN** se evalúan `datos contains "a"`, `motivo contains "a"` y `texto contains {"a": 1}`
- **THEN** las tres son falsas

### Requirement: Operador matches
`matches` SHALL interpretar `value` como una expresión regular ECMAScript en modo Unicode, sin más flags, y ser verdadero si encuentra coincidencia en cualquier posición de la forma textual de la variable (string, number o boolean). Si la variable es un array, un objeto o no tiene valor, la regla es falsa.

#### Scenario: Coincidencia anclada
- **GIVEN** `cp` = `"28001"`
- **WHEN** se evalúan `cp matches "^\\d{5}$"` y `cp matches "^\\d{4}$"`
- **THEN** la primera es verdadera y la segunda falsa

#### Scenario: Coincidencia parcial y mayúsculas
- **GIVEN** `texto` = `"xxABCxx"`
- **WHEN** se evalúan `texto matches "ABC"` y `texto matches "abc"`
- **THEN** la primera es verdadera y la segunda falsa

#### Scenario: Modo Unicode
- **GIVEN** `emoji` = `"😀"`
- **WHEN** se evalúa `emoji matches "^.$"`
- **THEN** es verdadero

#### Scenario: Number como texto
- **GIVEN** `cp` = 28001
- **WHEN** se evalúa `cp matches "^28"`
- **THEN** es verdadero

#### Scenario: Variable sin valor
- **GIVEN** `cp` sin valor
- **WHEN** se evalúa `cp matches ".*"`
- **THEN** es falso

### Requirement: Evaluación de matches en tiempo lineal
Como el patrón lo escribe el autor y el texto lo aporta el usuario, el motor MUST evaluar `matches` en tiempo lineal respecto a la longitud del texto y MUST NOT ejecutar el patrón con el motor de retroceso nativo.

#### Scenario: Retroceso catastrófico en tiempo lineal
- **GIVEN** `texto` = 5000 caracteres `"a"` seguidos de `"!"`
- **WHEN** se evalúan `texto matches "^(a+)+$"` y `texto matches "(a|aa)*!$"`
- **THEN** la primera es falsa y la segunda verdadera, y la operación termina

### Requirement: Construcciones admitidas en matches
`matches` SHALL admitir solo construcciones regulares: literales, `.`, clases (`[...]`, `\d`, `\w`, `\s`, `\p{...}` y sus negaciones), escapes, grupos (`(...)`, `(?:...)` y `(?<nombre>...)` con nombres no repetidos), alternativa `|`, cuantificadores (`*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}` y sus variantes perezosas) y las aserciones `^`, `$`, `\b` y `\B`.

#### Scenario: Construcciones admitidas
- **GIVEN** `cp` = `"28001"` y `nombre` = `"Ana"`
- **WHEN** se evalúan `cp matches "^(?<prov>\\d{2})\\d+?$"`, `nombre matches "^\\p{L}+$"` y `nombre matches "\\bAna\\b"`
- **THEN** las tres son verdaderas

### Requirement: Tamaño máximo del patrón de matches
El tamaño de un patrón de `matches` SHALL contar lo que el motor emite al compilarlo, sin expandirlo: átomo o aserción, 1; secuencia, la suma; alternativa de k ramas, la suma más k-1; repetición, 0 si su contenido vale 0 y si no contenido × copias + pasos opcionales (`{n}`: n y 0; `{n,m}`: m y m-n; `{n,}`: max(n, 1) y 1; `*`, `+`, `?` como `{0,}`, `{1,}`, `{0,1}`). No puede superar 1000, lo que acota el programa a 2001 instrucciones.

#### Scenario: Patrón por encima del tamaño máximo
- **GIVEN** `texto` = `"a"`
- **WHEN** se evalúan por separado `texto matches "a{1000}"`, `texto matches "a{1001}"` y `texto matches "(a{40}){40}"`
- **THEN** la primera es falsa sin error, y la segunda y la tercera hacen fallar la sesión con código `invalid_rule`

#### Scenario: Alternativas vacías repetidas
- **GIVEN** `texto` = `"a"`
- **WHEN** se evalúan por separado `(?:(?:|){1000}){1000}`, `(?:(?:|){1000}){1000}a` y `(?:(?:(?:|){1000}){1000}){1000}a`
- **THEN** las tres hacen fallar la sesión con código `invalid_rule` en milisegundos, sin agotar la memoria

#### Scenario: Cuantificadores apilados
- **GIVEN** `texto` = `"a"` y un patrón que anida 98 veces `(?:a)*` (cada uno dentro del anterior) y lo repite `{999}` seguido de `b`
- **WHEN** se evalúa
- **THEN** la sesión falla con código `invalid_rule`

#### Scenario: Contadores desmesurados
- **GIVEN** `texto` = `""`
- **WHEN** se evalúan por separado `^(?:){` seguido de 400 nueves y `}$`, y `a{1,` seguido de 400 nueves y `}`
- **THEN** la primera es verdadera (repetir lo que no consume nada no cuesta) y la segunda hace fallar la sesión con código `invalid_rule`

### Requirement: Profundidad máxima de anidamiento del patrón de matches
El anidamiento de grupos de un patrón de `matches` (de cualquier tipo: `(...)`, `(?:...)`, `(?<nombre>...)`) SHALL ser como mucho 100. Se comprueba recorriendo el patrón de forma iterativa, antes de compilarlo con el motor nativo y de analizarlo, de modo que el resultado no dependa de la pila disponible. Un patrón que lo supera hace fallar la sesión con `invalid_rule`.

#### Scenario: Patrón demasiado anidado
- **GIVEN** `texto` = `"a"`
- **WHEN** se evalúan por separado un patrón con 100 grupos `(?:` anidados alrededor de `a`, uno con 101 y uno con 100000
- **THEN** el primero es verdadero y los otros dos hacen fallar la sesión con código `invalid_rule`

#### Scenario: Paréntesis que no abren grupo
- **GIVEN** `texto` = `"("`
- **WHEN** se evalúan por separado un patrón de 150 `\(` seguidos y un patrón `[` + 150 `(` + `]`
- **THEN** ninguno falla por profundidad: los paréntesis escapados y los de una clase no cuentan como grupos

### Requirement: Operadores isSet e isEmpty
`isSet` SHALL ser verdadero si y solo si la variable tiene valor. `isEmpty` SHALL ser verdadero si la variable no tiene valor, es un string vacío o formado solo por espacios en blanco, un array vacío o un objeto vacío. `0` y `false` no están vacíos. Ambos ignoran `value` si está presente.

#### Scenario: String vacío
- **GIVEN** `nombre` = `""`
- **WHEN** se evalúan `nombre isSet` y `nombre isEmpty`
- **THEN** ambas son verdaderas

#### Scenario: Solo espacios
- **GIVEN** `nombre` = `"   "`
- **WHEN** se evalúa `nombre isEmpty`
- **THEN** es verdadero

#### Scenario: Cero, false y colecciones
- **GIVEN** `n` = 0, `ok` = false, `lista` = `[]` y `datos` = `{}`
- **WHEN** se evalúa `isEmpty` sobre cada una
- **THEN** `n` y `ok` dan falso; `lista` y `datos` dan verdadero

#### Scenario: Se ignora value
- **GIVEN** `nombre` = `"Ana"`
- **WHEN** se evalúa `{variable: "nombre", op: "isSet", value: false}`
- **THEN** es verdadero

### Requirement: Reglas que no se pueden evaluar
Si una regla que se llega a evaluar no tiene la propiedad `value` (salvo `isSet` e `isEmpty`), o usa `matches` con un `value` que no es string, no es una regex válida, usa una construcción no admitida (referencias hacia atrás, lookahead, lookbehind, modificadores en línea o nombres de grupo repetidos) o supera el tamaño o la profundidad máximos, la sesión MUST fallar con el error `invalid_rule` y el `nodeId` del `condition`, sin continuar en ninguna salida (tampoco en `else`).

#### Scenario: Falta value
- **GIVEN** un `condition` cuya única regla es `{variable: "segmento", op: "eq"}`
- **WHEN** se ejecuta
- **THEN** la sesión falla con un evento `error` de código `invalid_rule` y no continúa en `else`

#### Scenario: Regex inválida
- **GIVEN** `cp` = `"28001"` y una regla `cp matches "("`
- **WHEN** se evalúa
- **THEN** la sesión falla con código `invalid_rule`

#### Scenario: Value no string en matches
- **GIVEN** una regla `cp matches 5`
- **WHEN** se evalúa
- **THEN** la sesión falla con código `invalid_rule`

#### Scenario: Construcción no admitida en matches
- **GIVEN** `texto` = `"aa"`
- **WHEN** se evalúa por separado cada una de las reglas `texto matches "(a)\\1"`, `texto matches "a(?=a)"`, `texto matches "(?<=a)a"` y `texto matches "(?<x>a)|(?<x>b)"`
- **THEN** cada evaluación hace fallar la sesión con código `invalid_rule`

### Requirement: Nodo end
Un nodo `end` SHALL emitir primero un evento `message` con su `content` renderizado, si lo tiene, y después un evento `end` con su `outcome` (o `null` si no lo define). La sesión queda con `status` `ended` y el estado registra el `outcome`.

#### Scenario: Fin con contenido y outcome
- **GIVEN** `nombre` = `"Ana"` y un `end` con `outcome` `"lead-pyme"` y el texto `"Gracias, {{nombre}}."`
- **WHEN** se ejecuta
- **THEN** los eventos son un `message` con `"Gracias, Ana."` y un `end` con `outcome` `"lead-pyme"`, ambos con el `nodeId` del `end`
- **AND** el estado tiene `status` `ended` y `outcome` `"lead-pyme"`

#### Scenario: Fin sin contenido ni outcome
- **GIVEN** un `end` sin `content` ni `outcome`
- **WHEN** se ejecuta
- **THEN** el único evento que produce es `end` con `outcome` `null`

### Requirement: Nodos aún no soportados
Al llegar a un nodo `input`, `http` o `llm`, el motor MUST NOT ejecutarlo: la sesión falla con el error `unsupported_node`, el `nodeId` de ese nodo y un mensaje que nombra su tipo. Los eventos producidos antes en la misma operación se conservan.

#### Scenario: Ejemplo de captación de leads
- **GIVEN** el flujo `packages/spec/examples/captacion-leads.json`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son un `message` de `bienvenida` y un `error` de código `unsupported_node` con `nodeId` `pedir-nombre`
- **AND** el resultado tiene `status` `failed`

#### Scenario: Ejemplo de FAQ con IA
- **GIVEN** el flujo `packages/spec/examples/faq-ia.json`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son un `message` de `saludo` con `typingDelayMs` 400 y un `error` `unsupported_node` con `nodeId` `asistente`

#### Scenario: Nodo http tras un set
- **GIVEN** un flujo `set` → `http`
- **WHEN** el host arranca una sesión
- **THEN** el único evento es un `error` `unsupported_node` con el `nodeId` del `http`, y la asignación del `set` consta en el estado

### Requirement: Límite de pasos por avance
Cada operación SHALL ejecutar como mucho 200 nodos, contando el primero. Antes de ejecutar el nodo 201 la sesión falla con el error `step_limit_exceeded` y el `nodeId` de ese nodo; los eventos anteriores se conservan. El límite se comprueba antes de mirar el tipo del nodo y el contador se reinicia en cada operación.

#### Scenario: Ciclo sin mensajes
- **GIVEN** un `condition` cuya regla nunca se cumple, con `else` hacia un `jump` que vuelve al `condition`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `step_limit_exceeded` y es el único evento

#### Scenario: Ciclo con mensajes
- **GIVEN** un ciclo `message` → `condition` → mismo `message`, con el `message` como `start`, donde la regla del `condition` nunca se cumple y lleva a un `end` (para que el flujo sea válido) y su `else` vuelve al `message`
- **WHEN** el host arranca una sesión
- **THEN** se emiten 100 eventos `message` seguidos de un `error` `step_limit_exceeded` con el `nodeId` del `message`

#### Scenario: Justo en el límite
- **GIVEN** una cadena lineal de 199 nodos `set` o `jump` terminada en un `end` (200 nodos ejecutados)
- **WHEN** el host arranca una sesión
- **THEN** la sesión termina con `status` `ended`

#### Scenario: Un nodo por encima del límite
- **GIVEN** una cadena lineal de 200 nodos `set` o `jump` terminada en un `end` (201 nodos)
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `step_limit_exceeded` y el `nodeId` del `end`

#### Scenario: El límite gana a un nodo no soportado
- **GIVEN** una cadena lineal de 200 nodos `set` o `jump` terminada en un nodo `http`
- **WHEN** el host arranca una sesión
- **THEN** el error es `step_limit_exceeded`, no `unsupported_node`

### Requirement: Estado de sesión serializable
El estado MUST ser un valor JSON puro, sin referencias al objeto flujo, e incluir la versión de su propio formato. El host lo trata como opaco salvo `status` (`ended` o `failed`), el `outcome` si terminó, el error (`code` y `nodeId`) si falló y los valores de contacto.

#### Scenario: Ida y vuelta por JSON
- **GIVEN** el estado devuelto por cualquier operación
- **WHEN** se serializa y se vuelve a parsear como JSON
- **THEN** el resultado es estructuralmente igual al estado original

#### Scenario: Estado tras un fallo
- **GIVEN** una sesión que falla con `unsupported_node` en el nodo `pedir-nombre`
- **WHEN** el host lee el estado
- **THEN** tiene `status` `failed` y el error con código `unsupported_node` y `nodeId` `pedir-nombre`

### Requirement: Ejecución determinista y sin efectos externos
Con el mismo flujo y las mismas entradas, el motor SHALL devolver resultados estructuralmente iguales. MUST NOT leer el reloj, generar aleatoriedad, leer el entorno, acceder a red o disco, ni escribir en consola. MUST NOT mutar el flujo, los valores de contacto ni el estado recibidos.

#### Scenario: Dos ejecuciones iguales
- **GIVEN** un flujo y unos valores de contacto
- **WHEN** el host arranca dos sesiones con ellos
- **THEN** ambos resultados (`status`, `events` y `state`) son estructuralmente iguales

#### Scenario: Sin escritura en consola
- **GIVEN** espías sobre todos los métodos de `console`
- **WHEN** se ejecutan sesiones que terminan, que fallan y que se rechazan
- **THEN** ningún método de `console` se ha llamado

#### Scenario: Entradas congeladas
- **GIVEN** un flujo con un `set` y unos valores de contacto, ambos congelados en profundidad
- **WHEN** el host arranca una sesión
- **THEN** la operación no falla y las entradas no han cambiado

### Requirement: Los errores no revelan valores de variables
Los eventos `error`, el error registrado en el estado y los rechazos MUST NOT incluir valores de variables (marcadas `pii` o no) ni valores de contacto. Pueden incluir códigos, ids de nodo, nombres de variable, operadores y datos escritos en el flujo.

#### Scenario: Regla inválida sobre una variable pii
- **GIVEN** la variable `email` con `pii: true` y valor `"ana@example.com"`, y una regla `email matches "("`
- **WHEN** la sesión falla con `invalid_rule`
- **THEN** ni el evento `error` ni el error del estado contienen `"ana@example.com"`

#### Scenario: Rechazo de contacto inválido
- **WHEN** el host arranca con los valores de contacto `{"email": "ana@example.com", "edad": NaN}`
- **THEN** el rechazo `invalid_contact` puede nombrar `edad` pero no contiene `"ana@example.com"`

### Requirement: Continuar una sesión
La operación de continuar SHALL recibir el flujo, el estado y la entrada del usuario (cuyo formato define el nodo `input`), y comprobar en este orden: flujo válido (`invalid_flow`), estado bien formado y de versión conocida (`invalid_state`), estado del mismo `id` de flujo y con su nodo presente (`state_mismatch`), sesión activa (`session_not_active`). Un rechazo no produce eventos ni modifica el estado.

#### Scenario: Sesión terminada
- **GIVEN** el estado de una sesión con `status` `ended`
- **WHEN** el host intenta continuarla con el mismo flujo
- **THEN** la operación se rechaza con `session_not_active` y el estado recibido no cambia

#### Scenario: Sesión fallida
- **GIVEN** el estado de una sesión con `status` `failed`
- **WHEN** el host intenta continuarla con el mismo flujo
- **THEN** la operación se rechaza con `session_not_active`

#### Scenario: Estado de otro flujo
- **GIVEN** el estado de una sesión del flujo `a`
- **WHEN** el host intenta continuarla con un flujo válido de `id` `b`
- **THEN** la operación se rechaza con `state_mismatch`

#### Scenario: Nodo del estado ya no existe
- **GIVEN** el estado de una sesión terminada en el nodo `fin` y una versión del mismo flujo sin el nodo `fin`
- **WHEN** el host intenta continuarla con esa versión
- **THEN** la operación se rechaza con `state_mismatch`

#### Scenario: Estado mal formado o de versión desconocida
- **WHEN** el host intenta continuar con el estado `{}` o con un estado cuya versión de formato no reconoce el motor
- **THEN** la operación se rechaza con `invalid_state`

#### Scenario: El flujo se comprueba primero
- **GIVEN** un flujo inválido y un estado mal formado
- **WHEN** el host intenta continuar
- **THEN** la operación se rechaza con `invalid_flow`
