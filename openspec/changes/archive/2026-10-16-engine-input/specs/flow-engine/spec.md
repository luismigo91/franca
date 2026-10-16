## ADDED Requirements

### Requirement: Nodo input: pregunta y espera
Al llegar a un nodo `input`, el motor SHALL emitir un evento `message` con su `prompt` renderizado y después un evento `input` (ver «Evento input»), ambos con el `nodeId` del input, y detener la operación con `status` `waiting`. Preguntar no modifica ninguna variable. El estado en espera tiene como `nodeId` el del input, `outcome` `null` y error `null`.

#### Scenario: Ejemplo de captación de leads
- **GIVEN** el flujo `packages/spec/examples/captacion-leads.json`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son un `message` de `bienvenida`, un `message` de `pedir-nombre` con el texto `"¿Cómo te llamas?"` y un `input` de `pedir-nombre` con `inputType` `"text"`, en ese orden
- **AND** el resultado tiene `status` `waiting`
- **AND** el estado tiene `status` `waiting`, `nodeId` `pedir-nombre`, `outcome` `null` y error `null`

#### Scenario: Prompt con plantillas
- **GIVEN** `nombre` = `"Ana"` y un `input` cuyo `prompt` tiene el texto `"Encantado, {{nombre}}. ¿Tu email?"`
- **WHEN** se ejecuta el input
- **THEN** el evento `message` contiene el texto `"Encantado, Ana. ¿Tu email?"` y lleva el `typingDelayMs` del flujo

#### Scenario: Preguntar no toca la variable
- **GIVEN** la variable de contacto `email` inyectada con `"previo@example.com"` y un `input` de tipo `email` sobre `email`
- **WHEN** el host arranca una sesión y esta queda esperando en el input
- **THEN** los valores de contacto del estado contienen `email: "previo@example.com"`

### Requirement: Evento input
El evento `input` SHALL tener la forma `{type: "input", nodeId, inputType, attempt, reason}`. `attempt` es el número de intento (1 la primera vez que se pregunta) y `reason`, el motivo por el que se rechazó la respuesta anterior, o `null` si no hubo ninguna. Si el flujo define `placeholder`, el evento lo incluye renderizado como plantilla; si no, no tiene esa propiedad. Nunca incluye la `validation`, el nombre de la variable ni la respuesta del usuario.

#### Scenario: Input de texto mínimo
- **GIVEN** un `input` de tipo `text` sin `placeholder`
- **WHEN** se ejecuta
- **THEN** el evento `input` es exactamente `{type: "input", nodeId, inputType: "text", attempt: 1, reason: null}`, sin las propiedades `placeholder`, `choices` ni `multiple`

#### Scenario: Placeholder con plantilla
- **GIVEN** `nombre` = `"ana"` y un `input` de tipo `email` con `placeholder` `"{{nombre}}@empresa.com"`
- **WHEN** se ejecuta
- **THEN** el evento `input` tiene `placeholder` `"ana@empresa.com"`

#### Scenario: La validación no se expone
- **GIVEN** un `input` de tipo `text` con `validation` `{pattern: "^\\d{5}$", min: 5, max: 5, retryMessage: "Revisa el código"}`
- **WHEN** se ejecuta
- **THEN** el evento `input` no contiene el patrón, los límites, el `retryMessage` ni el nombre de la variable

### Requirement: Opciones en el evento input
Cuando `inputType` es `choice`, el evento `input` SHALL incluir `multiple` (`false` si el flujo no lo define) y `choices`, con un elemento `{id, label}` por opción, en el orden del flujo. `label` va renderizado como plantilla, y si la opción define `imageUrl`, se añade renderizada. El `value` de las opciones no se incluye. En los demás tipos, el evento no tiene `choices` ni `multiple`, aunque el nodo defina `multiple`.

#### Scenario: Opciones del ejemplo
- **GIVEN** una sesión de `captacion-leads` que llega a `pedir-tamano`
- **WHEN** se emite su evento `input`
- **THEN** tiene `inputType` `"choice"`, `multiple` `false` y `choices` `[{id: "pequena", label: "1 a 10"}, {id: "mediana", label: "11 a 50"}, {id: "grande", label: "Más de 50"}]`, sin ningún `value`

#### Scenario: Label e imagen con plantillas
- **GIVEN** `nombre` = `"Ana"` y una opción con `label` `"Para {{nombre}}"` e `imageUrl` `"https://example.com/{{nombre}}.png"`, y otra opción sin `imageUrl`
- **WHEN** se emite el evento `input`
- **THEN** la primera opción es `{id, label: "Para Ana", imageUrl: "https://example.com/Ana.png"}` y la segunda no tiene la propiedad `imageUrl`

#### Scenario: Selección múltiple
- **GIVEN** un `input` `choice` con `multiple: true`
- **WHEN** se emite su evento `input`
- **THEN** tiene `multiple` `true`

#### Scenario: multiple fuera de choice
- **GIVEN** un `input` de tipo `text` con `multiple: true`
- **WHEN** se emite su evento `input`
- **THEN** no tiene las propiedades `multiple` ni `choices`

### Requirement: Tamaño máximo de los textos de un input
Cada elemento del `prompt` y del `retryMessage`, el `placeholder` y cada `label` e `imageUrl` de las opciones SHALL respetar el límite de «Tamaño máximo de un texto renderizado». Si uno lo supera, la sesión MUST fallar con `value_too_large` y el `nodeId` del input, sin emitir ningún `message` ni `input` de ese nodo. Los eventos anteriores se conservan y el error no incluye el texto.

#### Scenario: Label demasiado largo
- **GIVEN** la variable `a` con un `default` de 16384 caracteres, un `message` previo y un `input` `choice` con una opción de `label` `"{{a}}!"`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son el `message` previo y un `error` `value_too_large` con el `nodeId` del input, y no hay ningún `message` del input

#### Scenario: Retry message demasiado largo
- **GIVEN** una sesión esperando en un input con `retryMessage` `"{{a}}!"`, donde `a` tiene 16384 caracteres
- **WHEN** el host continúa con una respuesta inválida
- **THEN** la sesión falla con `value_too_large` y el `nodeId` del input, y el único evento es el `error`

### Requirement: Forma de la entrada del usuario
Al continuar una sesión en espera, `input` SHALL ser un objeto plano con una sola propiedad: `{text: string}` si el `inputType` del nodo no es `choice`, `{choice: id}` en selección única y `{choices: [id, …]}` en selección múltiple. Si no tiene esa forma, si nombra un id que no es una opción del nodo o si repite un id, la operación se rechaza con `invalid_input`, sin eventos, sin consumir intento y sin modificar el estado.

#### Scenario: Formas incorrectas en un input de texto
- **GIVEN** una sesión esperando en un input de tipo `text`
- **WHEN** el host continúa por separado con `"Ana"`, `{text: 5}`, `{text: "Ana", extra: 1}`, `{choice: "a"}`, `{}`, `null` y sin `input`
- **THEN** cada operación se rechaza con `invalid_input`, sin eventos, y el estado recibido no cambia

#### Scenario: Texto en un input de opciones
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** el host continúa con `{text: "1 a 10"}`
- **THEN** la operación se rechaza con `invalid_input`

