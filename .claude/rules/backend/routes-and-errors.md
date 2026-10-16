---
paths:
  - "apps/api/src/**"
---

# Backend — rutas, validación y errores

> **Enforcement tier: advisory.** Sin respaldo mecánico salvo los e2e de cada endpoint.

- **Rutas**: específicas antes que genéricas con parámetro (`/flows/validate` antes que `/flows/:id`). Sin prefijo de versión todavía; decidirlo antes del primer consumidor externo.
- **DTOs**: cuando un endpoint reciba algo que no sea un flujo, usar `ValidationPipe({ whitelist: true, transform: true })` + class-validator. Los flujos no pasan por DTOs: se validan con `validateFlow` de `@franca/spec`.
- **Errores**: excepciones HTTP de Nest con shape estable `{ message, error }`; el cliente ramifica por `error`, no por el texto.
- **Un resultado de validación no es un error**: endpoints que *comprueban* algo responden 200 con el veredicto (`{ valid, issues }`); los que *guardan o ejecutan* un flujo inválido responden 400 con los `issues`.
