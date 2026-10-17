---
name: gotcha-next-dev-fuera-de-la-frontera
description: En next dev los recursos de desarrollo se atienden antes de proxy.ts, uno abre el inspector de Node y el DNS rebinding llega a él; por qué un guardián delante no basta y el preload sí, y que --inspect queda desaconsejado
metadata:
  type: project
  enforcement: apps/web/tests/local-only-preload.test.ts, apps/web/tests/static-guard.test.ts, apps/web/e2e/frontier.e2e.ts
---

# `next dev` atiende recursos de desarrollo antes de `proxy.ts`

En `next dev`, `router-server.js` ejecuta `blockCrossSiteDEV` y `hotReloader.run` **antes** de resolver rutas (donde corre `proxy.ts`). Los middlewares de desarrollo atienden `/__nextjs_*` y `/_next/*` sin pasar por [[decision-frontera-local-de-la-web]], y `blockCrossSiteDEV` deja pasar **toda petición sin `Origin`**, que es justo la de un `GET` del mismo origen tras un DNS rebinding.

Lo que expone: `/__nextjs_attach-nodejs-inspector` (cualquier método) abre el inspector de Node y devuelve su `devtoolsFrontendUrl` con el UUID secreto; el inspector acepta un WebSocket con `Host: 127.0.0.1:<puerto>` y cualquier `Origin`, así que una página con rebinding **ejecuta código** en el proceso. También `/__nextjs_launch-editor` (abre ficheros, oráculo de existencia) y los mapas de fuentes. Además, Next manda el `devtoolsFrontendUrl` por el *websocket* de HMR en el mensaje `SYNC`; `blockCrossSiteDEV` admite `localhost` y `*.localhost`, así que una página de `http://localhost:5173` leería ese canal: por eso `upgrade` exige el `Origin` propio.

**Un guardián delante no basta**: el `next dev` hijo atiende en su puerto efímero con cualquier `Host`, y ese puerto se localiza por tiempos. **El preload sí** (`apps/web/scripts/local-only-preload.cjs`, cargado con `--require` por `scripts/local-only.mjs` en todo el árbol de procesos): sustituye `inspector.open` por una función que lanza y envuelve `emit` de `http.Server` y `https.Server` en los cinco eventos (`request`, `checkContinue`, `checkExpectation`, `upgrade`, `connect`) y `ServerResponse.prototype.writeContinue`, con 403 a un `Host` no local y, en `upgrade` y `connect`, exigiendo el `Origin` propio. **`100 Continue`**: Next crea su servidor sin listener de `checkContinue`, así que Node escribe `100 Continue` antes de emitir `request`; sin envolver `writeContinue`, un `Host` ajeno lo recibía antes del 403 (`skipWriteContinueGuard`). El `--require` sobrevive al *fork* de `next-dev.js`.

**`--inspect` queda desaconsejado**: `next start --inspect` deja de funcionar (Next sale con 1) y `NODE_OPTIONS=--inspect` abre el inspector al arrancar sin pasar por `open`, dejándolo en `127.0.0.1:9229` para cualquier proceso local. Sigue abierto un efecto lateral sin lectura de datos: una página de otro puerto de `localhost` puede provocar `/__nextjs_launch-editor` o `POST /__nextjs_restart_dev?invalidateFileSystemCache` sin leer la respuesta.
