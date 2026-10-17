---
name: gotcha-turbo-filtra-variables-de-entorno
description: Turbo 2 en modo estricto no pasa a las tareas las variables de entorno que no declara; DATABASE_URL, HOST y PORT necesitan passThroughEnv
metadata:
  type: project
  enforcement: .github/workflows/ci.yml
---

# Turbo no deja pasar `DATABASE_URL` si no se declara

**Qué pasa:** turbo 2 corre las tareas en modo de entorno estricto: solo les llegan las variables que la tarea declara (`env`, `passThroughEnv`) más un puñado de sistema. `pnpm test:e2e` o `pnpm dev` lanzados con `DATABASE_URL=… pnpm test:e2e` arrancarían sin la variable, y el `globalSetup` fallaría con «Los e2e necesitan DATABASE_URL» aunque la shell la tenga.

**Cómo está resuelto (`turbo.json`):**
- `test:e2e` declara `passThroughEnv: ["DATABASE_URL"]`.
- `@franca/api#dev` es una tarea propia con `passThroughEnv: ["DATABASE_URL", "HOST", "PORT"]`. La tarea `dev` genérica no cambia: también ejecuta `next dev` en `apps/web`, y `HOST`/`PORT` de la api no deben llegarle.
- `passThroughEnv` y no `env`: así el valor no entra en el hash de la caché ni cambia entre máquinas. Por la misma razón `test:e2e` lleva `cache: false` (depende del estado de una base).

- `@franca/api#dev` también pasa `FRANCA_SECRET_*` (con comodín: turbo lo admite en `passThroughEnv`), `FRANCA_HTTP_SECRET_ORIGINS`, `FRANCA_HTTP_ALLOWED_DESTINATIONS` y `NODE_EXTRA_CA_CERTS`. Comprobado con `pnpm exec turbo run dev --filter=@franca/api`: la línea de arranque de la salida http nombra el secreto y su origen.

**Al añadir otra variable** que lea un paquete en tiempo de ejecución o de test, hay que declararla en su tarea. Un `build` no la necesita (el cliente de Prisma se genera sin base de datos).

Enforcement: el paso `pnpm test:e2e` de `.github/workflows/ci.yml`, que define `DATABASE_URL` solo en el `env` de ese paso y pasa por turbo; si dejara de llegar, la CI falla. Los pasos `lint`, `typecheck`, `build` y `test` corren sin la variable.
