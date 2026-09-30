// Растровые операции для распознавания плана (чистые функции, O(N) на пиксель).
// Бинарная маска — Uint8Array (1 — «чернила»), w × h.

export interface Bin { w: number; h: number; d: Uint8Array }

export function newBin(w: number, h: number): Bin {
  return { w, h, d: new Uint8Array(w * h) };
}

/**
 * «Чернила» изображения RGBA: тёмные и серые пиксели. Насыщенные цвета (размеры, подписи,
 * радиаторы обычно цветные) не считаются стенами.
 */
export function inkMask(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 0.1, maxSat = 0.35): Bin {
  const out = newBin(w, h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2], a = rgba[p + 3] ?? 255;
    if (a < 128) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat > maxSat && mx > 60) continue;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    if ((255 - gray) / 255 > threshold) out.d[i] = 1;
  }
  return out;
}

/** Стереть прямоугольники (текст): x0,y0,x1,y1 в пикселях. */
export function clearBoxes(b: Bin, boxes: [number, number, number, number][], pad = 1) {
  for (const [x0, y0, x1, y1] of boxes) {
    const a0 = Math.max(0, Math.floor(x0) - pad), a1 = Math.min(b.w - 1, Math.ceil(x1) + pad);
    const c0 = Math.max(0, Math.floor(y0) - pad), c1 = Math.min(b.h - 1, Math.ceil(y1) + pad);
    for (let y = c0; y <= c1; y++) b.d.fill(0, y * b.w + a0, y * b.w + a1 + 1);
  }
}

/** Одномерный проход «хотя бы один» (dilate) или «все» (erode) в окне k по строкам или столбцам. */
function pass(src: Bin, k: number, horizontal: boolean, mode: 'dil' | 'ero'): Bin {
  const { w, h } = src;
  const out = newBin(w, h);
  const r = Math.floor(k / 2);
  const lines = horizontal ? h : w, len = horizontal ? w : h;
  const at = (line: number, i: number) => (horizontal ? line * w + i : i * w + line);
  const pre = new Int32Array(len + 1);
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src.d[at(line, i)];
    for (let i = 0; i < len; i++) {
      const a = Math.max(0, i - r), b = Math.min(len - 1, i + (k - 1 - r));
      const s = pre[b + 1] - pre[a];
      // за границей изображения — фон (для эрозии это «нет»)
      const full = b - a + 1 === k;
      out.d[at(line, i)] = mode === 'dil' ? (s > 0 ? 1 : 0) : (full && s === k ? 1 : 0);
    }
  }
  return out;
}

/** Закрытие только вдоль одного направления: заполняет просвет между двумя параллельными линиями стены. */
export function closeDir(b: Bin, k: number, horizontal: boolean): Bin {
  return k <= 1 ? b : pass(pass(b, k, horizontal, 'dil'), k, horizontal, 'ero');
}

export function or(a: Bin, ...bs: Bin[]): Bin {
  const out = newBin(a.w, a.h);
  for (let i = 0; i < out.d.length; i++) {
    let v = a.d[i];
    for (const b of bs) v |= b.d[i];
    out.d[i] = v;
  }
  return out;
}

export const dilate = (b: Bin, k: number) => (k <= 1 ? b : pass(pass(b, k, true, 'dil'), k, false, 'dil'));
export const erode = (b: Bin, k: number) => (k <= 1 ? b : pass(pass(b, k, true, 'ero'), k, false, 'ero'));
/** Закрытие — заполняет штриховку и мелкие разрывы. */
export const close = (b: Bin, k: number) => erode(dilate(b, k), k);
/** Открытие — убирает тонкие линии (размеры, текст, контуры мебели). */
export const open = (b: Bin, k: number) => dilate(erode(b, k), k);

export interface Component { id: number; area: number; x0: number; y0: number; x1: number; y1: number }

/** Связные компоненты (4-связность). Возвращает метки и сводку. */
export function components(b: Bin): { labels: Int32Array; comps: Component[] } {
  const { w, h, d } = b;
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (!d[s] || labels[s]) continue;
    const id = ++next;
    const c: Component = { id, area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x > 0 && d[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && d[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && d[p - w] && !labels[p - w]) { labels[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && d[p + w] && !labels[p + w]) { labels[p + w] = id; stack.push(p + w); }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Оставить только компоненты, для которых keep(c) = true. */
export function filterComponents(b: Bin, keep: (c: Component, largest: Component) => boolean): Bin {
  const { labels, comps } = components(b);
  if (!comps.length) return b;
  const largest = comps.reduce((a, c) => (c.area > a.area ? c : a));
  const ok = new Uint8Array(comps.length + 1);
  for (const c of comps) ok[c.id] = keep(c, largest) ? 1 : 0;
  const out = newBin(b.w, b.h);
  for (let i = 0; i < labels.length; i++) if (labels[i] && ok[labels[i]]) out.d[i] = 1;
  return out;
}

export function countOnes(b: Bin, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  for (let y = Math.max(0, y0); y <= Math.min(b.h - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(b.w - 1, x1); x++) s += b.d[y * b.w + x];
  return s;
}
