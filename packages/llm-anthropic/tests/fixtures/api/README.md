# Cuerpos de la API de Mensajes para los tests

Cuerpos con la **forma real** de las respuestas de `POST /v1/messages` (referencia oficial de la API de Mensajes y
tipos de `@anthropic-ai/sdk` 0.135): `id`, `type`, `role`, `model`, `content`, `stop_reason`, `stop_sequence`,
`usage` (con los contadores de caché y `service_tier`) y, en un rechazo, `stop_details`. Los errores tienen la
forma `{ type: "error", error: { type, message }, request_id }`.

Lección de las features 1-3: un doble con la forma que el autor *cree* no detecta una integración rota. Por eso
estos cuerpos pasan por el SDK **real** (con un `fetch` inyectado, sin red) y no por un cliente simulado.

Lo que **no** está verificado contra el servidor:

- La forma exacta del bloque `fallback` y de `usage.iterations` (una entrada `message` y otra `fallback_message`
  por salto) sale de la referencia que aportó el orquestador, no de una respuesta real. El test en vivo
  (`pnpm --filter @franca/llm-anthropic test:live`) comprueba después que una respuesta real de la API pasa la misma
  lectura; ver el FOLLOW-UP de `engine-llm` para revisar `usage` con un fallback real.
- Los textos `MARCA-…` son marcadores de los tests (comprueban que nada del cuerpo de un error o de un pensamiento
  llega a un resultado); no vienen de la API.
