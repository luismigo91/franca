---
name: decision-http-un-intento-por-llamada
description: Por qué el host HTTP ejecuta un solo intento y el motor decide los reintentos, y por qué POST y PATCH no se reintentan tras un posible envío
metadata:
  type: project
  enforcement: packages/engine/tests/unit/http-retry.test.ts, packages/engine/tests/scenarios/http-result.test.ts
---

# El host ejecuta un intento; el motor decide si reintenta

**Decisión (`engine-http`, 2026-10-16):** `EngineHost.http` resuelve **un** intento con hechos (`status`, `timeout`, `requestSent`…) y la política de reintentos vive en una tabla determinista del motor (`src/http/retry.ts`). «El proveedor provee, el consumidor decide».

**Por qué `POST` y `PATCH` no se reintentan tras un posible envío:** un `timeout`, un 5xx o un `network_error` con `requestSent` `true` (u omitido) no dicen si el servidor llegó a procesar la petición. Reintentar un `POST` puede duplicar un lead o un cobro. Sí se reintentan 408, 429 y `network_error` con `requestSent: false` (no salió ni un byte). Perder un lead por un 503 se aceptó frente a duplicarlo; el remedio previsto es una opción explícita con `Idempotency-Key` del host (FOLLOW-UP 6.6 de `engine-http`).

**Por qué el motor no mide tiempo:** no tiene reloj ni temporizadores (determinismo). El `timeoutMs` se entrega en la petición y lo aplica el host como tope **total** del intento (no de inactividad: un servidor que escribe un byte cada pocos segundos alargaría un intento sin límite). Es un MUST de «Host de producción: tiempo por intento», comprobado por la suite `@franca/engine/conformance`.

**Consecuencias:** los reintentos cuentan en un presupuesto único de 10 llamadas externas por operación (`reserveExternalCall`, compartido con el futuro `llm`) y el nodo cuenta como un solo paso del límite de pasos.

Relacionado: [[domain-flujos-sin-secretos]], [[gotcha-url-whatwg-normaliza]].