#### Scenario: Ids desconocidos o repetidos
- **GIVEN** una sesión esperando en un input `choice` con `multiple: true` y opciones `a` y `b`
- **WHEN** el host continúa por separado con `{choices: ["a", "z"]}`, `{choices: ["a", "a"]}`, `{choices: ["a", 1]}`, `{choices: "a"}` y `{choice: "a"}`
- **THEN** cada operación se rechaza con `invalid_input`

#### Scenario: Id desconocido en selección única
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** el host continúa con `{choice: "enorme"}`
- **THEN** la operación se rechaza con `invalid_input`

#### Scenario: Un rechazo no consume intento
- **GIVEN** una sesión esperando en un input con `attempt` 1
- **WHEN** el host continúa con `{text: 5}` (rechazada) y después, con el mismo estado de antes, con una respuesta inválida
- **THEN** la segunda operación emite un `input` con `attempt` 2

#### Scenario: Entrada muy anidada
- **WHEN** el host continúa una sesión en espera con `{text: x}`, donde `x` anida 100000 niveles de arrays
- **THEN** la operación se rechaza con `invalid_input` y la promesa no se rechaza

### Requirement: Respuesta de texto obligatoria y acotada
En los tipos distintos de `choice`, el motor SHALL tratar como inválido, antes que cualquier otra comprobación, un `text` de más de 4096 unidades de código UTF-16 (`reason` `too_long`), y como inválido (`required`) uno que queda vacío al quitarle los espacios en blanco iniciales y finales. Las demás comprobaciones y el valor guardado parten del texto ya sin esos espacios.

#### Scenario: Espacios exteriores
- **GIVEN** una sesión esperando en un input de tipo `text` sobre `nombre`
- **WHEN** el host continúa con `{text: "  Ana Pérez \n"}`
- **THEN** `nombre` vale `"Ana Pérez"`

#### Scenario: Respuesta vacía
- **GIVEN** una sesión esperando en un input de tipo `text`
- **WHEN** el host continúa por separado con `{text: ""}` y `{text: "  \n "}`
- **THEN** ambas respuestas son inválidas con `reason` `required`

#### Scenario: Justo en el límite de longitud
- **GIVEN** una sesión esperando en un input de tipo `text`
- **WHEN** el host continúa por separado con 4096 caracteres `"a"`, con 4097 y con `"Ana"` rodeado de espacios hasta sumar 4097 unidades
- **THEN** la primera se acepta y las otras dos son inválidas con `reason` `too_long`

#### Scenario: Respuesta enorme con un patrón costoso
- **GIVEN** una sesión esperando en un input de tipo `text` con `validation.pattern` `"^(a+)+$"`
- **WHEN** el host continúa con 1000000 caracteres `"a"`
- **THEN** la respuesta es inválida con `reason` `too_long` y la operación termina

### Requirement: Conversión según inputType
El valor que se guarda SHALL depender solo del `inputType` del nodo, nunca del `type` declarado de la variable. Con `text`, se guarda como string el texto recortado, y se conservan sus espacios interiores, saltos de línea y marcado. Los demás tipos se convierten según sus requisitos; si el texto no tiene el formato del tipo, la respuesta es inválida con `reason` `invalid_format`.

#### Scenario: Texto con saltos de línea y marcado
- **GIVEN** una sesión esperando en un input de tipo `text` sobre `comentario`
- **WHEN** el host continúa con `{text: "<b>Hola</b>\nsegunda línea"}`
- **THEN** `comentario` vale exactamente `"<b>Hola</b>\nsegunda línea"`

#### Scenario: El tipo de la variable no manda
- **GIVEN** la variable `edad` de tipo `string` y un input de tipo `number` sobre ella
- **WHEN** el host continúa con `{text: "30"}`
- **THEN** `edad` vale el number 30 en el estado

### Requirement: Caracteres que no se pueden guardar
En los tipos distintos de `choice`, una respuesta cuyo texto recortado contiene U+0000 o un sustituto UTF-16 suelto (una mitad de un par sin la otra) SHALL ser inválida con `reason` `invalid_format`, de modo que todo valor guardado es texto Unicode bien formado que cualquier almacén JSON acepta. Los pares sustitutos completos (emoji) son válidos.

#### Scenario: Nulo y sustitutos sueltos en un texto
- **GIVEN** una sesión esperando en un input de tipo `text` sobre `t`
- **WHEN** el host continúa por separado con `"Ana\u0000"`, `"Ana\ud800"`, `"\udc00Ana"` y `"Ana 😀"`
- **THEN** las tres primeras son inválidas con `reason` `invalid_format` y la cuarta se acepta con `t` = `"Ana 😀"`

### Requirement: Tipo email
Con `email`, la respuesta SHALL ser válida si cumple la gramática de «valid e-mail address» del estándar HTML de WHATWG (ASCII), con un dominio de al menos dos etiquetas, la última de al menos dos caracteres y no solo dígitos, una parte local de 64 caracteres como mucho y 254 en total. Se guarda como string, con el dominio en minúsculas y la parte local sin cambios.

#### Scenario: Email válido normalizado
- **GIVEN** una sesión esperando en un input de tipo `email` sobre `email`
- **WHEN** el host continúa con `{text: " Ana.Perez+lead@Example.COM "}`
- **THEN** `email` vale `"Ana.Perez+lead@example.com"`

#### Scenario: Emails inválidos
- **GIVEN** una sesión esperando en un input de tipo `email`
- **WHEN** el host continúa por separado con `"ana"`, `"ana@"`, `"ana@example"`, `"ana @example.com"`, `"a@b@example.com"`, `"ana@example.c"`, `"ana@example.123"`, `"ana@-example.com"`, `"añá@example.com"` y `"ana@exámple.com"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

#### Scenario: Longitudes máximas
- **GIVEN** una sesión esperando en un input de tipo `email`
- **WHEN** el host continúa por separado con una parte local de 64 caracteres y otra de 65, ambas en `@example.com`
- **THEN** la primera se acepta y la segunda es inválida con `reason` `invalid_format`

### Requirement: Tipo phone
Con `phone`, la respuesta SHALL ser válida si solo contiene dígitos ASCII, espacios en blanco (los mismos que se recortan de los extremos), `-`, `.`, `(` y `)`, opcionalmente precedidos por un único `+` como primer carácter, y tiene entre 7 y 15 dígitos. Se guarda como string: el `+` si lo había, seguido solo de los dígitos. El motor no deduce el prefijo de país ni transforma `00` en `+`.

#### Scenario: Teléfonos normalizados
- **GIVEN** una sesión esperando en un input de tipo `phone` sobre `telefono`
- **WHEN** el host continúa por separado con `"+34 600-12-34-56"`, `"(91) 123 45 67"`, `"0034 600.123.456"` y `"600\u00a0123\u00a0456"` (con espacios de no separación)
- **THEN** `telefono` vale respectivamente `"+34600123456"`, `"911234567"`, `"0034600123456"` y `"600123456"`

#### Scenario: Teléfonos inválidos
- **GIVEN** una sesión esperando en un input de tipo `phone`
- **WHEN** el host continúa por separado con `"123456"` (6 dígitos), `"1234567890123456"` (16), `"600 12 34 5a"`, `"34+600123456"`, `"++34600123456"` y `"+"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

