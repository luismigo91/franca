---
name: gotcha-url-whatwg-normaliza
description: El parser URL de WHATWG cambia en silencio lo que el usuario escribió; por eso el tipo url del motor rechaza varias entradas antes de usarlo
metadata:
  type: project
  enforcement: packages/engine/tests/unit/input-url.test.ts, packages/engine/tests/unit/input-hypotheses.test.ts, packages/engine/tests/unit/http-hypotheses.test.ts
---

# `new URL()` no valida lo que escribió el usuario: lo normaliza

Medido en Node 22 al diseñar el tipo `url` de `packages/engine` (`src/input/parsers/url.ts`):

- **Quita en silencio** tabuladores, saltos de línea y controles finales (`new URL('https://exa\nmple.com').href` → `https://example.com/`), y **codifica** espacios y no ASCII (`/a b` → `/a%20b`; `ñ` → `%C3%B1`, hasta ×9 con `中`: 4096 unidades escritas pueden serializarse en 36 760).
- **Elimina del host 270 code points** (U+00AD, U+200B, U+FEFF, selectores de variación…, todos `Default_Ignorable_Code_Point`) y cambia un sustituto suelto por U+FFFD.
- **Decodifica `%` en el host y después elimina los invisibles**: `exa%C2%ADmple.com` y `exa%E2%80%8Bmple.com` dan `https://example.com/`; el filtro de invisibles sobre el texto escrito no los ve.
- **Convierte números en IPv4**: `12345` → `0.0.48.57`, `1.5` → `1.0.0.5`, `2130706433` y `127.1` → `127.0.0.1`; `[::1]` y `a.b` también pasarían un «host con un punto».

Por eso el conversor rechaza **antes** del parser cualquier blanco, control o `Default_Ignorable_Code_Point` (los sustitutos sueltos y U+0000 los rechaza antes `hasUnstorable`) y cualquier `%` en el host (hasta el primer `/`, `?`, `#` o `\`); exige que el `hostname` serializado cumpla la regla del dominio del email (excluye IPs y deja pasar `xn--…`) y que `href.length ≤ MAX_INPUT_LENGTH`. El esquema solo cuenta al principio del texto (RFC 3986): `example.com/?u=http://y.com` es una URL con `://` en la consulta, no un esquema ajeno.

Lo que **sí** se acepta, porque canonicaliza sin cambiar el recurso, no es «lo escrito»: mapeo IDNA de ancho completo y del punto ideográfico, host en minúsculas, `\` → `/`, segmentos `.`/`..`, puerto por defecto y percent-decoding fuera del host. Quitar cualquiera de los rechazos guarda en silencio un recurso distinto del que escribió el usuario.

Dependencias del runtime: la tabla de `Default_Ignorable_Code_Point`, IDNA y `String.prototype.normalize` dependen de la versión de Unicode de Node (fijado ≥ 22).

## Además, para la URL de un nodo `http` (`engine-http`)

La URL de `http` la escribe el autor y el motor inserta valores del usuario, así que las mismas reglas se reutilizan (`hasHiddenChars`, `hasPercentInHost`, `isDomainName`) y se añaden otras que se midieron:

- **Segmentos de punto disfrazados**: WHATWG trata como `..` también `.%2e`, `%2e.` y `%2E%2e` (sin distinguir mayúsculas) y como `.` también `%2e`; `..a`, `...` y `%252e` no son segmentos de punto.
- **El parser también encoge la URL**: quita el puerto por defecto y los ceros a la izquierda del puerto (`:0000000000443` → nada), así que la longitud se limita antes **y** después de serializar.
- **Un sustituto suelto literal en el texto** se cambia en silencio por `%EF%BF%BD`; hay que rechazarlo en todo el texto, no solo en los valores insertados.
- **`*.localhost`** (RFC 6761) pasa WHATWG y `isDomainName`: se rechaza `localhost` y todo lo que termine en `.localhost`.
- **Dígitos y puntos anchos** llegan al host por IDNA: `http://１２７．０．０．１/` es `127.0.0.1`. `isDomainName` debe mirar el `hostname` **serializado**, no el escrito. Y `12345`, `1.5`, `2130706433` o `600123456` también se convierten en IPv4.
- **`encodeURIComponent`** deja sin codificar `! ' ( ) *` y lanza `URIError` con un sustituto suelto: un post-pase los codifica.

Relacionado: [[domain-input-rechazos-deliberados]].
