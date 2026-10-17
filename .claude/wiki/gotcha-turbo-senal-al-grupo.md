---
name: gotcha-turbo-senal-al-grupo
description: Turbo ignora un SIGINT a su pid y corre cada tarea en su propio grupo de procesos; para pararlo hay que señalar al grupo, un SIGKILL deja las tareas huérfanas y un Ctrl+C a través de pnpm llega como dos SIGINT
metadata:
  type: project
  enforcement: apps/api/test/demo/dev-demo.spec.ts
---

# Parar `turbo run dev` desde un script: señal al grupo, nunca al pid

**Medido el 2026-10-17 con turbo 2.11.8 en macOS** (`pnpm dev:demo`, `apps/api/demo/dev-demo.mjs`):

- **Un `SIGINT` solo al pid del lanzador `node_modules/.bin/turbo` se ignora**: turbo siguió en marcha más de 5 minutos. Un `SIGINT` al **grupo** del lanzador (lanzador y binario) dice «Shutting down Turborepo tasks…» y libera los puertos 3000 y 3001 en menos de 1 s. Next deja un proceso auxiliar unos segundos.
- **Turbo ejecuta cada tarea en su propio grupo de procesos.** Por eso solo turbo puede pararlas: un `SIGKILL` al grupo de turbo (o al pid) las deja **huérfanas y con los puertos ocupados**. El `SIGKILL` solo es el último recurso, tras el plazo de 7 s.
- **Para pararlo desde un script hay que lanzarlo con `detached: true`** (grupo propio) y enviar `process.kill(-pid, 'SIGINT')`. Sin grupo propio, la señal alcanzaría también al propio script.
- **Con `detached`, turbo está en otra sesión y no recibe el `SIGHUP` de la terminal**: si el script no atiende `SIGHUP`, turbo y sus tareas quedan huérfanos al cerrar la ventana.
- **pnpm reenvía `SIGINT` a su hijo.** Un solo Ctrl+C llega al script **dos veces** casi a la vez (una de la terminal y otra de pnpm). Una parada que escalara a `SIGKILL` con el segundo `SIGINT` mataría turbo al momento y dejaría las tareas huérfanas: una parada en curso ignora cualquier señal nueva.
- `--no-daemon` está obsoleto en turbo 2.11.8 (el daemon ya no se usa en `run`): no hace falta.

**Qué comprobar si cambia la versión de turbo o la plataforma:** que `pnpm dev:demo` + un Ctrl+C deja 3000, 3001 y 4010 libres en menos de 10 s sin procesos huérfanos (`lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:4010 -sTCP:LISTEN`). La parada lo **detecta** al terminar (`checkPortsFree`, en `127.0.0.1` y `::1`: sale con 1 nombrando lo que siga escuchando) y el arranque siguiente también (rechaza arrancar si 3000 o el puerto de la API están ocupados); no lo evita.

**Límite: `kill -9` a la propia demo** deja turbo, la API y la web huérfanos (`detached` crea una sesión nueva y nadie recibe la señal). Recuperación: `lsof -nP -iTCP:3001 -sTCP:LISTEN` para ver el pid de la API, `ps -o pgid= -p <pid>` para su grupo (o el del lanzador de turbo) y `kill -INT -<pgid>`; después `lsof -nP -iTCP:3000 -iTCP:3001 -iTCP:4010 -sTCP:LISTEN` no debe mostrar nada. Si el lanzador de turbo muere con `kill -9` y la demo sigue viva, la demo lo nota y manda `SIGINT` a su grupo.

Enforcement: `apps/api/test/demo/dev-demo.spec.ts` (la parada envía la señal al grupo aunque el lanzador haya muerto, dos `SIGINT` no escalan, el `SIGKILL` solo llega a los 7 s, y la detección de puertos al parar y al arrancar). La medida con turbo real a través de `pnpm dev:demo` es manual (tasks 6.5 de `dev-servicios-simulados`).
