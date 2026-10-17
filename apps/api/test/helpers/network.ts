import { createServer, type Server } from 'node:net';

/** Un puerto de loopback en el que no escucha nadie (se ocupa un momento y se libera). */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface MuteServer {
  port: number;
  close(): Promise<void>;
}

/** Un servidor que acepta conexiones y nunca contesta: lo que hace un Postgres colgado. */
export async function startMuteServer(): Promise<MuteServer> {
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Cadena de conexión a un puerto local con una contraseña que no debe aparecer en ninguna salida. */
export const urlTo = (port: number): string => `postgresql://franca:no-mostrar-1234@127.0.0.1:${port}/franca`;
export const SECRET_PASSWORD = 'no-mostrar-1234';
