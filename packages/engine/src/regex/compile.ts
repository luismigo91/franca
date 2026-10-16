import { MAX_PATTERN_SIZE } from '../constants.js';
import { parsePattern, PatternError, type Assertion, type RegexNode } from './parse.js';

export type Instruction =
  | { op: 'atom'; atom: number }
  | { op: 'split'; x: number; y: number }
  | { op: 'jump'; to: number }
  | { op: 'assert'; kind: Assertion }
  | { op: 'match' };

export interface Program {
  instructions: Instruction[];
  /** Trozos de fuente de los átomos, sin repetir; `Instruction.atom` indexa aquí. */
  atoms: string[];
}

const CAP = MAX_PATTERN_SIZE + 1;

/**
 * Tamaño de un patrón calculado sobre el AST, sin expandir: átomos y aserciones, donde `{n}` y
 * `{n,m}` multiplican su contenido por `n` o `m`, `{n,}` por `max(n, 1)` y `*`, `+`, `?` por 1.
 * Los resultados intermedios se acotan a `MAX_PATTERN_SIZE + 1`.
 *
 * @param node Raíz del AST.
 * @returns El tamaño, como mucho `MAX_PATTERN_SIZE + 1`.
 */
export function patternSize(node: RegexNode): number {
  switch (node.type) {
    case 'empty':
      return 0;
    case 'atom':
    case 'assertion':
      return 1;
    case 'sequence':
      return Math.min(CAP, node.items.reduce((sum, item) => sum + patternSize(item), 0));
    case 'alternation':
      return Math.min(CAP, node.options.reduce((sum, option) => sum + patternSize(option), 0));
    case 'repeat': {
      const inner = patternSize(node.node);
      const times = Math.min(CAP, node.max === Infinity ? Math.max(node.min, 1) : node.max);
      return inner === 0 || times === 0 ? 0 : Math.min(CAP, inner * times);
    }
  }
}

/**
 * Construye el programa NFA de un AST.
 *
 * @param ast Raíz del AST.
 * @returns El programa.
 * @throws {PatternError} `too_large` si el tamaño supera `MAX_PATTERN_SIZE`; se comprueba antes de expandir.
 */
export function compileProgram(ast: RegexNode): Program {
  if (patternSize(ast) > MAX_PATTERN_SIZE) {
    throw new PatternError('too_large', `el patrón supera el tamaño máximo de ${MAX_PATTERN_SIZE}`);
  }
  const instructions: Instruction[] = [];
  const atoms: string[] = [];
  const atomIndex = new Map<string, number>();

  const emit = (node: RegexNode): void => {
    switch (node.type) {
      case 'empty':
        return;
      case 'atom': {
        let index = atomIndex.get(node.source);
        if (index === undefined) {
          index = atoms.push(node.source) - 1;
          atomIndex.set(node.source, index);
        }
        instructions.push({ op: 'atom', atom: index });
        return;
      }
      case 'assertion':
        instructions.push({ op: 'assert', kind: node.kind });
        return;
      case 'sequence':
        node.items.forEach(emit);
        return;
      case 'alternation':
        return emitAlternation(node.options);
      case 'repeat':
        return emitRepeat(node.node, node.min, node.max);
    }
  };

  const emitAlternation = (options: RegexNode[]): void => {
    const jumps: Extract<Instruction, { op: 'jump' }>[] = [];
    options.forEach((option, i) => {
      if (i === options.length - 1) return emit(option);
      const split: Extract<Instruction, { op: 'split' }> = { op: 'split', x: instructions.length + 1, y: -1 };
      instructions.push(split);
      emit(option);
      const jump: Extract<Instruction, { op: 'jump' }> = { op: 'jump', to: -1 };
      jumps.push(jump);
      instructions.push(jump);
      split.y = instructions.length;
    });
    for (const jump of jumps) jump.to = instructions.length;
  };

  /** Emite `node` y dice si produjo instrucciones (repetir lo que no produce nada no cambia nada). */
  const emitNonEmpty = (node: RegexNode): boolean => {
    const before = instructions.length;
    emit(node);
    return instructions.length > before;
  };

  const emitRepeat = (node: RegexNode, min: number, max: number): void => {
    const unbounded = max === Infinity;
    const mandatory = unbounded && min > 0 ? min - 1 : min;
    for (let i = 0; i < mandatory; i++) if (!emitNonEmpty(node)) return;
    if (unbounded) {
      const loop = instructions.length;
      if (min === 0) {
        const split: Extract<Instruction, { op: 'split' }> = { op: 'split', x: loop + 1, y: -1 };
        instructions.push(split);
        if (!emitNonEmpty(node)) return void instructions.pop();
        instructions.push({ op: 'jump', to: loop });
        split.y = instructions.length;
      } else {
        if (!emitNonEmpty(node)) return;
        instructions.push({ op: 'split', x: loop, y: instructions.length + 1 });
      }
      return;
    }
    for (let i = min; i < max; i++) {
      const split: Extract<Instruction, { op: 'split' }> = { op: 'split', x: instructions.length + 1, y: -1 };
      instructions.push(split);
      if (!emitNonEmpty(node)) return void instructions.pop();
      split.y = instructions.length;
    }
  };

  emit(ast);
  instructions.push({ op: 'match' });
  return { instructions, atoms };
}

/**
 * Parsea y compila un patrón de `matches`.
 *
 * @param pattern Patrón del autor.
 * @returns El programa NFA.
 * @throws {PatternError} Si el patrón es inválido, usa una construcción no admitida, es demasiado grande o demasiado anidado.
 */
export function compilePattern(pattern: string): Program {
  try {
    return compileProgram(parsePattern(pattern));
  } catch (error) {
    if (error instanceof RangeError) throw new PatternError('too_large', 'el patrón está demasiado anidado');
    throw error;
  }
}
