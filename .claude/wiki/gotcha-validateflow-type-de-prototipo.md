---
name: gotcha-validateflow-type-de-prototipo
description: validateFlow lanza con un nodo cuyo type es constructor, toString, __proto__… porque busca el tipo en una tabla de objeto plano; el editor lo envuelve con validateDraft
metadata:
  type: project
  enforcement: apps/web/src/lib/editor/validate-draft.test.ts, apps/web/src/lib/editor/malformed-flows.test.ts
---

# `validateFlow` lanza con `type: "constructor"`

**Medido el 2026-10-18 (`web-editor`).** `validateFlow` con un nodo `{"id": "a", "type": "constructor"}` (también `toString`, `__proto__`, `hasOwnProperty`, `valueOf`) lanza `Error: can't resolve reference urn:franca:spec:v0:flow#/$defs/function Object()…`. La causa es `NODE_DEFS[kind]` en `packages/spec/src/shape.ts`: una tabla de objeto plano que encuentra `Object.prototype.constructor`. Un `type` desconocido cualquiera (`"x"`) sí da el issue «tipo de nodo desconocido».

No se corrigió en `packages/spec`: el cambio del editor no toca `packages/` ni `apps/api`. **La API tiene el mismo fallo** (medido): `POST /flows` y `POST /flows/validate` con un nodo así responden 500 `internal_error`. Pendiente, con su propio cambio y su test de regresión en `packages/spec`; hasta entonces, crear desde JSON pegado en la web (que valida antes con `validateDraft`) no llega a la API con ese flujo.

**Cómo se evita en la web:** `validateDraft` (`apps/web/src/lib/editor/validate-draft.ts`) envuelve la llamada y, si lanza, devuelve el mismo veredicto que para un tipo desconocido, con el nodo señalado. Todo el editor valida con ella. Las tablas por tipo del editor son `Map` ([[gotcha-variables-nombre-proto]]).