### Requirement: Tipo number
Con `number`, la respuesta SHALL ser válida si es un signo `+` o `-` opcional, dígitos ASCII y, opcionalmente, un único `.` o `,` seguido de dígitos, sea cual sea el `locale`. Se rechaza por ambigua la que tiene una parte entera de 1 a 3 dígitos sin cero inicial y justo 3 decimales. No se admiten separadores de miles, exponentes ni espacios. Se guarda como number (`-0` como 0); ver «Números que no se pueden guardar exactamente».

#### Scenario: Números válidos
- **GIVEN** una sesión esperando en un input de tipo `number` sobre `n`
- **WHEN** el host continúa por separado con `"42"`, `"-3,5"`, `"+0.25"`, `"1234.567"`, `"0,500"`, `"007"` y `"-0"`
- **THEN** `n` vale respectivamente los numbers 42, -3.5, 0.25, 1234.567, 0.5, 7 y 0

#### Scenario: Separador de miles ambiguo
- **GIVEN** una sesión esperando en un input de tipo `number`
- **WHEN** el host continúa por separado con `"1.500"`, `"1,500"` y `"-2.000"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

#### Scenario: Números inválidos
- **GIVEN** una sesión esperando en un input de tipo `number`
- **WHEN** el host continúa por separado con `".5"`, `"5."`, `"1 000"`, `"1.000.000"`, `"1e3"`, `"0x10"`, `"١٢"` y 400 dígitos `"9"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

### Requirement: Números que no se pueden guardar exactamente
Con `number`, la respuesta SHALL ser inválida (`invalid_format`) si tiene más de 15 cifras significativas (las que van de la primera a la última cifra distinta de cero) o si, sin ser cero, su valor no es un number normal: mayor que el máximo finito o, en valor absoluto, menor que 2^-1022 (unos 2,2·10^-308). Así, todo número aceptado se guarda sin redondeo y su forma textual denota el mismo número que escribió el usuario.

#### Scenario: Cifras significativas
- **GIVEN** una sesión esperando en un input de tipo `number` sobre `n`
- **WHEN** el host continúa por separado con `"123456789012345"`, `"1234567890123456"`, `"0,00000000000000012345"` y `"1"` seguido de 21 ceros
- **THEN** la primera da el number 123456789012345, la segunda es inválida con `reason` `invalid_format`, la tercera da 1.2345e-16 y la cuarta da 1e21

#### Scenario: Desbordamiento y subdesbordamiento
- **GIVEN** una sesión esperando en un input de tipo `number`
- **WHEN** el host continúa por separado con `"1"` seguido de 309 ceros, con `"0,"` seguido de 307 ceros y un `"1"` (1e-308) y con `"0,"` seguido de 306 ceros y un `"1"` (1e-307)
- **THEN** las dos primeras son inválidas con `reason` `invalid_format` y la tercera da el number 1e-307

#### Scenario: Ceros
- **GIVEN** una sesión esperando en un input de tipo `number` sobre `n`
- **WHEN** el host continúa por separado con `"0"`, `"-0,0"` y `"0000,0000"`
- **THEN** `n` vale 0 en los tres casos

### Requirement: Tipo url
Con `url`, si el texto empieza por un esquema (una letra y después letras, dígitos, `+`, `-` o `.`, seguidos de `://`), solo se admite `http` o `https`, sin distinguir mayúsculas, y se toma tal cual; si no, aunque contenga `://` más adelante, se le antepone `https://`. La respuesta SHALL ser válida si el resultado es una URL absoluta WHATWG sin usuario ni contraseña y con un nombre de dominio como host (ver «Host de una url»). Se guarda su serialización.

#### Scenario: URLs válidas
- **GIVEN** una sesión esperando en un input de tipo `url` sobre `web`
- **WHEN** el host continúa por separado con `"example.com"`, `"HTTP://Example.com/a?b=1"` y `"www.example.com/precios"`
- **THEN** `web` vale respectivamente `"https://example.com/"`, `"http://example.com/a?b=1"` y `"https://www.example.com/precios"`

#### Scenario: `://` dentro de la consulta
- **GIVEN** una sesión esperando en un input de tipo `url` sobre `web`
- **WHEN** el host continúa por separado con `"example.com/?u=http://y.com"`, `"example.com#a://b"`, `"example.com:8080/a://b"` y `"git+ssh://example.com"`
- **THEN** `web` vale respectivamente `"https://example.com/?u=http://y.com"`, `"https://example.com/#a://b"` y `"https://example.com:8080/a://b"`, y la cuarta es inválida con `reason` `invalid_format` (es un esquema distinto de http y https)

#### Scenario: URLs inválidas
- **GIVEN** una sesión esperando en un input de tipo `url`
- **WHEN** el host continúa por separado con `"ftp://example.com"`, `"javascript:alert(1)"`, `"mailto:ana@example.com"`, `"https://user:pass@example.com"`, `"https://localhost"`, `"http://"` y `"exa mple.com"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

### Requirement: Host de una url
Con `url`, el host serializado por WHATWG SHALL cumplir la regla del dominio de un email (etiquetas de letras ASCII, dígitos y `-`, sin `-` en los extremos y de 63 caracteres como mucho; al menos dos; la última de dos caracteres o más y no solo dígitos); si no, la respuesta es inválida con `reason` `invalid_format`. Así se excluyen las direcciones IPv4 e IPv6 en cualquier forma, y pasan los dominios internacionales (`xn--…`).

#### Scenario: Direcciones IP y hosts sin dominio
- **GIVEN** una sesión esperando en un input de tipo `url`
- **WHEN** el host continúa por separado con `"12345"`, `"1.5"`, `"2130706433"`, `"600123456"`, `"192.168.1.1"`, `"https://[::1]"`, `"a.b"` y `"example.com."`
- **THEN** cada respuesta es inválida con `reason` `invalid_format` (el parser convierte las cuatro primeras en direcciones IPv4 como `0.0.48.57` o `127.0.0.1`)

#### Scenario: Dominio internacional
- **GIVEN** una sesión esperando en un input de tipo `url` sobre `web`
- **WHEN** el host continúa con `"exámple.com"`
- **THEN** `web` vale `"https://xn--exmple-qta.com/"`

### Requirement: Espacios y controles en una url
Con `url`, un texto (ya recortado) que contiene espacios en blanco, caracteres de control (U+0000 a U+001F y U+007F), caracteres ignorables por defecto de Unicode (`Default_Ignorable_Code_Point`, como U+00AD o U+200B) o sustitutos UTF-16 sueltos SHALL ser inválido con `reason` `invalid_format`, antes de aplicar el parser de WHATWG. También lo es si el host contiene `%`; el host va tras las `/` o `\` iniciales, que WHATWG ignora, hasta el primer `/`, `?`, `#` o `\`.

#### Scenario: Espacios y caracteres de control
- **GIVEN** una sesión esperando en un input de tipo `url`
- **WHEN** el host continúa por separado con `"example.com/precios y más"`, `"exa\tmple.com"`, `"example.com\n/precios"` y `"example.com/\u0000"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format` (el parser de WHATWG codificaría los espacios y quitaría en silencio los tabuladores, los saltos de línea y los controles finales)

