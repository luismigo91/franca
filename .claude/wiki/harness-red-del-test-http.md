---
name: harness-red-del-test-http
description: Cómo los tests de la salida http llegan a servidores locales sin 127.0.0.2 (macOS), sin puertos privilegiados y sin vaciar la suite; la costura, los pares virtuales y el canario
metadata:
  type: project
  enforcement: apps/api/test/http-host-seam.e2e-spec.ts, apps/api/src/http-host/static-guard.spec.ts
---

# La red del test de la salida http

**El problema:** la suite de conformidad del motor pide servidores locales **fuera** de `CONFORMANCE_INTERNAL_ADDRESSES` (que incluye `127.0.0.1` y `::1`), y los escenarios usan `https://crm.example.com` (puerto 443). En macOS no existe `127.0.0.2` (`EADDRNOTAVAIL`, medido en Darwin 24.6) y el 443 exige privilegios.

**Cómo se resuelve (`apps/api/test/helpers/test-network.ts`):** los tests sustituyen **solo** `HTTP_NETWORK` ([[decision-salida-http-politica]]): el resolutor (qué direcciones devuelve cada nombre y en qué orden) y el abridor de sockets (a qué servidor real lleva un par `dirección:puerto`). Ninguno tiene lógica. La política, el plazo, TLS (siempre `tls.connect` de producción sobre el socket que da el abridor), el cliente HTTP y los límites son el código de producción.
- Las direcciones de los servidores del test son **virtuales** (`198.51.100.0/24`, TEST-NET-2, no global y fuera de las internas del motor) y sus puertos también (cerrados en `127.0.0.1`). La red registra cada `open` **antes** de decidir y nunca mapea `127.0.0.1:<puerto real>`.
- **Si la sustitución estuviera por encima de la política** (antes de resolver o de validar), la suite pasaría sin probar nada. Lo demuestran: un **canario** (con un abridor que rechaza todo, el escenario del CRM termina en `lead-sin-enviar` y el servidor real no recibe nada), el escenario positivo con direcciones virtuales (un código que conectara por su cuenta no llegaría al servidor) validado con el mutante `bypassOpenerToLoopback`, la guarda estática y los mutantes, que corren con esta misma red.
- **Ningún paquete sale de loopback** en ningún test ni mutante. La autoridad TLS del test solo entra por `HTTP_NETWORK.ca`; ninguna variable puede activarla. La PKI se genera en memoria (nada de claves en disco).
- Los casos de tiempo (500 ms, recorte por el plazo) usan la tolerancia del entorno del catálogo del motor (1500 ms): si la CI se queda corta se sube la tolerancia, nunca el tiempo del caso.

Enforcement: el canario y el escenario positivo de `http-host-seam.e2e-spec.ts`, `static-guard.spec.ts` y el gate de mutación de `apps/api/test/mutations.json`.
