import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunToken } from '../../demo/demo-config.mjs';
import { checkPortsFree, installStreamErrorGuards, runDemo } from '../../demo/dev-demo.mjs';

const DEV_DEMO = fileURLToPath(new URL('../../demo/dev-demo.mjs', import.meta.url));

type StartResult = { ok: true } | { ok: false; code: string };
type ExitInfo = { code: number | null; signal: string | null };
type Signal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

/** Un doble del CRM: sale al recibir `stop` salvo que se diga lo contrario. */
function crmDouble(options: { start?: () => Promise<StartResult>; exitsOnStop?: boolean } = {}) {
  let exit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => (exit = resolve));
  return {
    exited,
    exit,
    start: vi.fn(async (_token: string, _port: number): Promise<StartResult> => (options.start ? options.start() : { ok: true })),
    stop: vi.fn(() => {
      if (options.exitsOnStop !== false) exit(0);
    }),
    kill: vi.fn(),
  };
}

/** Un doble de turbo: sale al recibir `SIGINT` en su grupo salvo que se diga lo contrario. */
function turboDouble(options: { exitsOnSigint?: boolean } = {}) {
  let exit!: (info: ExitInfo) => void;
  const exited = new Promise<ExitInfo>((resolve) => (exit = resolve));
  return {
    exited,
    exit,
    signalGroup: vi.fn((signal: NodeJS.Signals) => {
      if (signal === 'SIGINT' && options.exitsOnSigint !== false) exit({ code: null, signal: 'SIGINT' });
    }),
  };
}

interface Options {
  env?: Record<string, string | undefined>;
  crm?: ReturnType<typeof crmDouble>;
  turbo?: ReturnType<typeof turboDouble>;
  probeApi?: () => Promise<boolean>;
  seed?: (write: (line: string) => void) => Promise<{ ok: boolean }>;
  checkPorts?: (ports: number[], timeoutMs: number) => Promise<{ host: string; port: number }[]>;
  write?: (line: string) => void;
  createToken?: () => string;
}

/** Arranca `runDemo` con dobles de procesos (no de integraciones): la costura con turbo y con la API se comprueba aparte. */
function start(options: Options = {}) {
  const output: string[] = [];
  const signals = new EventEmitter();
  const crm = options.crm ?? crmDouble();
  const turbo = options.turbo ?? turboDouble();
  const launchTurbo = vi.fn((_env: Record<string, string | undefined>) => turbo);
  const launchCrm = vi.fn(() => crm);
  const checkPorts = vi.fn(options.checkPorts ?? (async () => []));
  const exit = vi.fn();
  const deps = {
    env: options.env ?? { PATH: '/bin' },
    write: options.write ?? ((line: string) => void output.push(line)),
    createToken: options.createToken ?? createRunToken,
    launchCrm,
    launchTurbo,
    probeApi: options.probeApi ?? (async () => true),
    seed: options.seed ?? (async (write: (line: string) => void) => (write('[semilla] captacion-leads-local: creado y publicado (versión 1).'), { ok: true })),
    checkPorts,
    onSignals: (handler: (signal: Signal) => void) => {
      const listener = (signal: Signal) => handler(signal);
      for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.on(name, () => listener(name as Signal));
      return () => void signals.removeAllListeners();
    },
    exit,
  };
  let result: number | undefined;
  const finished = runDemo(deps).then((code: number) => (result = code));
  return { output, text: () => output.join('\n'), signals, crm, turbo, launchTurbo, launchCrm, checkPorts, exit, finished, result: () => result };
}

