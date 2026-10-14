import type { PlanGeometry, Pt, Wall } from '../model/types';
import { dist, pointInPolygon, projectOnSegment } from '../geometry/poly';
import { openingRect } from '../geometry/plan';

/** Snap to wall axes rather than painted wall faces; Shift keeps a strict axis. */
export function snapWallAxis(raw: Pt, walls: Wall[], radius: number, anchor: Pt | null = null, ortho = false): Pt {
  const horizontal = anchor && Math.abs(raw.x - anchor.x) >= Math.abs(raw.y - anchor.y);
  const target = anchor && ortho ? horizontal ? { x: raw.x, y: anchor.y } : { x: anchor.x, y: raw.y } : raw;
  const aligned = (p: Pt) => !anchor || !ortho || Math.abs(horizontal ? p.y - anchor.y : p.x - anchor.x) < 1;
  const ends = walls.flatMap(w => [w.a, w.b]).filter(p => aligned(p) && dist(p, target) <= radius).sort((a, b) => dist(a, target) - dist(b, target));
  if (ends[0]) return { ...ends[0] };
  const projections = walls.map(w => projectOnSegment(target, w.a, w.b)).filter(p => aligned(p.point) && p.dist <= radius).sort((a, b) => a.dist - b.dist);
  return projections[0]?.point ?? target;
}

/** Extend/trim close corners along their own axes. Door/window openings are protected. */
export function repairWallJunctions(g: PlanGeometry, tolerance = 120, changedWalls?: Set<string>): PlanGeometry {
  const walls = g.walls.map(w => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  let changed = false;
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j], ax = a.b.x - a.a.x, ay = a.b.y - a.a.y, bx = b.b.x - b.a.x, by = b.b.y - b.a.y;
    if (changedWalls && !changedWalls.has(a.id) && !changedWalls.has(b.id)) continue;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), den = ax * by - ay * bx;
    if (!la || !lb || Math.abs(den) / (la * lb) < .25) continue;
    const dx = b.a.x - a.a.x, dy = b.a.y - a.a.y, t = (dx * by - dy * bx) / den, u = (dx * ay - dy * ax) / den;
    if (t < -tolerance / la || t > 1 + tolerance / la || u < -tolerance / lb || u > 1 + tolerance / lb) continue;
    const p = { x: a.a.x + t * ax, y: a.a.y + t * ay };
    if (g.openings.some(o => pointInPolygon(p, openingRect(o)))) continue;
    for (const w of [a, b]) for (const end of ['a', 'b'] as const) {
      if (dist(w[end], p) < 1e-6 || dist(w[end], p) > tolerance || dist(w[end === 'a' ? 'b' : 'a'], p) < 50) continue;
      w[end] = { ...p }; changed = true;
    }
  }
  return changed ? { ...g, walls } : g;
}
