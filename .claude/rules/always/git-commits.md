---
alwaysApply: true
---

# Git: commits, ramas y PRs

> **Enforcement tier: advisory** (formato de commit). Lo que SÍ está enforced: push a ramas protegidas (hook `guard_bash` del plugin popi + `.githooks/pre-push`).

## Reglas innegociables

1. **NUNCA** crear una rama sin permiso explícito del usuario. Solo el analista de producto crea ramas, y siempre preguntando: "¿rama nueva desde `main` o trabajo en la actual?".
2. **NUNCA** hacer push, abrir PR ni mergear sin que el usuario lo pida de forma explícita e inequívoca. Un "vale" o "dale" a una pregunta compuesta que menciona el merge **no** autoriza el merge.
3. **SIEMPRE** verificar la rama actual (`git branch --show-current`) antes de cambiar nada.
4. Las ramas de trabajo salen de `main` y vuelven a `main` por PR. No hay rama de integración aparte: `main` es a la vez integración y producción, así que solo recibe cambios por PR con la CI en verde.
5. Una rama por feature (backend + frontend juntos).
6. `git add <rutas concretas>`; nunca `git add -A` ni `git add .` (puede haber untracked con credenciales). Nunca commitear `.env`, credenciales ni binarios grandes.

## Nombres de rama

`<prefijo>/<kebab-case>` con prefijo en `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `spec`, `hotfix`. Ejemplos: `feat/presupuestos-compartidos`, `fix/login-redirect`, `spec/credit-packs`.

## Formato de commit (Conventional Commits)

```
<tipo>(<scope opcional>): <título corto en minúscula, sin punto final>

<cuerpo: viñetas que explican el POR QUÉ, no solo el qué>
```

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`, `spec`, `ci`. Scope por capa o paquete (`api`, `web`, `backend`, `frontend`, `ios`, `android`…).

Crea el commit con un heredoc para conservar el formato (`git commit -m "$(cat <<'MSG' ... MSG)"`). El harness añade el trailer `Co-Authored-By` automáticamente; no lo fijes a un modelo concreto en texto.

## PR

`gh pr create --base main` con cuerpo `## Summary` / `## Changes` / `## Test plan`. Genera el cuerpo con `/popi:mr-description` o el flujo completo con `/popi:pr`.
