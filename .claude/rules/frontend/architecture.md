---
paths:
  - "apps/web/**"
---

# Frontend (`apps/web`) — arquitectura

> **Enforcement tier: advisory.** Patrones del stack en la skill `popi:stack-nextjs`; aquí solo lo que aplica a este repo.

- **Next.js 16**: antes de usar una API de Next, lee la guía en `node_modules/next/dist/docs/` (`apps/web/AGENTS.md`). No asumas APIs de versiones anteriores.
- App Router en `src/app/`: **Server Components por defecto**; `'use client'` solo para interactividad, hooks o estado. Alias `@/*` → `src/*`.
- Componentes por feature en `src/components/<feature>/`; genéricos en `src/components/ui/`.
- **Tipos de flujo desde `@franca/spec`** (`Flow`, `Node`, `validateFlow`…), nunca redefinidos en la web. El editor puede validar en vivo con `validateFlow`; cada `issue` trae `path` (JSON Pointer) y `nodeId` para señalar el nodo.
- Cuando haya llamadas a la API: un cliente HTTP único y un `ENDPOINTS` en `src/config/` como única fuente de URLs; nada de URLs sueltas en componentes. La API corre en `:3001`.
- Estados siempre: loading, error, empty, success. Verificación en navegador antes de dar algo por hecho (`/popi:verify frontend`).
