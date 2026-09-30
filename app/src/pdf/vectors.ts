// Векторы страницы PDF для привязки при разметке: отрезки, прямоугольные заливки (стены на чертеже)
// и дуги (открывание дверей). Координаты — в единицах листа (pt, ось Y вниз, как во viewport pdf.js).
import type { Pt } from '../model/types';

export interface Seg { a: Pt; b: Pt; color: string; width: number }
export interface FillRect { x0: number; y0: number; x1: number; y1: number; color: string }
export interface Arc { center: Pt; r: number; start: Pt; end: Pt }

export interface PageVectors {
  width: number;
  height: number;
  segments: Seg[];
  fills: FillRect[];
  arcs: Arc[];
  /** Уникальные концы отрезков и углы заливок — точки привязки. */
  points: Pt[];
}

type M = [number, number, number, number, number, number];
const mulM = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Коды операций pdf.js, нужные разбору (передаются снаружи, чтобы модуль не зависел от сборки pdf.js). */
export interface OpsCodes {
  save: number; restore: number; transform: number; constructPath: number;
  setStrokeRGBColor: number; setFillRGBColor: number; setLineWidth: number;
  stroke: number; closeStroke: number; fill: number; eoFill: number; fillStroke: number; eoFillStroke: number;
  closeFillStroke: number; closeEOFillStroke: number;
}

// DrawOPS внутри Float32Array пути (pdf.js ≥ 5).
const MOVE = 0, LINE = 1, CURVE = 2, QUAD = 3, CLOSE = 4;

