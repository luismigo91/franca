---
name: domain-llm-puede-saltar-a-si-mismo
description: El validador prohíbe que un nodo apunte a sí mismo salvo el nodo llm; no es un descuido
metadata:
  type: project
---

# Solo el nodo `llm` puede saltar a sí mismo

La regla semántica "`<campo>` apunta a sí mismo" (`semanticIssues` en `packages/spec/src/validate.ts`) se salta los nodos `llm` a propósito. Viene así del validador Python original y se mantuvo al portarlo.

**Por qué:** cualquier otro nodo que se apunte a sí mismo es un bucle infinito sin entrada del usuario (un `message`, un `set`) o un error de edición. Un `llm` es un paso conversacional de varios turnos que ya está acotado por la propia spec: `maxTurns` (por defecto 8, máximo 50), `costCapUsd` opcional y la salida obligatoria `onExhausted`. Volver a sí mismo con `next` equivale a "otra vuelta de conversación", y el motor puede cortarla.

**Implicación para el motor de ejecución:** al implementar el `llm`, el límite de turnos y coste tiene que contar también las vueltas que se dan por un autosalto, o la excepción del validador deja de estar justificada.

Pruebas: "detecta un nodo que salta a sí mismo" y "permite que un nodo llm salte a sí mismo" en `packages/spec/tests/validate.test.ts`.
