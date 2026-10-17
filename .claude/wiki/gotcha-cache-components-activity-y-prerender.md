---
name: gotcha-cache-components-activity-y-prerender
description: Con Cache Components un GET sin connection() se prerenderiza en el build y Next oculta con Activity las rutas visitadas conservando su estado y su DOM
metadata:
  type: project
  enforcement: apps/web/tests/static-guard.test.ts, apps/web/e2e/home.e2e.ts
---

# Dos trampas de `cacheComponents: true`

1. **Un `GET` de un route handler se prerenderiza en el `next build`** si no toca datos de la petición, y un `node:http` propio no es un «network request» que Next detecte. Cada manejador de `src/app/api/**/route.ts` empieza con `await connection()`; la guarda estática lo exige.
2. **`<Activity>`**: al navegar, Next **oculta** las rutas visitadas (hasta 3) con `display: none` y conserva su estado y su DOM; los efectos se limpian al ocultar y se recrean al mostrar. Una lista leída al montar mostraría datos viejos (la conversación recién borrada). Cada pantalla vuelve a leer en un efecto y, en el *cleanup* (`useLayoutEffect`), vuelve a `loading` (`use-paged-list.ts`, `conversation-session.ts`).

Consecuencia para los tests: la ruta anterior sigue en el DOM, así que los E2E usan `getByText(...).filter({visible: true})` y miran solo lo visible. El E2E «Conversación creada fuera del chat» falla si una lista se sirve de caché.
