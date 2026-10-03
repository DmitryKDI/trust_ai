// Операции редактора разметки (чистые функции, покрыты тестами).
import type { Calibration, Opening, PlanGeometry, Pt, Wall } from '../model/types';
import { uid } from '../model/defaults';
import { add, dist, dot, leftNormal, mul, norm, projectOnSegment, sub } from '../geometry/poly';
import { usesRoomWalls, wallPolygon } from '../geometry/plan';
import type { Arc, FillRect, SnapIndex } from '../pdf/vectors';

export const WALL_KINDS = [['unknown', 'Тип неизвестен'], ['bearing', 'Несущая'], ['partition', 'Перегородка']] as const;

export function addPlanWall(g: PlanGeometry, wall: Wall): PlanGeometry {
  if (![wall.a.x, wall.a.y, wall.b.x, wall.b.y, wall.thickness].every(Number.isFinite) || wall.thickness < 30 || dist(wall.a, wall.b) < 50) throw new Error('Нужны две разные точки стены и толщина от 30 мм.');
  return { ...g, ...(usesRoomWalls(g) ? { wallMode: 'rooms' as const } : {}), walls: [...g.walls, wall] };
}

/** Предварительный масштаб до калибровки: PDF — как 1:50 (мм на pt), растр — 10 мм на пиксель. */
export function provisionalScale(mime: string | undefined): number {
  return mime === 'application/pdf' ? (25.4 / 72) * 50 : 10;
}

export function scaleOf(g: PlanGeometry, mime: string | undefined): number {
  return g.calibration?.mmPerUnit ?? provisionalScale(mime);
}

/** Масштабирует всю разметку (после новой калибровки). */
export function scaleGeometry(g: PlanGeometry, f: number): PlanGeometry {
  if (Math.abs(f - 1) < 1e-9) return g;
  const P = (p: Pt): Pt => ({ x: p.x * f, y: p.y * f });
  return {
    ...g,
    walls: g.walls.map((w) => ({ ...w, a: P(w.a), b: P(w.b), thickness: w.thickness * f })),
    openings: g.openings.map((o) => ({ ...o, a: P(o.a), b: P(o.b), thickness: o.thickness * f })),
    fixed: g.fixed.map((x) => ({ ...x, polygon: x.polygon.map(P) })),
    wetZones: g.wetZones.map((x) => ({ ...x, polygon: x.polygon.map(P) })),
    rooms: g.rooms.map((x) => ({ ...x, polygon: x.polygon.map(P) })),
  };
}

/** Калибровка по двум точкам (в мм текущего масштаба) и известному размеру. */
export function calibrate(g: PlanGeometry, p1mm: Pt, p2mm: Pt, realMm: number, currentK: number): PlanGeometry {
  const s1 = mul(p1mm, 1 / currentK), s2 = mul(p2mm, 1 / currentK);
  const units = dist(s1, s2);
  if (units <= 0 || realMm <= 0) return g;
  const k = realMm / units;
  const cal: Calibration = { p1: s1, p2: s2, mm: realMm, mmPerUnit: k };
  return { ...scaleGeometry(g, k / currentK), calibration: cal };
}

const round = (v: number) => Math.round(v);

/** Стена по прямоугольной заливке чертежа: ось по длинной стороне, толщина — короткая сторона. */
export function wallFromFill(f: FillRect, k: number, page: number | null, g?: PlanGeometry): Wall {
  const w = (f.x1 - f.x0) * k, h = (f.y1 - f.y0) * k;
  const x0 = f.x0 * k, y0 = f.y0 * k;
  let horizontal = w >= h;
  // Короткий «обрезок» (у дверей, в углах): направление берём у соседней стены, чья ось проходит через заливку.
  if (g && Math.max(w, h) / Math.min(w, h) < 2.5) {
    const cx = x0 + w / 2, cy = y0 + h / 2;
    const near = g.walls.find((x) => {
      const vertical = Math.abs(x.a.x - x.b.x) < 1;
      const horiz = Math.abs(x.a.y - x.b.y) < 1;
      const reach = 1500; // соседняя стена может быть за дверным проёмом
      if (vertical && Math.abs(x.a.x - cx) < w / 2) return Math.min(Math.abs(cy - x.a.y), Math.abs(cy - x.b.y)) < reach || (cy - x.a.y) * (cy - x.b.y) < 0;
      if (horiz && Math.abs(x.a.y - cy) < h / 2) return Math.min(Math.abs(cx - x.a.x), Math.abs(cx - x.b.x)) < reach || (cx - x.a.x) * (cx - x.b.x) < 0;
      return false;
    });
    if (near) horizontal = Math.abs(near.a.y - near.b.y) < 1;
  }
  const a = horizontal ? { x: round(x0), y: round(y0 + h / 2) } : { x: round(x0 + w / 2), y: round(y0) };
  const b = horizontal ? { x: round(x0 + w), y: round(y0 + h / 2) } : { x: round(x0 + w / 2), y: round(y0 + h) };
  return { id: uid('w'), a, b, thickness: round(horizontal ? h : w), kind: 'unknown', source: 'suggested', verifiedByManager: false, sourcePage: page };
}

