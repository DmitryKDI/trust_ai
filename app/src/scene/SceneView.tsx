import { useEffect, useMemo, useRef, useState } from 'react';
import type { Concept, FurnitureItem, PlanGeometry } from '../model/types';
import { buildScene } from './build';
import { createSceneRenderer, DEFAULT_CAMERA, type Camera } from './renderer';
import { type MaterialCatalog, type SceneSettings } from './types';
import { sceneMaterials } from './materials';
import './scene.css';

export function SceneView({ geometry, items, settings, catalog, palette, title, onSnapshot }: {
  geometry: PlanGeometry; items: FurnitureItem[]; settings: SceneSettings; catalog: MaterialCatalog;
  palette?: Concept['palette']; title: string; onSnapshot?: (url: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<ReturnType<typeof createSceneRenderer> | null>(null);
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA), drag = useRef<{ x: number; y: number } | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA), [error, setError] = useState(''), [warning, setWarning] = useState(''), [ready, setReady] = useState(false), [epoch, setEpoch] = useState(0);
  const model = useMemo(() => buildScene(geometry, items, settings), [geometry, items, settings]);
  const materials = useMemo(() => sceneMaterials(catalog, settings, palette), [catalog, settings.assignments, palette]);
  useEffect(() => {
    const el = canvas.current!; setError(''); setWarning(''); setReady(false);
    try { renderer.current = createSceneRenderer(el, model, materials, setWarning); renderer.current.draw(cameraRef.current); const instance = renderer.current; void instance.ready.then(() => { if (renderer.current === instance && !el.getContext('webgl')?.isContextLost()) setReady(true); }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось открыть 3D.'); }
    const observer = new ResizeObserver(() => renderer.current?.draw(cameraRef.current)); observer.observe(el);
    const lost = (e: Event) => { e.preventDefault(); setReady(false); setError('Отображение 3D приостановлено браузером. Ожидаем восстановление.'); };
    const restored = () => setEpoch(n => n + 1);
    el.addEventListener('webglcontextlost', lost); el.addEventListener('webglcontextrestored', restored);
    return () => { observer.disconnect(); el.removeEventListener('webglcontextlost', lost); el.removeEventListener('webglcontextrestored', restored); renderer.current?.destroy(); renderer.current = null; };
  }, [model, materials, epoch]);
  useEffect(() => { cameraRef.current = camera; renderer.current?.draw(camera); }, [camera]);
  const zoom = (delta: number) => setCamera(c => ({ ...c, zoom: Math.max(.4, Math.min(3, c.zoom * delta)) }));
  useEffect(() => {
    const el = canvas.current!, wheel = (e: WheelEvent) => { e.preventDefault(); zoom(e.deltaY > 0 ? .92 : 1.08); };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, []);
  return <div className="scene-view">
    <canvas ref={canvas} className="scene-canvas" aria-label={`3D: ${title}`} tabIndex={0} data-scene-ready={ready} data-scene-nodes={model.nodes.length}
      onPointerDown={e => { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; }}
      onPointerMove={e => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setCamera(c => ({ ...c, yaw: c.yaw + dx * .008, pitch: Math.max(.15, Math.min(Math.PI / 2, c.pitch + dy * .008)) })); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(e.key)) return; e.preventDefault();
        if (e.key === '+' || e.key === '=') zoom(1.1); else if (e.key === '-') zoom(.9);
        else setCamera(c => ({ ...c, yaw: c.yaw + (e.key === 'ArrowLeft' ? -.1 : e.key === 'ArrowRight' ? .1 : 0), pitch: Math.max(.15, Math.min(Math.PI / 2, c.pitch + (e.key === 'ArrowUp' ? .1 : e.key === 'ArrowDown' ? -.1 : 0))) }));
      }} />
    {error && <div className="notice" role="alert">{error}</div>}
    {warning && <div className="notice" role="status">{warning}</div>}
    <div className="actions scene-toolbar">
      <button className="btn secondary sm" onClick={() => setCamera(DEFAULT_CAMERA)}>Общий вид</button>
      <button className="btn secondary sm" onClick={() => setCamera({ yaw: 0, pitch: Math.PI / 2, zoom: 1 })}>Сверху</button>
      <button className="btn ghost sm" aria-label="Уменьшить 3D" onClick={() => zoom(.85)}>−</button>
      <button className="btn ghost sm" aria-label="Увеличить 3D" onClick={() => zoom(1.15)}>+</button>
      {onSnapshot && <button className="btn sm" disabled={!ready} onClick={() => { try { renderer.current?.draw(cameraRef.current); onSnapshot(canvas.current!.toDataURL('image/png')); } catch { setWarning('Не удалось сохранить ракурс.'); } }}>Сохранить ракурс</button>}
    </div>
    <p className="muted small">Перетаскивание — вращение; колесо или +/− — масштаб. С клавиатуры: стрелки и +/−.</p>
  </div>;
}
