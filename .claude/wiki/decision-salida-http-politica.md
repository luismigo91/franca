---
name: decision-salida-http-politica
description: Por qué la salida http de la API guarda los secretos en variables con origen exacto, bloquea una resolución mezclada entera, solo permite http:// hacia pares permitidos y no registra nada de una llamada; límites conocidos y fecha de los CSV de IANA
metadata:
  type: project
  enforcement: apps/api/src/http-host/destination-policy.spec.ts, apps/api/test/http-host-destinations.e2e-spec.ts, apps/api/test/http-host-secrets.e2e-spec.ts, apps/api/test/http-host-logging.e2e-spec.ts, apps/api/test/mutations.json
---

# La política de la salida http de la API (`api-http-host`)

Sustituye a la ficha antigua «http deshabilitado en las conversaciones»: desde esta feature un nodo `http` hace la llamada (`apps/api/src/http-host/`, ver [[decision-http-un-intento-por-llamada]] para el reparto con el motor y [[domain-flujos-sin-secretos]] para por qué el flujo solo nombra secretos).

**Decisiones y su porqué**
- **Secretos en `FRANCA_SECRET_<NOMBRE>` con los orígenes en una variable aparte (`FRANCA_HTTP_SECRET_ORIGINS`).** Es el patrón de `FRANCA_ANTHROPIC_API_KEY`. Un fichero JSON de secretos dentro del árbol de un repo público acabaría commiteado, y las guardas solo protegen ficheros de entorno. Separar valor y orígenes evita la ambigüedad de `FRANCA_SECRET_X_ORIGIN` (¿origen de `X` o valor de `X_ORIGIN`?) y deja imprimir los orígenes al arrancar.
- **Origen escrito exactamente como su serialización WHATWG**; si no, no arranca. `HTTPS://CRM…` o `:443` se normalizarían en silencio ([[gotcha-url-whatwg-normaliza]]) y quien opera vería una cosa y la API compararía otra. La regla de «qué es un origen válido» no se copia: `secret-origin.ts` se la pregunta al motor con un flujo sonda.
- **Resolución mezclada: se bloquea entera.** Un servicio público legítimo no publica direcciones internas; mezclarlas es el patrón del *DNS rebinding*. Bloquear es más simple de verificar que filtrar, y nunca hay que elegir qué dirección «vale».
- **`http://` solo hacia pares permitidos** (`blocked`, `insecure_transport`): los ejemplos envían nombre y email. En local, la lista de permitidos cubre los servidores de prueba.
- **Los secretos se comprueban antes de resolver el nombre**: una petición que no va a salir no filtra el nombre al DNS, y `missing_secret` gana al plazo.
- **De una llamada no se registra nada**, ni siquiera el origen (el host de una URL puede salir de una plantilla con datos del usuario). Solo dos avisos de plantilla fija: `missing_secret` y `blocked`.
- **La instalación es el único tenant** mientras la API no tenga autenticación; el arnés de conformidad crea un host por tenant.

**Límites conocidos**
- Los prefijos NAT64 propios de un operador (RFC 6052, distintos de `64:ff9b::/96`) no se pueden detectar: una IPv6 global de ese prefijo que traduzca a una IPv4 interna pasaría.
- `192.88.99.2/32` (6a44) se trata como no global por criterio conservador; IANA también lo marca `False`.
- Las tablas de `special-purpose-addresses.ts` son la instantánea de los CSV de IANA del **2026-10-17** (`iana-ipv4-special-registry` e `iana-ipv6-special-registry`). Cambian (RFC 9602, 9637 y 9780 son de 2024-2025): actualizarlas es un cambio de conducta, va primero a la spec de `http-host`.
- Los valores de los secretos viven en el entorno del proceso: legibles por cualquier proceso del mismo usuario. Válido solo mientras la API escuche en bucle local.
- `lookup` del sistema no se cancela: una resolución colgada ocupa un hilo de libuv hasta que el sistema responda.

Enforcement: `destination-policy.spec.ts`, `addresses.spec.ts`, los e2e `http-host-*` y los mutantes de `apps/api/test/mutations.json`.
