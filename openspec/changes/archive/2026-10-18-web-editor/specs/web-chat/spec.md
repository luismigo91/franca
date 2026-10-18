## MODIFIED Requirements

### Requirement: Chat de prueba en local
La web de Franca SHALL ofrecer un chat de prueba: la página de inicio (`/`) lista los flujos publicados y las conversaciones recientes, y cada conversación tiene su página en `/conversaciones/<id>`. Todo el texto visible está en español y nombra el producto como «Franca», nunca con el nombre de un paquete o del repositorio. Desde la página de una conversación siempre se puede volver al inicio, y desde el inicio, ir al editor de flujos (`/flujos`, ver `web-editor`).

#### Scenario: Marca en la página de inicio
- **WHEN** se abre `/`
- **THEN** el título del documento contiene «Franca» y la página no contiene `@franca/`, `franca-web` ni «Create Next App»

#### Scenario: Enlace al editor desde el inicio
- **WHEN** se abre `/` y se sigue el enlace al editor de flujos
- **THEN** el navegador llega a `/flujos`

### Requirement: Estados de las listas
Mientras carga una lista, la página de inicio SHALL indicarlo. Vacía, muestra un mensaje propio: sin flujos publicados, que se publique uno desde el editor de flujos, con un enlace a `/flujos`; sin conversaciones, que aún no se ha probado ningún flujo. Si la API no responde o responde un error, muestra un mensaje en español, sin el texto de la API, con «Reintentar», que vuelve a pedir la lista.

#### Scenario: Sin flujos publicados
- **GIVEN** ningún flujo publicado
- **WHEN** se abre `/`
- **THEN** la página dice que todavía no hay flujos publicados, enlaza con `/flujos` para publicar uno y no ofrece ningún botón «Probar»

#### Scenario: API parada
- **GIVEN** la API parada
- **WHEN** se abre `/`, se arranca la API y se pulsa «Reintentar»
- **THEN** la página dice primero que no se puede conectar con la API de Franca, con «Reintentar», y después muestra la lista de flujos

### Requirement: Operaciones del chat en la API
Las páginas del chat SHALL usar solo estas operaciones de la API: `GET /flows?published=true`, `GET /flows/:flowId/versions/:version`, `GET /conversations`, `GET /conversations/:conversationId`, `GET /conversations/:conversationId/transcript`, `POST /conversations`, `POST /conversations/:conversationId/inputs` y `DELETE /conversations/:conversationId`. Las del editor son las de `web-editor`, y la web no usa otras. Un id de conversación que no es un UUID en minúsculas no llega a la API.

#### Scenario: Recorrido completo
- **GIVEN** la API simulada delante de la API real, reenviando cada petición y registrándola, y `captacion-leads` publicado
- **WHEN** se abre `/`, se prueba `Captación de leads`, se responde hasta el final, se recarga la página, se pulsa «Empezar de nuevo» y se borra la conversación
- **THEN** cada petición registrada es de una de esas ocho operaciones

#### Scenario: Id de conversación con una ruta dentro
- **GIVEN** la API simulada
- **WHEN** se pide a la web, desde el navegador, enviar una respuesta y borrar la conversación `..%2F..%2Fflows%2Fhola` y la conversación `00000000-0000-4000-8000-00000000000A`
- **THEN** las cuatro peticiones se responden como conversación no encontrada y la API simulada no ha recibido ninguna
