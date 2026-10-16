# Wiki de conocimiento del proyecto — cómo funciona

Base de conocimiento **tácito** del proyecto, versionada en git, **escrita y leída por Claude** como documentación de trabajo. Es el hogar compartido de lo que antes vivía solo en la auto-memory personal de `~/.claude` (local a una máquina, no compartida).

Consumidor primario: **Claude** (y cualquier agente). No es documentación de cara a humanos (eso es `docs/`), ni comportamiento canónico de capacidades (eso son las specs), ni tracking de trabajo en curso.

## Qué va aquí y qué NO (frontera anti-deriva — tier `advisory`)

Este es el nicho exclusivo de la wiki: **lo que no puedes grep-ear.**

```
¿el dato deriva del código?  ──SÍ──►  NO lo copies como valor. Enlaza a la fuente.
   (rutas, DTOs, límites,             (filosofía "pointer" de .claude/rules/README.md)
    constantes)
                             ──NO──►  es un HECHO durable. Va entero.

¿tiene casa en un spec o en docs/?  ──SÍ──►  va ahí, NO aquí.
                                    ──NO──►  es tácito → la wiki es su casa.
```

**SÍ va:** por qué se decidió X, gotchas, callejones sin salida ("la teoría era falsa"), trampas cross-cutting, invariantes no obvios descubiertos, decisiones de dominio intencionales que parecen bugs.

**NO va:** valores que están en el código, estructura de carpetas (deriva), estado de un cambio en vuelo, documentación para humanos, preferencias personales o PII.

## Formato

- **Un hecho por fichero.** Nada de ficheros monolíticos (evita conflictos de merge y mejora el recall).
- **Frontmatter** en cada fichero:
  ```markdown
  ---
  name: <slug-kebab-case, igual al nombre del fichero>
  description: <una línea; se usa para decidir relevancia al recuperar>
  metadata:
    type: project | reference
    enforcement: <ruta del gate>[, <otra>]   # obligatorio en gotcha-*
  ---
  ```
- **`enforcement` (gotcha-\*, lo comprueba `scripts/wiki-lint.mjs`):** la ruta del test/hook/workflow/regla de lint que impide que el gotcha vuelva a morder, o `none — <razón>` (mínimo 12 caracteres) si la lección no es mecanizable. Existe porque **23 de 81 gotchas volvieron a morder DESPUÉS de estar escritos**: una ficha advisory no protege; el campo obliga a decidir en voz alta si se mecaniza. Ratchet: los antiguos entran al tocarlos.
- **Cuerpo:** el hecho. Enlaza hechos relacionados con `[[slug]]`.
- **Naming:** kebab-case con prefijo por naturaleza: `gotcha-*`, `domain-*`, `decision-*`, `harness-*`, `infra-*`, `project-*`, `reference-*`.
- **Índice:** el índice canónico (una línea por hecho — `- [Título](../../wiki/slug.md) — gancho corto`) vive en `.claude/rules/always/knowledge-wiki.md`, **no** aquí, porque ese fichero se auto-carga en contexto y `.claude/wiki/` no. Todo fichero de hecho debe tener su línea ahí.

## Split por tipo (qué es del repo y qué es personal)

| type | Dónde vive | Ejemplos |
|------|-----------|----------|
| `project` | **`.claude/wiki/` (repo)** | gotchas, bugs resueltos, decisiones de dominio, harness |
| `reference` | **`.claude/wiki/` (repo)** | infra, normas de equipo, punteros a recursos |
| `user` | `~/.claude` (personal) | quién es el usuario, preferencias |
| `feedback` | `~/.claude` (personal) | cómo trabaja Claude para este usuario |

Nunca escribas `user`/`feedback` ni PII (emails) en el repo. Nada de secretos: nombres de variables sí, valores jamás.

## Cómo se mantiene

Cuando aprendas un hecho **durable, no obvio y no derivable** que pase la frontera de arriba:
1. Créalo como fichero nuevo aquí (`/popi:wiki add`) o actualiza el existente que ya lo cubre.
2. Añade/actualiza su línea en el índice de `.claude/rules/always/knowledge-wiki.md`.
3. Enlaza con `[[slug]]` los hechos relacionados.
4. `/popi:wiki lint` antes de commitear (o el Stop hook / CI lo harán por ti).

El Stop hook `check_wiki_coverage` del plugin popi **recuerda** (no bloquea) al final de un turno que tocó código sin tocar la wiki.
