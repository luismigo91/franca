---
name: gotcha-variables-nombre-proto
description: Los nombres de variable constructor, toString o __proto__ son válidos; por eso el motor usa Map y Object.fromEntries
metadata:
  type: project
  enforcement: packages/engine/tests/scenarios/start.test.ts, packages/engine/tests/unit/variables.test.ts, packages/engine/tests/unit/json.test.ts
---

# Un nombre de variable puede ser `__proto__`

**Qué pasa:** `varName` en `flow.schema.json` admite `constructor`, `toString` y `__proto__`. Con un objeto plano, `vars['__proto__'] = 'x'` no crea una propiedad propia (cambia el prototipo, o se ignora si el valor no es objeto) y `vars['constructor']` devuelve una función aunque nadie la haya asignado: una variable "sin valor" parecería tener valor.

**Cómo se evita en `packages/engine`:**
- `VariableStore` guarda los valores en un `Map`; nunca lee ni escribe propiedades de objeto.
- Los `Record` del estado se construyen con `Object.fromEntries` (crea propiedades propias, también `__proto__`) y se leen con `Object.entries`/`Object.hasOwn`. `JSON.parse` también crea `__proto__` como propiedad propia, así que el estado hace ida y vuelta por JSON sin perderla.
- El contacto del host se copia con `cloneJsonStrict` al mismo estilo.

No sustituyas el `Map` ni `Object.fromEntries` por `obj[name] = value` "por simplificar".
