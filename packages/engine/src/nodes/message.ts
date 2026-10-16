import type { ContentItem } from '@franca/spec';
import { renderTemplate, ValueTooLargeError } from '../template.js';
import type { RenderedContentItem } from '../types.js';
import type { NodeExecutor, StepContext, StepOutcome } from './types.js';

export const VALUE_TOO_LARGE: StepOutcome = {
  kind: 'fail',
  code: 'value_too_large',
  message: 'un texto renderizado supera el tamaño máximo permitido',
};

/**
 * Renderiza los elementos de un contenido (`text`, `url` y `alt` son plantillas).
 *
 * @throws {ValueTooLargeError} Si algún texto renderizado supera `MAX_RENDERED_LENGTH`.
 */
export function renderContent(content: readonly ContentItem[], ctx: StepContext): RenderedContentItem[] {
  const lookup = (name: string) => ctx.vars.get(name);
  return content.map((item): RenderedContentItem => {
    if (item.kind === 'text') return { kind: 'text', text: renderTemplate(item.text, lookup) };
    const rendered: RenderedContentItem = { kind: item.kind, url: renderTemplate(item.url, lookup) };
    if (item.alt !== undefined) rendered.alt = renderTemplate(item.alt, lookup);
    return rendered;
  });
}

/** Emite un único evento `message` con el contenido renderizado y continúa en `next`. */
export const executeMessage: NodeExecutor<'message'> = (node, ctx) => {
  try {
    const content = renderContent(node.content, ctx);
    ctx.emit({ type: 'message', nodeId: node.id, content, typingDelayMs: ctx.typingDelayMs });
    return { kind: 'next', nodeId: node.next };
  } catch (error) {
    if (error instanceof ValueTooLargeError) return VALUE_TOO_LARGE;
    throw error;
  }
};
