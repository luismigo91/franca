---
paths:
  - "apps/api/**"
---

# Backend (`apps/api`) — arquitectura

> **Enforcement tier: pointer.** Patrones del stack en la skill `popi:stack-nestjs`; aquí solo lo que aplica a este repo. Ejemplo de referencia: `apps/api/src/flows/`.

- Un módulo por dominio en `src/<modulo>/`: `<modulo>.module.ts`, `<modulo>.controller.ts` (HTTP: decoradores, delega), `<modulo>.service.ts` (lógica). El módulo se registra en `src/app.module.ts`.
- **El formato de flujo es de `@franca/spec`.** La API nunca redefine tipos de flujo ni reimplementa reglas de validación: importa `Flow`, `Node`, `validateFlow`… de `@franca/spec`. Si falta una regla, va a `packages/spec` con su test.
- ESM: imports relativos con extensión `.js`.
- Tests unit junto al código (`*.spec.ts`, Vitest) y e2e en `test/*.e2e-spec.ts` con `supertest` (`pnpm --filter @franca/api test:e2e`). Un e2e por endpoint nuevo: happy path + entradas inválidas.
- Aún no hay base de datos ni autenticación. Cuando lleguen, el owner/tenant sale siempre del usuario autenticado, nunca del body ni de los params (ver `popi:stack-nestjs`).
