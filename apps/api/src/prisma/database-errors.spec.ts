import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { isDatabaseUnavailable } from './database-errors.js';

/**
 * Formas reales capturadas con prisma 7.10.1 y @prisma/adapter-pg 7.10.1 contra un puerto cerrado, contra un
 * servidor que acepta y no contesta (`net.createServer(() => {})`), con una transacción interactiva caducada y con
 * una consulta esperando un bloqueo de fila. El mensaje de P1001 lleva host y puerto: aquí no se registra.
 */
const known = (code: string, message: string, meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '7.10.1', meta });

describe('isDatabaseUnavailable', () => {
  it('P1001 con el puerto cerrado (findMany, create, transacción interactiva y en lote)', () => {
    const meta = { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'DatabaseNotReachable', host: '127.0.0.1', port: 59999 } } };
    for (const message of [
      "\nInvalid `prisma.flow.findMany()` invocation:\n\n\nCan't reach database server at 127.0.0.1:59999",
      "Can't reach database server at 127.0.0.1:59999",
    ]) {
      expect(isDatabaseUnavailable(known('P1001', message, { modelName: 'Flow', ...meta }))).toBe(true);
    }
  });

  it('DatabaseNotReachable aunque el código sea otro', () => {
    const meta = { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } };
    expect(isDatabaseUnavailable(known('P2010', 'x', meta))).toBe(true);
  });

  it('P2028 «Unable to start a transaction in the given time» (transacción en lote o interactiva con un servidor mudo)', () => {
    expect(
      isDatabaseUnavailable(
        known('P2028', '\nInvalid `prisma.flow.findMany()` invocation:\n\n\nTransaction API error: Unable to start a transaction in the given time.', { modelName: 'Flow' }),
      ),
    ).toBe(true);
    expect(isDatabaseUnavailable(known('P2028', 'Transaction API error: Unable to start a transaction in the given time.', {}))).toBe(true);
  });

  it('P2028 «A query cannot be executed on an expired transaction» es un fallo del código, no de la base', () => {
    const expired = known(
      'P2028',
      '\nInvalid `prisma.$queryRaw()` invocation:\n\n\nTransaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 100 ms, however 303 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.',
      { operation: 'query', timeout: 100, timeTaken: 303 },
    );
    expect(isDatabaseUnavailable(expired)).toBe(false);
  });

  it('P2010 con 57014: una sentencia (la espera de un bloqueo de fila) superó statement_timeout', () => {
    const meta = {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '57014',
          originalMessage: 'canceling statement due to statement timeout',
          kind: 'postgres',
          code: '57014',
          severity: 'ERROR',
          message: 'canceling statement due to statement timeout',
        },
      },
    };
    const message = '\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`';
    expect(isDatabaseUnavailable(known('P2010', message, meta))).toBe(true);
  });

  const terminated = (originalCode: string, originalMessage: string) => ({
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: { originalCode, originalMessage, kind: 'postgres', code: originalCode, severity: 'FATAL', message: originalMessage },
    },
  });

  it('P2039 con 57P01: el servidor corta la conexión a mitad de findMany, count, create o update (pg_terminate_backend)', () => {
    const meta = { modelName: 'Flow', ...terminated('57P01', 'terminating connection due to administrator command') };
    for (const operation of ['findMany', 'count', 'create', 'update']) {
      const message = `\nInvalid \`prisma.flow.${operation}()\` invocation:\n\n\nDatabase error. Code: \`57P01\`. Message: \`terminating connection due to administrator command\``;
      expect(isDatabaseUnavailable(known('P2039', message, meta))).toBe(true);
    }
  });

  it('P2010 con 57P01: el servidor corta la conexión a mitad de un $queryRaw (el FOR UPDATE de un escritor)', () => {
    const message = '\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `57P01`. Message: `terminating connection due to administrator command`';
    expect(isDatabaseUnavailable(known('P2010', message, terminated('57P01', 'terminating connection due to administrator command')))).toBe(true);
  });

  it.each([
    ['57P02', 'crash of another server process'],
    ['57P03', 'the database system is starting up'],
  ])('%s: el servidor se cae o está arrancando', (code, text) => {
    expect(isDatabaseUnavailable(known('P2010', 'x', terminated(code, text)))).toBe(true);
  });

  it.each([
    ['57P04', 'database "x" does not exist'],
    ['23505', 'duplicate key value violates unique constraint'],
    ['40001', 'could not serialize access'],
  ])('P2039 con %s no es base caída', (code, text) => {
    expect(isDatabaseUnavailable(known('P2039', 'x', terminated(code, text)))).toBe(false);
  });

  it('P1003, P1010 y P1011 (DATABASE_URL con base, usuario o TLS erróneos) son base no disponible', () => {
    const fixtures: [string, string, Record<string, unknown>][] = [
      ['P1003', 'Database `no_existe_zz` does not exist on the database server', { originalCode: '3D000', originalMessage: 'database "no_existe_zz" does not exist', kind: 'DatabaseDoesNotExist', db: 'no_existe_zz' }],
      ['P1010', 'User was denied access on the database `(not available)`', { originalCode: '28000', originalMessage: 'role "nadie_zz" does not exist', kind: 'DatabaseAccessDenied' }],
      ['P1011', 'Error opening a TLS connection: The server does not support SSL connections', { kind: 'TlsConnectionError', reason: 'The server does not support SSL connections' }],
    ];
    for (const [code, message, cause] of fixtures) {
      expect(isDatabaseUnavailable(known(code, `\nInvalid \`prisma.flow.findMany()\` invocation:\n\n\n${message}`, { modelName: 'Flow', driverAdapterError: { name: 'DriverAdapterError', cause } }))).toBe(true);
      expect(isDatabaseUnavailable(known(code, message, { driverAdapterError: { name: 'DriverAdapterError', cause } }))).toBe(true);
    }
  });

  it('P1000 (autenticación fallida) también es configuración; P1012 y P2003 no', () => {
    expect(isDatabaseUnavailable(known('P1000', 'Authentication failed against database server', {}))).toBe(true);
    expect(isDatabaseUnavailable(known('P1012', 'Schema validation error', {}))).toBe(false);
    expect(isDatabaseUnavailable(known('P2003', 'Foreign key constraint failed', {}))).toBe(false);
  });

  it('P1008 (ETIMEDOUT del socket, SocketTimeout) es base no disponible', () => {
    const message = '\nInvalid `prisma.flow.findMany()` invocation:\n\n\nOperations timed out after `N/A`';
    expect(isDatabaseUnavailable(known('P1008', message, { modelName: 'Flow' }))).toBe(true);
    expect(isDatabaseUnavailable(known('P2010', 'x', { driverAdapterError: { cause: { kind: 'SocketTimeout' } } }))).toBe(true);
  });

  it('P2037 con 53300: demasiadas conexiones (rol con CONNECTION LIMIT 0), forma capturada de count, create y transacción', () => {
    const cause = {
      originalCode: '53300',
      originalMessage: 'too many connections for role "limitado_zz"',
      kind: 'TooManyConnections',
      cause: 'too many connections for role "limitado_zz"',
    };
    const text = 'Too many database connections opened: too many connections for role "limitado_zz"';
    expect(isDatabaseUnavailable(known('P2037', `\nInvalid \`prisma.flow.count()\` invocation:\n\n\n${text}`, { modelName: 'Flow', driverAdapterError: { name: 'DriverAdapterError', cause } }))).toBe(true);
    expect(isDatabaseUnavailable(known('P2037', text, { driverAdapterError: { name: 'DriverAdapterError', cause } }))).toBe(true);
    // Aunque Prisma lo envolviera con otro código, el SQLSTATE lo delata.
    expect(isDatabaseUnavailable(known('P2010', 'x', { driverAdapterError: { cause: { originalCode: '53300' } } }))).toBe(true);
  });

  it('errno de socket sin mapear: EHOSTUNREACH llega como código del error, con meta solo de modelo (forma capturada con 0.0.0.1)', () => {
    const message = '\nInvalid `prisma.flow.count()` invocation:\n\n\nconnect EHOSTUNREACH 0.0.0.1:5432';
    expect(isDatabaseUnavailable(known('EHOSTUNREACH', message, { modelName: 'Flow' }))).toBe(true);
    // En una transacción interactiva llega un Error plano con `code`.
    expect(isDatabaseUnavailable(Object.assign(new Error('connect EHOSTUNREACH 0.0.0.1:5432'), { code: 'EHOSTUNREACH' }))).toBe(true);
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'])('errno %s', (code) => {
    expect(isDatabaseUnavailable(known(code, 'connect x', { modelName: 'Flow' }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error('connect x'), { code }))).toBe(true);
  });

  it('un errno que no es de conectividad (ENOENT, EACCES) o un Error con otro code sigue en 500', () => {
    expect(isDatabaseUnavailable(known('ENOENT', 'x', {}))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'EACCES' }))).toBe(false);
  });

  it.each(['08000', '08003', '08006', '08001', '08004'])('SQLSTATE %s (clase 08, excepción de conexión)', (code) => {
    expect(isDatabaseUnavailable(known('P2010', 'x', terminated(code, 'connection exception')))).toBe(true);
  });

  it.each(['53100', '53200', '23505', '40001', '40P01', '42P01', '57000', '57P04'])('SQLSTATE %s es un fallo del código o de recursos, no base caída', (code) => {
    expect(isDatabaseUnavailable(known('P2010', 'x', terminated(code, 'x')))).toBe(false);
    expect(isDatabaseUnavailable(known('P2039', 'x', terminated(code, 'x')))).toBe(false);
  });

  it('P2002 (clave duplicada) y P2028 de transacción caducada siguen en 500', () => {
    expect(isDatabaseUnavailable(known('P2002', 'Unique constraint failed', { target: ['id'] }))).toBe(false);
    expect(isDatabaseUnavailable(known('P2028', 'Transaction API error: A rollback cannot be executed on an expired transaction.', {}))).toBe(false);
  });

  it('P2010 con otro error de Postgres (por ejemplo una sintaxis incorrecta) no es base caída', () => {
    const meta = { driverAdapterError: { cause: { originalCode: '42601', kind: 'postgres' } } };
    expect(isDatabaseUnavailable(known('P2010', 'Raw query failed. Code: `42601`.', meta))).toBe(false);
  });

  it.each(['P1002', 'P1017', 'P2024'])('%s', (code) => {
    expect(isDatabaseUnavailable(known(code, 'x', {}))).toBe(true);
  });

  it.each(['P1000', 'P1001', 'P1003', 'P1008', 'P1010', 'P1011', 'P1017'])('PrismaClientInitializationError con errorCode %s', (code) => {
    expect(isDatabaseUnavailable(new Prisma.PrismaClientInitializationError('x', '7.10.1', code))).toBe(true);
  });

  it('PrismaClientInitializationError sin errorCode o con otro (runtime o adaptador ausentes: un despliegue roto) es un fallo del código', () => {
    expect(isDatabaseUnavailable(new Prisma.PrismaClientInitializationError('Query engine library not found', '7.10.1'))).toBe(false);
    expect(isDatabaseUnavailable(new Prisma.PrismaClientInitializationError('x', '7.10.1', 'P1012'))).toBe(false);
  });

  it.each([
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
    'timeout exceeded when trying to connect',
    'Query read timeout',
  ])('Error plano de pg: %s', (message) => {
    expect(isDatabaseUnavailable(new Error(message))).toBe(true);
  });

  it('no clasifica como base caída lo que no lo es', () => {
    expect(isDatabaseUnavailable(new Error('x'))).toBe(false);
    expect(isDatabaseUnavailable(new Error('Connection terminated due to connection timeout y algo más'))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error('Query read timeout'), { code: 'XX000' }))).toBe(false);
    expect(isDatabaseUnavailable(known('P2002', 'Unique constraint failed', { target: ['id'] }))).toBe(false);
    expect(isDatabaseUnavailable(known('P2025', 'x', {}))).toBe(false);
    expect(isDatabaseUnavailable('Query read timeout')).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});
