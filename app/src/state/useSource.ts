// Растр и векторы выбранной страницы исходника (кэш на сессию).
import { useEffect, useState } from 'react';
import type { SourceDocument } from '../model/types';
import { getFile } from '../storage/db';
import { renderImage, renderPdfPage, type RenderedPage } from '../pdf/load';

const cache = new Map<string, Promise<RenderedPage>>();

export function clearSourceCache() {
  for (const entry of cache.values()) void entry.then(page => { if (page.imageUrl.startsWith('blob:')) URL.revokeObjectURL(page.imageUrl); }).catch(() => {});
  cache.clear();
}

export function loadPage(doc: SourceDocument, page: number, withVectors = true): Promise<RenderedPage> {
  const key = `${doc.id}:${page}:${withVectors}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const blob = await getFile(doc.id);
      if (!blob) throw new Error('Файл исходника не найден в хранилище — загрузите его заново');
      if (doc.mime === 'application/pdf') return renderPdfPage(await blob.arrayBuffer(), page, 3, withVectors);
      return renderImage(blob);
    })();
    cache.set(key, p);
    const entry = p;
    p.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  }
  return p;
}

export function useSourcePage(doc: SourceDocument | null | undefined, page: number | null, withVectors = true) {
  const [state, setState] = useState<{ page: RenderedPage | null; error: string | null; loading: boolean }>({ page: null, error: null, loading: false });
  useEffect(() => {
    if (!doc || !page) { setState({ page: null, error: null, loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadPage(doc, page, withVectors)
      .then((r) => alive && setState({ page: r, error: null, loading: false }))
      .catch((e) => alive && setState({ page: null, error: String(e.message ?? e), loading: false }));
    return () => { alive = false; };
  }, [doc?.id, page, withVectors]);
  return state;
}
