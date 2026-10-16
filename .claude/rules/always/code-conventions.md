---
alwaysApply: true
---

# Convenciones de código

> **Enforcement tier: advisory.** El linter cubre parte (naming, `no-explicit-any`). "Documentación en todo lo público" no se enforce mecánicamente.

## Naming

- Clases y tipos: PascalCase. Funciones y variables: camelCase. Ficheros y carpetas: kebab-case. Constantes y variables de entorno: MAYÚSCULAS.
- Funciones con verbo + sustantivo (`getUserData`, `buildRowForPiece`). Booleanos con `is/has/can`. Handlers `handle*`; callbacks de props `on*`; hooks `use*`.
- Código e identificadores en inglés; copy visible al usuario en el idioma del producto.

## Tipado y estilo

- Tipado fuerte: evitar `any`; `import type` para tipos; preferir esquemas con inferencia (Zod) al crear tipos nuevos.
- Funciones cortas con una responsabilidad; early returns; `async/await` sin mezclar con `.then()`.
- Sin `console.log` en producción; logging con el logger del proyecto.
- Estados de UI siempre: loading, error, empty, success.

## Documentación

- Docstring/JSDoc en todo lo público con `@param`, `@returns`, `@throws`; voz activa, presente.
- Sin comentarios que narren lo obvio; sí los que explican un porqué no evidente (y si es durable y no derivable, va a la wiki).
