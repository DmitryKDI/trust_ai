import type { FurnitureItem, PlanGeometry, Pt } from '../model/types';
import { footprint } from '../furniture/catalog';
import { roomWallBand, usesRoomWalls, wallsGeom } from '../geometry/plan';
import { bbox, dist, dot, fromRing, overlapArea, mul, projectOnSegment, sub, union, type Geom } from '../geometry/poly';
import { resizeFurniture } from './furniture';

export type ResizeHandle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };
export const RESIZE_HANDLES: ResizeHandle[] = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }];
export interface SnapGuide { a: Pt; b: Pt; kind: 'wall' | 'item' }
export interface FurnitureSnapContext { walls: Geom; edges: { a: Pt; b: Pt }[]; others: FurnitureItem[] }
export function furnitureSnapContext(g: PlanGeometry, others: FurnitureItem[]): FurnitureSnapContext {
  const walls = union(wallsGeom(g), usesRoomWalls(g) ? roomWallBand(g, 200) : []);
  const edges = walls.flatMap(poly => poly.flatMap(ring => { const pts = fromRing(ring); return pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length] })).filter(e => dist(e.a, e.b) > 1); }));
  return { walls, edges, others };
}
function wallOverlap(item: FurnitureItem, walls: Geom): number { return walls.length ? overlapArea(footprint(item), walls) : 0; }
function clear(item: FurnitureItem, context: FurnitureSnapContext): boolean {
  if (wallOverlap(item, context.walls) > 1) return false;
  return !context.others.some(other => other.type !== 'play-rug' && item.type !== 'play-rug' && overlapArea(footprint(item), footprint(other)) > 1);
}

/** Противоположная сторона/угол неподвижны, даже у повернутого предмета. */
export function resizeFurnitureAtHandle(item: FurnitureItem, handle: ResizeHandle, pointer: Pt): FurnitureItem {
  if (![pointer.x, pointer.y].every(Number.isFinite)) return item;
  const angle = item.rot * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), delta = sub(pointer, item);
  const local = { x: delta.x * c + delta.y * s, y: -delta.x * s + delta.y * c };
  let left = -item.w / 2, right = item.w / 2, top = -item.d / 2, bottom = item.d / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (handle.x < 0) left = clamp(local.x, right - 10000, right - 100);
  if (handle.x > 0) right = clamp(local.x, left + 100, left + 10000);
  if (handle.y < 0) top = clamp(local.y, bottom - 10000, bottom - 100);
  if (handle.y > 0) bottom = clamp(local.y, top + 100, top + 10000);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  return { ...resizeFurniture(item, right - left, bottom - top), x: item.x + center.x * c - center.y * s, y: item.y + center.x * s + center.y * c };
}

