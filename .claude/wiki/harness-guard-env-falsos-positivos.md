---
name: harness-guard-env-falsos-positivos
description: Las guardas de secretos de popi bloquean también el fichero de ejemplo de variables de entorno y cualquier comando que mencione ".env", aunque sea en texto
metadata:
  type: project
---

# Las guardas de ficheros de entorno dan falsos positivos

**Qué pasó:** 2026-10-16, durante `/popi:setup`, nos mordió dos veces:

1. `.claude/settings.json` deniega `Write(**/.env.*)` (y `Read`/`Edit`). El patrón también cubre `.env.example`, así que ni la herramienta Write ni un `printf >` por shell pudieron crear `apps/api/.env.example`. El `secretAllowlist` de `.claude/popi.json` solo afecta a los hooks de popi, no a los permisos de Claude Code.
2. El hook `guard_bash` del plugin popi trata como lectura de secretos cualquier comando que contenga un token tipo `.env` o `**/.env.*` junto a un verbo de lectura (`cat`, `printf`…), aunque solo sea texto: un comentario dentro de un `printf` o el cuerpo de un PR en un heredoc.

**Cómo se trabaja con ello:**
- En textos que se pasan por shell (cuerpos de PR, mensajes de commit), habla de "ficheros de entorno" en vez de escribir el patrón.
- El fichero de ejemplo de variables lo crea una persona, o hay que relajar el deny de `.claude/settings.json` para excluirlo (decisión pendiente). Mientras, las variables se documentan en `CLAUDE.md`.
- No intentes esquivar el deny por otra vía: es una guarda deliberada.
