'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Page } from '@/lib/chat/api-types';
import type { ChatErrorCode } from '@/lib/chat/copy';
import { appendPage, emptyPagedList, hasMore, type PagedList } from '@/lib/chat/paged-list';
import type { ClientResult } from '@/lib/web-client';

export type PageReader<T> = (offset: number, signal: AbortSignal) => Promise<ClientResult<Page<T>>>;

export interface PagedListState<T extends { id: string }> {
  /** `loading` la primera vez y al volver a mostrarse; `ready` con la lista (vacía o no); `error` si falló la primera página. */
  phase: 'loading' | 'ready' | 'error';
  list: PagedList<T>;
  /** Fallo de la última lectura (primera página o «Ver más»). */
  error: ChatErrorCode | null;
  loadingMore: boolean;
  more: boolean;
}

type Plain<T extends { id: string }> = Omit<PagedListState<T>, 'more'>;

/** El estado que resulta de leer la página que empieza en `offset`. */
function applyPage<T extends { id: string }>(result: ClientResult<Page<T>>, offset: number): (current: Plain<T>) => Plain<T> {
  const first = offset === 0;
  return (current) => {
    if (!result.ok) return first ? { phase: 'error', list: emptyPagedList<T>(), error: result.code, loadingMore: false } : { ...current, loadingMore: false, error: result.code };
    return { phase: 'ready', list: appendPage(first ? emptyPagedList<T>() : current.list, result.body), error: null, loadingMore: false };
  };
}

/**
 * Lista paginada del inicio (D7): lee la primera página al montarse **y** al volver a mostrarse (`<Activity>`), y al
 * ocultarse vuelve a `loading`, para que no se vea ni un instante la lista vieja (p. ej. una conversación recién borrada).
 *
 * @param read Lee la página que empieza en `offset`. Tiene que ser estable (una función de módulo).
 */
export function usePagedList<T extends { id: string }>(read: PageReader<T>) {
  const [state, setState] = useState<Plain<T>>({ phase: 'loading', list: emptyPagedList<T>(), error: null, loadingMore: false });
  const controller = useRef<AbortController | null>(null);

  /** Lee una página y aplica el resultado. Empieza por la espera: el estado de «cargando» lo pone quien la pide. */
  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      const result = await read(offset, signal);
      if (!signal.aborted) setState(applyPage(result, offset));
    },
    [read],
  );

  /** Cancela la lectura en curso y devuelve la señal de la nueva. */
  const renew = useCallback(() => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  }, []);

  // Al montarse y al volver a mostrarse (`<Activity>`) lee la primera página.
  useEffect(() => {
    const signal = renew();
    const loadFirstPage = async () => {
      const result = await read(0, signal);
      if (!signal.aborted) setState(applyPage(result, 0));
    };
    void loadFirstPage();
  }, [read, renew]);

  // Al ocultarse (o desmontarse) se cancela la lectura y se vuelve a `loading`.
  useLayoutEffect(
    () => () => {
      controller.current?.abort();
      setState({ phase: 'loading', list: emptyPagedList<T>(), error: null, loadingMore: false });
    },
    [],
  );

  const reload = useCallback(() => {
    setState({ phase: 'loading', list: emptyPagedList<T>(), error: null, loadingMore: false });
    return fetchPage(0, renew());
  }, [fetchPage, renew]);
  const loadMore = useCallback(() => {
    setState((current) => ({ ...current, error: null, loadingMore: true }));
    return fetchPage(state.list.nextOffset, renew());
  }, [fetchPage, renew, state.list.nextOffset]);
  return { state: { ...state, more: hasMore(state.list) } satisfies PagedListState<T>, reload, loadMore };
}
