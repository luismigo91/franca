import type { Page } from '@/lib/chat/api-types';

/** Una lista que crece página a página (flujos y conversaciones recientes). */
export interface PagedList<T extends { id: string }> {
  items: T[];
  /** `total` de la última página leída. */
  total: number;
  /** Siguiente `offset` que pedir. */
  nextOffset: number;
  /** La última página vino vacía: no hay más, aunque `total` diga otra cosa. */
  exhausted: boolean;
}

export function emptyPagedList<T extends { id: string }>(): PagedList<T> {
  return { items: [], total: 0, nextOffset: 0, exhausted: false };
}

/**
 * Añade una página sin repetir ningún `id` (la lista de la API puede moverse entre páginas).
 *
 * @param list La lista actual.
 * @param page La página leída.
 * @returns Una lista nueva; la recibida no se modifica.
 */
export function appendPage<T extends { id: string }>(list: PagedList<T>, page: Page<T>): PagedList<T> {
  const seen = new Set(list.items.map((item) => item.id));
  const added = page.items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { items: [...list.items, ...added], total: page.total, nextOffset: page.offset + page.items.length, exhausted: page.items.length === 0 };
}

/** Indica si quedan más páginas (`offset + items < total`). Una página vacía no promete más: evita un bucle. */
export function hasMore<T extends { id: string }>(list: PagedList<T>): boolean {
  return !list.exhausted && list.nextOffset < list.total;
}
