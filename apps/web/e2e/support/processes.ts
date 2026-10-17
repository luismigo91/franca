import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { REPO_ROOT, WEB_ROOT } from '../../tests/helpers/paths';

export const WEB_DIR = WEB_ROOT;
export const REPO_DIR = REPO_ROOT;

export interface Managed {
  child: ChildProcess;
  /** Salida estándar y de error acumulada (los E2E comprueban que no lleva datos de una conversación). */
  output: () => string;
  stop: () => Promise<void>;
}

/** Lanza un proceso en su propio grupo, para poder matar también a sus hijos (`pnpm` → `node` → `next-server`). */
export function launch(command: string, args: string[], options: { cwd: string; env: Record<string, string | undefined> }): Managed {
  const env = {} as Record<string, string> as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(options.env)) if (value !== undefined) env[key] = value;
  const child = spawn(command, args, { cwd: options.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  const stop = async () => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* ya terminó */
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* ya terminó */
      }
    }, 5000);
    await exited;
    clearTimeout(timer);
  };
  return { child, output: () => out, stop };
}

/** Espera a que `check` devuelva `true` (cada 100 ms) hasta el plazo. */
export async function waitFor(check: () => Promise<boolean> | boolean, what: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`se agotó el plazo esperando: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** ¿Hay algo escuchando en `host:port`? */
export function isListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Los pids de un proceso y todos sus descendientes. */
export function descendants(pid: number): number[] {
  const all = [pid];
  for (let index = 0; index < all.length; index++) {
    try {
      const out = execFileSync('pgrep', ['-P', String(all[index])], { encoding: 'utf8' });
      for (const line of out.split('\n')) if (line.trim() !== '') all.push(Number(line));
    } catch {
      /* sin hijos */
    }
  }
  return all;
}

/** Las direcciones `host:puerto` de la salida de `lsof` (la penúltima columna, sin la cabecera). */
function parseLsof(out: string): string[] {
  return out
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => line.trim().split(/\s+/).slice(-2, -1)[0] ?? '')
    .sort();
}

/** Los puertos TCP en escucha de un conjunto de procesos (con `lsof`), o `null` si `lsof` no está. */
export function listeningPorts(pids: number[]): string[] | null {
  try {
    return parseLsof(execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', pids.join(',')], { encoding: 'utf8' }));
  } catch (error) {
    // `lsof` sale con 1 si no hay nada que listar y, en Linux, también si alguno de los pids ya terminó (un hijo efímero
    // de `next dev`), aunque haya encontrado los demás: lo encontrado sigue en su salida.
    const failure = error as { status?: number; stdout?: string };
    if (failure.status === 1) return parseLsof(failure.stdout ?? '');
    return null;
  }
}

/** La salida de un comando aunque salga con error, o el motivo si no se pudo ejecutar. */
function outputOf(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8' });
  } catch (error) {
    const failure = error as { stdout?: string; message?: string };
    return failure.stdout ?? `(${command}: ${failure.message ?? 'falló'})`;
  }
}

/**
 * Lo que hace falta para entender un fallo de `listeningPorts`: el árbol del proceso `pid` y todos los sockets TCP en
 * escucha de la máquina. Va en el mensaje de la aserción.
 */
export function listeningDiagnostics(pid: number): string {
  return [`descendientes de ${pid}: ${descendants(pid).join(',')}`, outputOf('ps', ['-eo', 'pid,ppid,pgid,args']), outputOf('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])].join('\n');
}
