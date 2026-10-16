import type { HttpNode } from '@franca/spec';
import { httpNode, type Obj } from './flows.js';

/** Un `HttpNode` tipado para los unit tests de `src/http/`. */
export const node = (request: Obj = {}, extra: Obj = {}): HttpNode => httpNode('h', request, extra) as unknown as HttpNode;
