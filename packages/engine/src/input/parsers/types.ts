import type { VariableValue } from '../../types.js';

/** @returns El valor convertido, o `undefined` si el texto (ya recortado y no vacío) no es de este tipo. */
export type TextParser = (text: string, language: string) => VariableValue | undefined;
