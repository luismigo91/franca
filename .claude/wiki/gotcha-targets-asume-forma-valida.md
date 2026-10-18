---
name: gotcha-targets-asume-forma-valida
description: targets() de @franca/spec lanza TypeError con un nodo de forma inválida (condición sin rules, choices que no es una lista de objetos); el editor los produce y por eso todo pasa por nodeTargets
metadata:
  type: project
  enforcement: apps/web/src/lib/editor/node-targets.test.ts, apps/web/tests/static-guard.test.ts, apps/web/e2e/editor-inspector.e2e.ts
---

# `targets()` solo vale con la forma ya validada

`targets(node)` (`packages/spec/src/validate.ts`) recorre `node.rules.forEach`, `(node.choices ?? []).forEach` y `c.next` sin proteger. Lanza `TypeError` con una condición sin `rules`, con `rules: 5` o `[null]`, y con un `input` cuyo `choices` es `"x"` o `[null]`. `validateFlow` solo lo llama después de comprobar la forma, así que allí es seguro.

El editor sí los produce: «Añadir nodo» crea una condición sin `rules` y «Editar como JSON» deja escribir cualquier cosa. Además `targets` empuja `rules[i].next` sin mirar su tipo (la plantilla de regla, sin `next`, daría una conexión a `undefined`) y etiqueta una opción sin `id` de texto como `choices[[object Object]].next`.

**Cómo se evita:** el editor solo llega a `targets` a través de `nodeTargets` (`apps/web/src/lib/editor/node-targets.ts`), que comprueba la forma mínima, recorre lo legible si no se cumple, da solo saltos con `id` de texto y usa el índice como etiqueta de una opción sin `id` de texto. La identidad de una salida es su `pointer`, nunca su `key`. La guarda estática exige que ningún otro fichero de `src/` importe `targets` (tampoco con `import *` ni `import()`), y el E2E «añadir una condición no rompe el lienzo» lo ejerce de punta a punta.
