import type { Node } from '@franca/spec';
import { executeCondition } from './condition.js';
import { executeEnd } from './end.js';
import { executeHttp } from './http.js';
import { executeInput } from './input.js';
import { executeJump } from './jump.js';
import { executeLlm } from './llm.js';
import { executeMessage } from './message.js';
import { executeSet } from './set.js';
import type { NodeExecutor } from './types.js';

/**
 * Un ejecutor por cada tipo de nodo de `@franca/spec`. El tipo mapeado hace que el compilador
 * falle si el esquema añade un tipo y no hay ejecutor.
 */
export const EXECUTORS: { [K in Node['type']]: NodeExecutor<K> } = {
  message: executeMessage,
  set: executeSet,
  jump: executeJump,
  condition: executeCondition,
  end: executeEnd,
  input: executeInput,
  http: executeHttp,
  llm: executeLlm,
};
