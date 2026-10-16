---
name: decision-llm-coste-y-reintentos-en-el-adaptador
description: Por qué el coste de un turno lo calcula el proveedor y el motor solo aplica el tope de parada, por qué los reintentos son del SDK y no del motor, y que lo facturado puede superar lo contabilizado
metadata:
  type: project
  enforcement: packages/engine/tests/scenarios/llm-turns.test.ts, packages/engine/tests/unit/llm-hypotheses.test.ts
---

# Coste y reintentos de un turno `llm`: del adaptador, no del motor

**Decisión (`engine-llm`, 2026-10-16):** el motor no sabe de tokens ni de precios. El proveedor devuelve `costUsd` en cada resultado (un hecho observado) y el motor solo suma y compara con `costCapUsd`: «el proveedor provee, el consumidor decide». `costCapUsd` es un **tope de parada**: el acumulado puede superarlo como mucho en el coste de un turno, porque el coste de un turno no se conoce hasta que ocurre. Una suma no finita (dos importes finitos enormes) es un resultado fuera de contrato (`llm_host_error`), no un coste.

**Por qué los reintentos no están en el motor (frente a [[decision-http-un-intento-por-llamada]]):** un turno `llm` no tiene efectos externos que se dupliquen (no crea un lead ni cobra a un tercero), así que reintentar es seguro, y el SDK de Anthropic ya lo hace bien (408, 409, 429, 5xx, `retry-after`, backoff con jitter). El motor nunca repite un turno: un `failed` sale por `onExhausted` con `provider_error`. El tiempo total por turno lo acota el adaptador con su propio temporizador, porque el motor no tiene reloj.

**El gasto facturado puede superar el contabilizado.** Si la API procesa una petición que el adaptador da por fallida (tiempo agotado, corte de conexión tras enviar), esa petición se factura pero cuenta `costUsd` 0, y cada reintento del SDK puede repetirlo: hasta `maxRetries` + 1 veces por turno. Se acepta porque no hay forma de conocer ese coste. Quien despliega debe conciliar el coste contabilizado con la facturación real y poner un presupuesto por sesión o tenant (FOLLOW-UP de la feature 6); `costCapUsd` por sí solo no es un límite de gasto.

**Consecuencias:** el cálculo del coste (tarifas, caché, prompt largo, fallback del servidor) vive en `@franca/llm-anthropic`; los reintentos del SDK cuentan dentro del turno, que sigue siendo una sola llamada del presupuesto de 10 llamadas externas por operación.
