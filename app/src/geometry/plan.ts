// Производная геометрия плана: полигоны стен с вырезанными проёмами, дуги дверей,
// внутреннее пространство квартиры и автоконтур помещения по клику.
import type { Opening, PlanGeometry, Pt, Wall } from '../model/types';
import {
  add, bbox, difference, dist, fromRing, geomArea, leftNormal, mul, norm, pointInGeom, pointInPolygon,
  segmentRect, simplifyRing, sub, toGeom, union, type Geom,
} from './poly';

export function wallPolygon(w: Wall, neighbors: Wall[] = []): Pt[] {
  const direction = norm(sub(w.b, w.a));
  const extension = (p: Pt) => neighbors.reduce((length, other) => {
    if (other.id === w.id || ![other.a, other.b].some(q => dist(p, q) < 1)) return length;
    const d = norm(sub(other.b, other.a)), sine = Math.abs(direction.x * d.y - direction.y * d.x);
    // Fill perpendicular corners through the outer wall face; free ends stay flat.
    return sine > .95 ? Math.max(length, other.thickness / (2 * sine)) : length;
  }, 0);
  return segmentRect(add(w.a, mul(direction, -extension(w.a))), add(w.b, mul(direction, extension(w.b))), w.thickness);
}

export function usesRoomWalls(g: PlanGeometry): boolean {
  return g.rooms.length > 0 && (g.wallMode === 'rooms' || (!g.wallMode && !g.walls.length));
}

/** Прямоугольник проёма; чуть толще стены, чтобы гарантированно прорезать её. */
export function openingRect(o: Opening, extra = 2): Pt[] {
  return segmentRect(o.a, o.b, o.thickness + extra);
}

export function openingWidth(o: Opening): number {
  return dist(o.a, o.b);
}

/** Направление «внутрь» по стороне открывания (единичный вектор). */
export function swingDir(o: Opening): Pt {
  return mul(leftNormal(norm(sub(o.b, o.a))), o.swing);
}

/** Сектор открывания двери (четверть круга от петли), полигон-аппроксимация. */
export function doorSwingPolygon(o: Opening, segments = 12): Pt[] {
  const hinge = o.hinge === 'a' ? o.a : o.b;
  const free = o.hinge === 'a' ? o.b : o.a;
  const r = dist(hinge, free);
  const face = mul(swingDir(o), o.thickness / 2);
  const h = add(hinge, face);
  const closed = norm(sub(free, hinge));
  const open = swingDir(o);
  const pts: Pt[] = [h];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * (Math.PI / 2);
    const dir = add(mul(closed, Math.cos(t)), mul(open, Math.sin(t)));
    pts.push(add(h, mul(dir, r)));
  }
  return pts;
}

/** Две равные створки открываются с обоих откосов в одну сторону. */
export function doorSwingPolygons(o: Opening, segments = 12): Pt[][] {
  if (o.leaves !== 2) return [doorSwingPolygon(o, segments)];
  const mid = mul(add(o.a, o.b), 0.5);
  return [
    doorSwingPolygon({ ...o, b: mid, hinge: 'a', leaves: 1 }, segments),
    doorSwingPolygon({ ...o, a: mid, hinge: 'b', leaves: 1 }, segments),
  ];
}

/** Полигоны стен с прорезанными проёмами (MultiPolygon). */
export function wallsGeom(g: PlanGeometry, cutOpenings = true, neighbors = g.walls): Geom {
  const walls = union(...g.walls.map((w) => toGeom(wallPolygon(w, neighbors))));
  if (!cutOpenings || !g.openings.length) return walls;
  return difference(walls, union(...g.openings.map((o) => toGeom(openingRect(o)))));
}

/** Стены + все проёмы как сплошная граница (для поиска контуров помещений). */
export function barrierGeom(g: PlanGeometry): Geom {
  return union(
    ...g.walls.map((w) => toGeom(wallPolygon(w, g.walls))),
    ...g.openings.map((o) => toGeom(segmentRect(o.a, o.b, o.thickness))),
  );
}