/** Deja correr los temporizadores falsos y las promesas pendientes. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('arranque de la demo (dobles de procesos)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Variables de la shell en conflicto', async () => {
    const run = start({ env: { PATH: '/bin', FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080', FRANCA_SECRET_CRM_TOKEN: 'Bearer no-mostrar-3' } }); // gitleaks:allow
    expect(await run.finished).toBe(1);
    expect(run.launchCrm).not.toHaveBeenCalled();
    expect(run.launchTurbo).not.toHaveBeenCalled();
    expect(run.text()).toContain('FRANCA_HTTP_ALLOWED_DESTINATIONS, FRANCA_SECRET_CRM_TOKEN');
    expect(run.text()).not.toContain('no-mostrar-3');
    expect(run.text()).not.toContain('127.0.0.1:8080');
  });

  it('Variable vacía en la shell', async () => {
    const run = start({ env: { PATH: '/bin', FRANCA_HTTP_LOCAL_NAMES: '' } });
    expect(await run.finished).toBe(1);
    expect(run.launchCrm).not.toHaveBeenCalled();
    expect(run.text()).toContain('FRANCA_HTTP_LOCAL_NAMES');
  });

  it('Clave de Claude en la shell', async () => {
    const run = start({ env: { PATH: '/bin', FRANCA_ANTHROPIC_API_KEY: 'clave-no-usar' } });
    await settle();
    expect(run.launchTurbo).toHaveBeenCalledOnce();
    const env = run.launchTurbo.mock.calls[0]![0];
    expect(Object.hasOwn(env, 'FRANCA_ANTHROPIC_API_KEY')).toBe(false);
    expect(env.NEXT_TELEMETRY_DISABLED).toBe('1');
    expect(env.TURBO_TELEMETRY_DISABLED).toBe('1');
    expect(run.text()).toContain('La demo no usa Claude');
    expect(run.text()).toContain('(se ha quitado la de la shell)');
    expect(run.text()).not.toContain('clave-no-usar');
    run.signals.emit('SIGINT');
    await run.finished;
  });

  it('sin clave de Claude en la shell la demo también dice que no la usa, sin decir que la quitó', async () => {
    const run = start();
    await settle();
    expect(run.text()).toContain('La demo no usa Claude');
    expect(run.text()).not.toContain('se ha quitado');
    run.signals.emit('SIGINT');
    await run.finished;
  });

  it('Puerto del CRM ocupado', async () => {
    const crm = crmDouble({ start: async () => ({ ok: false, code: 'EADDRINUSE' }) });
    const run = start({ crm });
    expect(await run.finished).toBe(1);
    expect(run.launchTurbo).not.toHaveBeenCalled();
    expect(run.text()).toContain('127.0.0.1:4010');
    expect(run.text()).toContain('puerto 4010 ocupado');
    expect(crm.kill).toHaveBeenCalled();
  });

  it('un CRM que no responde (otro código) lo nombra sin lanzar turbo', async () => {
    const run = start({ crm: crmDouble({ start: async () => ({ ok: false, code: 'timeout' }) }) });
    expect(await run.finished).toBe(1);
    expect(run.launchTurbo).not.toHaveBeenCalled();
    expect(run.text()).toContain('(timeout)');
  });

  it('Token de la ejecución fuera de la salida', async () => {
    const tokens: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = start();
      await settle();
      const token = run.launchTurbo.mock.calls[0]![0].FRANCA_SECRET_CRM_TOKEN!;
      expect(token).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
      expect(run.crm.start).toHaveBeenCalledWith(token, 4010);
      run.signals.emit('SIGINT');
      await run.finished;
      expect(run.text()).not.toContain(token);
      expect(run.text()).not.toContain(token.slice('Bearer '.length));
      tokens.push(token);
    }
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('en el camino feliz escribe cada mensaje de C4 en su orden y termina "Lista"', async () => {
    const run = start();
    await settle();
    expect(run.output.filter((line) => line.startsWith('[demo]'))).toEqual([
      '[demo] La demo no usa Claude: la API arranca sin FRANCA_ANTHROPIC_API_KEY y los nodos llm terminan en llm_not_configured.',
      '[demo] CRM simulado en http://127.0.0.1:4010 (crm.franca.test). Arrancando la API y la web (pnpm dev)…',
      '[demo] La API responde; sembrando la copia local…',
      '[demo] Lista: abre http://localhost:3000 y prueba «Captación de leads (local)». Ctrl+C para parar.',
    ]);
    expect(run.output).toContain('[semilla] captacion-leads-local: creado y publicado (versión 1).');
    run.signals.emit('SIGINT');
    await run.finished;
  });

  it('Siembra fallida al arrancar', async () => {
    const run = start({
      seed: async (write) => {
        write('[semilla] captacion-leads-local: el id captacion-leads-local está reservado por un borrado y la API no deja reutilizarlo.');
        return { ok: false };
      },
    });
    await settle();
    expect(run.text()).toContain('reservado');
    expect(run.text()).toContain('pnpm demo:seed');
    expect(run.crm.stop).not.toHaveBeenCalled();
    expect(run.turbo.signalGroup).not.toHaveBeenCalled();
    expect(run.result()).toBeUndefined();
    run.signals.emit('SIGINT');
    await run.finished;
  });

  it('la API que no responde en 120 s da su mensaje y la demo sigue en marcha', async () => {
    const probe = vi.fn(async () => false);
    const seed = vi.fn(async () => ({ ok: true }));
    const run = start({ probeApi: probe, seed });
    await settle(119_000);
    expect(run.text()).not.toContain('120 s');
    await settle(2_000);
    expect(run.text()).toContain('La API no ha respondido en 120 s; la demo sigue en marcha. Cuando arranque, siembra con pnpm demo:seed.');
    expect(seed).not.toHaveBeenCalled();
    expect(probe.mock.calls.length).toBeGreaterThan(200);
    expect(run.result()).toBeUndefined();
    run.signals.emit('SIGINT');
    await run.finished;
  });

  describe('Parada con Ctrl+C', () => {
    it('Parada con Ctrl+C', async () => {
      const run = start();
      await settle();
      run.signals.emit('SIGINT');
      expect(await run.finished).toBe(130);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT']]);
      expect(run.crm.stop).toHaveBeenCalledOnce();
      expect(run.crm.kill).not.toHaveBeenCalled();
      expect(run.checkPorts).toHaveBeenCalledWith([3000, 3001, 4010], 2000);
      expect(run.text()).toContain('Parando…');
      expect(run.output.at(-1)).toBe('[demo] Parada.');
    });

    it('si los procesos no salen, a los 7 s hay SIGKILL al grupo y al CRM, y no antes', async () => {
      const run = start({ crm: crmDouble({ exitsOnStop: false }), turbo: turboDouble({ exitsOnSigint: false }) });
      await settle();
      run.signals.emit('SIGINT');
      await settle(6_999);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT']]);
      expect(run.crm.kill).not.toHaveBeenCalled();
      await settle(1);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
      expect(run.crm.kill).toHaveBeenCalledOnce();
      expect(await run.finished).toBe(130);
    });

    it('un puerto que sigue ocupado tras parar da su aviso y el código 1', async () => {
      const run = start({ checkPorts: async () => [{ host: '127.0.0.1', port: 3001 }, { host: '::1', port: 3000 }] });
      await settle();
      run.signals.emit('SIGINT');
      expect(await run.finished).toBe(1);
      expect(run.text()).toContain('Atención: algo sigue escuchando en 127.0.0.1:3001; búscalo con lsof -nP -iTCP:3001 -sTCP:LISTEN.');
      expect(run.text()).toContain('Atención: algo sigue escuchando en [::1]:3000; búscalo con lsof -nP -iTCP:3000 -sTCP:LISTEN.');
    });

    it('el puerto de la API que se comprueba es el de PORT', async () => {
      const run = start({ env: { PATH: '/bin', PORT: '3333' } });
      await settle();
      run.signals.emit('SIGINT');
      await run.finished;
      expect(run.checkPorts).toHaveBeenCalledWith([3000, 3333, 4010], 2000);
    });

    it('dos SIGINT con menos de 50 ms entre ellos (el Ctrl+C reenviado por pnpm) dan un único SIGINT al grupo y ningún SIGKILL antes de los 7 s', async () => {
      const run = start({ crm: crmDouble({ exitsOnStop: false }), turbo: turboDouble({ exitsOnSigint: false }) });
      await settle();
      run.signals.emit('SIGINT');
      await settle(10);
      run.signals.emit('SIGINT');
      await settle(6_900);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT']]);
      expect(run.crm.stop).toHaveBeenCalledOnce();
      expect(run.crm.kill).not.toHaveBeenCalled();
      await settle(200);
      expect(await run.finished).toBe(130);
      expect(run.output.filter((line) => line === '[demo] Parando…')).toHaveLength(1);
    });

    it('un SIGTERM o un SIGHUP durante la parada no cambian nada', async () => {
      const run = start({ crm: crmDouble({ exitsOnStop: false }), turbo: turboDouble({ exitsOnSigint: false }) });
      await settle();
      run.signals.emit('SIGINT');
      run.signals.emit('SIGTERM');
      run.signals.emit('SIGHUP');
      await settle(7_001);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
      expect(await run.finished).toBe(130);
      expect(run.output.filter((line) => line === '[demo] Parando…')).toHaveLength(1);
    });

    it.each([
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ] as const)('%s para todo con el código %i', async (signal, code) => {
      const run = start();
      await settle();
      run.signals.emit(signal);
      expect(await run.finished).toBe(code);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT']]);
      expect(run.crm.stop).toHaveBeenCalledOnce();
    });

    it('SIGHUP con la terminal cerrada: una salida que falla (EIO) no tumba la parada', async () => {
      let closed = false;
      const run = start({
        write: (line) => {
          if (closed && line !== '') throw Object.assign(new Error('write EIO'), { code: 'EIO' });
        },
      });
      await settle();
      closed = true;
      run.signals.emit('SIGHUP');
      expect(await run.finished).toBe(129);
      expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT']]);
      expect(run.crm.stop).toHaveBeenCalledOnce();
    });

    it('una señal mientras se espera el listening del CRM: turbo no se lanza', async () => {
      let answer!: (result: StartResult) => void;
      const crm = crmDouble({ start: () => new Promise<StartResult>((resolve) => (answer = resolve)) });
      const run = start({ crm });
      await settle();
      expect(run.launchTurbo).not.toHaveBeenCalled();
      run.signals.emit('SIGINT');
      await settle();
      answer({ ok: true });
      expect(await run.finished).toBe(130);
      expect(run.launchTurbo).not.toHaveBeenCalled();
      expect(crm.stop).toHaveBeenCalledOnce();
      expect(run.text()).not.toContain('CRM simulado en');
    });

    it('stopAll termina siempre: a los 9,5 s hay SIGKILL y process.exit aunque la comprobación de puertos no responda', async () => {
      const run = start({
        crm: crmDouble({ exitsOnStop: false }),
        turbo: turboDouble({ exitsOnSigint: false }),
        checkPorts: () => new Promise(() => undefined),
      });
      await settle();
      run.signals.emit('SIGINT');
      await settle(9_499);
      expect(run.exit).not.toHaveBeenCalled();
      await settle(1);
      expect(run.exit).toHaveBeenCalledWith(130);
      expect(run.turbo.signalGroup).toHaveBeenLastCalledWith('SIGKILL');
      expect(run.crm.kill).toHaveBeenCalled();
    });

    it('stopAll no espera a la semilla ni al sondeo de la API', async () => {
      const run = start({ seed: () => new Promise(() => undefined) });
      await settle();
      expect(run.text()).toContain('sembrando la copia local');
      run.signals.emit('SIGINT');
      expect(await run.finished).toBe(130);
      expect(run.exit).not.toHaveBeenCalled();

      const probing = start({ probeApi: () => new Promise(() => undefined) });
      await settle();
      probing.signals.emit('SIGTERM');
      expect(await probing.finished).toBe(143);
    });

    it('con el plazo vencido no se escribe "Lista" ni se siembra después de parar', async () => {
      let release!: () => void;
      const seed = vi.fn(
        (write: (line: string) => void) =>
          new Promise<{ ok: boolean }>((resolve) => {
            release = () => (write('[semilla] tarde'), resolve({ ok: true }));
          }),
      );
      const run = start({ seed });
      await settle();
      run.signals.emit('SIGINT');
      await run.finished;
      release();
      await settle();
      expect(run.text()).not.toContain('Lista');
      expect(run.text()).not.toContain('tarde');
    });
  });

  it('CRM simulado que termina', async () => {
    const run = start();
    await settle();
    run.crm.exit(3);
    expect(await run.finished).toBe(1);
    expect(run.turbo.signalGroup.mock.calls).toEqual([['SIGINT']]);
    expect(run.text()).toContain('El CRM simulado se ha parado (código 3); paro la API y la web.');
    expect(run.crm.stop).not.toHaveBeenCalled();
  });

  it('Arranque de la API y la web que termina', async () => {
    const run = start();
    await settle();
    run.turbo.exit({ code: 0, signal: null });
    expect(await run.finished).toBe(1);
    expect(run.crm.stop).toHaveBeenCalledOnce();
    expect(run.text()).toContain('pnpm dev ha terminado (código 0); paro el CRM simulado.');
    expect(run.turbo.signalGroup).not.toHaveBeenCalled();

    const failing = start();
    await settle();
    failing.turbo.exit({ code: 7, signal: null });
    expect(await failing.finished).toBe(7);

    const killed = start();
    await settle();
    killed.turbo.exit({ code: null, signal: 'SIGKILL' });
    expect(await killed.finished).toBe(1);
    expect(killed.text()).toContain('código SIGKILL');
  });
});

describe('installStreamErrorGuards', () => {
  it('un error de escritura (EIO) en stdout o stderr no tumba el proceso', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    expect(() => stdout.emit('error', new Error('write EIO'))).toThrow('write EIO');
    installStreamErrorGuards([stdout, stderr]);
    expect(() => stdout.emit('error', new Error('write EIO'))).not.toThrow();
    expect(() => stderr.emit('error', new Error('write EPIPE'))).not.toThrow();
  });
});

describe('checkPortsFree', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  async function listen(host: string): Promise<number | undefined> {
    const server = createServer();
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(0, host, () => resolve(true));
    });
    if (!listening) return undefined;
    servers.push(server);
    return (server.address() as { port: number }).port;
  }

  it('un puerto libre no se informa', async () => {
    const free = await listen('127.0.0.1');
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    expect(await checkPortsFree([free!], 300)).toEqual([]);
  });

  it('informa de lo que acepta conexiones en 127.0.0.1', async () => {
    const port = await listen('127.0.0.1');
    expect(await checkPortsFree([port!], 300)).toEqual([{ host: '127.0.0.1', port }]);
  });

  it('informa también de lo que acepta conexiones en ::1', async () => {
    const port = await listen('::1');
    if (port === undefined) return;
    expect(await checkPortsFree([port], 300)).toEqual([{ host: '::1', port }]);
  });

  it('espera a que lo ocupado se libere mientras dure el margen', async () => {
    const port = await listen('127.0.0.1');
    setTimeout(() => servers.splice(0).forEach((server) => server.close()), 300);
    expect(await checkPortsFree([port!], 2_000)).toEqual([]);
  });
});

describe('dev-demo.mjs como proceso real', () => {
  /** Lanza el arranque con exactamente este entorno, en un grupo propio, y lo mata entero pase lo que pase. */
  async function runReal(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
    const child = spawn(process.execPath, [DEV_DEMO], { env: { PATH: process.env.PATH ?? '', ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    try {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      const [code] = (await once(child, 'exit')) as [number | null];
      clearTimeout(timer);
      return { code, output };
    } finally {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // El grupo ya no existe.
      }
    }
  }

  it('Variables de la shell en conflicto', async () => {
    const { code, output } = await runReal({ FRANCA_HTTP_ALLOWED_DESTINATIONS: '127.0.0.1:8080', FRANCA_SECRET_CRM_TOKEN: 'Bearer no-mostrar-3' }); // gitleaks:allow
    expect(code).toBe(1);
    expect(output).toContain('FRANCA_HTTP_ALLOWED_DESTINATIONS, FRANCA_SECRET_CRM_TOKEN');
    expect(output).not.toContain('no-mostrar-3');
    expect(output).not.toContain('127.0.0.1:8080');
    expect(output).not.toContain('crm simulado');
  });

  it('Variable vacía en la shell', async () => {
    const { code, output } = await runReal({ FRANCA_HTTP_LOCAL_NAMES: '' });
    expect(code).toBe(1);
    expect(output).toContain('FRANCA_HTTP_LOCAL_NAMES');
  });
});
