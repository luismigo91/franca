---
name: domain-flujos-sin-secretos
description: Un flujo nunca contiene valores secretos ni credenciales; los referencia por nombre y la instalación los resuelve
metadata:
  type: project
  enforcement: packages/engine/tests/scenarios/http-privacy.test.ts
---

# Los flujos son JSON compartible: secretos y proveedores van por nombre

El formato (`packages/spec/flow.schema.json`) está pensado para que un flujo se pueda versionar, exportar o publicar sin filtrar nada:

- **Secretos**: las cabeceras de un nodo `http` aceptan una plantilla o `{ "secret": "NOMBRE" }` (`$defs/secretRef`, nombre en MAYÚSCULAS). El valor lo pone la instalación que ejecuta el flujo. Los ejemplos usan `CRM_TOKEN` y `SOPORTE_TOKEN`.
- **Proveedores LLM**: `llm.provider` es el nombre de un proveedor configurado en la instalación (`"principal"` en `examples/faq-ia.json`), no una clave ni un endpoint.
- **Datos personales**: las variables se marcan `pii: true` (`nombre`, `email` en los ejemplos) para que el motor sepa qué no debe registrar ni exportar en claro.

**Consecuencias para el código que venga:**
- La api nunca debe aceptar ni guardar un flujo con un token pegado en una cabecera como texto. Vale la pena una regla semántica que lo detecte (por ejemplo, cabeceras `Authorization` que no sean `secretRef`); hoy no existe.
- El editor debe ofrecer un selector de secretos y proveedores por nombre, no campos de valor.
- Los logs del motor tienen que respetar `pii`.

**Dónde se resuelve un secreto (`engine-http`):** solo en el host, dentro de cada intento. La petición que recibe `EngineHost.http` lleva `{ name, secret }` (el **nombre**) y el motor no tiene ni tipo ni campo para el valor, ni en la petición ni en el resultado: no puede filtrar lo que nunca tiene. El host resuelve el nombre con el almacén de la instalación o tenant dueño del flujo **solo** si el origen exacto de la `url` (esquema, host y puerto) está autorizado para ese secreto; si no, devuelve `missing_secret` sin abrir conexión (otro origen, incluso `http://` frente a `https://` del mismo host, o el secreto de otro tenant). Lo comprueba la suite `@franca/engine/conformance` y el test de marcador de `tests/scenarios/http-privacy.test.ts`.
