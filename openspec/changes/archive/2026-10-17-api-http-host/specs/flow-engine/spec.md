## MODIFIED Requirements

### Requirement: Host de producción: destinos de red
El host de producción MUST devolver `{kind: "blocked"}` sin enviar nada si la dirección a la que va a conectar no es unicast global: loopback, privada, de enlace local (con 169.254.169.254), no especificada, compartida (100.64.0.0/10), multicast, broadcast o reservada, también mapeada en IPv6 o tras NAT64 (`64:ff9b::/96`). Tampoco lo son `::/96`, `64:ff9b:1::/48`, 6to4 (`2002::/16`) ni Teredo (`2001::/32`). Una instalación MAY permitir destinos concretos (ver «Host de producción: destinos permitidos y resolución»).

#### Scenario: Dominios que resuelven a direcciones internas
- **GIVEN** un host de producción sin destinos permitidos para esos puertos y nombres DNS que resuelven, uno por clase, a `127.0.0.1`, `0.0.0.0`, `10.0.0.5`, `172.16.0.1`, `172.31.255.254`, `192.168.1.1`, `100.64.0.1`, `169.254.169.254`, `224.0.0.1`, `255.255.255.255`, `240.0.0.1`, `192.0.2.1`, `198.18.0.1`, `::1`, `::`, `fe80::1`, `fc00::1`, `fd12:3456::1`, `ff02::1`, `2001:db8::1`, `::ffff:127.0.0.1`, `::ffff:10.0.0.5`, `::ffff:169.254.169.254`, `64:ff9b::a9fe:a9fe`, `64:ff9b::7f00:1`, `::127.0.0.1`, `64:ff9b:1::a9fe:a9fe`, `2002:7f00:1::1`, `2001::1`, y las mismas escritas de otra forma: `::ffff:7f00:1`, `0:0:0:0:0:0:0:1` y `0000:0000:0000:0000:0000:0000:0000:0001`
- **WHEN** recibe una petición a cada uno
- **THEN** devuelve `{kind: "blocked"}` en todos los casos y no abre ninguna conexión
