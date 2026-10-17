---
name: gotcha-next-escucha-antes-de-cargar-la-config
description: next dev y next start escuchan antes de cargar next.config, así que validar FRANCA_API_URL ahí no impide arrancar; por eso la valida el lanzador
metadata:
  type: project
  enforcement: apps/web/e2e/frontier.e2e.ts, apps/web/tests/static-guard.test.ts
---

# Next escucha antes de leer su configuración

`next dev` y `next start` llaman a `server.listen` y cargan `next.config` **dentro** del callback de escucha (`next/dist/server/lib/start-server.js`). Un error en la configuración (o en `instrumentation.ts`, que también corre después) llega con el puerto ya abierto. Con un `FRANCA_API_URL` inválido la web «no arrancaría» pero escucharía.

Por eso `apps/web/scripts/local-only.mjs` valida la variable **antes** de ejecutar `next` y sale con 1 (`dev` y `start` pasan por él, y la guarda estática exige que los scripts de `package.json` sean exactamente `node scripts/local-only.mjs <dev|start> --hostname 127.0.0.1 --port 3000`). Arrancar `next` a mano se salta la validación y el preload de [[gotcha-next-dev-fuera-de-la-frontera]]: `transport.ts` valida de forma perezosa como defensa y cada ruta responde 500.