/**
 * Автоконтур помещения: область, ограниченная стенами и проёмами, в которой лежит точка.
 * Возвращает null, если точка снаружи квартиры или внутри стены.
 */
export function detectRoomPolygon(g: PlanGeometry, p: Pt): Pt[] | null {
  if (!g.walls.length) return null;
  const pts = g.walls.flatMap((w) => wallPolygon(w));
  const b = bbox(pts);
  const pad = 2000;
  const frame: Pt[] = [
    { x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.minY - pad },
    { x: b.maxX + pad, y: b.maxY + pad }, { x: b.minX - pad, y: b.maxY + pad },
  ];
  const free = difference(toGeom(frame), barrierGeom(g));
  for (const poly of free) {
    const outer = fromRing(poly[0]);
    // Область, касающаяся рамки, — внешнее пространство.
    const touchesFrame = outer.some((q) => q.x <= b.minX - pad + 1 || q.y <= b.minY - pad + 1 || q.x >= b.maxX + pad - 1 || q.y >= b.maxY + pad - 1);
    if (touchesFrame) continue;
    if (pointInGeom(p, [poly])) return simplifyRing(outer.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })));
  }
  return null;
}

/** Внутреннее пространство квартиры = объединение помещений (без стен). */
export function interiorGeom(g: PlanGeometry, includeBalcony = true): Geom {
  return union(...g.rooms.filter((r) => includeBalcony || r.type !== 'balcony').map((r) => toGeom(r.polygon)));
}

/** Внешний контур квартиры (помещения + стены), для проверки сохранения контура. */
export function outlineGeom(g: PlanGeometry): Geom {
  return union(interiorGeom(g), wallsGeom(g, false));
}

export function roomAt(g: PlanGeometry, p: Pt) {
  return g.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;
}

export function roomArea(poly: Pt[]): number {
  return geomArea(toGeom(poly));
}

/** Стабильный хэш геометрии: варианты ссылаются на утверждённую версию. */
export function geometryHash(g: PlanGeometry): string {
  const r = (n: number) => Math.round(n);
  const p = (q: Pt) => `${r(q.x)},${r(q.y)}`;
  const parts = [
    ...(g.wallMode ? [`WM${g.wallMode}`] : []),
    ...g.walls.map((w) => `W${p(w.a)}|${p(w.b)}|${r(w.thickness)}|${w.kind}`),
    ...g.openings.map((o) => `O${o.type}${p(o.a)}|${p(o.b)}|${o.hinge}${o.swing}${o.isEntrance ? 'E' : ''}${o.leaves === 2 ? '|L2' : ''}`),
    ...g.fixed.map((f) => `F${f.kind}${f.polygon.map(p).join(';')}`),
    ...g.wetZones.map((z) => `Z${z.polygon.map(p).join(';')}`),
    ...g.rooms.map((m) => `R${m.type}${m.polygon.map(p).join(';')}`),
  ].sort();
  let h = 2166136261;
  for (const s of parts) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Стены для плана без векторных стен (скан): полоса толщиной t вокруг помещений,
 * пустоты между помещениями залиты, дверные и оконные проёмы вырезаны.
 */
export function roomWallBand(g: PlanGeometry, t = 300): Geom {
  if (!g.rooms.length) return [];
  const parts: Geom[] = [];
  for (const r of g.rooms) {
    parts.push(toGeom(r.polygon));
    const n = r.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = r.polygon[i], b = r.polygon[(i + 1) % n];
      parts.push(toGeom(segmentRect(a, b, 2 * t)));
      parts.push(toGeom([{ x: a.x - t, y: a.y - t }, { x: a.x + t, y: a.y - t }, { x: a.x + t, y: a.y + t }, { x: a.x - t, y: a.y + t }]));
    }
  }
  const dil = union(...parts);
  const filled: Geom = dil.map((poly) => [poly[0]]); // без внутренних пустот
  const interior = union(...g.rooms.map((r) => toGeom(r.polygon)));
  const cuts = union(...g.openings.map((o) => toGeom(segmentRect(o.a, o.b, o.type === 'door' ? 2 * t + 200 : o.thickness + 2))));
  return difference(filled, interior, cuts);
}
