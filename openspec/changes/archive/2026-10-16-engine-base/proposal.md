# Proposal: motor base de ejecución de flujos (`engine-base`)

**Fecha**: 2026-10-16 · **Estado**: Draft · **Rama**: `feat/engine-base` · **Feature 1 de 8** del plan de ejecución de flujos.

## Why

Franca define los flujos conversacionales en JSON (`@franca/spec`) y los valida, pero hoy ningún componente los ejecuta: un flujo válido no produce ni una sola respuesta. Las siete features siguientes (nodos `input`, `http` y `llm`, API de flujos y de conversaciones, web chat y editor) necesitan un motor común, puro y determinista, cuya semántica quede fijada antes de construir nada encima. Esta feature pone ese cimiento con los nodos que no dependen del usuario ni del exterior.

## What Changes

- Nuevo paquete `packages/engine` (`@franca/engine`): TypeScript puro, sin IO, sin reloj ni aleatoriedad, que consume los tipos y `validateFlow` de `@franca/spec`.
- Operación de **arranque de sesión**: valida el flujo, inicializa las variables (valores `default` y valores de contacto inyectados por el host) y ejecuta desde `start` hasta que el flujo termina o falla.
- Operación de **continuación de sesión** con su contrato de rechazos (sesión terminada, estado de otro flujo, estado corrupto). Su camino feliz llega con el nodo `input` (feature 2).
- **Eventos de salida** ordenados: `message` (contenido ya renderizado, con `nodeId` y `typingDelayMs`), `end` (con `outcome`) y `error` (con código estable).
- **Plantillas** `{{var}}`: sustitución en una sola pasada, con reglas fijas para variables sin valor y para valores no string.
- Nodos ejecutables: `message`, `set`, `jump`, `condition` (todos los operadores de `rule.op` y los predicados `all`/`any`) y `end`.
- Nodos `input`, `http` y `llm`: al alcanzarlos, la sesión falla con el error explícito `unsupported_node`. Las operaciones son asíncronas desde ya para que `http` y `llm` no cambien el contrato.
- **Protección contra bucles**: máximo 200 nodos ejecutados por avance; al superarlo, error `step_limit_exceeded`.
- **Estado de sesión** serializable a JSON, versionado y que no se muta: es lo que la feature 6 persistirá.

Ningún cambio es **BREAKING**: no hay consumidores previos.

### Formato de flujo

No cambia `packages/spec/flow.schema.json` ni `validate.ts`; ningún flujo existente se rompe. La feature solo fija la **semántica de ejecución** de campos que el esquema ya define. Tres puntos que el esquema deja abiertos se resuelven aquí y conviene anotarlos en el RFC-0001 cuando se escriba su texto: los strings de `set` son plantillas, `rule.value` es literal y `alt` se renderiza como plantilla.

## Capabilities

### New Capabilities
- `flow-engine`: ejecución de un flujo de `@franca/spec`: ciclo de vida de la sesión, variables y valores de contacto, plantillas, semántica de los nodos `message`, `set`, `jump`, `condition` y `end`, eventos de salida, límites, errores y propiedades del estado (serializable, determinista, sin IO).

### Modified Capabilities
- Ninguna (no existen specs previas en `openspec/specs/`).

## Impact

- **Código nuevo**: `packages/engine/**` (paquete de workspace; `pnpm-workspace.yaml` ya incluye `packages/*` y turbo construye `@franca/spec` antes por `^build`).
- **Dependencias**: `@franca/engine` → `@franca/spec` (runtime: `validateFlow` y tipos). Ninguna dependencia externa nueva exigida por los requisitos.
- **Sin cambios** en `apps/api`, `apps/web` ni `packages/spec`. Si el diseño obliga a tocar otro paquete, será una decisión explícita del arquitecto, no un efecto colateral.
- **Consumidores futuros**: feature 6 (persiste el estado y los valores de contacto), feature 7 (pinta eventos y respeta `typingDelayMs`), features 2-4 (añaden nodos sobre este contrato).

## Non-goals / Out of scope

- **Nodo `input`** y el estado "esperando al usuario", con su camino feliz de continuación (feature 2).
- **Nodo `http`**: red, secretos, `responseMap` y reintentos (feature 3).
- **Nodo `llm`**: proveedores, `maxTurns`, `costCapUsd` y autosaltos (feature 4).
- **Persistencia**: el motor no guarda nada; Postgres/Prisma, cifrado de PII en reposo, caducidad por `sessionTimeoutMinutes` y almacenamiento de contactos son de las features 5 y 6.
- **API HTTP y UI**: ni endpoints (features 5 y 6) ni web chat o editor (features 7 y 8).
- **Autenticación y aislamiento por tenant**: no aplica; el motor no conoce usuarios ni owners. El host (feature 6) decide quién puede arrancar o continuar una sesión. Los escenarios de privacidad de esta spec cubren lo que sí depende del motor: los errores no revelan valores y el motor no escribe logs.
- **Esperas reales**: el motor no duerme; `typingDelayMs` solo se expone.
- **Formateo por `locale`** (números, fechas, booleanos traducidos): los valores se renderizan en forma canónica.
- **Expresiones**: ni aritmética, ni rutas con punto (`{{a.b}}`), ni filtros en plantillas, ni comparar una variable con otra en `condition`.
- **Comparaciones insensibles a mayúsculas** y normalización Unicode.
- **Comprobar el tipo declarado** de una variable al asignarla (`set`, `default`, contacto): el motor guarda el valor tal cual.
- **Nuevas reglas semánticas en `validateFlow`** (regex inválida, `value` ausente en un operador que lo necesita, `default` incompatible con el tipo): quedan como FOLLOW-UP en `packages/spec`; mientras tanto el motor las trata como errores de ejecución.
- **Logs, métricas y trazas**: el motor no escribe nada; observabilidad y su filtrado de `pii` son del host.
- **Migración de estados** entre versiones de flujo editadas: el motor rechaza el estado si no encaja; versionar flujos es de la feature 5.

## Plan de verificación por capas

| Capa | Veredicto | Razón |
|---|---|---|
| Unit | **Aplica** | Lógica pura nueva: tabla operador × tipo de valor (incluidos sin valor, coerciones y errores), plantillas, `set`, orden de reglas, cortocircuito de `all`/`any`, límite de pasos. Es donde vive el producto cartesiano. |
| Golden / contractual | **Aplica** | La secuencia de eventos y el estado son el contrato de las features 6 y 7: transcripciones golden de flujos fixture (y de los ejemplos de `packages/spec/examples` hasta su primer nodo no soportado). Invariantes: estado JSON ida y vuelta, determinismo (dos ejecuciones dan el mismo resultado), entradas no mutadas, ninguna escritura en consola. |
| Paridad | **Aplica** | Test que recorre `rule.op` y los tipos de nodo de `flow.schema.json` y falla si alguno no tiene semántica en el motor (o, en el caso de los nodos, el error `unsupported_node`). Así un operador nuevo en el esquema no pasa desapercibido. |
| Integración HTTP | No aplica | No hay endpoints; llegan en las features 5 y 6. |
| E2E opción-al-menos-una-vez | No aplica | No hay UI; llega en la feature 7. |
| Smoke de ruta | No aplica | No hay páginas ni rutas. |
| Mutación | No aplica ahora | El evaluador de condiciones sería buen candidato, pero el repo no tiene herramienta de mutación. FOLLOW-UP: valorarla cuando el motor tenga los ocho nodos. |
