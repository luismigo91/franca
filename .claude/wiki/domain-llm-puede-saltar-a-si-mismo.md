---
name: domain-llm-puede-saltar-a-si-mismo
description: Solo el nodo llm puede apuntar a sí mismo, y solo con next (no con onExhausted); no es un descuido, el motor conserva turnos y coste en el autosalto
metadata:
  type: project
  enforcement: packages/spec/tests/validate.test.ts, packages/engine/tests/scenarios/llm-turns.test.ts
---

# Solo el nodo `llm` puede saltar a sí mismo, y solo con `next`

La regla semántica "`<campo>` apunta a sí mismo" (`semanticIssues` en `packages/spec/src/validate.ts`) exime a los nodos `llm` en su `next` a propósito. Viene así del validador Python original y se mantuvo al portarlo. Desde `engine-llm` la exención ya no alcanza a `onExhausted`: un `llm` que se agota hacia sí mismo reabriría una conversación nueva sin que nada la acote.

**Por qué:** cualquier otro nodo que se apunte a sí mismo es un bucle infinito sin entrada del usuario (un `message`, un `set`) o un error de edición. Un `llm` es un paso conversacional de varios turnos acotado por la propia spec: `maxTurns` (por defecto 8, máximo 50), `costCapUsd` opcional y la salida obligatoria `onExhausted`. Volver a sí mismo con `next` equivale a "otra vuelta de conversación" y el motor la corta.

**Cómo lo cumple el motor:** en el autosalto (`next` igual al propio nodo) el motor **no** devuelve `next(node.id)` (eso sería una llegada nueva, con conversación vacía y coste 0): guarda los slots, emite el evento `llm` con `reason: null` y espera en la misma conversación, conservando mensajes, turnos, coste y slots recogidos. Así `maxTurns` y `costCapUsd` cuentan también las vueltas dadas por autosalto, y la excepción del validador sigue justificada. Un ciclo con otro nodo (`llm` → `set` → `llm`) sí empieza conversaciones nuevas: lo acotan el límite de pasos y el de llamadas externas por avance, y el presupuesto por sesión o tenant es del host.

Pruebas: "onExhausted hacia sí mismo", "next hacia sí mismo sigue siendo válido" y "permite que un nodo llm salte a sí mismo" en `packages/spec/tests/validate.test.ts`; "Autosalto con turnos conservados" y "El autosalto no reinicia el coste" en `packages/engine/tests/scenarios/llm-turns.test.ts` (mutaciones `llm-selfjump-arrival` y `llm-selfjump-reset`).