#### Scenario: Caracteres invisibles y sustitutos sueltos
- **GIVEN** una sesión esperando en un input de tipo `url`
- **WHEN** el host continúa por separado con `"ex\u00adample.com"`, `"ex\u200bample.com"`, `"example.com/\ufeffa"` (BOM interior: uno final lo quita el recorte de espacios antes de convertir) y `"example.com/\ud800"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format` (el parser quitaría en silencio los tres primeros caracteres del host o de la ruta, o cambiaría el sustituto por U+FFFD)

#### Scenario: Invisibles codificados en el host
- **GIVEN** una sesión esperando en un input de tipo `url`
- **WHEN** el host continúa por separado con `"exa%C2%ADmple.com"`, `"exa%E2%80%8Bmple.com"`, `"exa%EF%BB%BFmple.com"`, `"https://exa%C2%ADmple.com/"`, `"exa%41mple.com"`, `"/exa%C2%ADmple.com"`, `"//exa%C2%ADmple.com"`, `"https:///exa%C2%ADmple.com"`, `"https:////exa%C2%ADmple.com"` y `"https://\exa%C2%ADmple.com"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format` (el parser decodificaría el porcentaje y luego quitaría el carácter invisible del host)

#### Scenario: Porcentaje fuera del host
- **GIVEN** una sesión esperando en un input de tipo `url` sobre `web`
- **WHEN** el host continúa por separado con `"example.com/a%20b?q=%C3%B1"`, `"https:///example.com/%41"` y `"example.com\a%41"`
- **THEN** `web` vale respectivamente `"https://example.com/a%20b?q=%C3%B1"`, `"https://example.com/%41"` y `"https://example.com/a%41"`

### Requirement: Tamaño máximo del valor guardado
La forma textual (ver «Forma textual de los valores») de un valor que guarda un input de tipo distinto de `choice` SHALL tener como mucho 4096 unidades de código UTF-16, aunque la conversión lo haga crecer. Si la conversión produciría un valor más largo, la respuesta es inválida con `reason` `invalid_format`.

#### Scenario: URL que crece al serializarse
- **GIVEN** una sesión esperando en un input de tipo `url` sobre `web`
- **WHEN** el host continúa por separado con `"example.com/"` seguido de 679 `"ñ"` (691 unidades de código) y con `"example.com/"` seguido de 680 `"ñ"`
- **THEN** la primera se acepta y `web` tiene 4094 unidades de código (cada `ñ` se serializa como `%C3%B1`), y la segunda es inválida con `reason` `invalid_format` (su serialización tendría 4100)

### Requirement: Tipo date
Con `date`, la respuesta SHALL ser válida si tiene la forma `AAAA-MM-DD` con dígitos ASCII, un año de 0001 a 9999, un mes de 01 a 12 y un día que existe en ese mes según el calendario gregoriano, bisiestos incluidos. Se guarda el mismo string. No se admiten otros formatos, horas ni fechas relativas, y el motor no consulta la fecha actual.

#### Scenario: Fechas válidas
- **GIVEN** una sesión esperando en un input de tipo `date` sobre `fecha`, seguido de un `condition` con la regla `fecha lt "2026-11-01"`
- **WHEN** el host continúa con `{text: "2026-10-16"}`
- **THEN** `fecha` vale el string `"2026-10-16"` y la regla es verdadera

#### Scenario: Bisiesto
- **GIVEN** una sesión esperando en un input de tipo `date`
- **WHEN** el host continúa por separado con `"2024-02-29"` y `"2026-02-29"`
- **THEN** la primera se acepta y la segunda es inválida con `reason` `invalid_format`