export function nearestWall(g: PlanGeometry, p: Pt, maxDist = 400): { wall: Wall; t: number; point: Pt; dist: number } | null {
  let best: { wall: Wall; t: number; point: Pt; dist: number } | null = null;
  for (const w of g.walls) {
    const pr = projectOnSegment(p, w.a, w.b);
    if (pr.dist <= Math.max(maxDist, w.thickness / 2 + 50) && (!best || pr.dist < best.dist)) best = { wall: w, ...pr };
  }
  return best;
}

/** Точка на оси стены (проекция). */
function onAxis(w: Wall, p: Pt): Pt {
  const d = norm(sub(w.b, w.a));
  return add(w.a, mul(d, dot(sub(p, w.a), d)));
}

/**
 * Дверь по дуге открывания на чертеже: петля — центр дуги, закрытое положение полотна — конец дуги,
 * лежащий вдоль стены, открытое — второй конец.
 */
export function doorFromArc(g: PlanGeometry, arc: Arc, k: number, page: number | null): Opening | null {
  const H = mul(arc.center, k), S = mul(arc.start, k), E = mul(arc.end, k);
  const near = nearestWall(g, H, 300);
  const dir = near ? norm(sub(near.wall.b, near.wall.a)) : null;
  let closed = S, open = E;
  if (dir) {
    const aS = Math.abs(dot(norm(sub(S, H)), dir)), aE = Math.abs(dot(norm(sub(E, H)), dir));
    if (aE > aS) { closed = E; open = S; }
  } else if (Math.abs(S.y - H.y) > Math.abs(E.y - H.y)) { closed = E; open = S; }
  let a = near ? onAxis(near.wall, H) : H;
  let b = near ? onAxis(near.wall, closed) : closed;
  // Подтянуть откосы к торцам стен рядом (дуга обычно чуть меньше проёма).
  const ends = g.walls.flatMap((w) => [w.a, w.b]);
  const snapEnd = (p: Pt, r: number) => ends.filter((e) => dist(e, p) < r).sort((x, y) => dist(x, p) - dist(y, p))[0];
  const ea = snapEnd(a, 120), eb = snapEnd(b, 160);
  if (ea) a = ea;
  if (eb) b = eb;
  const n = leftNormal(norm(sub(b, a)));
  const swing: 1 | -1 = dot(sub(open, H), n) >= 0 ? 1 : -1;
  return {
    id: uid('d'), type: 'door', a: { x: round(a.x), y: round(a.y) }, b: { x: round(b.x), y: round(b.y) },
    thickness: near ? near.wall.thickness : 150, hinge: 'a', swing, isEntrance: false, sillHeight: null,
    source: 'suggested', verifiedByManager: false, sourcePage: page,
  };
}

/** Проём по двум кликам: толщина — от ближайшей стены, откосы на её оси. */
export function openingFromClicks(g: PlanGeometry, p1: Pt, p2: Pt, type: 'door' | 'window', page: number | null): Opening {
  const mid = mul(add(p1, p2), 0.5);
  const near = nearestWall(g, mid, 400);
  const a = near ? onAxis(near.wall, p1) : p1, b = near ? onAxis(near.wall, p2) : p2;
  return {
    id: uid(type === 'door' ? 'd' : 'o'), type, a: { x: round(a.x), y: round(a.y) }, b: { x: round(b.x), y: round(b.y) },
    thickness: near ? near.wall.thickness : 150, hinge: 'a', swing: 1, isEntrance: false, sillHeight: null,
    source: 'manual', verifiedByManager: false, sourcePage: page,
  };
}

export type SnapKind = 'geometry' | 'vector-point' | 'vector-line' | 'ortho' | 'none';

export interface SnapResult { p: Pt; kind: SnapKind }

/** Привязка курсора: точки разметки → точки чертежа → ортогональ → линии чертежа. */
export function snapPoint(raw: Pt, opts: { g: PlanGeometry; k: number; index: SnapIndex | null; radiusMm: number; anchor: Pt | null; ortho: boolean; vectors: boolean }): SnapResult {
  const { g, k, index, radiusMm, anchor, ortho } = opts;
  const geomPts: Pt[] = [
    ...g.walls.flatMap((w) => [w.a, w.b, ...wallPolygon(w)]),
    ...g.openings.flatMap((o) => [o.a, o.b]),
    ...g.rooms.flatMap((r) => r.polygon),
  ];
  let best: Pt | null = null, bd = radiusMm;
  for (const q of geomPts) { const d = dist(q, raw); if (d < bd) { bd = d; best = q; } }
  if (best) return { p: best, kind: 'geometry' };
  if (index && opts.vectors) {
    const vp = index.nearestPoint(mul(raw, 1 / k), radiusMm / k);
    if (vp) return { p: mul(vp, k), kind: 'vector-point' };
  }
  if (anchor && ortho) {
    const dx = raw.x - anchor.x, dy = raw.y - anchor.y;
    const p = Math.abs(dx) >= Math.abs(dy) ? { x: raw.x, y: anchor.y } : { x: anchor.x, y: raw.y };
    return { p, kind: 'ortho' };
  }
  if (index && opts.vectors) {
    const vl = index.nearestOnSegment(mul(raw, 1 / k), radiusMm / k);
    if (vl) return { p: mul(vl, k), kind: 'vector-line' };
  }
  return { p: raw, kind: 'none' };
}

/** Заливки, похожие на стены: серые, не белые и не чёрные. */
export function isWallFill(color: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(color);
  if (!m) return false;
  const [r, gg, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return Math.abs(r - gg) < 12 && Math.abs(gg - b) < 12 && r > 60 && r < 245;
}
