// Анализ стен помещения для расстановки: отрезки контура, внутренняя нормаль,
// участки с дверями и окнами. Параметр s — расстояние вдоль отрезка от его начала, мм.
import type { Opening, Pt, Rot } from '../model/types';
import { add, dist, dot, mul, norm, pointInPolygon, sub } from '../geometry/poly';

export interface Interval { s0: number; s1: number; openingId: string }

export interface RoomEdge {
  index: number;
  a: Pt;
  b: Pt;
  len: number;
  dir: Pt;
  inward: Pt;
  doors: Interval[];
  windows: Interval[];
}

/** Поворот предмета, при котором его спинка прижата к стене с данной внутренней нормалью. */
export function backRot(inward: Pt): Rot | null {
  if (Math.abs(inward.y - 1) < 1e-6) return 0;
  if (Math.abs(inward.x + 1) < 1e-6) return 90;
  if (Math.abs(inward.y + 1) < 1e-6) return 180;
  if (Math.abs(inward.x - 1) < 1e-6) return 270;
  return null; // наклонные стены пока не поддерживаются движком
}

/** Повороты, при которых к стене прижат бок предмета (локальная ось x вдоль нормали). */
export function sideRots(inward: Pt): Rot[] {
  const r = backRot(inward);
  if (r === null) return [];
  return [((r + 90) % 360) as Rot, ((r + 270) % 360) as Rot];
}

export function roomEdges(poly: Pt[], openings: Opening[], minLen = 300): RoomEdge[] {
  const edges: RoomEdge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = dist(a, b);
    if (len < minLen) continue;
    const dir = norm(sub(b, a));
    const n1 = { x: dir.y, y: -dir.x };
    const mid = mul(add(a, b), 0.5);
    const inward = pointInPolygon(add(mid, mul(n1, 20)), poly) ? n1 : mul(n1, -1);
    const e: RoomEdge = { index: i, a, b, len, dir, inward, doors: [], windows: [] };
    for (const o of openings) {
      const od = norm(sub(o.b, o.a));
      if (Math.abs(Math.abs(dot(od, dir)) - 1) > 1e-3) continue; // не параллелен
      const om = mul(add(o.a, o.b), 0.5);
      const off = dot(sub(om, a), inward);
      // Проём лежит в стене, грань которой — этот отрезок (центр проёма снаружи на толщину/2).
      if (Math.abs(off + o.thickness / 2) > Math.max(60, o.thickness * 0.35)) continue;
      const sa = dot(sub(o.a, a), dir), sb = dot(sub(o.b, a), dir);
      const s0 = Math.max(0, Math.min(sa, sb)), s1 = Math.min(len, Math.max(sa, sb));
      if (s1 - s0 < 50) continue;
      (o.type === 'door' ? e.doors : e.windows).push({ s0, s1, openingId: o.id });
    }
    edges.push(e);
  }
  return edges;
}

export function overlaps(a0: number, a1: number, list: Interval[], pad = 0): boolean {
  return list.some((iv) => a0 < iv.s1 + pad && iv.s0 - pad < a1);
}

/** Свободные участки отрезка между дверями (и окнами, если avoidWindows). */
export function freeSpans(e: RoomEdge, jamb: number, avoidWindows: boolean): [number, number][] {
  const cuts = [...e.doors.map((d) => [d.s0 - jamb, d.s1 + jamb]), ...(avoidWindows ? e.windows.map((w) => [w.s0 - 50, w.s1 + 50]) : [])]
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [c0, c1] of cuts) {
    if (c0 > cur) out.push([cur, Math.min(c0, e.len)]);
    cur = Math.max(cur, c1);
  }
  if (cur < e.len) out.push([cur, e.len]);
  return out.filter(([s0, s1]) => s1 - s0 > 100);
}

export function pointAt(e: RoomEdge, s: number): Pt {
  return add(e.a, mul(e.dir, s));
}
