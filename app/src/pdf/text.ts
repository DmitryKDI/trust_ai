// Текст страницы PDF в единицах листа (viewport pdf.js, ось Y вниз): для масштаба по размерам,
// подписей помещений и чтобы стирать текст перед поиском стен.

export interface TextBox { str: string; x0: number; y0: number; x1: number; y1: number; vertical: boolean }

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

export interface RawTextItem { str: string; transform: number[]; width: number; height: number }

export function textBoxes(items: RawTextItem[], viewport: number[]): TextBox[] {
  const out: TextBox[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const m = mul(viewport as M, it.transform as M);
    // В текстовом пространстве размер кегля = 1: ширина строки = width / кегль, высота ≈ 0,9 кегля.
    const wLocal = it.width / (Math.hypot(it.transform[0], it.transform[1]) || 1);
    const pts = [[0, 0], [wLocal, 0], [wLocal, 0.9], [0, 0.9]]
      .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    out.push({ str: it.str, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), vertical: Math.abs(m[1]) > Math.abs(m[0]) });
  }
  return out;
}

/** Склеить соседние куски одного числа («5» «000» → «5000»). */
export function numbers(boxes: TextBox[]): { value: number; box: TextBox }[] {
  const nums = boxes.filter((b) => /^[\d\s  ,.]+$/.test(b.str) && /\d/.test(b.str));
  const used = new Set<TextBox>();
  const out: { value: number; box: TextBox }[] = [];
  const sorted = nums.slice().sort((a, b) => (a.vertical === b.vertical ? (a.vertical ? a.y0 - b.y0 : a.x0 - b.x0) : 0));
  for (const b of sorted) {
    if (used.has(b)) continue;
    let cur = { ...b };
    used.add(b);
    for (;;) {
      const h = cur.vertical ? cur.x1 - cur.x0 : cur.y1 - cur.y0;
      const nb = sorted.find((o) => !used.has(o) && o.vertical === cur.vertical && (cur.vertical
        ? Math.abs(o.x0 - cur.x0) < h * 0.3 && Math.abs(o.y1 - cur.y0) < h * 0.8 || Math.abs(o.x0 - cur.x0) < h * 0.3 && Math.abs(o.y0 - cur.y1) < h * 0.8
        : Math.abs(o.y0 - cur.y0) < h * 0.3 && o.x0 - cur.x1 < h * 0.8 && o.x0 >= cur.x1 - h * 0.2));
      if (!nb) break;
      used.add(nb);
      cur = { str: cur.str + nb.str, x0: Math.min(cur.x0, nb.x0), y0: Math.min(cur.y0, nb.y0), x1: Math.max(cur.x1, nb.x1), y1: Math.max(cur.y1, nb.y1), vertical: cur.vertical };
    }
    const v = Number(cur.str.replace(/[\s  ]/g, '').replace(',', '.'));
    if (Number.isFinite(v)) out.push({ value: v, box: cur });
  }
  return out;
}
