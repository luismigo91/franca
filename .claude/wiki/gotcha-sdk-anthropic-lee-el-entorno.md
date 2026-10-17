---
name: gotcha-sdk-anthropic-lee-el-entorno
description: El SDK de Anthropic lee ANTHROPIC_AUTH_TOKEN y siempre ANTHROPIC_CUSTOM_HEADERS, que pisa x-api-key; ni apiKey ni defaultHeaders lo impiden, por eso la API pasa por una puerta de salida
metadata:
  type: project
  enforcement: apps/api/src/conversations/llm-providers.spec.ts
---

# El SDK de Anthropic hace caso al entorno aunque le pases `apiKey` y `baseURL`

**Evidencia** (`@anthropic-ai/sdk` 0.135.0, `client.js`, constructor):
- `authToken` `undefined` lee `ANTHROPIC_AUTH_TOKEN` (línea 119) y se envía como `Authorization: Bearer …`. Pasar `authToken: null` lo evita.
- `ANTHROPIC_CUSTOM_HEADERS` se lee **siempre** (línea 159) y se vuelca en `options.defaultHeaders` (línea 168: `{ ...parsed, ...options.defaultHeaders }`). `buildHeaders` fusiona en este orden: cabeceras base, `authHeaders()`, `defaultHeaders`, cabeceras del cuerpo, cabeceras de la llamada, y un nombre ya visto lo sustituye la fuente posterior. Resultado: una línea `x-api-key: otra` del entorno **sustituye** la clave explícita, y `Authorization: …` se **añade**.
- En total el SDK lee más de veinte variables `ANTHROPIC_*` (perfiles, federación de identidad, trazas…), algunas solo cuando no hay `apiKey`.

**La trampa:** la primera revisión del diseño de `api-conversations` decía que `ANTHROPIC_CUSTOM_HEADERS` «no cambia la clave». Era falso. Un `apiKey`/`baseURL` explícitos no bastan, ni tampoco `defaultHeaders` propias: el spread solo deja ganar a los nombres que conocemos, y un `X-Extra` o un `Proxy-Authorization` del entorno seguirían saliendo.

**Qué hace la API:** el cliente de `createPrincipalClient` (`apps/api/src/conversations/llm-providers.ts`) recibe `apiKey`, `authToken: null`, `baseURL` explícitos y un `fetch` que es una **puerta de salida**. Esa puerta es lo último antes de la red: deniega por defecto (solo `POST https://api.anthropic.com/v1/messages`, con consulta vacía o `?beta=true`; lo demás lanza un error de texto fijo y el turno es `failed`) y reconstruye las cabeceras desde cero (`accept`, `content-type`, `anthropic-version`, `x-api-key` y, solo en la llamada beta, el `anthropic-beta` del adaptador, leído con `new Headers(init.headers)`). No depende de cuántas variables lea el SDK. Descartado: borrar `process.env.ANTHROPIC_CUSTOM_HEADERS` mientras se construye el cliente (muta el entorno global) o negarse a arrancar si existe (castiga a las shells que la tienen para otras herramientas, igual que se ignora `ANTHROPIC_API_KEY`).

**Qué NO cubre la puerta:** el proxy y el TLS de Node. `NODE_USE_ENV_PROXY` con `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS` y `NODE_TLS_REJECT_UNAUTHORIZED=0` cambian por dónde y con qué confianza sale la conexión, por debajo de `fetch`. Son configuración de la máquina, fuera del alcance de la API.

**Dependencias frágiles** (el unit las vigila): que el SDK use el `fetch` inyectado para toda petición (hoy `this.fetch`, que `withOptions` conserva al clonar), que su `anthropic-version` coincida con `ANTHROPIC_API_VERSION` y que el adaptador siga poniendo su cabecera beta en la llamada con `fallbacks`. Subir el SDK o el adaptador exige pasar `llm-providers.spec.ts`.

FOLLOW-UP: ofrecer esta puerta desde `createAnthropicClient` en `@franca/llm-anthropic`, para que cualquier host la tenga sin copiarla. Relacionado: [[decision-llm-coste-y-reintentos-en-el-adaptador]].

Enforcement: `apps/api/src/conversations/llm-providers.spec.ts` («Cabeceras del entorno ignoradas»; validado con dos mutantes: copiar las cabeceras del SDK y no comprobar la URL).
