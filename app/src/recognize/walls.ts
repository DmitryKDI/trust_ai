// Маска стен → прямоугольники стен (оси и толщины). Работает в пикселях.
import type { Bin } from './raster';

export interface PxRect { x0: number; y0: number; x1: number; y1: number; horizontal: boolean }

const len = (r: PxRect) => (r.horizontal ? r.x1 - r.x0 + 1 : r.y1 - r.y0 + 1);
const thick = (r: PxRect) => (r.horizontal ? r.y1 - r.y0 + 1 : r.x1 - r.x0 + 1);

/**
 * Полосы одного направления: последовательные строки (или столбцы) с почти одинаковыми
 * отрезками «чернил» объединяются в прямоугольник. Оставляем вытянутые прямоугольники.
 */
function strips(b: Bin, horizontal: boolean, minLen: number, minThick: number, tol: number): PxRect[] {
  const lines = horizontal ? b.h : b.w, n = horizontal ? b.w : b.h;
  const at = (line: number, i: number) => (horizontal ? line * b.w + i : i * b.w + line);
  let open: { a: number; z: number; from: number; to: number }[] = [];
  const done: { a: number; z: number; from: number; to: number }[] = [];
  for (let line = 0; line < lines; line++) {
    const runs: [number, number][] = [];
    for (let i = 0; i < n;) {
      if (!b.d[at(line, i)]) { i++; continue; }
      const s = i;
      while (i < n && b.d[at(line, i)]) i++;
      if (i - s >= minLen) runs.push([s, i - 1]);
    }
    const next: typeof open = [];
    const used = new Set<number>();
    for (const [s, e] of runs) {
      const k = open.findIndex((o, idx) => !used.has(idx) && Math.abs(o.a - s) <= tol && Math.abs(o.z - e) <= tol);
      if (k >= 0) {
        used.add(k);
        const o = open[k];
        next.push({ a: Math.min(o.a, s), z: Math.max(o.z, e), from: o.from, to: line });
      } else next.push({ a: s, z: e, from: line, to: line });
    }
    open.forEach((o, idx) => { if (!used.has(idx)) done.push(o); });
    open = next;
  }
  done.push(...open);
  const out: PxRect[] = [];
  for (const o of done) {
    const r: PxRect = horizontal
      ? { x0: o.a, x1: o.z, y0: o.from, y1: o.to, horizontal }
      : { x0: o.from, x1: o.to, y0: o.a, y1: o.z, horizontal };
    // Длина не меньше толщины: оставляем и короткие обрезки у дверей (иначе проём не закроется).
    if (thick(r) >= minThick && len(r) >= thick(r)) out.push(r);
  }
  return out;
}

/** Слить соседние полосы одной стены (разбитые на несколько из-за примыканий). */
function mergeSame(rs: PxRect[], tol: number): PxRect[] {
  const list = rs.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        if (a.horizontal !== c.horizontal) continue;
        const [a0, a1, at0, at1] = a.horizontal ? [a.x0, a.x1, a.y0, a.y1] : [a.y0, a.y1, a.x0, a.x1];
        const [c0, c1, ct0, ct1] = c.horizontal ? [c.x0, c.x1, c.y0, c.y1] : [c.y0, c.y1, c.x0, c.x1];
        // та же стена: соприкасаются по толщине и почти совпадают по длине
        const touch = ct0 <= at1 + 1 && at0 <= ct1 + 1;
        const same = Math.abs(a0 - c0) <= tol * 3 && Math.abs(a1 - c1) <= tol * 3;
        if (touch && same) {
          list[i] = a.horizontal
            ? { horizontal: true, x0: Math.min(a0, c0), x1: Math.max(a1, c1), y0: Math.min(at0, ct0), y1: Math.max(at1, ct1) }
            : { horizontal: false, y0: Math.min(a0, c0), y1: Math.max(a1, c1), x0: Math.min(at0, ct0), x1: Math.max(at1, ct1) };
          list.splice(j, 1);
          changed = true;
          break outer;
        }
      }
  }
  return list;
}

export function wallRects(mask: Bin, minLen: number, minThick: number, tol = 2): PxRect[] {
  const h = mergeSame(strips(mask, true, minLen, minThick, tol), tol);
  const v = mergeSame(strips(mask, false, minLen, minThick, tol), tol);
  return [...h, ...v];
}

export { len as rectLen, thick as rectThick };
