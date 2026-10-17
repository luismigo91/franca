---
name: domain-contacto-compartido-entre-flujos
description: Las variables scope contact se comparten por nombre entre todos los flujos de la instalación; solo se guarda lo que un avance cambió, el default no se guarda y la vista queda fijada al crear la conversación
metadata:
  type: project
  enforcement: apps/api/test/conversations-contacts.e2e-spec.ts
---

# Valores de contacto: compartidos por nombre, solo lo que cambia

**Qué hace `api-conversations`:** `scope: contact` describe a la persona, no al flujo. Los valores se guardan por `(contactId, nombre de variable)` y se comparten entre **todos los flujos** de la instalación: `faq-ia` conoce el `email` que el contacto dio en `captacion-leads`. El `contactId` lo elige el cliente y es opaco (`^[A-Za-z0-9_-]{1,64}$`: sin `@`, puntos ni espacios, porque aparece en rutas y registros). Sin `contactId`, la conversación es anónima y no lee ni guarda nada.

**Reglas que parecen bugs y son intencionales:**
- *Se guarda solo lo que el avance cambió* (comparación estructural JSON de `state.contact` antes y después, `apps/api/src/conversations/contact-values.ts`). Lo no cambiado no se escribe, así dos conversaciones del mismo contacto no se pisan valores que no tocaron. «Sin valor» (`null`) **borra** la fila.
- *Un `default` no se guarda*: es un valor de reserva del flujo, no un dato de la persona. Un `default` igual al valor inicial no cuenta como cambio.
- *La vista queda fijada al crear*: la conversación ve los valores del contacto tal como estaban al crearse (el estado del motor lleva su propia copia) y no los cambios que hagan otras conversaciones después. Releerlos en cada avance cambiaría el contrato del motor.
- *Sin tipos*: el motor no impone el tipo y aquí tampoco. Dos flujos con tipos distintos para el mismo nombre se pasan el valor tal cual; el último en aplicar gana si cambian la misma variable.
- *El cliente no puede inyectar valores*: los únicos que llegan al motor son los que él mismo produjo, ya acotados.
- La réplica de la vista inicial (`initialContactView`) duplica lógica de `createVariableStore` del motor; la fija un test de paridad con `startSession`. [[gotcha-variables-nombre-proto]]: nombres como `__proto__` se tratan con `Object.keys`/`Object.fromEntries`, nunca con `obj[name] = v`.

**Supresión:** `DELETE /contacts/:contactId` borra valores, conversaciones y transcripciones (también las que se están procesando). Una creación fallida con `contactId` puede dejar la fila `contacts` vacía (solo el identificador opaco) hasta la purga, que es un FOLLOW-UP obligatorio antes de exponer la API fuera de loopback.

Enforcement: `apps/api/test/conversations-contacts.e2e-spec.ts` y `apps/api/src/conversations/contact-values.spec.ts`.
