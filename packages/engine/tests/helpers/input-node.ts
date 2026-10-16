import type { InputNode } from '@franca/spec';
import { input, type Obj } from './flows.js';

/** Un `InputNode` para los unit tests de `src/input/`. */
export const inputNode = (inputType: string, extra: Obj = {}): InputNode =>
  input('pregunta', 'v', inputType, 'fin', extra) as unknown as InputNode;

export const choiceNode = (ids: string[], extra: Obj = {}): InputNode =>
  inputNode('choice', { choices: ids.map((id) => ({ id, label: id })), ...extra });
