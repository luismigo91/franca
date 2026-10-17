---
name: domain-flujos-sin-secretos
description: Un flujo nunca contiene valores secretos ni credenciales; los referencia por nombre y la instalación los resuelve. La spec avisa de un texto escrito y la API lo rechaza, con una heurística que se esquiva
metadata:
  type: project
  enforcement: packages/engine/tests/scenarios/http-privacy.test.ts, packages/spec/tests/warnings.test.ts
---

# Los flujos son JSON compartible: secretos y proveedores van por nombre

El formato (`packages/spec/flow.schema.json`) está pensado para que un flujo se pueda versionar, exportar o publicar sin filtrar nada:

- **Secretos**: las cabeceras de un nodo `http` aceptan una plantilla o `{ "secret": "NOMBRE" }` (`$defs/secretRef`, nombre en MAYÚSCULAS). El valor lo pone la instalación que ejecuta el flujo. Los ejemplos usan `CRM_TOKEN` y `SOPORTE_TOKEN`.
- **Proveedores LLM**: `llm.provider` es el nombre de un proveedor configurado en la instalación (`"principal"` en `examples/faq-ia.json`), no una clave ni un endpoint.
- **Datos personales**: las variables se marcan `pii: true` (`nombre`, `email` en los ejemplos) para que el motor sepa qué no debe registrar ni exportar en claro.

**Quién avisa y quién rechaza (`api-flows`):** el reparto es «el proveedor provee, el consumidor decide».
- `@franca/spec` solo **informa**, con avisos neutrales que no cambian `valid`: `credential_header_literal` (cabecera de credenciales con un texto sin marcadores) y `credential_header_not_secret` (texto con marcadores `{{nombre}}`). Se calculan en `packages/spec/src/warnings.ts` y los prueba `packages/spec/tests/warnings.test.ts`.
- La API **decide**: crear, actualizar y publicar un flujo válido con algún `credential_header_literal` en la lista **completa** de avisos (no la recortada a 100) se rechaza con 400 `literal_credential`, y la respuesta no repite el valor. `POST /flows/validate` no rechaza: responde 200 con el aviso. Lo prueba el e2e de secretos escritos de `apps/api` (`test/flows-secrets.e2e-spec.ts`).
- El aviso de un texto **con marcadores** no se rechaza: `"Bearer {{segmento}}"` se guarda con `credential_header_not_secret`, porque lo que llegue en esa variable es decisión de quien ejecuta.

**`literal_credential` es una heurística, no una garantía.** Se esquiva con un marcador (`"{{x}}abc123"` da `credential_header_not_secret`), con una cabecera fuera de la lista de seis nombres o poniendo el token en la query de la `url` (`https://crm.example.com/?token=abc123`). Detiene el error de pegar un token en `Authorization`, no a quien quiera esconder un secreto. No la presentes al usuario como «los flujos no pueden tener secretos».

**Consecuencias para el código que venga:**
- El editor debe ofrecer un selector de secretos y proveedores por nombre, no campos de valor, y mostrar los avisos.
- Los logs del motor tienen que respetar `pii`; los de la API no registran cuerpos ni cabeceras, así que un token pegado por error no se copia a los registros.

**Dónde se resuelve un secreto (`engine-http`):** solo en el host, dentro de cada intento. La petición que recibe `EngineHost.http` lleva `{ name, secret }` (el **nombre**) y el motor no tiene ni tipo ni campo para el valor, ni en la petición ni en el resultado: no puede filtrar lo que nunca tiene. El host resuelve el nombre con el almacén de la instalación o tenant dueño del flujo **solo** si el origen exacto de la `url` (esquema, host y puerto) está autorizado para ese secreto; si no, devuelve `missing_secret` sin abrir conexión (otro origen, incluso `http://` frente a `https://` del mismo host, o el secreto de otro tenant). El aviso `url_template_in_origin` marca justo las `url` cuyo origen depende de una variable. Lo comprueba la suite `@franca/engine/conformance` y el test de marcador de `tests/scenarios/http-privacy.test.ts`.
