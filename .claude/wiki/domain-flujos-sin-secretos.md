---
name: domain-flujos-sin-secretos
description: Un flujo nunca contiene valores secretos ni credenciales; los referencia por nombre y la instalación los resuelve
metadata:
  type: project
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
