---
name: decision-editor-lienzo-y-validacion
description: Por qué el editor tiene lienzo propio en DOM y SVG, valida síncrono en el navegador con ajv y Function (CSP sin script-src), y por qué atrás del navegador con cambios sin guardar no pregunta
metadata:
  type: project
  enforcement: apps/web/src/server/frontier-editor.test.ts, apps/web/tests/static-guard.test.ts — la pérdida al volver atrás no tiene mecanismo: es una limitación aceptada
---

# Lienzo propio, validación síncrona y una CSP sin `script-src`

**Decisión (`web-editor`, 2026-10-18).**

- **Lienzo propio (DOM y SVG), sin dependencia.** Una librería de grafos (React Flow) pesa unos 45 KB y su teclado, ARIA y conexiones habría que apagarlos y rehacerlos para cumplir la spec: las salidas no reciben el foco y todo lo que hace el arrastre se hace desde el inspector. Con unas 700 líneas propias, el diseño automático, el soltar y las reglas del autosalto de `llm` viven en funciones puras (`layout.ts`, `drop.ts`).
- **Validación síncrona en el navegador con `validateFlow`**, sin Web Worker ni *debounce*: 0,09 ms con los ejemplos y 12-20 ms con 1 MiB (medido en el portátil: se repite en el *runner*). Copiar 1 MiB a un *worker* cuesta lo mismo que validar, y un veredicto tardío dejaría a «Guardar» decidir con datos viejos.
- **ajv compila con `Function`** al cargar `validateFlow` (chunk de 144 KB, 41 KB en gzip, solo en `/flujos`). Por eso la CSP de la web (`frame-ancestors 'none'`) **no puede llevar `script-src`**: rompería el editor con un `EvalError`. Si algún día hace falta, ajv *standalone* en `packages/spec`, con su propio cambio.
- **Posiciones en `nodes[].position`**, que ya existe en el esquema; el diseño automático no se escribe hasta mover, añadir o conectar.

**Límite aceptado: atrás del navegador con cambios sin guardar pregunta nada y los pierde.** `<Activity>` oculta el editor y `reset()` descarta el borrador al ocultarse; Next no da una API estable para interceptar `popstate`. La confirmación cubre los enlaces de la web, recargar y cerrar. No es un fallo: está escrito para que nadie lo tome por uno.

**`validateDraft`** (`apps/web/src/lib/editor/validate-draft.ts`) envuelve `validateFlow` como defensa en profundidad: hasta #16, `validateFlow` lanzaba con un `type` como `constructor` (`NODE_DEFS` era un objeto plano) y la API respondía 500; ya no lo hace, pero una excepción en la validación en vivo rompería la pantalla.

Ver [[gotcha-cache-components-activity-y-prerender]], [[decision-frontera-local-de-la-web]] y [[gotcha-ajv-allerrors-cuadratico]].