#### Scenario: Fechas inválidas
- **GIVEN** una sesión esperando en un input de tipo `date`
- **WHEN** el host continúa por separado con `"2026-13-01"`, `"2026-1-5"`, `"16/10/2026"`, `"2026-10-16T10:00"`, `"20261016"` y `"0000-01-01"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

### Requirement: Tipo boolean
Con `boolean`, la respuesta SHALL ser válida si, normalizada a NFC y sin distinguir mayúsculas, es `true` o `false` en cualquier `locale`, o una palabra del idioma del flujo: con `es` (`sí` o `si` → true, `no` → false) y con `en` (`yes` o `y` → true, `no` o `n` → false). El idioma es la parte de `locale` antes del guion; sin `locale`, se usa `es`. Se guarda como boolean.

#### Scenario: Español
- **GIVEN** un flujo con `locale` `"es"` y una sesión esperando en un input de tipo `boolean` sobre `ok`
- **WHEN** el host continúa por separado con `"Sí"`, `"SI"`, `"si"`, `"true"`, `"No"` y `"FALSE"`
- **THEN** `ok` vale respectivamente true, true, true, true, false y false

#### Scenario: Palabras no admitidas
- **GIVEN** un flujo con `locale` `"es"` y una sesión esperando en un input de tipo `boolean`
- **WHEN** el host continúa por separado con `"vale"`, `"s"`, `"yes"` y `"1"`
- **THEN** cada respuesta es inválida con `reason` `invalid_format`

#### Scenario: Inglés con región
- **GIVEN** un flujo con `locale` `"en-GB"` y una sesión esperando en un input de tipo `boolean`
- **WHEN** el host continúa por separado con `"Yes"`, `"y"`, `"N"` y `"sí"`
- **THEN** las tres primeras dan true, true y false, y la cuarta es inválida con `reason` `invalid_format`

#### Scenario: Otros idiomas y flujo sin locale
- **GIVEN** un flujo con `locale` `"fr"` y otro sin `locale`, cada uno esperando en un input de tipo `boolean`
- **WHEN** el host continúa con `"oui"` y con `"true"` en el primero y con `"si"` en el segundo
- **THEN** `"oui"` es inválida con `reason` `invalid_format`, `"true"` da true y `"si"` da true

#### Scenario: Acento combinado
- **GIVEN** un flujo con `locale` `"es"` y una sesión esperando en un input de tipo `boolean`
- **WHEN** el host continúa con la `s` y la `i` seguidas de U+0301, el acento combinante (el texto equivale a `sí` en forma NFD)
- **THEN** la respuesta se acepta como true

### Requirement: Selección única
En un input `choice` sin `multiple: true`, la respuesta `{choice: id}` SHALL guardar en `variable` el `value` de esa opción tal cual (string, number o boolean) o, si no lo tiene, su `id`, y continuar en el `next` de la opción. El `next` del nodo, si lo hay, se ignora, y `validation` no se aplica.

#### Scenario: Opción del ejemplo
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** el host continúa con `{choice: "grande"}`
- **THEN** `tamano` vale `"51+"` y la sesión sigue en `marcar-empresa`

#### Scenario: Opción sin value y values con tipo
- **GIVEN** una sesión esperando en un input `choice` cuya opción `sin-valor` no tiene `value`, la opción `tres` tiene `value` 3 y la opción `si` tiene `value` true
- **WHEN** el host continúa por separado con cada una
- **THEN** la variable vale respectivamente el string `"sin-valor"`, el number 3 y el boolean true

#### Scenario: Validación ignorada en selección única
- **GIVEN** un input `choice` de selección única con `validation` `{pattern: "(", min: 5, max: 2}` y un `next` de nodo hacia un `end` distinto del de la opción
- **WHEN** el host arranca la sesión y la continúa con una opción válida
- **THEN** la sesión no falla y sigue en el `next` de la opción

### Requirement: Selección múltiple
En un input `choice` con `multiple: true`, la respuesta `{choices: [id, …]}` SHALL guardar un array con el `value` (o, si no lo tiene, el `id`) de cada opción elegida, en el orden en que aparecen en el flujo, y continuar en el `next` del nodo; los `next` de las opciones se ignoran. Una selección vacía es inválida (`required`) y `min`/`max` limitan el número de opciones elegidas.

#### Scenario: Orden del flujo
- **GIVEN** una sesión esperando en un input múltiple con las opciones `a` (`value` `"A"`), `b` (sin `value`) y `c` (`value` 3, con su propio `next`)
- **WHEN** el host continúa con `{choices: ["c", "b", "a"]}`
- **THEN** la variable vale `["A", "b", 3]` y la sesión sigue en el `next` del nodo, no en el de `c`

#### Scenario: Selección vacía
- **GIVEN** una sesión esperando en un input múltiple
- **WHEN** el host continúa con `{choices: []}`
- **THEN** la respuesta es inválida con `reason` `required`

### Requirement: Límites min y max
`validation.min` y `validation.max` SHALL ser límites inclusivos. Con `text`, limitan el número de code points del texto recortado; con `number`, el valor, y con `choice` múltiple, el número de opciones elegidas. Una respuesta fuera de esos límites es inválida (`out_of_range`). Con `email`, `phone`, `url`, `date`, `boolean` y `choice` única, se ignoran.

#### Scenario: Longitud de texto en code points
- **GIVEN** una sesión esperando en un input de tipo `text` con `min` 2 y `max` 5
- **WHEN** el host continúa por separado con `"A"`, `"Ana"`, `"😀😀"` (2 code points, 4 unidades de código) y `"abcdef"`
- **THEN** `"Ana"` y `"😀😀"` se aceptan, y `"A"` y `"abcdef"` son inválidas con `reason` `out_of_range`

#### Scenario: Rango numérico
- **GIVEN** una sesión esperando en un input de tipo `number` con `min` 18 y `max` 99
- **WHEN** el host continúa por separado con `"17"`, `"18"`, `"99"` y `"99,5"`
- **THEN** `"18"` y `"99"` se aceptan, y `"17"` y `"99,5"` son inválidas con `reason` `out_of_range`

#### Scenario: Número de opciones
- **GIVEN** una sesión esperando en un input múltiple de cuatro opciones con `min` 2 y `max` 3
- **WHEN** el host continúa por separado eligiendo 1, 2, 3 y 4 opciones
- **THEN** 2 y 3 se aceptan, y 1 y 4 son inválidas con `reason` `out_of_range`

#### Scenario: Tipos que ignoran los límites
- **GIVEN** una sesión esperando en un input de tipo `email` con `min` 100 y otra en uno de tipo `date` con `max` 1
- **WHEN** el host continúa con `"ana@example.com"` y con `"2026-10-16"`
- **THEN** ambas respuestas se aceptan

### Requirement: Patrón de validación
`validation.pattern` SHALL evaluarse con la semántica, el subconjunto admitido, los límites y la evaluación en tiempo lineal del operador `matches`, sobre la forma textual del valor ya convertido. Si no hay coincidencia, la respuesta es inválida (`pattern_mismatch`). El patrón es literal: no se renderiza como plantilla. En `choice` no se aplica.

#### Scenario: Código postal
- **GIVEN** una sesión esperando en un input de tipo `text` con `pattern` `"^\\d{5}$"`
- **WHEN** el host continúa por separado con `"28001"` y `"2800"`
- **THEN** la primera se acepta y la segunda es inválida con `reason` `pattern_mismatch`

#### Scenario: Se aplica al valor normalizado
- **GIVEN** una sesión esperando en un input de tipo `phone` con `pattern` `"^\\+34\\d{9}$"` y otra en uno de tipo `number` con `pattern` `"^\\d+\\.\\d+$"`
- **WHEN** el host continúa con `"+34 600 12 34 56"` en la primera y con `"3,5"` en la segunda
- **THEN** ambas se aceptan (las formas textuales son `"+34600123456"` y `"3.5"`)

#### Scenario: Patrón costoso en tiempo lineal
- **GIVEN** una sesión esperando en un input de tipo `text` con `pattern` `"^(a+)+$"`
- **WHEN** el host continúa con 4095 caracteres `"a"` seguidos de `"!"`
- **THEN** la respuesta es inválida con `reason` `pattern_mismatch` y la operación termina

### Requirement: Validación que no se puede aplicar
Si el `validation.pattern` de un input que no es `choice` no se puede evaluar (regex inválida, construcción no admitida, tamaño o profundidad por encima de los de `matches`), o si los límites no se pueden cumplir en un tipo donde se aplican (`min` mayor que `max`; en `text`, `max` menor que 1 o `min` mayor que 4096; en `choice` múltiple, `max` menor que 1 o `min` mayor que el número de opciones), la sesión MUST fallar con `invalid_validation` y el `nodeId` del input.

#### Scenario: Patrón inválido al preguntar
- **GIVEN** un flujo `message` → `input` de tipo `text` con `pattern` `"("`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son el `message` y un `error` `invalid_validation` con el `nodeId` del input, sin `message` del prompt ni evento `input`

#### Scenario: Construcción no admitida o rango imposible
- **GIVEN** un input de tipo `text` con `pattern` `"(a)\\1"` y otro de tipo `number` con `min` 5 y `max` 2
- **WHEN** el host arranca una sesión con cada uno
- **THEN** ambas fallan con `invalid_validation`

#### Scenario: Límites que ninguna respuesta puede cumplir
- **GIVEN** por separado un input de tipo `text` con `max` 0, un input de tipo `text` con `min` 5000, un input `choice` múltiple con `max` 0 y un input `choice` múltiple de tres opciones con `min` 4
- **WHEN** el host arranca una sesión con cada uno
- **THEN** las cuatro fallan con `invalid_validation`, sin `message` del prompt ni evento `input`

#### Scenario: Configuración ignorada no falla
- **GIVEN** un input de tipo `email` con `min` 5 y `max` 2 y un input `choice` con `pattern` `"("`
- **WHEN** el host arranca una sesión con cada uno
- **THEN** ninguna falla: ambas quedan en `waiting`

#### Scenario: Flujo cambiado mientras se espera
- **GIVEN** el estado de una sesión esperando en un input de tipo `text` y una versión del mismo flujo en la que ese input tiene `pattern` `"("`
- **WHEN** el host continúa con esa versión y `{text: "Ana"}`
- **THEN** la sesión falla con `invalid_validation`
- **AND** si continúa con `{text: 5}`, la operación se rechaza con `invalid_input`

### Requirement: Momento de la comprobación de la validación
La validación de un input SHALL comprobarse al llegar al nodo, antes de renderizar o emitir nada de él, y al continuar, después de comprobar la forma de la entrada y antes de evaluar la respuesta. Por eso `invalid_validation` gana a `value_too_large` en el mismo nodo, y un rechazo `invalid_input` gana a `invalid_validation`.

#### Scenario: La validación gana al tamaño
- **GIVEN** la variable `a` con un `default` de 16384 caracteres y un input de tipo `text` con `pattern` `"("` y `prompt` `"{{a}}!"`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `invalid_validation`, no con `value_too_large`

### Requirement: Orden de comprobación de una respuesta
Una respuesta con la forma correcta SHALL comprobarse en este orden y el `reason` es el de la primera comprobación que falla: longitud máxima (`too_long`), vacía (`required`), formato del tipo (`invalid_format`), `min`/`max` (`out_of_range`) y `pattern` (`pattern_mismatch`). Estos son los únicos valores de `reason`.

#### Scenario: El rango gana al patrón
- **GIVEN** una sesión esperando en un input de tipo `number` con `min` 10 y `pattern` `"^1"`
- **WHEN** el host continúa con `"5"`
- **THEN** la respuesta es inválida con `reason` `out_of_range`

#### Scenario: El formato gana al patrón
- **GIVEN** una sesión esperando en un input de tipo `email` con `pattern` `"@empresa\\.com$"`
- **WHEN** el host continúa con `"ana"`
- **THEN** la respuesta es inválida con `reason` `invalid_format`

#### Scenario: Vacía gana a los límites
- **GIVEN** una sesión esperando en un input de tipo `text` con `min` 3
- **WHEN** el host continúa con `"   "`
- **THEN** la respuesta es inválida con `reason` `required`

### Requirement: Reintentos tras una respuesta inválida
Ante una respuesta inválida, si el intento actual no supera `validation.maxRetries` (3 si no se define), el motor SHALL emitir un `message` con el `retryMessage` renderizado (o, si no hay, el `prompt` renderizado otra vez) y un `input` con `attempt` aumentado en 1 y el `reason` del rechazo, ambos con el `nodeId` del input. La sesión sigue en `waiting` en el mismo nodo y ninguna variable cambia.

#### Scenario: Email inválido en el ejemplo
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-email` por primera vez
- **WHEN** el host continúa con `{text: "ana@"}`
- **THEN** los eventos son un `message` con el texto `"Ese email no parece válido, ¿lo revisas?"` y un `input` con `attempt` 2 y `reason` `"invalid_format"`
- **AND** el resultado tiene `status` `waiting`, el estado sigue en `pedir-email` y los valores de contacto contienen `email: null`

