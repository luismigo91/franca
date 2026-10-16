# Flujo de bugfix

> **Enforcement tier: advisory.** Nada comprueba mecánicamente que un fix lleve test; el Stop hook `check_testing_pyramid` solo recuerda.

Todo bugfix incluye un test de regresión:

1. **Arregla el bug.**
2. **Busca si un test existente cubre el escenario que falló.**
3. **Si no lo cubre, añádelo sin preguntar**, como parte del fix.

Guía:
- Si la lógica con el bug está inline en un componente (un `useMemo`, un handler), **extráela a una función pura** para poder testearla.
- El test reproduce la condición exacta del fallo y verifica tanto el comportamiento correcto como la ausencia del bug.
- Antes de dar el fix por hecho, ejecuta los tests.
- Explica al usuario qué estaba roto, por qué y qué vas a cambiar, **antes** de cambiarlo.
