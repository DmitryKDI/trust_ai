import type { FurnitureItem, Pt } from '../model/types';
import { footprint } from '../furniture/catalog';
import { bbox, dist, overlapArea, projectOnSegment } from '../geometry/poly';
import type { FurnitureSnapContext } from './furniture-interaction';

export interface Measurement { id: string; label: string; a: Pt; b: Pt; mm: number; kind: 'wall' | 'item' }
/** Ray distances to actual wall faces, including thick and diagonal walls. */
export function furnitureMeasurements(item: FurnitureItem, context: FurnitureSnapContext): Measurement[] {
  const bounds = bbox(footprint(item));
  const rays: { id: string; label: string; a: Pt; dir: Pt }[] = [
    { id: 'left', label: 'Слева до стены', a: { x: bounds.minX, y: item.y }, dir: { x: -1, y: 0 } },
    { id: 'right', label: 'Справа до стены', a: { x: bounds.maxX, y: item.y }, dir: { x: 1, y: 0 } },
    { id: 'top', label: 'Сверху до стены', a: { x: item.x, y: bounds.minY }, dir: { x: 0, y: -1 } },
    { id: 'bottom', label: 'Снизу до стены', a: { x: item.x, y: bounds.maxY }, dir: { x: 0, y: 1 } },
  ];
  const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
  const measurements: Measurement[] = [];
  for (const ray of rays) {
    let closest = Infinity;
    for (const edge of context.edges) {
      const delta = { x: edge.b.x - edge.a.x, y: edge.b.y - edge.a.y }, origin = { x: edge.a.x - ray.a.x, y: edge.a.y - ray.a.y };
      const den = cross(ray.dir, delta); if (Math.abs(den) < 1e-9) continue;
      const t = cross(origin, delta) / den, u = cross(origin, ray.dir) / den;
      if (t >= -1e-6 && u >= -1e-6 && u <= 1 + 1e-6) closest = Math.min(closest, Math.max(0, t));
    }
    if (Number.isFinite(closest)) measurements.push({ id: `wall-${ray.id}`, label: ray.label, a: ray.a, b: { x: ray.a.x + ray.dir.x * closest, y: ray.a.y + ray.dir.y * closest }, mm: Math.round(closest), kind: 'wall' });
  }
  // Shortest boundary distance to another solid object (not center-to-center).
  const poly = footprint(item); let nearest: Measurement | undefined;
  for (const other of context.others) {
    if (other.type === 'play-rug') continue;
    const op = footprint(other); let gap = Infinity, a = item as Pt, b = other as Pt;
    for (const [source, target, reverse] of [[poly, op, false], [op, poly, true]] as const) {
      for (const p of source) for (let i = 0; i < target.length; i++) {
        const q = projectOnSegment(p, target[i], target[(i + 1) % target.length]).point; const distance = dist(p, q);
        if (distance < gap) { gap = distance; a = reverse ? q : p; b = reverse ? p : q; }
      }
    }
    if (overlapArea(poly, op) > 1) { gap = 0; b = a; }
    if (!nearest || gap < nearest.mm) nearest = { id: 'nearest-item', label: 'До ближайшего предмета', a, b, mm: gap, kind: 'item' };
  }
  if (nearest) measurements.push({ ...nearest, mm: Math.round(nearest.mm) });
  return measurements;
}
