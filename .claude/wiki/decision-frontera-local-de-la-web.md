---
name: decision-frontera-local-de-la-web
description: Por qué la web es la frontera local de la API sin autenticación (proxy en el servidor y no lista de orígenes), con Host en bruto más Origin, sin Server Actions, sin marcos y con catorce operaciones fijas
metadata:
  type: project
  enforcement: apps/web/src/server/frontier.test.ts, apps/web/tests/static-guard.test.ts, apps/web/e2e/frontier.e2e.ts, apps/web/src/server/frontier-editor.test.ts, apps/web/e2e/editor-frontier.e2e.ts
---

# La web es la frontera local de una API sin autenticación

**Decisión (`web-chat`, 2026-10-17).** El navegador nunca habla con la API: lo hace el servidor de la web (`apps/web/src/server/`), por loopback y sin `Origin`. No se abrió la API con una lista de orígenes ni CORS: «Sin acceso desde navegadores» sigue siendo cierto y la API no cambia.

- **`Host` en bruto, no `x-forwarded-host`.** Next rellena `x-forwarded-host` con `??=` y respeta el que mande el cliente. `proxy.ts` (sin `matcher`) decide solo sobre la cabecera `host` (`checkFrontier`). Un DNS rebinding trae un `Host` ajeno y falla ahí.
- **`Origin` además del `Host`**: en todo método que no sea `GET` ni `HEAD`, `Origin` tiene que ser `http://` + el `Host` ya validado. Las Server Actions de Next comparan con el `Host` y dejan pasar una petición sin `Origin`, así que no hay ninguna (guarda estática) y nada acepta mutaciones fuera de las rutas fijas.
- **Sin marcos**: `frame-ancestors 'none'` y `X-Frame-Options: DENY` en toda respuesta. Con `Host` y `Origin` solos, un `iframe` de otra web mandaría peticiones con el `Origin` propio (clickjacking).
- **Catorce operaciones fijas** (ocho del chat desde `web-chat`; seis del editor desde `web-editor`, bajo `/api/editor/flows/**`: lista sin `published`, leer, crear, guardar, publicar y borrar), no un proxy genérico ni `rewrites` de `next.config` (reenviarían las cabeceras del navegador): `operations.ts` arma cada ruta con argumentos ya validados, y un id de conversación que no es un UUID en minúsculas, o un id de flujo que no cumple el patrón de la spec, no llega a la API (404 en la frontera y otra vez en el manejador).
- **`fetch` del navegador en modo `cors`**: con `Referrer-Policy: no-referrer`, un `POST` `no-cors` o el envío nativo de un `<form>` llevan `Origin: null` y la frontera los rechaza. Los formularios llaman siempre a `preventDefault()` y no tienen `action`.

Los siete manejadores que cambian algo (tres del chat, cuatro del editor) vuelven a llamar a `checkFrontier` (defensa en profundidad). Con las mutaciones del editor, un CSRF que pasara podría publicar un flujo con nodos `http`; lo contienen `Origin`, `Host`, la ausencia de marcos y que un secreto solo viaja a su origen autorizado ([[decision-salida-http-politica]]). En publicar y borrar, la web **exige** `If-Match` aunque la API lo admite opcional. **Residuos que no llegan a manejadores ni a la API**: la forma absoluta (`GET http://evil.com/` recibe un 308 de Next antes de `proxy.ts`) y `TRACE` (500); el navegador no los produce.

Ver [[gotcha-next-dev-fuera-de-la-frontera]] para `next dev` y [[gotcha-node-http-createconnection-y-proxy]] para el transporte.