#### Scenario: Sin retryMessage se repite el prompt
- **GIVEN** `nombre` = `"Ana"` y una sesión esperando en un input de tipo `number` sin `retryMessage` cuyo `prompt` es `"¿Cuántos sois, {{nombre}}?"`
- **WHEN** el host continúa con `{text: "muchos"}`
- **THEN** los eventos son un `message` con `"¿Cuántos sois, Ana?"` y un `input` con `attempt` 2

#### Scenario: Retry message con plantilla
- **GIVEN** `nombre` = `"Ana"` y una sesión esperando en un input con `retryMessage` `"{{nombre}}, revisa el formato"`
- **WHEN** el host continúa con una respuesta inválida
- **THEN** el `message` contiene `"Ana, revisa el formato"`

#### Scenario: Tres reintentos por defecto
- **GIVEN** una sesión esperando en un input de tipo `email` sin `maxRetries`
- **WHEN** el host continúa tres veces seguidas con respuestas inválidas, usando cada vez el estado devuelto
- **THEN** las tres operaciones quedan en `waiting` y sus eventos `input` tienen `attempt` 2, 3 y 4

#### Scenario: Una respuesta válida tras reintentos
- **GIVEN** una sesión que espera en un input de tipo `email` con `attempt` 3
- **WHEN** el host continúa con `{text: "ana@example.com"}`
- **THEN** la respuesta se acepta y la sesión continúa en el `next` del input

### Requirement: Reintentos agotados
Ante una respuesta inválida, si el intento actual supera `validation.maxRetries`, la sesión MUST fallar con `retries_exhausted` y el `nodeId` del input, sin emitir `retryMessage` ni `prompt`. La variable conserva el valor que tenía antes de preguntar. Un input con `maxRetries` 0 falla con la primera respuesta inválida.

