---
name: gotcha-url-whatwg-normaliza
description: El parser URL de WHATWG cambia en silencio lo que el usuario escribió; por eso el tipo url del motor rechaza varias entradas antes de usarlo
metadata:
  type: project
  enforcement: packages/engine/tests/unit/input-url.test.ts, packages/engine/tests/unit/input-hypotheses.test.ts
---

# `new URL()` no valida lo que escribió el usuario: lo normaliza

Medido en Node 22 al diseñar el tipo `url` de `packages/engine` (`src/input/parsers/url.ts`):

- **Quita en silencio** tabuladores, saltos de línea y controles finales (`new URL('https://exa\nmple.com').href` → `https://example.com/`), y **codifica** espacios y no ASCII (`/a b` → `/a%20b`; `ñ` → `%C3%B1`, hasta ×9 con `中`: 4096 unidades escritas pueden serializarse en 36 760).
- **Elimina del host 270 code points** (U+00AD, U+200B, U+FEFF, selectores de variación…, todos `Default_Ignorable_Code_Point`) y cambia un sustituto suelto por U+FFFD.
- **Convierte números en IPv4**: `12345` → `0.0.48.57`, `1.5` → `1.0.0.5`, `2130706433` y `127.1` → `127.0.0.1`; `[::1]` y `a.b` también pasarían un «host con un punto».

Por eso el conversor rechaza **antes** del parser cualquier blanco, control, `Default_Ignorable_Code_Point` o sustituto suelto; exige que el `hostname` serializado cumpla la regla del dominio del email (excluye IPs y deja pasar `xn--…`) y que `href.length ≤ MAX_INPUT_LENGTH`. Quitar cualquiera de esas comprobaciones guarda en silencio algo distinto de lo escrito.

Dependencias del runtime: la tabla de `Default_Ignorable_Code_Point`, IDNA y `String.prototype.normalize` dependen de la versión de Unicode de Node (fijado ≥ 22).

Relacionado: [[domain-input-rechazos-deliberados]].
