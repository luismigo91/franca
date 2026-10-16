import { compilePattern, type Program } from './compile.js';
import type { Assertion } from './parse.js';

/** Contadores de una evaluación, para comprobar la cota de trabajo. */
export interface MatchStats {
  /** Visitas distintas (instrucción, posición) del cierre-ε: como mucho `(n + 1) · m`. */
  work: number;
  /** `m`: instrucciones del programa. */
  instructions: number;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_]$/.test(c);

function holds(kind: Assertion, chars: string[], pos: number): boolean {
  if (kind === 'start') return pos === 0;
  if (kind === 'end') return pos === chars.length;
  const boundary = isWordChar(chars[pos - 1]) !== isWordChar(chars[pos]);
  return kind === 'wordBoundary' ? boundary : !boundary;
}

/**
 * Simulación Pike VM booleana (Thompson): busca el patrón en cualquier posición del texto en
 * tiempo O((n + 1) · m) con n code points y m instrucciones, sin retroceso. Cada átomo se
 * prueba con el `RegExp` nativo sobre **un** code point, con el resultado memorizado por
 * posición; el patrón completo no se ejecuta nunca con el motor nativo.
 *
 * @param program Programa compilado.
 * @param text Texto donde buscar.
 * @param stats Contadores opcionales (para tests).
 * @returns `true` si hay coincidencia en alguna posición.
 */
export function runProgram(program: Program, text: string, stats?: MatchStats): boolean {
  const { instructions, atoms } = program;
  const chars = Array.from(text);
  const natives = atoms.map((source) => new RegExp(`^(?:${source})$`, 'u'));
  const atomStamp = new Int32Array(atoms.length).fill(-1);
  const atomResult = new Uint8Array(atoms.length);
  const seen = new Int32Array(instructions.length).fill(-1);
  if (stats) {
    stats.work = 0;
    stats.instructions = instructions.length;
  }

  let current: number[] = [];
  let next: number[] = [];

  /** Añade a `list` los hilos que quedan esperando un carácter (o la coincidencia) desde `pc` en `pos`. */
  const addThread = (list: number[], start: number, pos: number): void => {
    const stack = [start];
    while (stack.length) {
      const pc = stack.pop()!;
      if (seen[pc] === pos) continue;
      seen[pc] = pos;
      if (stats) stats.work++;
      const ins = instructions[pc]!;
      switch (ins.op) {
        case 'jump':
          stack.push(ins.to);
          break;
        case 'split':
          stack.push(ins.y, ins.x);
          break;
        case 'assert':
          if (holds(ins.kind, chars, pos)) stack.push(pc + 1);
          break;
        default:
          list.push(pc);
      }
    }
  };

  const atomMatches = (atom: number, pos: number): boolean => {
    if (atomStamp[atom] !== pos) {
      atomStamp[atom] = pos;
      atomResult[atom] = natives[atom]!.test(chars[pos]!) ? 1 : 0;
    }
    return atomResult[atom] === 1;
  };

  for (let pos = 0; pos <= chars.length; pos++) {
    addThread(current, 0, pos);
    for (const pc of current) if (instructions[pc]!.op === 'match') return true;
    if (pos === chars.length) break;
    next = [];
    for (const pc of current) {
      const ins = instructions[pc]!;
      if (ins.op === 'atom' && atomMatches(ins.atom, pos)) addThread(next, pc + 1, pos + 1);
    }
    current = next;
  }
  return false;
}

/**
 * Evalúa un patrón de `matches` contra un texto en tiempo lineal.
 *
 * @param pattern Patrón del autor (ECMAScript, modo Unicode, subconjunto regular).
 * @param text Texto donde buscar.
 * @param stats Contadores opcionales (para tests).
 * @returns `true` si el patrón coincide en alguna posición del texto.
 * @throws {PatternError} Si el patrón es inválido, no admitido o demasiado grande.
 */
export function matchPattern(pattern: string, text: string, stats?: MatchStats): boolean {
  return runProgram(compilePattern(pattern), text, stats);
}
