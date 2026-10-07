import { useRef, useState } from 'react';
import type { PlanGeometry, Pt } from '../model/types';
import { dist } from '../geometry/poly';
import { polyPath } from '../plan/PlanView';
import { geometryVertices, moveGeometryVertex, type ElementSelection } from './selection';
import { orthogonalPoint } from './ops';

export function GeometryHandles({ geometry, selection, radius, onChange, onError }: { geometry: PlanGeometry; selection: ElementSelection | null; radius: number; onChange: (fn: (g: PlanGeometry) => PlanGeometry) => void; onError: (message: string) => void }) {
  const [preview, setPreview] = useState<Pt[] | null>(null);
  const drag = useRef<{ original: PlanGeometry; sel: ElementSelection; index: number; point: Pt; before: Pt[] } | null>(null);
  const vertices = selection ? geometryVertices(geometry, selection) : [];
  const move = (e: React.PointerEvent<SVGCircleElement>) => {
    const d = drag.current; if (!d) return;
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement!, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const raw = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    let p: Pt = { x: Math.round(raw.x / 10) * 10, y: Math.round(raw.y / 10) * 10 };
    if (e.shiftKey) p = orthogonalPoint(d.before[(d.index + d.before.length - 1) % d.before.length], p);
    if (!e.altKey && !e.shiftKey) {
      const points = [...d.original.walls.flatMap(w => [w.a, w.b]), ...d.original.openings.flatMap(o => [o.a, o.b]), ...d.original.rooms.flatMap(r => r.polygon), ...d.original.fixed.flatMap(f => f.polygon), ...d.original.wetZones.flatMap(z => z.polygon)].filter(q => dist(q, d.before[d.index]) > 1);
      const nearby = points.filter(q => dist(q, p) < radius * 2).sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (nearby) p = nearby;
    }
    d.point = p; setPreview(d.before.map((q, i) => i === d.index ? p : q));
  };
  return <g data-geometry-handles="true">
    {preview && <path d={selection?.kind === 'wall' || selection?.kind === 'opening' ? `M${preview[0].x} ${preview[0].y}L${preview[1].x} ${preview[1].y}` : polyPath(preview)} fill="none" stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    {(preview ?? vertices).map((p, index) => <circle key={index} data-vertex-handle={index} cx={p.x} cy={p.y} r={radius} fill="#fff" stroke="#d2691e" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: 'move' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!selection) return; e.currentTarget.ownerSVGElement?.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { original: geometry, sel: selection, index, point: p, before: vertices }; }}
      onPointerMove={move}
      onPointerUp={e => { e.stopPropagation(); move(e); const d = drag.current; drag.current = null; setPreview(null); if (!d) return; try { const next = moveGeometryVertex(d.original, d.sel, d.index, d.point); if (next !== d.original) onChange(() => next); } catch (err) { onError(err instanceof Error ? err.message : 'Не удалось изменить угол.'); } }}
      onPointerCancel={e => { e.stopPropagation(); drag.current = null; setPreview(null); }} onLostPointerCapture={() => { if (drag.current) { drag.current = null; setPreview(null); } }} />)}
  </g>;
}

export function WallAngle({ geometry, selection, onChange, onError }: { geometry: PlanGeometry; selection: ElementSelection | null; onChange: (fn: (g: PlanGeometry) => PlanGeometry) => void; onError: (message: string) => void }) {
  const wall = selection?.kind === 'wall' ? geometry.walls.find(w => w.id === selection.id) : null;
  if (!wall || !selection) return null;
  const angle = ((Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) * 180 / Math.PI + 360) % 360).toFixed(1);
  const commit = (text: string) => {
    const n = Number(text); if (!text.trim() || !Number.isFinite(n) || n < 0 || n > 360) { onError('Угол должен быть от 0 до 360 градусов.'); return; }
    const rad = n * Math.PI / 180, length = dist(wall.a, wall.b);
    try { const next = moveGeometryVertex(geometry, selection, 1, { x: wall.a.x + length * Math.cos(rad), y: wall.a.y + length * Math.sin(rad) }); if (next !== geometry) onChange(() => next); } catch (e) { onError(e instanceof Error ? e.message : 'Не удалось изменить угол.'); }
  };
  return <label className="field">Угол стены, °<input key={`${wall.id}:${angle}`} type="number" min={0} max={360} step={.1} defaultValue={angle} onBlur={e => commit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); } }} /><span className="hint">Поворот вокруг первой точки. Углы фигур можно перетаскивать на плане.</span></label>;
}
