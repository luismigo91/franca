---
name: decision-http-deshabilitado-en-conversaciones
description: Por qué las conversaciones ejecutan los flujos sin la capacidad http (el nodo falla con unsupported_node) y no con un host que responda blocked, hasta la feature 6b
metadata:
  type: project
  enforcement: apps/api/test/conversations-inputs.e2e-spec.ts
---

# Nodos `http` deshabilitados en las conversaciones: `unsupported_node`, no `blocked`

**Decisión (`api-conversations`, D8):** `buildEngineHost` (`apps/api/src/conversations/engine-host.ts`) devuelve `{ llm }` **sin la propiedad `http`**. El motor trata un hueco de capacidad como `unsupported_node`: la conversación termina en `failed` con ese código y el `nodeId` del nodo `http`, sin resolver secretos ni abrir conexiones salientes. Un flujo con nodos `http` se publica y conversa con normalidad hasta ese nodo.

**Por qué no un host que responda `blocked`:** llevaría el flujo por `onError` y mentiría al usuario. En `faq-ia`, `crear-ticket` sale por `onError` a un mensaje que dice que se creó un ticket que nunca se envió. Fallar con `unsupported_node` es honesto.

**Por qué no el host real ahora:** el host `http` de producción (anti-SSRF, resolución fijada, secretos por origen, límites de respuesta) es un componente de seguridad grande con su propia suite de conformidad (17 casos y 16 mutantes, [[decision-http-un-intento-por-llamada]] y [[domain-flujos-sin-secretos]]). Es la feature 6b, aprobada por el usuario, justo después de esta y antes del chat. Sustituir `buildEngineHost` por uno con `http` no cambia el resto del contrato.

**Consecuencia visible:** los dos ejemplos (`captacion-leads`, `faq-ia`) no llegan al final mientras `http` siga deshabilitado; el chat de prueba lo verá como `failed` / `unsupported_node` en `enviar-crm` y `crear-ticket`.

Enforcement: el escenario «Escalado en el ejemplo de FAQ» y «Fallo en el nodo http del ejemplo» de `apps/api/test/conversations-inputs.e2e-spec.ts`, y el unit de `engine-host.spec.ts` (el host no tiene la clave `http`).