export function snapFurnitureMove(item: FurnitureItem, context: FurnitureSnapContext, radius: number): { item: FurnitureItem; guides: SnapGuide[] } {
  let current = item;
  const guides: SnapGuide[] = [], usedNormals: Pt[] = [];
  // Два независимых направления позволяют прилипнуть в угол.
  for (let pass = 0; pass < 2; pass++) {
    const candidates: { dx: number; dy: number; normal: Pt; guide: SnapGuide; distance: number }[] = [];
    const poly = footprint(current), bounds = bbox(poly);
    const consider = (delta: Pt, normal: Pt, guide: SnapGuide) => {
      const distance = Math.hypot(delta.x, delta.y);
      if (distance > radius || usedNormals.some(n => Math.abs(dot(n, normal)) > .95)) return;
      const next = { ...current, x: current.x + delta.x, y: current.y + delta.y };
      if (clear(next, context)) candidates.push({ dx: delta.x, dy: delta.y, normal, guide, distance });
    };
    for (const edge of context.edges) {
      const delta = sub(edge.b, edge.a), length = Math.hypot(delta.x, delta.y), normal = { x: -delta.y / length, y: delta.x / length };
      const distances = poly.map(p => dot(sub(p, edge.a), normal)), centerSide = dot(sub(current, edge.a), normal);
      const near = centerSide >= 0 ? Math.min(...distances) : Math.max(...distances);
      if (Math.abs(near) > radius) continue;
      const along = poly.map(p => dot(sub(p, edge.a), mul(delta, 1 / length)));
      if (Math.max(...along) < 0 || Math.min(...along) > length) continue;
      consider(mul(normal, -near), normal, { ...edge, kind: 'wall' });
    }
    for (const other of context.others) {
      const b = bbox(footprint(other));
      const overlapY = Math.min(bounds.maxY, b.maxY) - Math.max(bounds.minY, b.minY), overlapX = Math.min(bounds.maxX, b.maxX) - Math.max(bounds.minX, b.minX);
      if (overlapY >= -radius) {
        for (const [x, from] of [[b.minX, bounds.maxX], [b.maxX, bounds.minX]]) consider({ x: x - from, y: 0 }, { x: 1, y: 0 }, { a: { x, y: Math.min(b.minY, bounds.minY) }, b: { x, y: Math.max(b.maxY, bounds.maxY) }, kind: 'item' });
      }
      if (overlapX >= -radius) {
        for (const [y, from] of [[b.minY, bounds.maxY], [b.maxY, bounds.minY]]) consider({ x: 0, y: y - from }, { x: 0, y: 1 }, { a: { x: Math.min(b.minX, bounds.minX), y }, b: { x: Math.max(b.maxX, bounds.maxX), y }, kind: 'item' });
      }
      // Выравнивание краёв близких соседей в ряд без наложения.
      if (overlapY >= -radius * 2 && overlapY <= 0) for (const [x, from] of [[b.minX, bounds.minX], [b.maxX, bounds.maxX]]) consider({ x: x - from, y: 0 }, { x: 1, y: 0 }, { a: { x, y: Math.min(b.minY, bounds.minY) }, b: { x, y: Math.max(b.maxY, bounds.maxY) }, kind: 'item' });
      if (overlapX >= -radius * 2 && overlapX <= 0) for (const [y, from] of [[b.minY, bounds.minY], [b.maxY, bounds.maxY]]) consider({ x: 0, y: y - from }, { x: 0, y: 1 }, { a: { x: Math.min(b.minX, bounds.minX), y }, b: { x: Math.max(b.maxX, bounds.maxX), y }, kind: 'item' });
    }
    const best = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!best) break;
    current = { ...current, x: current.x + best.dx, y: current.y + best.dy }; guides.push(best.guide); usedNormals.push(best.normal);
  }
  return { item: current, guides };
}

/** Для размеров магнитится движущаяся сторона; противоположная остаётся на месте. */
export function snapFurnitureResize(item: FurnitureItem, handle: ResizeHandle, pointer: Pt, context: FurnitureSnapContext, radius: number): { item: FurnitureItem; guides: SnapGuide[] } {
  const quarter = item.rot === 90 || item.rot === 270;
  const allowX = quarter ? handle.y !== 0 : handle.x !== 0, allowY = quarter ? handle.x !== 0 : handle.y !== 0;
  let p = pointer; const guides: SnapGuide[] = [];
  const edges = [...context.edges.map(e => ({ ...e, kind: 'wall' as const })), ...context.others.flatMap(it => { const pts = footprint(it); return pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length], kind: 'item' as const })); })];
  for (const axis of ['x', 'y'] as const) {
    if (axis === 'x' ? !allowX : !allowY) continue;
    const orth = axis === 'x' ? 'y' : 'x';
    const options = edges.filter(e => Math.abs(e.a[axis] - e.b[axis]) < 1 && p[orth] >= Math.min(e.a[orth], e.b[orth]) - radius && p[orth] <= Math.max(e.a[orth], e.b[orth]) + radius && Math.abs(p[axis] - e.a[axis]) <= radius).sort((a, b) => Math.abs(p[axis] - a.a[axis]) - Math.abs(p[axis] - b.a[axis]));
    for (const edge of options) { const next = { ...p, [axis]: edge.a[axis] }, resized = resizeFurnitureAtHandle(item, handle, next); if (clear(resized, context)) { p = next; guides.push(edge); break; } }
  }
  // Наклонная стена: магнит к ближайшей точке поверхности для углового маркера.
  if (allowX && allowY && !guides.length) {
    const best = context.edges.map(e => ({ edge: e, ...projectOnSegment(p, e.a, e.b) })).filter(e => e.dist <= radius).sort((a, b) => a.dist - b.dist).find(e => clear(resizeFurnitureAtHandle(item, handle, e.point), context));
    if (best) { p = best.point; guides.push({ ...best.edge, kind: 'wall' }); }
  }
  return { item: resizeFurnitureAtHandle(item, handle, p), guides };
}
