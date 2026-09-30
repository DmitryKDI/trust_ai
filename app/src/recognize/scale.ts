// Автомасштаб по размерным числам: число N рядом с параллельным отрезком длины L → N/L мм на единицу.
// Берём самую многочисленную группу совпадающих отношений.
import type { Pt } from '../model/types';
import type { Seg } from '../pdf/vectors';
import { numbers, type TextBox } from '../pdf/text';

export interface ScaleGuess { k: number; support: number; p1: Pt; p2: Pt; mm: number }

export function scaleFromDimensions(texts: TextBox[], segs: Seg[]): ScaleGuess | null {
  const cands: { k: number; p1: Pt; p2: Pt; mm: number }[] = [];
  const axisSegs = segs.filter((s) => Math.abs(s.a.x - s.b.x) < 0.05 || Math.abs(s.a.y - s.b.y) < 0.05);
  for (const { value, box } of numbers(texts)) {
    if (value < 250 || value > 30000) continue;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const th = box.vertical ? box.x1 - box.x0 : box.y1 - box.y0;
    let best: Seg | null = null, bd = Infinity;
    for (const s of axisSegs) {
      const horiz = Math.abs(s.a.y - s.b.y) < 0.05;
      if (horiz === box.vertical) continue;
      const lo = horiz ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y), hi = horiz ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y);
      const along = horiz ? cx : cy, off = horiz ? Math.abs(s.a.y - cy) : Math.abs(s.a.x - cx);
      if (along < lo || along > hi || off > th * 2.2 || hi - lo < th * 1.5) continue;
      if (off < bd) { bd = off; best = s; }
    }
    if (!best) continue;
    const L = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
    cands.push({ k: value / L, p1: best.a, p2: best.b, mm: value });
  }
  if (cands.length < 2) return null;
  let bestGroup: typeof cands = [];
  for (const c of cands) {
    const g = cands.filter((o) => Math.abs(o.k - c.k) / c.k < 0.015);
    if (g.length > bestGroup.length) bestGroup = g;
  }
  if (bestGroup.length < 3 && bestGroup.length < cands.length * 0.5) return null;
  const ks = bestGroup.map((c) => c.k).sort((a, b) => a - b);
  const k = ks[Math.floor(ks.length / 2)];
  const ref = bestGroup.reduce((a, c) => (c.mm > a.mm ? c : a));
  return { k, support: bestGroup.length, p1: ref.p1, p2: ref.p2, mm: ref.mm };
}
