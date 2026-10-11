import { useEffect, useRef, useState } from 'react';
import type { Concept, FurnitureItem, PlanGeometry } from '../model/types';
import { buildScene } from './build';
import { sceneMaterials } from './materials';
import { createSceneRenderer, DEFAULT_CAMERA } from './renderer';
import type { MaterialCatalog, SceneSettings } from './types';

/** Отдельный ракурс каждой расстановки; PNG остаётся виден в печати/PDF. */
export function SceneImage({ geometry, items, settings, catalog, palette, title }: {
  geometry: PlanGeometry; items: FurnitureItem[]; settings: SceneSettings; catalog: MaterialCatalog; palette: Concept['palette']; title: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let active = true, renderer: ReturnType<typeof createSceneRenderer> | undefined;
    const el = canvas.current!; setUrl(''); setError('');
    try {
      renderer = createSceneRenderer(el, buildScene(geometry, items, settings), sceneMaterials(catalog, settings, palette), () => {});
      renderer.draw(DEFAULT_CAMERA);
      const instance = renderer;
      void instance.ready.then(() => {
        if (!active) return;
        try { instance.draw(DEFAULT_CAMERA); if (el.getContext('webgl')?.isContextLost()) throw new Error('Отображение 3D приостановлено. Откройте экран заново.'); setUrl(el.toDataURL('image/png')); }
        catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить 3D.'); }
        finally { instance.destroy(); }
      });
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить 3D.'); }
    return () => { active = false; renderer?.destroy(); };
  }, [geometry, items, settings, catalog, palette]);
  return <div className="client-scene">
    <canvas ref={canvas} className="client-scene-source no-print" aria-hidden="true" />
    {url ? <img data-client-3d="true" src={url} alt={`3D-визуализация: ${title}`} /> : <div className="notice" role="status">{error || 'Готовим 3D-визуализацию…'}</div>}
  </div>;
}
