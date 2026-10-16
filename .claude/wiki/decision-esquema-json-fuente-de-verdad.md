---
name: decision-esquema-json-fuente-de-verdad
description: Por qué el formato de flujo se define en JSON Schema y los tipos TS se generan, en vez de definirlo en TypeScript o Zod
metadata:
  type: project
---

# El JSON Schema manda; los tipos TypeScript se derivan

**Decisión (2026-10-16):** `packages/spec/flow.schema.json` (JSON Schema 2020-12) es la definición canónica del formato de flujo. `src/types.ts` se genera con json-schema-to-typescript y la validación de forma usa ajv contra el mismo esquema.

**Por qué:**
- La spec nació como borrador de una spec **pública** (RFC-0001), con un validador en Python. El formato tiene que poder implementarse desde cualquier lenguaje; un JSON Schema lo consume cualquiera, un tipo de TS o un esquema Zod no.
- Al portar el validador a TypeScript se mantuvo el esquema intacto: `validate.ts` es una traducción regla a regla de `validate.py` y dio los mismos resultados con los ejemplos y los flujos rotos.

**Alternativa descartada:** Zod como fuente de verdad, exportando JSON Schema. Encaja con las convenciones TS del equipo, pero convierte el formato público en un artefacto derivado de una librería concreta.

**Consecuencia:** los tipos generados tienen formas algo toscas (intersecciones con `NodeBase`, `type?:` opcional dentro de la intersección). Se aceptan; no se retocan a mano (test "tipos" en `packages/spec/tests/validate.test.ts`).

Relacionado: [[gotcha-spec-watch-borra-dist]].
