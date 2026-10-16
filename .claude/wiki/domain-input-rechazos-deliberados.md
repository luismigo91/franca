---
name: domain-input-rechazos-deliberados
description: Qué respuestas del nodo input se rechazan a propósito (1.500, más de 15 cifras, subnormales, E.164) y por qué agotar los reintentos falla la sesión
metadata:
  type: project
  enforcement: packages/engine/tests/unit/input-phone-number.test.ts, packages/engine/tests/scenarios/input-answers.test.ts, packages/engine/tests/scenarios/input-flow.test.ts
---

# Rechazos deliberados de `input` en el motor

Decisiones de producto aprobadas en `engine-input`; parecen bugs y no lo son:

- **`1.500` y `1,500` son inválidos en `number`.** Es ambiguo (¿mil quinientos o uno coma cinco?) y el motor no conoce el `locale` del usuario. Se rechaza justo la forma «1 a 3 dígitos enteros sin cero inicial y exactamente 3 decimales»; el usuario reformula (`1500`, `1.5`). `0,500` y `1234.567` sí valen.
- **Más de 15 cifras significativas, o un subnormal (< 2^-1022), son inválidos en `number`.** Con ≤ 15 cifras un double reproduce el decimal (DBL_DIG), así que lo guardado es lo escrito; con más, `Number()` redondea en silencio (`1234567890123456789` → `…800`) y por debajo del rango normal pierde precisión o da `0`.
- **Agotar `maxRetries` falla la sesión (`retries_exhausted`)** en vez de seguir por una salida: el esquema no tiene `onExhausted` en `input` (solo `llm`). Es un FOLLOW-UP aditivo (6.1 de `engine-input`); hasta entonces el host decide qué hacer con una sesión `failed`.
- **No hay E.164 ni prefijo de país en `phone`.** Se acepta 7-15 dígitos y se guarda `+`? + dígitos tal cual; deducir el país exigiría tablas de numeración (`libphonenumber`) que se excluyeron como dependencia.
- **Un teléfono de 16 dígitos, una URL con IP o un texto de más de 4096 unidades se rechazan** y el usuario reintenta: nunca se guarda un valor distinto de lo escrito.
- **El `trim` de la respuesta es el de `String.prototype.trim`**, que también quita NBSP, U+2003, U+202F y U+FEFF. Por eso `example.com/` + U+FEFF final es una URL válida (el BOM se recorta antes del conversor) aunque en medio del texto se rechace.

Relacionado: [[gotcha-url-whatwg-normaliza]], [[decision-matches-regex-lineal]].
