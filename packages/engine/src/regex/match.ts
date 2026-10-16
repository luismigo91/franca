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

/** Code points vecinos de una posición; `undefined` es el borde del texto. */
interface Around {
  prev: string | undefined;
  next: string | undefined;
}

function holds(kind: Assertion, { prev, next }: Around): boolean {
  if (kind === 'start') return prev === undefined;
  if (kind === 'end') return next === undefined;
  const boundary = isWordChar(prev) !== isWordChar(next);
  return kind === 'wordBoundary' ? boundary : !boundary;
}

/** Code point que empieza en `index` (iteración como en modo `u`), o `undefined` al final. */
const codePointAt = (text: string, index: number): string | undefined =>
  index < text.length ? String.fromCodePoint(text.codePointAt(index)!) : undefined;

/**
 * Simulación Pike VM booleana (Thompson): busca el patrón en cualquier posición del texto en
 * tiempo O((n + 1) · m) con n code points y m instrucciones, sin retroceso y con memoria O(m)
 * (el texto se recorre sin copiarlo). Cada átomo se prueba con el `RegExp` nativo sobre **un**
 * code point, con el resultado memorizado por posición; el patrón completo no se ejecuta nunca
 * con el motor nativo.
 *
 * @param program Programa compilado.
 * @param text Texto donde buscar.
 * @param stats Contadores opcionales (para tests).
 * @returns `true` si hay coincidencia en alguna posición.
 */
export function runProgram(program: Program, text: string, stats?: MatchStats): boolean {
  const { instructions, atoms } = program;
  const natives = atoms.map((source) => new RegExp(`^(?:${source})$`, 'u'));
  const atomStamp = new Int32Array(atoms.length).fill(-1);
  const atomResult = new Uint8Array(atoms.length);
  const seen = new Int32Array(instructions.length).fill(-1);
  if (stats) {
    stats.work = 0;
    stats.instructions = instructions.length;
  }

  /** Añade a `list` los hilos que quedan esperando un carácter (o la coincidencia) desde `start` en `pos`. */
  const addThread = (list: number[], start: number, pos: number, around: Around): void => {
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
          if (holds(ins.kind, around)) stack.push(pc + 1);
          break;
        default:
          list.push(pc);
      }
    }
  };

  const atomMatches = (atom: number, pos: number, codePoint: string): boolean => {
    if (atomStamp[atom] !== pos) {
      atomStamp[atom] = pos;
      atomResult[atom] = natives[atom]!.test(codePoint) ? 1 : 0;
    }
    return atomResult[atom] === 1;
  };

  let current: number[] = [];
  let prev: string | undefined;
  let cur = codePointAt(text, 0);
  let index = 0;
  for (let pos = 0; ; pos++) {
    addThread(current, 0, pos, { prev, next: cur });
    for (const pc of current) if (instructions[pc]!.op === 'match') return true;
    if (cur === undefined) return false;
    const afterIndex = index + cur.length;
    const following = codePointAt(text, afterIndex);
    const next: number[] = [];
    for (const pc of current) {
      const ins = instructions[pc]!;
      if (ins.op === 'atom' && atomMatches(ins.atom, pos, cur)) addThread(next, pc + 1, pos + 1, { prev: cur, next: following });
    }
    current = next;
    prev = cur;
    cur = following;
    index = afterIndex;
  }
}

/**
 * Evalúa un patrón de `matches` contra un texto en tiempo lineal. Es la entrada que usarán
 * también otras features (p. ej. `validation.pattern` de `input`) y los tests.
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
