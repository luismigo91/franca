import { connect, createServer, isIP } from 'node:net';
import { destinationKey } from '../../src/http-host/addresses.js';
import type { HttpNetwork, Resolver, SocketOpener } from '../../src/http-host/network.js';
import { trustedAuthority } from './test-pki.js';
import { isRealServerPort, type TestServer } from './test-servers.js';

/** Una entrada de resolución: una dirección (la familia se deduce) o una entrada cruda, para probar basura. */
export type Answer = string | { address: unknown; family: unknown };

type Plan = { kind: 'rounds'; rounds: readonly (readonly Answer[])[] } | { kind: 'hang' };

export interface OpenedConnection {
  readonly address: string;
  readonly port: number;
}

/** Un puerto de loopback en el que no escucha nadie (se ocupa un momento y se libera). */
async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * La costura de red del test (`HttpNetwork`): lo único que sustituyen los e2e de la salida http. **No tiene lógica de
 * seguridad**:
 * - el resolutor devuelve lo que el test guionizó para cada nombre (rondas sucesivas; la última se repite), un nombre
 *   desconocido es un rechazo, y `hang` nunca responde ni mira la señal, como el `lookup` real;
 * - el abridor registra `{address, port}` **antes** de decidir y después lleva el par a `127.0.0.1:<puerto real>` del
 *   servidor registrado para él, o a un puerto local cerrado (un rechazo real del sistema). Nunca mapea el puerto real de
 *   un servidor: los pares de los escenarios son virtuales.
 * Todo lo demás (política, plazo, TLS, cliente HTTP, límites) es el código de producción, que corre igual.
 */
export class TestNetwork implements HttpNetwork {
  readonly ca: readonly string[] = [trustedAuthority.certificate];
  readonly resolver: Resolver;
  readonly opener: SocketOpener;

  private readonly plans = new Map<string, Plan>();
  private readonly asked: string[] = [];
  private readonly mapped = new Map<string, number>();
  private readonly opened: OpenedConnection[] = [];
  private refusedPort: number;

  private constructor(refusedPort: number) {
    this.refusedPort = refusedPort;
    this.resolver = {
      lookup: async (hostname) => {
        this.asked.push(hostname);
        const plan = this.plans.get(hostname);
        if (plan === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
        if (plan.kind === 'hang') return new Promise<never>(() => undefined);
        const round = plan.rounds[Math.min(this.timesAsked(hostname) - 1, plan.rounds.length - 1)]!;
        return round.map((answer) => (typeof answer === 'string' ? { address: answer, family: isIP(answer) } : answer));
      },
    };
    this.opener = {
      open: ({ address, port }) => {
        this.opened.push({ address, port });
        const real = this.mapped.get(`${address}|${port}`);
        return connect({ host: '127.0.0.1', port: real ?? this.refusedPort });
      },
    };
  }

  static async create(): Promise<TestNetwork> {
    return new TestNetwork(await closedLoopbackPort());
  }

  /**
   * `name` resuelve a cada lista de direcciones en resoluciones sucesivas (la última se repite).
   *
   * @param name El nombre.
   * @param rounds Una lista por resolución.
   */
  resolve(name: string, ...rounds: (readonly Answer[])[]): void {
    this.plans.set(name, { kind: 'rounds', rounds });
  }

  /** `name` tiene una resolución que nunca responde. */
  hang(name: string): void {
    this.plans.set(name, { kind: 'hang' });
  }

  /** Quita la resolución de `name`: pasa a no existir. */
  forget(name: string): void {
    this.plans.delete(name);
  }

  private timesAsked(name: string): number {
    return this.asked.filter((asked) => asked === name).length;
  }

  /** Cuántas veces se pidió resolver `name`. */
  resolutions(name: string): number {
    return this.timesAsked(name);
  }

  /** Todos los nombres cuya resolución se pidió, en orden. */
  resolved(): readonly string[] {
    return [...this.asked];
  }

  /**
   * Un par virtual (la dirección y el puerto que la API validó) lleva al servidor real del test.
   *
   * @throws {Error} Si el par es `127.0.0.1:<puerto real de un servidor>`: el puerto real nunca se mapea.
   */
  mapPair(address: string, port: number, server: TestServer): void {
    const key = destinationKey(address, port);
    if (key === null) throw new Error(`no es una dirección: ${address}`);
    if (isRealServerPort(port) || port === server.port) throw new Error(`el puerto ${port} es el de un servidor real: los pares del test son virtuales`);
    this.mapped.set(key, server.port);
  }

  /** Los pares a los que la API intentó abrir una conexión desde el último `reset`. */
  connections(): readonly OpenedConnection[] {
    return [...this.opened];
  }

  /** Cuántas conexiones se abrieron hacia `address:port` (`address` en cualquier forma escrita). */
  connectionsTo(address: string, port: number): number {
    const key = destinationKey(address, port);
    return this.opened.filter((opened) => destinationKey(opened.address, opened.port) === key).length;
  }

  /** Vacía resoluciones, pares, servidores mapeados y conexiones, con un puerto cerrado nuevo. */
  async reset(): Promise<void> {
    this.plans.clear();
    this.asked.length = 0;
    this.mapped.clear();
    this.opened.length = 0;
    this.refusedPort = await closedLoopbackPort();
  }
}
