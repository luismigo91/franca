# Lecciones aprendidas del equipo

> **Enforcement tier: advisory.** Reglas fijadas a partir de incidentes reales en otros proyectos. Cada una tiene un porqué; no son estilo.

## Control y autorización

- **Nunca mergear sin orden explícita e inequívoca.** Un "vale"/"dale" a una pregunta compuesta que menciona el merge NO cuenta. Nada con destino a producción salvo una orden directa. Al mergear, recuerda en la respuesta que el destino es `main` (producción).
- **No empezar trabajo que nadie ha pedido.** Que llegue un sync, diverjan marcadores o aparezca una spec nueva NO es una orden de trabajo: como mucho, avísalo en una frase.
- **Sin orquestadores opacos.** Para un pipeline de agentes, lanza los subagentes en secuencia a mano e informa al usuario al terminar cada uno. El usuario quiere control paso a paso.
- **"Vamos más rápido"** = prompts más ligeros y saltarse QA intermedio, solo con la spec cerrada. Nunca en la fase de spec, donde las decisiones no se pueden acelerar.
- **Cuando el usuario dice "dale a todo en orden"** tras acordar una lista, quiere ejecución autónoma completa (ramas, PRs, CI) sin más preguntas; solo decisiones de producto y merges quedan para él.
- **Nunca SSH a servidores** (prod, CI, VMs) sin OK explícito.
- **Para una necesidad puntual, usa un mecanismo por-commit** (marcador, variable de entorno) en vez de tocar configuración persistente del repo (desactivar workflows, cambiar settings).

## Specs, arquitectura e integración

- **Auditar una spec contra el código ya fusionado de sus dependencias, no contra otros documentos.** Los fallos que rompen el sistema en ejecución no se ven leyendo documentos.
- **Un desarrollo nuevo convive con el existente sin retocarlo**: módulo nuevo, router propio; contacto en una cláusula de una línea y un criterio de aceptación que haga fallar el PR si el diff abre otros ficheros.
- **Cada integración con código ajeno se escribe con ese código abierto** (DTO real, excepción real, lector real) y se prueba con al menos un fixture copiado de su forma real. Miles de tests verdes pueden convivir con integraciones rotas si los dobles tienen la forma que el autor creía.
- **Revisión adversarial de las costuras antes de dar algo por verde.**
- **Validar la arquitectura de un agente contra la petición literal del usuario**, no solo contra su coherencia interna. Si la petición pide granularidad ("punto por punto"), cuenta unidades reales frente a unidades producidas: un ratio muy alejado de 1:1 es la señal.
- **"El proveedor provee, el consumidor decide"**: por una frontera viajan hechos observados; las decisiones (reintentar, bloquear, avisar) viven en un solo sitio, el consumidor.
- **Si una hipótesis sobre la forma de los datos choca con lo que el usuario recuerda, pide un dato real** antes de descartarla.
- **Nombre de marca ≠ nombre interno.** Todo copy visible al usuario usa la marca, nunca el nombre del repo o del paquete.

## Verificación y CI

- **Informa solo de checks realmente ejecutados.** Nunca describas como pasado un check que no corriste.
- **No des por hecho lo que no se ve funcionar**: backend con curl al endpoint; frontend en el navegador con consola limpia y pestaña de red revisada.
- **Repo local desactualizado**: antes de afirmar que algo falta en el remoto, `git fetch` y lee de `origin/<rama>` con `git ls-tree` / `git show`, sin cambiar el working tree.
- **No mides rendimiento de e2e en el portátil**: la varianza invalida el experimento; mide en el runner o con muchas repeticiones.
- **Si un deploy "falla" pero los jobs de deploy están verdes, mira primero qué job es el rojo** antes de tocar nada.
- **Un formateo global (`prettier --write .`) está prohibido**: reformatea cientos de ficheros y rompe baselines. Formatea solo los ficheros tocados con la CLI de la misma versión.
- **Agentes headless (`claude -p`) no pueden dejar procesos en segundo plano** esperando notificación: la sesión termina. Verificación en primer plano y, si no hubo commit, marcar el resultado como `[INCOMPLETE]`.
- **No expongas un PAT a un agente desatendido**: puede crear PRs contra producción. Ramas empujadas con `GITHUB_TOKEN` no disparan CI.
- **Dos ejecuciones desatendidas sobre el mismo delta divergen**: limita el alcance (máximo N features por ejecución, un solo PR abierto a la vez) y nunca inventes UI sin spec.
- **Nada de auto-bless de baselines**: un hook que consagra outputs sin revisión convierte cualquier regresión en "comportamiento correcto". Los baselines se regraban con un comando explícito.
- **Un gotcha documentado no protege**: muchos gotchas vuelven a morder después de estar escritos. Todo gotcha declara su enforcement (test/hook/CI) o `none — <razón>` en voz alta.
