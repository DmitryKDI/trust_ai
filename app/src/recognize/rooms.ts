// Все замкнутые области между стенами и проёмами (помещения-кандидаты).
import type { PlanGeometry, Pt } from '../model/types';
import { barrierGeom, wallPolygon } from '../geometry/plan';
import { bbox, difference, fromRing, simplifyRing, toGeom } from '../geometry/poly';

export function detectAllRooms(g: PlanGeometry): Pt[][] {
  if (!g.walls.length) return [];
  const b = bbox(g.walls.flatMap((w) => wallPolygon(w)));
  const pad = 2000;
  const frame: Pt[] = [
    { x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.minY - pad },
    { x: b.maxX + pad, y: b.maxY + pad }, { x: b.minX - pad, y: b.maxY + pad },
  ];
  const free = difference(toGeom(frame), barrierGeom(g));
  const out: Pt[][] = [];
  for (const poly of free) {
    const outer = fromRing(poly[0]);
    const touches = outer.some((q) => q.x <= b.minX - pad + 1 || q.y <= b.minY - pad + 1 || q.x >= b.maxX + pad - 1 || q.y >= b.maxY + pad - 1);
    if (touches) continue;
    out.push(simplifyRing(outer.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })), 2));
  }
  return out;
}
