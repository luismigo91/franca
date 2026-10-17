import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';

export type ProxyMode = 'pass' | 'freeze';

export interface DatabaseProxy {
  port: number;
  /** `pass` reenvía; `freeze` retiene los bytes en ambos sentidos sin cerrar nada: un Postgres que enmudece. */
  mode: ProxyMode;
  /** Conexiones de cliente abiertas ahora. */
  open(): number;
  /** Destruye todas las conexiones abiertas: un Postgres que cae o un corte de red. */
  reset(): void;
  close(): Promise<void>;
}

/** Proxy TCP de loopback entre la API y Postgres para provocar cortes y silencios a mitad de un avance. */
export async function startDatabaseProxy(
  upstreamUrl: string,
): Promise<DatabaseProxy> {
  const upstream = new URL(upstreamUrl);
  const pairs = new Set<[Socket, Socket]>();
  const state = { mode: 'pass' as ProxyMode };

  const server: Server = createServer((client) => {
    const remote = createConnection({
      host: upstream.hostname,
      port: Number(upstream.port || 5432),
    });
    const pair: [Socket, Socket] = [client, remote];
    pairs.add(pair);
    const pump = (from: Socket, to: Socket) => {
      const buffered: Buffer[] = [];
      const flush = () => {
        while (state.mode === 'pass' && buffered.length > 0)
          to.write(buffered.shift()!);
      };
      from.on('data', (chunk: Buffer) => {
        buffered.push(chunk);
        flush();
      });
      const timer = setInterval(flush, 20);
      timer.unref();
      from.on('close', () => {
        clearInterval(timer);
        to.destroy();
        pairs.delete(pair);
      });
      from.on('error', () => undefined);
    };
    pump(client, remote);
    pump(remote, client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as { port: number }).port,
    get mode() {
      return state.mode;
    },
    set mode(value: ProxyMode) {
      state.mode = value;
    },
    open: () => pairs.size,
    reset: () =>
      pairs.forEach(([client, remote]) => (client.destroy(), remote.destroy())),
    close: async () => {
      pairs.forEach(([client, remote]) => (client.destroy(), remote.destroy()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