const hex = (c: unknown): string => {
  if (typeof c === 'string') return c.toLowerCase();
  if (Array.isArray(c) || ArrayBuffer.isView(c)) {
    const a = Array.from(c as ArrayLike<number>);
    return '#' + a.slice(0, 3).map((v) => Math.round(v > 1 ? v : v * 255).toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
};

export function parseOperatorList(fnArray: number[], argsArray: unknown[][], ops: OpsCodes, viewport: M, width: number, height: number): PageVectors {
  const segments: Seg[] = [];
  const fills: FillRect[] = [];
  const arcs: Arc[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: M; stroke: string; fill: string; lw: number }[] = [];
  let stroke = '#000000', fill = '#000000', lw = 1;

  for (let k = 0; k < fnArray.length; k++) {
    const fn = fnArray[k];
    const args = argsArray[k] as unknown[];
    if (fn === ops.save) stack.push({ ctm, stroke, fill, lw });
    else if (fn === ops.restore) { const s = stack.pop(); if (s) ({ ctm, stroke, fill, lw } = s); }
    else if (fn === ops.transform) ctm = mulM(ctm, args as unknown as M);
    else if (fn === ops.setStrokeRGBColor) stroke = hex(typeof args[0] === 'string' ? args[0] : args);
    else if (fn === ops.setFillRGBColor) fill = hex(typeof args[0] === 'string' ? args[0] : args);
    else if (fn === ops.setLineWidth) lw = Number(args[0]);
    else if (fn === ops.constructPath) {
      const paint = args[0] as number;
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!data) continue;
      const isStroke = [ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(paint);
      const isFill = [ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(paint);
      if (!isStroke && !isFill) continue; // обрезки (clip) и endPath
      const full = mulM(viewport, ctm);
      const T = (x: number, y: number) => apply(full, x, y);
      const scale = Math.hypot(full[0], full[1]);
      const polys: Pt[][] = [];
      let cur: Pt[] = [];
      let start: Pt | null = null;
      let last: Pt | null = null;
      for (let i = 0; i < data.length;) {
        const op = data[i++];
        if (op === MOVE) {
          if (cur.length > 1) polys.push(cur);
          last = start = T(data[i], data[i + 1]); i += 2;
          cur = [last];
        } else if (op === LINE) {
          const p = T(data[i], data[i + 1]); i += 2;
          if (isStroke && last) segments.push({ a: last, b: p, color: stroke, width: lw * scale });
          cur.push(p);
          last = p;
        } else if (op === CURVE) {
          const c1 = T(data[i], data[i + 1]), c2 = T(data[i + 2], data[i + 3]), p = T(data[i + 4], data[i + 5]); i += 6;
          if (isStroke && last) {
            const arc = arcFromBezier(last, c1, c2, p);
            if (arc) arcs.push(arc);
          }
          cur.push(p);
          last = p;
        } else if (op === QUAD) {
          const p = T(data[i + 2], data[i + 3]); i += 4;
          cur.push(p);
          last = p;
        } else if (op === CLOSE) {
          if (isStroke && last && start) segments.push({ a: last, b: start, color: stroke, width: lw * scale });
          last = start;
        } else break;
      }
      if (cur.length > 1) polys.push(cur);
      if (isFill) for (const p of polys) {
        const r = axisRect(p);
        if (r) fills.push({ ...r, color: fill });
      }
    }
  }
  return { width, height, segments, fills, arcs, points: snapPoints(segments, fills) };
}

function axisRect(p: Pt[]): Omit<FillRect, 'color'> | null {
  const pts = p.length > 4 && Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) < 0.01 ? p.slice(0, -1) : p;
  if (pts.length < 3 || pts.length > 4) return null;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return null;
  // Все вершины на сторонах прямоугольника; треугольники (половинки угловых квадратов) тоже подходят.
  if (!pts.every((q) => (Math.abs(q.x - x0) < 0.05 || Math.abs(q.x - x1) < 0.05) && (Math.abs(q.y - y0) < 0.05 || Math.abs(q.y - y1) < 0.05))) return null;
  return { x0, y0, x1, y1 };
}

/** Окружность через начало, середину и конец кубической кривой (дуга двери ≈ четверть окружности). */
function arcFromBezier(p0: Pt, c1: Pt, c2: Pt, p3: Pt): Arc | null {
  const m = { x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x, y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y };
  const d = 2 * (p0.x * (m.y - p3.y) + m.x * (p3.y - p0.y) + p3.x * (p0.y - m.y));
  if (Math.abs(d) < 1e-9) return null;
  const s0 = p0.x ** 2 + p0.y ** 2, s1 = m.x ** 2 + m.y ** 2, s2 = p3.x ** 2 + p3.y ** 2;
  const center = { x: (s0 * (m.y - p3.y) + s1 * (p3.y - p0.y) + s2 * (p0.y - m.y)) / d, y: (s0 * (p3.x - m.x) + s1 * (p0.x - p3.x) + s2 * (m.x - p0.x)) / d };
  const r = Math.hypot(p0.x - center.x, p0.y - center.y);
  if (r < 5 || r > 200) return null; // в pt: от ~0,1 до ~3,5 м в масштабе 1:50
  return { center, r, start: p0, end: p3 };
}

function snapPoints(segments: Seg[], fills: FillRect[]): Pt[] {
  const seen = new Set<string>();
  const out: Pt[] = [];
  const add = (p: Pt) => {
    const k = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  };
  for (const s of segments) { add(s.a); add(s.b); }
  for (const f of fills) { add({ x: f.x0, y: f.y0 }); add({ x: f.x1, y: f.y0 }); add({ x: f.x1, y: f.y1 }); add({ x: f.x0, y: f.y1 }); }
  return out;
}

/** Пространственный индекс точек и отрезков для привязки курсора. */
export class SnapIndex {
  private cells = new Map<string, number[]>();
  private segCells = new Map<string, number[]>();
  constructor(readonly v: PageVectors, readonly cell = 10) {
    v.points.forEach((p, i) => this.push(this.cells, this.key(p.x, p.y), i));
    v.segments.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell), x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
      const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell), y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return; // слишком длинные (рамки листа) не индексируем
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.push(this.segCells, `${x},${y}`, i);
    });
  }
  private key(x: number, y: number) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  private push(m: Map<string, number[]>, k: string, i: number) { const a = m.get(k); if (a) a.push(i); else m.set(k, [i]); }
  private around<T>(m: Map<string, number[]>, p: Pt, r: number, list: T[]): T[] {
    const out: T[] = [];
    const seen = new Set<number>();
    const c = Math.ceil(r / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell);
    for (let x = cx - c; x <= cx + c; x++) for (let y = cy - c; y <= cy + c; y++)
      for (const i of m.get(`${x},${y}`) ?? []) if (!seen.has(i)) { seen.add(i); out.push(list[i]); }
    return out;
  }
  /** Ближайшая точка привязки в радиусе r (единицы листа). */
  nearestPoint(p: Pt, r: number): Pt | null {
    let best: Pt | null = null, bd = r;
    for (const q of this.around(this.cells, p, r, this.v.points)) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  /** Проекция на ближайший отрезок в радиусе r. */
  nearestOnSegment(p: Pt, r: number): Pt | null {
    let best: Pt | null = null, bd = r;
    for (const s of this.around(this.segCells, p, r, this.v.segments)) {
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2));
      const q = { x: s.a.x + dx * t, y: s.a.y + dy * t };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  /** Прямоугольная заливка под курсором (стена на чертеже). */
  fillAt(p: Pt, colorFilter?: (c: string) => boolean): FillRect | null {
    let best: FillRect | null = null;
    for (const f of this.v.fills) {
      if (p.x < f.x0 || p.x > f.x1 || p.y < f.y0 || p.y > f.y1) continue;
      if (colorFilter && !colorFilter(f.color)) continue;
      const w = Math.min(f.x1 - f.x0, f.y1 - f.y0), l = Math.max(f.x1 - f.x0, f.y1 - f.y0);
      if (l < 2 || w > 60) continue; // не стена: слишком мелко или слишком толсто (заливка помещения/рамки)
      if (!best || (f.x1 - f.x0) * (f.y1 - f.y0) < (best.x1 - best.x0) * (best.y1 - best.y0)) best = f;
    }
    return best;
  }
  /** Дуга двери рядом с точкой. */
  arcNear(p: Pt, r: number): Arc | null {
    let best: Arc | null = null, bd = r;
    for (const a of this.v.arcs) {
      const d = Math.min(Math.abs(Math.hypot(p.x - a.center.x, p.y - a.center.y) - a.r), Math.hypot(p.x - a.center.x, p.y - a.center.y));
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}
