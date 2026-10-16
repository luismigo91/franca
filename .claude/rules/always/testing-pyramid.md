# Pirámide de verificación — qué tests necesita un cambio

> **Enforcement tier: pointer.** Árbol de decisión; el respaldo mecánico son los tests y guards reales del repo. Recordatorio no bloqueante: Stop hook `check_testing_pyramid` del plugin popi.

La exhaustividad NO vive en la UI (es cara): vive en las capas baratas. Regla general: **el producto cartesiano va abajo (unit/golden/mutación, milisegundos); la UI ejercita cada opción al menos una vez más los journeys representativos.**

## Árbol de decisión

```
¿Lógica pura nueva (utils, generadores, cálculos)?
   → unit tests que maten sus ramas; entra en el alcance de mutación si existe

¿Generador/serializador con output contractual (CSV, PDF, export, geometría)?
   → fixture golden que cubra la rama nueva (baselines protegidos: se regraban, no se editan)
   → invariante si introduces una PROPIEDAD que todo output debe cumplir

¿Endpoint nuevo o cambiado?
   → test HTTP: happy path + 400 (validación) + 401/403 (auth, aislamiento por owner) + 404

¿Opción nueva de UI / configurador?
   → E2E opción-al-menos-una-vez; ¿cambia el output? → variante + baseline

¿Página / ruta nueva?
   → smoke de presencia + gate de auth correcto

¿Bugfix?
   → test de regresión que reproduzca el fallo exacto (bugfix-workflow.md)

¿Constantes espejadas entre capas (front↔back)?
   → test de paridad que falle si divergen
```

## Criterios de calidad de cada test

- Necesario (cubre algo que ningún otro ejercita), no duplicado, valida comportamiento significativo.
- Nunca aserciones sobre fixtures locales (tautología), nunca solo sobre mocks, nunca `expect` dentro de un `if`.
- Determinista: sin relojes reales ni red; un test nunca llama a un partner real (PostHog, Stripe, Firebase…); usar el SDK real sin red está permitido.
- Todo test "negativo" (afirma que algo NO ocurre) se valida mutando temporalmente el fixture para producir el caso prohibido y comprobando que FALLA.

## Fuentes (rellenar por proyecto)

- Comando canónico: ver CLAUDE.md.
- Fixtures golden y cómo regrabarlos: `.claude/popi.json` → `protectedFixtures`.
