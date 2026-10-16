# Spec-first para decisiones de comportamiento

> **Enforcement tier: advisory.** Disciplina de flujo: el verify/archive reconcilia implementación contra artefactos, y eso solo tiene sentido si los artefactos van delante.

Ante CADA decisión de producto en un cambio activo aplica el **test del usuario**: *¿un test, o un usuario, notaría la diferencia sin ver el CSS?*

- **SÍ (decisión conductual)** — qué se genera/persiste/exporta, defaults, capacidades que aparecen o desaparecen, reglas de compatibilidad:
  1. Escribe el delta de spec y committéalo solo (`spec: ...`).
  2. Con el usuario delante, confirma la lectura si hay ambigüedad.
  3. SOLO entonces implementa, contra ese delta. No toques `src/**` antes.
- **NO (iteración presentacional)** — colocación, estilo, copy, tamaños: puede ir código-first. La spec recoge después solo el residuo conductual, sin detalle de píxeles.
- **En duda, clasifica al alza** (spec-first o pregunta).

Por qué: cuatro decisiones conductuales aterrizaron código-primero en una feature y una necesitó tres correcciones del usuario porque la intención nunca se escribió antes. Un delta de cinco líneas habría destapado las preguntas en un intercambio. El caso inverso también es real: spec-first indiscriminado en lo presentacional produce specs-transcripción que envejecen mal. Por eso la regla discrimina, no ritualiza.

Si el ritmo de una sesión pide saltarse el orden, se acuerda explícitamente con el usuario; nunca en silencio.