#### Scenario: Agotamiento en el ejemplo
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-email` (`maxRetries` 2)
- **WHEN** el host continúa tres veces seguidas con respuestas inválidas
- **THEN** las dos primeras quedan en `waiting` y la tercera devuelve como único evento un `error` `retries_exhausted` con `nodeId` `pedir-email`
- **AND** el resultado tiene `status` `failed` y el error del estado es `{code: "retries_exhausted", nodeId: "pedir-email"}`

#### Scenario: Sin reintentos
- **GIVEN** una sesión esperando en un input con `maxRetries` 0
- **WHEN** el host continúa con una respuesta inválida
- **THEN** la sesión falla con `retries_exhausted`

#### Scenario: La variable conserva su valor
- **GIVEN** la variable de contacto `email` inyectada con `"previo@example.com"` y una sesión esperando en un input de tipo `email` sobre ella con `maxRetries` 0
- **WHEN** el host continúa con `{text: "no-es-un-email"}`
- **THEN** los valores de contacto del estado contienen `email: "previo@example.com"`

### Requirement: Respuesta válida
Ante una respuesta válida, el motor SHALL guardar el valor convertido en `variable` (y, si es de contacto, reflejarlo en los valores de contacto del estado) y seguir ejecutando, sin intervención externa, desde el `next` que corresponde, como en el arranque, hasta la siguiente detención. Los eventos de la operación son los de los nodos que ejecuta a partir de ese `next`.

#### Scenario: Conversación completa del ejemplo
- **GIVEN** el flujo `captacion-leads`
- **WHEN** el host arranca y continúa, usando cada vez el estado devuelto, con `{text: " Ana "}`, `{text: "ana@"}`, `{text: "ana@example.com"}` y `{choice: "grande"}`
- **THEN** la segunda operación emite el `message` `"Encantado, Ana. ¿A qué email te escribimos?"` y un `input` de `pedir-email`; la tercera, el reintento; la cuarta, el `message` y el `input` de `pedir-tamano`
- **AND** la última falla con `unsupported_node` en `enviar-crm`, con `nombre` `"Ana"`, `tamano` `"51+"`, `segmento` `"empresa"` y los valores de contacto `{email: "ana@example.com"}`

#### Scenario: Dos inputs seguidos
- **GIVEN** un flujo `input` A → `input` B → `end`
- **WHEN** el host continúa en A con una respuesta válida
- **THEN** los eventos son el `message` del prompt de B y el `input` de B con `attempt` 1, y el estado espera en B

#### Scenario: Volver al mismo input reinicia el intento
- **GIVEN** un ciclo `input` A → `condition` que vuelve a A si la respuesta es `"otra"`, con A esperando en `attempt` 2
- **WHEN** el host continúa con `{text: "otra"}`
- **THEN** el evento `input` de A vuelve a tener `attempt` 1 y `reason` `null`

### Requirement: Variables al reanudar
Al continuar, cada variable declarada en el flujo recibido SHALL tomar el valor que tiene en el estado o quedar sin valor. El valor se busca solo en la parte del estado de su ámbito actual: las variables de sesión o los valores de contacto. Los `default` no se vuelven a aplicar y los valores de variables que el flujo ya no declara se descartan.

#### Scenario: Variable que el flujo ya no declara
- **GIVEN** el estado de una sesión esperando con la variable `motivo` = `"precio"` y una versión del flujo que ya no declara `motivo`
- **WHEN** el host continúa con una respuesta válida
- **THEN** el estado devuelto no contiene `motivo`

#### Scenario: Variable nueva con default
- **GIVEN** el estado de una sesión esperando y una versión del flujo que añade la variable `extra` con `default: "x"`, seguida de un `message` con el texto `"[{{extra}}]"`
- **WHEN** el host continúa con una respuesta válida
- **THEN** el `message` es `"[]"`

#### Scenario: Un valor vaciado no resucita
- **GIVEN** la variable `motivo` con `default: "precio"`, vaciada por un `set` con `null` antes del input en el que espera la sesión
- **WHEN** el host continúa con una respuesta válida y se evalúa `motivo isSet`
- **THEN** la regla es falsa

### Requirement: Las respuestas inválidas no se guardan
Una entrada rechazada (`invalid_input`) o una respuesta inválida MUST NOT aparecer en el estado, en los eventos, en el error registrado ni en el rechazo. Solo se guarda el valor convertido de una respuesta válida, y únicamente en su variable.

#### Scenario: Email inválido marcado pii
- **GIVEN** la variable `email` con `pii: true` y una sesión esperando en un input de tipo `email` sobre ella
- **WHEN** el host continúa con `{text: "ana@@example.com"}`
- **THEN** ni los eventos ni el estado serializado como JSON contienen `"ana@@example.com"`

#### Scenario: Agotamiento sin rastro de las respuestas
- **GIVEN** una sesión esperando en un input de tipo `email` con `maxRetries` 1
- **WHEN** el host continúa con `"respuesta-uno"` y después con `"respuesta-dos"`, ambas inválidas como email
- **THEN** ni los eventos ni el estado de ninguna de las dos operaciones contienen `"respuesta-uno"` ni `"respuesta-dos"`

#### Scenario: Rechazo sin la entrada
- **GIVEN** una sesión de `captacion-leads` esperando en `pedir-tamano`
- **WHEN** el host continúa con `{choice: "ana@example.com"}`
- **THEN** el rechazo `invalid_input` no contiene `"ana@example.com"`

### Requirement: Compatibilidad del estado
El formato del estado SHALL seguir siendo la versión 1: el estado en espera solo añade datos. Un estado `ended` o `failed` producido por la versión anterior del motor, sin esos datos, se sigue aceptando. Un estado en espera con un número de intento que no es un entero mayor o igual que 1, o con `outcome` o error distintos de `null`, se rechaza con `invalid_state`.

#### Scenario: Estado de la versión anterior
- **GIVEN** el estado que el motor anterior devolvía al arrancar `captacion-leads` (`status` `failed`, error `unsupported_node` en `pedir-nombre`)
- **WHEN** el host intenta continuarlo con `captacion-leads`
- **THEN** la operación se rechaza con `session_not_active`, no con `invalid_state`

#### Scenario: Estado en espera corrupto
- **GIVEN** el estado de una sesión esperando en un input, modificado por separado para que su número de intento sea 0, -1, 1.5 o `"2"`, o para que su error no sea `null`
- **WHEN** el host intenta continuarla
- **THEN** cada operación se rechaza con `invalid_state`

#### Scenario: Versión del estado
- **WHEN** una sesión queda esperando en un input
- **THEN** su estado tiene `stateVersion` 1

### Requirement: Un input de selección múltiple necesita next
`validateFlow` SHALL informar de un issue de capa `semantic`, con `path` `/nodes/<índice>`, el `nodeId` del input y el mensaje `"en selección múltiple, el nodo necesita next"`, cuando un input `choice` tiene `multiple: true` y no tiene `next`. Por tanto, el motor rechaza ese flujo con `invalid_flow`.

#### Scenario: Múltiple sin next
- **GIVEN** `captacion-leads` con `pedir-tamano` cambiado a `multiple: true`, sin `next` de nodo
- **WHEN** se valida y el host arranca una sesión con él
- **THEN** `validateFlow` devuelve un issue `semantic` con `path` `/nodes/3` y `nodeId` `pedir-tamano`, y la sesión se rechaza con `invalid_flow`

#### Scenario: Múltiple con next
- **GIVEN** el mismo flujo con `next` `marcar-pyme` en `pedir-tamano`
- **WHEN** se valida
- **THEN** el flujo es válido

## MODIFIED Requirements

### Requirement: Ejecución hasta que la sesión se detiene
Cada operación de avance SHALL ejecutar nodos encadenados, sin intervención externa, hasta que la sesión termina en un `end` (`status` `ended`), falla (`status` `failed`) o llega a un `input` y espera la respuesta del usuario (`status` `waiting`).

#### Scenario: Cadena completa hasta el fin
- **GIVEN** un flujo `message` → `set` → `condition` → `end`
- **WHEN** el host arranca una sesión
- **THEN** el resultado tiene `status` `ended` y los eventos `message` y `end`, en ese orden

#### Scenario: Detención en un input
- **GIVEN** un flujo `message` → `input` → `end`
- **WHEN** el host arranca una sesión
- **THEN** el resultado tiene `status` `waiting` y los eventos `message`, `message` (prompt) e `input`, sin ningún `end`

### Requirement: Eventos de salida
El motor SHALL producir eventos con estas formas: `{type: "message", nodeId, content, typingDelayMs}`, `{type: "input", nodeId, inputType, attempt, reason, …}` (ver «Evento input»), `{type: "end", nodeId, outcome}` y `{type: "error", nodeId, code, message}`. Los eventos se devuelven en el orden en que ocurren. Cada operación produce como mucho un `end`, un `error` o un `input`, y siempre es el último evento.

#### Scenario: El fin es el último evento
- **GIVEN** un flujo con dos `message` seguidos de un `end`
- **WHEN** el host arranca una sesión
- **THEN** los eventos son `message`, `message`, `end` y no hay ningún `error`

#### Scenario: El error es el último evento
- **GIVEN** un flujo cuyo segundo nodo es de tipo `http`
- **WHEN** el host arranca una sesión
- **THEN** el último evento es de tipo `error` y no hay ningún evento `end`

#### Scenario: El input es el último evento
- **GIVEN** un flujo cuyo segundo nodo es un `input`
- **WHEN** el host arranca una sesión
- **THEN** el último evento es de tipo `input` y no hay ningún `end` ni `error`

### Requirement: Nodos aún no soportados
Al llegar a un nodo `http` o `llm`, el motor MUST NOT ejecutarlo: la sesión falla con el error `unsupported_node`, el `nodeId` de ese nodo y un mensaje que nombra su tipo. Los eventos producidos antes en la misma operación se conservan.

#### Scenario: Ejemplo de captación de leads
- **GIVEN** una sesión de `packages/spec/examples/captacion-leads.json` esperando en `pedir-tamano`
- **WHEN** el host continúa con `{choice: "pequena"}`
- **THEN** el único evento es un `error` de código `unsupported_node` con `nodeId` `enviar-crm`, y `segmento` vale `"pyme"` en el estado
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
Cada operación SHALL ejecutar como mucho 200 nodos, contando el primero; al continuar, el primero es el input que recibe la respuesta. Antes de ejecutar el nodo 201 la sesión falla con el error `step_limit_exceeded` y el `nodeId` de ese nodo; los eventos anteriores se conservan. El límite se comprueba antes de mirar el tipo del nodo y el contador se reinicia en cada operación.

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

#### Scenario: El límite gana a un input
- **GIVEN** una cadena lineal de 200 nodos `set` o `jump` terminada en un `input`
- **WHEN** el host arranca una sesión
- **THEN** la sesión falla con `step_limit_exceeded` y el `nodeId` del input, sin `message` ni `input` de ese nodo

#### Scenario: Al continuar cuenta el input
- **GIVEN** una sesión esperando en un input seguido de una cadena lineal de N nodos `set` o `jump` terminada en un `end`
- **WHEN** el host continúa con una respuesta válida, con N = 198 y con N = 199
- **THEN** con 198 la sesión termina con `status` `ended`, y con 199 falla con `step_limit_exceeded` y el `nodeId` del `end`

### Requirement: Estado de sesión serializable
El estado MUST ser un valor JSON puro, sin referencias al objeto flujo, e incluir la versión de su propio formato. El host lo trata como opaco salvo `status` (`ended`, `failed` o `waiting`), el `nodeId` (el input en el que espera, si espera), el `outcome` si terminó, el error (`code` y `nodeId`) si falló y los valores de contacto.

#### Scenario: Ida y vuelta por JSON
- **GIVEN** el estado devuelto por cualquier operación, incluido uno en espera
- **WHEN** se serializa y se vuelve a parsear como JSON
- **THEN** el resultado es estructuralmente igual al estado original y se puede usar para continuar la sesión

#### Scenario: Estado tras un fallo
- **GIVEN** una sesión de `captacion-leads` que falla con `unsupported_node` en el nodo `enviar-crm`
- **WHEN** el host lee el estado
- **THEN** tiene `status` `failed` y el error con código `unsupported_node` y `nodeId` `enviar-crm`

#### Scenario: Estado en espera
- **GIVEN** una sesión de `captacion-leads` recién arrancada
- **WHEN** el host lee el estado
- **THEN** tiene `status` `waiting`, `nodeId` `pedir-nombre`, `outcome` `null` y error `null`

### Requirement: Ejecución determinista y sin efectos externos
Con el mismo flujo y las mismas entradas, el motor SHALL devolver resultados estructuralmente iguales. MUST NOT leer el reloj, generar aleatoriedad, leer el entorno, acceder a red o disco, ni escribir en consola. MUST NOT mutar el flujo, los valores de contacto, el estado ni la entrada del usuario recibidos.

#### Scenario: Dos ejecuciones iguales
- **GIVEN** un flujo y unos valores de contacto
- **WHEN** el host arranca dos sesiones con ellos
- **THEN** ambos resultados (`status`, `events` y `state`) son estructuralmente iguales

#### Scenario: Dos continuaciones iguales
- **GIVEN** un flujo, un estado en espera y una entrada
- **WHEN** el host continúa dos veces con ellos
- **THEN** ambos resultados son estructuralmente iguales

#### Scenario: Sin escritura en consola
- **GIVEN** espías sobre todos los métodos de `console`
- **WHEN** se ejecutan sesiones que terminan, que fallan, que esperan, que reintentan y que se rechazan
- **THEN** ningún método de `console` se ha llamado

#### Scenario: Entradas congeladas
- **GIVEN** un flujo con un `set` y unos valores de contacto, ambos congelados en profundidad
- **WHEN** el host arranca una sesión
- **THEN** la operación no falla y las entradas no han cambiado

#### Scenario: Continuación con entradas congeladas
- **GIVEN** un flujo, un estado en espera y una entrada válida, los tres congelados en profundidad
- **WHEN** el host continúa la sesión
- **THEN** la operación no falla y ninguna de las tres entradas ha cambiado

### Requirement: Los errores no revelan valores de variables
Los eventos `error`, el error registrado en el estado y los rechazos MUST NOT incluir valores de variables (marcadas `pii` o no), valores de contacto ni la entrada del usuario. Pueden incluir códigos, ids de nodo, nombres de variable, operadores y datos escritos en el flujo.

#### Scenario: Regla inválida sobre una variable pii
- **GIVEN** la variable `email` con `pii: true` y valor `"ana@example.com"`, y una regla `email matches "("`
- **WHEN** la sesión falla con `invalid_rule`
- **THEN** ni el evento `error` ni el error del estado contienen `"ana@example.com"`

#### Scenario: Rechazo de contacto inválido
- **WHEN** el host arranca con los valores de contacto `{"email": "ana@example.com", "edad": NaN}`
- **THEN** el rechazo `invalid_contact` puede nombrar `edad` pero no contiene `"ana@example.com"`

#### Scenario: Reintentos agotados con una respuesta pii
- **GIVEN** la variable `email` con `pii: true` y una sesión esperando en un input de tipo `email` sobre ella con `maxRetries` 0
- **WHEN** el host continúa con `{text: "ana@ejemplo"}`
- **THEN** ni el evento `error` `retries_exhausted` ni el error del estado contienen `"ana@ejemplo"`

### Requirement: Continuar una sesión
La operación de continuar SHALL recibir el flujo, el estado y la entrada del usuario, y comprobar en este orden: flujo válido (`invalid_flow`); estado bien formado y de versión conocida (`invalid_state`); estado del mismo `id` de flujo, con su nodo presente y, si espera, siendo ese nodo un `input` (`state_mismatch`); sesión en espera (`session_not_active`), y entrada con la forma que pide el nodo (`invalid_input`). Un rechazo no produce eventos ni modifica el estado.

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

#### Scenario: El nodo en espera ya no es un input
- **GIVEN** el estado de una sesión esperando en `pedir-nombre` y una versión del mismo flujo en la que `pedir-nombre` es un `message`
- **WHEN** el host intenta continuarla con esa versión
- **THEN** la operación se rechaza con `state_mismatch`

#### Scenario: Estado mal formado o de versión desconocida
- **WHEN** el host intenta continuar con el estado `{}` o con un estado cuya versión de formato no reconoce el motor
- **THEN** la operación se rechaza con `invalid_state`

#### Scenario: El flujo se comprueba primero
- **GIVEN** un flujo inválido y un estado mal formado
- **WHEN** el host intenta continuar
- **THEN** la operación se rechaza con `invalid_flow`

#### Scenario: La sesión se comprueba antes que la entrada
- **GIVEN** el estado de una sesión con `status` `ended`
- **WHEN** el host intenta continuarla con la entrada `"no es un objeto"`
- **THEN** la operación se rechaza con `session_not_active`, no con `invalid_input`
