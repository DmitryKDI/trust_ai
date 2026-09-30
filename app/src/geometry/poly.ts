// Базовая 2D-геометрия в мм. Булевы операции над полигонами — через polygon-clipping.
import pc from 'polygon-clipping';
import type { Pt } from '../model/types';

type Ring = [number, number][];
export type Geom = Ring[][]; // MultiPolygon: полигоны → кольца → точки

export const EPS_AREA = 100; // мм² — меньше считаем шумом округления

export function toRing(poly: Pt[]): Ring {
  const r: Ring = poly.map((p) => [p.x, p.y]);
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]]);
  return r;
}

export function toGeom(poly: Pt[]): Geom {
  return [[toRing(poly)]];
}

export function fromRing(r: Ring): Pt[] {
  const pts = r.map(([x, y]) => ({ x, y }));
  if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
  return pts;
}

export function union(...gs: Geom[]): Geom {
  const nonEmpty = gs.filter((g) => g.length);
  if (!nonEmpty.length) return [];
  const [first, ...rest] = nonEmpty;
  return pc.union(first as never, ...(rest as never[])) as Geom;
}

export function intersection(a: Geom, b: Geom): Geom {
  if (!a.length || !b.length) return [];
  return pc.intersection(a as never, b as never) as Geom;
}

export function difference(a: Geom, ...bs: Geom[]): Geom {
  if (!a.length) return [];
  const nonEmpty = bs.filter((g) => g.length);
  if (!nonEmpty.length) return a;
  return pc.difference(a as never, ...(nonEmpty as never[])) as Geom;
}

export function ringArea(r: Ring | Pt[]): number {
  let s = 0;
  const pts = (r as unknown[]).map((p) => (Array.isArray(p) ? { x: p[0] as number, y: p[1] as number } : (p as Pt)));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function geomArea(g: Geom): number {
  let s = 0;
  for (const poly of g) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring));
      s += i === 0 ? a : -a;
    });
  }
  return s;
}

export function polyArea(poly: Pt[]): number {
  return Math.abs(ringArea(poly));
}

/** Площадь пересечения двух полигонов, мм². */
export function overlapArea(a: Pt[] | Geom, b: Pt[] | Geom): number {
  const ga = isGeom(a) ? a : toGeom(a);
  const gb = isGeom(b) ? b : toGeom(b);
  if (!bboxOverlap(geomBBox(ga), geomBBox(gb))) return 0;
  return geomArea(intersection(ga, gb));
}

/** Площадь части `a`, выходящей за пределы `container`. */
export function outsideArea(a: Pt[], container: Pt[] | Geom): number {
  const gc = isGeom(container) ? container : toGeom(container);
  return geomArea(difference(toGeom(a), gc));
}

function isGeom(x: Pt[] | Geom): x is Geom {
  return Array.isArray(x) && x.length > 0 && Array.isArray(x[0]);
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function bbox(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function geomBBox(g: Geom): BBox {
  const pts: Pt[] = [];
  for (const poly of g) for (const [x, y] of poly[0]) pts.push({ x, y });
  return bbox(pts);
}

export function bboxOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return a.minX - pad < b.maxX && b.minX - pad < a.maxX && a.minY - pad < b.maxY && b.minY - pad < a.maxY;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInGeom(p: Pt, g: Geom): boolean {
  for (const poly of g) {
    if (!pointInPolygon(p, fromRing(poly[0]))) continue;
    if (poly.slice(1).some((h) => pointInPolygon(p, fromRing(h)))) continue;
    return true;
  }
  return false;
}

// ——— Векторы ———
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Левая нормаль при оси Y вниз (визуально — влево от направления движения). */
export const leftNormal = (d: Pt): Pt => ({ x: d.y, y: -d.x });

/** Прямоугольник, построенный на отрезке a→b с толщиной t (симметрично). */
export function segmentRect(a: Pt, b: Pt, t: number): Pt[] {
  const d = norm(sub(b, a));
  const n = mul(leftNormal(d), t / 2);
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

/** Прямоугольник по центру, размерам и повороту (градусы, по часовой при оси Y вниз). */
export function orientedRect(cx: number, cy: number, w: number, d: number, rotDeg: number): Pt[] {
  const local: Pt[] = [
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 },
  ];
  return local.map((p) => localToWorld(p, cx, cy, rotDeg));
}

export function localToWorld(p: Pt, cx: number, cy: number, rotDeg: number): Pt {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return { x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c };
}

export function projectOnSegment(p: Pt, a: Pt, b: Pt): { t: number; point: Pt; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, mul(ab, t));
  return { t, point, dist: dist(p, point) };
}

/** Упрощение кольца: убирает дубли и точки на одной прямой. */
export function simplifyRing(pts: Pt[], tol = 0.5): Pt[] {
  let out = pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > tol);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) / (dist(a, c) || 1) < tol) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = bbox(poly);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Точка внутри полигона, удобная для подписи (центр масс, либо центр наибольшего прямоугольника сетки). */
export function labelPoint(poly: Pt[]): Pt {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const b = bbox(poly);
  let best = c, bestD = -1;
  const step = Math.max(50, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 20);
  for (let x = b.minX + step / 2; x < b.maxX; x += step)
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, poly)) continue;
      let dmin = Infinity;
      for (let i = 0; i < poly.length; i++) dmin = Math.min(dmin, projectOnSegment(p, poly[i], poly[(i + 1) % poly.length]).dist);
      if (dmin > bestD) { bestD = dmin; best = p; }
    }
  return best;
}
