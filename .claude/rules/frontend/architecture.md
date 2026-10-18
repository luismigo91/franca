---
paths:
  - "apps/web/**"
---

# Frontend (`apps/web`) — arquitectura

> **Enforcement tier: advisory.** Patrones del stack en la skill `popi:stack-nextjs`; aquí solo lo que aplica a este repo.

- **Next.js 16**: antes de usar una API de Next, lee la guía en `node_modules/next/dist/docs/` (`apps/web/AGENTS.md`). No asumas APIs de versiones anteriores.
- App Router en `src/app/`: **Server Components por defecto**; `'use client'` solo para interactividad, hooks o estado. Alias `@/*` → `src/*`.
- Componentes por feature en `src/components/<feature>/`; genéricos en `src/components/ui/`.
- **Tipos de flujo desde `@franca/spec`** (`Flow`, `Node`, `validateFlow`…), nunca redefinidos en la web. El editor valida en vivo con `validateFlow` (a través de `validateDraft`, que no lanza); cada `issue` trae `path` (JSON Pointer) y `nodeId` para señalar el nodo. **`@franca/spec` solo entra en el navegador por el editor** (`src/lib/editor/**`; la guarda estática lo exige) y `targets` solo a través de `src/lib/editor/node-targets.ts`.
- Cuando haya llamadas a la API: un cliente HTTP único y un `ENDPOINTS` en `src/config/` como única fuente de URLs; nada de URLs sueltas en componentes. La API corre en `:3001`.
- Estados siempre: loading, error, empty, success. Verificación en navegador antes de dar algo por hecho (`/popi:verify frontend`).
- **Frontera local del chat** (`web-chat`): el navegador nunca habla con la API. `src/proxy.ts` (sin `matcher`) aplica `Host` en bruto y `Origin` (`src/server/frontier.ts`), y `src/server/api/operations.ts` es la única puerta, con **catorce operaciones fijas** (ocho del chat y seis del editor, bajo `/api/editor/flows/**`) sobre `node:http` (`transport.ts`, sin `fetch`). Las URLs salen de `WEB_ENDPOINTS` (navegador) y `API_OPERATIONS` (servidor) en `src/config/endpoints.ts`.
- **El editor de flujos** (`web-editor`): `/flujos` y `/flujos/<id>`. La lógica pura vive en `src/lib/editor/` (edición sobre el JSON del flujo, descriptores del inspector, salidas, diseño automático, soltar, `EditorSession`) y se prueba sin React; los componentes en `src/components/editor/` (lienzo propio en DOM y SVG, inspector por descriptores) no cargan ni enlazan ninguna URL del flujo. Cada pantalla relee al mostrarse y suelta su estado al ocultarse (`<Activity>`).
- **Un único cliente del navegador**, `src/lib/web-client.ts` (`webClient` y `editorClient`), con `fetch` en modo `cors` y sin `mode:`. Lee las respuestas por su estado: un 204 es éxito, y un 4xx/5xx sin cuerpo (el 403 de la frontera) es `unknown`, nunca `network_error`.
- **Tests de la web**: Vitest en `pnpm check` (unit, marcado con `renderToStaticMarkup`, integración con una API simulada, guarda estática, paridad de códigos y cobertura de la spec) y Playwright en `pnpm test:e2e` (Chromium contra la API real, solo loopback).
