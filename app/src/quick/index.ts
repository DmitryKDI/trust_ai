// Быстрый режим для сканов, фото и скриншотов плана: ищем не стены, а светлые комнаты
// («заливка»), делим их по узким дверным проёмам, строим контуры, двери и чистую стилизованную подложку.
import type { Opening, PlanGeometry, Pt, Room } from '../model/types';
import { emptyGeometry, uid } from '../model/defaults';
import { closeDir, components, dilate, erode, newBin, or, type Bin } from '../recognize/raster';
import { assignTypes } from '../recognize/index';
import { difference, intersection, pointInGeom, simplifyRing, union, fromRing, toGeom, polyArea } from '../geometry/poly';
import { scaleGeometry } from '../editor/ops';

export interface QuickInput {
  rgba: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
  /** Пикселей распознавания на единицу листа (подложки). */
  pxPerUnit: number;
  /** Общая площадь квартиры, м² (с плана БТИ). Без неё — типовые 55 м². */
  areaM2: number | null;
  children: number;
  page: number | null;
}

export interface QuickResult {
  geometry: PlanGeometry;
  /** Маска стен для стилизованной подложки: белые стены на прозрачном фоне (RGBA). */
  wallsMask: { rgba: Uint8ClampedArray; w: number; h: number };
  report: { rooms: { name: string; type: string; areaM2: number }[]; doors: number; entrance: boolean; pxPerM: number; areaAssumed: boolean; scaleMethod: 'area' | 'doors' | 'assumed'; notes: string[]; ms: number };
}

const prov = (page: number | null) => ({ source: 'suggested' as const, verifiedByManager: false, sourcePage: page });

/**
 * Цвет «бумаги»: самый частый светлый малонасыщенный тон (на фото листа он серый, а не белый),
 * затем медиана пикселей рядом с ним.
 */
function paperColor(d: Uint8ClampedArray | Uint8Array, n: number): [number, number, number] {
  const lum = new Uint32Array(64);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 30) { const l = (r + g + b) / 3; if (l >= 120) lum[l >> 2]++; }
  }
  let mode = -1;
  for (let v = 0; v < 64; v++) if (lum[v] && (mode < 0 || lum[v] > lum[mode])) mode = v;
  if (mode < 0) return [245, 245, 245];
  const L = mode * 4 + 2;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let cnt = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 30 && Math.abs((r + g + b) / 3 - L) <= 12) { hist[0][r]++; hist[1][g]++; hist[2][b]++; cnt++; }
  }
  const med = (h: Uint32Array) => { let s = 0; for (let v = 0; v < 256; v++) { s += h[v]; if (s >= cnt / 2) return v; } return 245; };
  return cnt ? [med(hist[0]), med(hist[1]), med(hist[2])] : [245, 245, 245];
}

const openBin = (b: Bin, k: number) => dilate(erode(b, k), k);

/** Многоисточниковый рост меток по разрешённым пикселям. */
function grow(labels: Int32Array, allowed: Uint8Array, w: number, h: number, cls?: Int32Array, labelCls?: Map<number, number>) {
  let frontier: number[] = [];
  for (let i = 0; i < labels.length; i++) if (labels[i] > 0) frontier.push(i);
  while (frontier.length) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w, y = (p - x) / w, l = labels[p];
      const lc = labelCls?.get(l);
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      // Цвет заливки пола: метка не переходит на пол другого цвета (цветные планировки).
      for (const q of nb) if (q >= 0 && allowed[q] && labels[q] === 0 && (lc === undefined || !cls || cls[q] < 0 || cls[q] === lc)) { labels[q] = l; next.push(q); }
    }
    frontier = next;
  }
}

/** Контур метки на грубой сетке → прямоугольный полигон (внешнее кольцо). Нужен и быстрой правке. */
export function labelPolygon(labels: Int32Array, w: number, h: number, id: number, cell: number): Pt[] | null {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let c = 0, t = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) { t++; if (labels[y * w + x] === id) c++; }
      if (c * 2 >= t) grid[gy * gw + gx] = 1;
    }
  // Сглаживание: закрытие и открытие на 3 клетки (~0,3 м) убирают «ступеньки» от надписей и значков,
  // иначе вдоль стены не остаётся ровных участков для мебели.
  const gb: Bin = { w: gw, h: gh, d: grid };
  const sm = dilate(erode(erode(dilate(gb, 3), 3), 3), 3);
  if (sm.d.some((v) => v)) grid.set(sm.d);
  const rects: Pt[][] = [];
  for (let gy = 0; gy < gh; gy++) {
    let gx = 0;
    while (gx < gw) {
      if (!grid[gy * gw + gx]) { gx++; continue; }
      const s = gx;
      while (gx < gw && grid[gy * gw + gx]) gx++;
      rects.push([{ x: s * cell, y: gy * cell }, { x: gx * cell, y: gy * cell }, { x: gx * cell, y: (gy + 1) * cell }, { x: s * cell, y: (gy + 1) * cell }]);
    }
  }
  if (!rects.length) return null;
  const u = union(...rects.map((r) => toGeom(r)));
  if (!u.length) return null;
  const biggest = u.reduce((a, p) => (polyArea(fromRing(p[0])) > polyArea(fromRing(a[0])) ? p : a));
  // cell ≈ 0,1 м: выемки от цифр у стены — до 0,7 м шириной и 0,45 м глубиной.
  return fillDents(straighten(diagonals(simplifyRing(fromRing(biggest[0]), cell * 0.5), cell * 2.5, cell * 20, cell * 15), cell * 3), cell * 7, cell * 4.5);
}

/**
 * Скошенная стена (балкон-трапеция, эркер) на сетке становится «лесенкой»: по одной оси короткие
 * ступеньки (до minor), по другой — отрезки до major, всё в одну сторону. Лесенку из трёх и более
 * ступенек длиной больше minLen заменяем прямым отрезком через середины крайних ступенек.
 * Выравнивание углов ниже трогает только горизонтальные и вертикальные отрезки.
 */
function diagonals(poly: Pt[], minor: number, major: number, minLen: number): Pt[] {
  const n = poly.length;
  if (n < 8) return poly;
  const seg = (k: number) => { const a = poly[k % n], b = poly[(k + 1) % n]; return { dx: b.x - a.x, dy: b.y - a.y, len: Math.hypot(b.x - a.x, b.y - a.y) }; };
  let start = 0;
  for (let k = 0; k < n; k++) if (seg(k).len > seg(start).len) start = k;
  const out: Pt[] = [];
  let i = 0;
  while (i < n) {
    let j = i, maxH = 0, maxV = 0;
    const sx = new Set<number>(), sy = new Set<number>();
    while (j < n) {
      const g = seg(start + j);
      if (g.len > major) break;
      if (g.dx) sx.add(Math.sign(g.dx));
      if (g.dy) sy.add(Math.sign(g.dy));
      if (sx.size > 1 || sy.size > 1) break;
      if (Math.abs(g.dy) < 1e-6) maxH = Math.max(maxH, g.len); else maxV = Math.max(maxV, g.len);
      if (Math.min(maxH, maxV) > minor) break;
      j++;
    }
    const a = poly[(start + i) % n], b = poly[(start + j) % n];
    // Настоящий скос — длинная правильная лесенка (не меньше шести ступенек) с заметным
    // смещением по обеим осям; пара ступенек у дверного полотна или окна — не скос.
    const ex = Math.abs(b.x - a.x), ey = Math.abs(b.y - a.y);
    // Ступеньки ровно вдоль прямой: ни одна вершина не отходит от линии a–b дальше ступеньки
    // (угол комнаты с выступом у двери даёт большое отклонение).
    let dev = 0;
    const L = Math.hypot(ex, ey) || 1;
    for (let k = i + 1; k < j; k++) {
      const q = poly[(start + k) % n];
      dev = Math.max(dev, Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / L);
    }
    if (j - i >= 12 && L >= minLen && Math.min(ex, ey) >= 1.5 * minor && dev <= minor) {
      const m = (k: number) => { const p = poly[k % n], q = poly[(k + 1) % n]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
      out.push(a, m(start + i), m(start + j - 1));
      i = j;
      continue;
    }
    out.push(a);
    i++;
  }
  return out.length >= 3 ? simplifyRing(out, 0.5) : poly;
}

/**
 * Заполнение узких П-образных выемок посреди стены (цифры размеров, прижатые к стене, вырезают
 * их из помещения и сужают проходы). Выемка убирается, только если площадь от этого растёт —
 * выступы помещения не трогаются.
 */
function fillDents(poly: Pt[], maxW: number, maxD: number): Pt[] {
  let pts = poly.map((q) => ({ ...q }));
  const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
  for (let guard = 0; guard < 100 && pts.length > 4; guard++) {
    let changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const ia = i, ib = (i + 1) % n, ic = (i + 2) % n, id = (i + 3) % n;
      const a = pts[ia], b = pts[ib], c = pts[ic], d = pts[id];
      const d1 = Math.hypot(b.x - a.x, b.y - a.y), w2 = Math.hypot(c.x - b.x, c.y - b.y), d3 = Math.hypot(d.x - c.x, d.y - c.y);
      if (d1 > maxD || d3 > maxD || w2 > maxW) continue;
      // a→b и c→d — стенки выемки в противоположные стороны, b→c — её дно.
      if ((b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) >= 0) continue;
      // Концы выемки — на одной линии стены (с допуском); d выравнивается по a.
      const vertical = Math.abs(b.x - a.x) < 1e-6; // стенки выемки вертикальны → стена горизонтальна
      const off = vertical ? Math.abs(a.y - d.y) : Math.abs(a.x - d.x);
      if (off > maxD * 0.3) continue;
      const cand = pts.filter((_, j) => j !== ib && j !== ic).map((q) => ({ ...q }));
      const dj = cand.findIndex((q) => q.x === d.x && q.y === d.y);
      if (dj < 0) continue;
      if (vertical) cand[dj].y = a.y; else cand[dj].x = a.x;
      if (area(cand) <= area(pts)) continue; // это выступ, а не выемка
      pts = simplifyRing(cand, 0.5);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return pts;
}

/**
 * Выпрямление прямоугольного контура: убирает «ступеньки» короче minStep —
 * короткий отрезок между двумя параллельными соседями сдвигается на линию более длинного соседа.
 */
function straighten(poly: Pt[], minStep: number): Pt[] {
  let pts = poly.map((q) => ({ ...q }));
  for (let guard = 0; guard < 200 && pts.length > 4; guard++) {
    let changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n], d = pts[(i + 2) % n];
      const lbc = Math.hypot(c.x - b.x, c.y - b.y);
      if (lbc >= minStep) continue;
      const abH = Math.abs(a.y - b.y) < 1e-6, cdH = Math.abs(c.y - d.y) < 1e-6;
      const abV = Math.abs(a.x - b.x) < 1e-6, cdV = Math.abs(c.x - d.x) < 1e-6;
      if (!((abH && cdH) || (abV && cdV))) continue;
      const lab = Math.hypot(b.x - a.x, b.y - a.y), lcd = Math.hypot(d.x - c.x, d.y - c.y);
      if (abH) { if (lab >= lcd) { c.y = b.y; d.y = b.y; } else { a.y = c.y; b.y = c.y; } }
      else { if (lab >= lcd) { c.x = b.x; d.x = b.x; } else { a.x = c.x; b.x = c.x; } }
      pts = simplifyRing(pts, 0.5);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return pts;
}

/**
 * Порог «тонкая линия / стена» по самому плану. Толщины штрихов (удвоенное расстояние до фона
 * на гребне) дают пики: тонкие линии (сантехника, полотна дверей, текст), перегородки, несущие.
 * Ищем провал после пика тонких линий. Нет явного провала (план начерчен одной толщиной) — null.
 */
function strokeThreshold(free: Uint8Array, w: number, h: number, pxPerM: number): number | null {
  const n = w * h, dt = new Float32Array(n);
  for (let i = 0; i < n; i++) dt[i] = free[i] ? 0 : 1e9;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!dt[i]) continue; let v = dt[i];
    if (x) v = Math.min(v, dt[i - 1] + 1); if (y) v = Math.min(v, dt[i - w] + 1);
    if (x && y) v = Math.min(v, dt[i - w - 1] + 1.414); if (y && x < w - 1) v = Math.min(v, dt[i - w + 1] + 1.414);
    dt[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!dt[i]) continue; let v = dt[i];
    if (x < w - 1) v = Math.min(v, dt[i + 1] + 1); if (y < h - 1) v = Math.min(v, dt[i + w] + 1);
    if (x < w - 1 && y < h - 1) v = Math.min(v, dt[i + w + 1] + 1.414); if (y < h - 1 && x) v = Math.min(v, dt[i + w - 1] + 1.414);
    dt[i] = v;
  }
  const hist = new Float64Array(256);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = dt[i];
    if (v && v < 1e8 && v >= dt[i - 1] && v >= dt[i + 1] && v >= dt[i - w] && v >= dt[i + w]) hist[Math.min(255, Math.round(v))]++;
  }
  // Сглаживание (соседние значения) — у штрихов в JPEG толщина «гуляет».
  const sm = (t: number) => (hist[t - 1] ?? 0) + hist[t] + (hist[t + 1] ?? 0);
  // Пик тонких линий: полутолщина от 1,5 px до 6 см.
  let m1 = -1;
  for (let t = 2; t <= Math.max(2, Math.round(0.06 * pxPerM)); t++) if (m1 < 0 || sm(t) > sm(m1)) m1 = t;
  if (m1 < 0 || sm(m1) < 50) return null;
  let T = -1;
  for (let t = Math.ceil(1.5 * m1); t <= 3 * m1 && t < 255; t++) if (T < 0 || sm(t) < sm(T)) T = t;
  if (T < 0 || sm(T) > 0.35 * sm(m1)) return null;
  // Выше порога должна остаться заметная масса — стены (по площади штрихов).
  let lo = 0, hi = 0;
  for (let t = 1; t < 256; t++) (t < T ? (lo += hist[t] * t) : (hi += hist[t] * t));
  if (hi < 0.3 * (lo + hi)) return null;
  return 2 * T; // полная толщина в пикселях
}

function quickPlanCore(inp: QuickInput): QuickResult {
  const t0 = Date.now();
  const { w, h, rgba } = inp;
  const n = w * h;
  const notes: string[] = [];
  const P = paperColor(rgba, n);

  // 1. Всё, что не «бумага», — преграда (стены любого цвета, линии, текст).
  const barrier = newBin(w, h);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const dr = Math.abs(rgba[p] - P[0]), dg = Math.abs(rgba[p + 1] - P[1]), db = Math.abs(rgba[p + 2] - P[2]);
    if (Math.max(dr, dg, db) > 32) barrier.d[i] = 1;
  }
  // Цветная заливка помещений (рекламные и дизайнерские планировки): крупные однородные светлые
  // области — пол, а не стена. Тонкие светлые полосы (розовые стены техплана) открытие убирает.
  const light = newBin(w, h);
  for (let i = 0, p = 0; i < n; i++, p += 4) if (barrier.d[i] && 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2] > 140) light.d[i] = 1;
  const fill = openBin(light, Math.max(9, Math.round(Math.min(w, h) / 12)));
  // Цвет заливки решаем целиком: если заметная доля пикселей этого цвета лежит в широких
  // областях, это пол — и в узком коридоре или санузле тоже. Розовые стены техплана узкие везде,
  // их цвет остаётся стеной.
  const binOf = (p: number) => ((rgba[p] >> 4) << 8) | ((rgba[p + 1] >> 4) << 4) | (rgba[p + 2] >> 4);
  const tot = new Map<number, number>(), wide = new Map<number, number>();
  for (let i = 0, p = 0; i < n; i++, p += 4) if (light.d[i]) { const b = binOf(p); tot.set(b, (tot.get(b) ?? 0) + 1); if (fill.d[i]) wide.set(b, (wide.get(b) ?? 0) + 1); }
  const floorBin = new Set([...tot].filter(([b, t]) => t > 200 && (wide.get(b) ?? 0) >= 0.4 * t).map(([b]) => b));
  // Узкие помещения (коридор, санузел ~1 м) своей заливки «в широком» не имеют. Цвет — пол, если
  // заметная его доля лежит в областях шире ~0,6 м. Только на цветных планировках (уже есть
  // цветной пол): на техплане с белым полом широкие розовые стены — не пол.
  if (floorBin.size) {
    const mid = openBin(light, Math.max(7, Math.round(Math.min(w, h) / 20)));
    const midN = new Map<number, number>();
    for (let i = 0, p = 0; i < n; i++, p += 4) if (mid.d[i]) { const b = binOf(p); midN.set(b, (midN.get(b) ?? 0) + 1); }
    for (const [b, t] of tot) if (t > 200 && (midN.get(b) ?? 0) >= 0.4 * t) floorBin.add(b);
    // Заметная цветная (не серая) светлая заливка на цветной планировке — тоже пол: санузел с
    // сантехникой узок и в «широких» областях почти не встречается.
    // Заметная цветная (не серая) светлая заливка на цветной планировке — тоже пол: санузел и
    // коридор узки и в «широких» областях почти не встречаются. Заливка стен техплана (розовая,
    // серая) — полосы ~0,2–0,4 м: её отсекает открытие ~0,3 м.
    const nar = openBin(light, Math.max(5, Math.round(Math.min(w, h) / 36)));
    const narN = new Map<number, number>();
    for (let i = 0, p = 0; i < n; i++, p += 4) if (nar.d[i]) { const b = binOf(p); narN.set(b, (narN.get(b) ?? 0) + 1); }
    for (const [b, t] of tot) {
      const r = ((b >> 8) << 4) + 8, g = (((b >> 4) & 15) << 4) + 8, bl = ((b & 15) << 4) + 8;
      if (t >= Math.max(200, 0.002 * n) && Math.max(r, g, bl) - Math.min(r, g, bl) >= 16 && (narN.get(b) ?? 0) >= 0.5 * t) floorBin.add(b);
    }
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) if (fill.d[i] || (light.d[i] && floorBin.has(binOf(p)))) barrier.d[i] = 0;
  // Цвет пола по пикселю: заливки близких оттенков (соседние ячейки цвета — JPEG) — один цвет,
  // белая бумага — цвет 0. Мелкие пятна (текст, сглаживание на стыке цветов) — «любой» (-1).
  // На цветных планировках разный цвет пола — разные помещения.
  const cls = new Int32Array(n);
  let colored = false; // есть цветная заливка пола
  {
    // Основные цвета пола — пики гистограммы (шаг 8 по каналу), не ближе 10 друг к другу:
    // на цветных планировках соседние комнаты отличаются всего на 8–16 единиц. Каждый пиксель
    // пола относим к ближайшему пику; далёкие от всех (сглаживание) — «любой» цвет.
    const isFloor = (i: number, p: number) => !barrier.d[i] && light.d[i] && floorBin.has(binOf(p));
    const fine = new Map<number, number>();
    for (let i = 0, p = 0; i < n; i++, p += 4) if (isFloor(i, p)) { const k = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3); fine.set(k, (fine.get(k) ?? 0) + 1); }
    const rgbOf = (k: number) => [((k >> 10) << 3) + 4, (((k >> 5) & 31) << 3) + 4, ((k & 31) << 3) + 4];
    const centers: number[][] = [];
    for (const [k, c] of [...fine].sort((x, y) => y[1] - x[1])) {
      if (c < Math.max(200, 0.003 * n)) break;
      const q = rgbOf(k);
      if (centers.every((z) => Math.hypot(z[0] - q[0], z[1] - q[1], z[2] - q[2]) >= 10)) centers.push(q);
    }
    colored = centers.length > 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (barrier.d[i]) { cls[i] = -1; continue; }
      if (!isFloor(i, p)) { cls[i] = 0; continue; }
      let best = -1, bd = 15;
      for (let c = 0; c < centers.length; c++) {
        const z = centers[c], d = Math.hypot(z[0] - rgba[p], z[1] - rgba[p + 1], z[2] - rgba[p + 2]);
        if (d < bd) { bd = d; best = c + 1; }
      }
      cls[i] = best;
    }
    const ids = { size: centers.length };
    // Пятна меньше ~1 м² (внутри ванны, буквы) — «любой» цвет.
    const minSpot = Math.max(50, Math.round(Math.min(w, h) * Math.min(w, h) / 144));
    for (let c = 0; c <= ids.size; c++) {
      const m = newBin(w, h);
      for (let i = 0; i < n; i++) if (cls[i] === c) m.d[i] = 1;
      const { labels: ml, comps: mc } = components(m);
      const tiny = new Uint8Array(mc.length + 1);
      // Цветной пол — от ~0,3 м² (туалет бывает около метра); белые пятна (внутри ванны, буквы) — до ~1 м².
      for (const k of mc) if (k.area < (c > 0 ? minSpot / 4 : minSpot)) tiny[k.id] = 1;
      for (let i = 0; i < n; i++) if (ml[i] && tiny[ml[i]]) cls[i] = -1;
    }
  }
  // Стык двух цветов пола режет затравку (по одному пикселю с каждой стороны).
  const clsEdge = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (cls[i] < 0) continue;
    const x = i % w;
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (q >= 0 && q < n && cls[q] >= 0 && cls[q] !== cls[i]) { clsEdge[i] = 1; break; }
  }
  const labelCls = new Map<number, number>();
  const classOfLabels = (lab: Int32Array, skip: Set<number>) => {
    labelCls.clear();
    const cnt = new Map<number, Map<number, number>>();
    for (let i = 0; i < n; i++) {
      const l = lab[i];
      if (l <= 0 || skip.has(l) || cls[i] < 0) continue;
      const m = cnt.get(l) ?? new Map<number, number>();
      m.set(cls[i], (m.get(cls[i]) ?? 0) + 1);
      cnt.set(l, m);
    }
    for (const [l, m] of cnt) labelCls.set(l, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  };
  // Пунктир перегородок и штрихи — в сплошную линию (короткие разрывы вдоль строк и столбцов).
  const gap = Math.max(3, Math.round(Math.min(w, h) / 120));
  const solid = or(barrier, closeDir(barrier, gap, true), closeDir(barrier, gap, false));
  const solidComps = components(solid);
  // Рамка чертежа: границы «чернил»; области, упирающиеся в неё с двух сторон, — поле листа, а не комната.
  let ix0 = w, iy0 = h, ix1 = 0, iy1 = 0;
  for (const c of solidComps.comps) { if (c.x0 < ix0) ix0 = c.x0; if (c.y0 < iy0) iy0 = c.y0; if (c.x1 > ix1) ix1 = c.x1; if (c.y1 > iy1) iy1 = c.y1; }
  const edge = Math.max(4, Math.round(Math.min(w, h) * 0.02));
  const isOutside = (c: { x0: number; y0: number; x1: number; y1: number }) => {
    if (c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1) return true;
    const sides = +(c.x0 - ix0 <= edge) + +(ix1 - c.x1 <= edge) + +(c.y0 - iy0 <= edge) + +(iy1 - c.y1 <= edge);
    return sides >= 2;
  };

  // 2. Масштаб и деление на комнаты: открытие свободного пространства рвёт узкие дверные «горлышки».
  const areaM2 = inp.areaM2 && inp.areaM2 > 10 ? inp.areaM2 : null;
  let pxPerM = Math.min(w, h) / 12;
  let labels: Int32Array = new Int32Array(n);
  let exteriorIds = new Set<number>();
  let seedCount = 0;
  const free = newBin(w, h);
  let chromaticInk = 0, allInk = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) if (barrier.d[i]) {
    allInk++;
    if (Math.max(rgba[p], rgba[p+1], rgba[p+2]) - Math.min(rgba[p], rgba[p+1], rgba[p+2]) > 30) chromaticInk++;
  }
  // Красные/розовые стены могут быть тонкими и бледными: к ним правило размеров не применяем.
  const grayInk = chromaticInk < 0.25 * allInk;
  for (let iter = 0; iter < 3; iter++) {
    // Текст и мелкие значки (меньше ~0,6 м) — не преграда: иначе режут комнату на куски.
    const small = new Uint8Array(solidComps.comps.length + 1);
    // Стены — одна большая связная сеть; отдельно висящие надписи и значки (даже крупные) — не стены.
    const largest = solidComps.comps.reduce((a, c) => (c.area > a.area ? c : a), solidComps.comps[0]);
    for (const c of solidComps.comps) small[c.id] = Math.max(c.x1 - c.x0, c.y1 - c.y0) < 0.8 * pxPerM || (c !== largest && c.area < largest.area * 0.03) ? 1 : 0;
    for (let i = 0; i < n; i++) free.d[i] = solid.d[i] && !small[solidComps.labels[i]] ? 0 : 1;
    const k = Math.max(3, Math.round(0.9 * pxPerM));
    const sf = newBin(w, h);
    for (let i = 0; i < n; i++) sf.d[i] = free.d[i] && !clsEdge[i] ? 1 : 0;
    // На монохромном плане бледные размерные линии могут быть связаны со стенами
    // и дробить комнату. Убираем их только из поиска затравок и только при явном
    // разделении толщин штрихов. Исходная маска остаётся для проёмов и границ.
    // Цветные планы используют собственное разделение; их здесь не меняем.
    const Tseed = colored || !grayInk ? null : strokeThreshold(free.d, w, h, pxPerM);
    if (Tseed) {
      const wl = newBin(w, h), dark = newBin(w, h);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        wl.d[i] = !free.d[i] && barrier.d[i] ? 1 : 0;
        if (!free.d[i] && 0.299 * (P[0] - rgba[p]) + 0.587 * (P[1] - rgba[p+1]) + 0.114 * (P[2] - rgba[p+2]) > 90) dark.d[i] = 1;
      }
      // Сохраняем широкие светлые перегородки и тёмные тонкие линии (в т. ч.
      // остекление). 90 — контраст яркости относительно бумаги, не RGB комнаты.
      // Ограничение 0,1 м не даёт порогу штрихов удалить узкую перегородку.
      const structural = openBin(wl, Math.min(Tseed, Math.max(3, Math.round(0.1 * pxPerM))));
      const strong = or(dark, closeDir(dark, gap, true), closeDir(dark, gap, false));
      for (let i = 0; i < n; i++) if (!structural.d[i] && !strong.d[i] && !clsEdge[i]) sf.d[i] = 1;
    }
    const seeds = openBin(sf, k);
    // Санузел: пол вдоль ванны и унитаза уже 0,9 м — крупной затравки там нет, и коридор съедает
    // санузел. Сантехника — мелкий замкнутый контур (карман пола внутри линии); считаем карман
    // вместе с контуром полом и ищем затравку мельче (0,6 м: дверь санузла уже). Берём её, только
    // если в ней есть сантехника и она не связана с крупными затравками.
    const onFix = newBin(w, h); // пиксели затравки санузла на контурах сантехники — не пол
    {
      const m2 = pxPerM * pxPerM;
      const fc = components(free), mark = new Uint8Array(fc.comps.length + 1);
      for (const c of fc.comps) {
        const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
        if (c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1) continue;
        // Стёкла окон — длинные узкие карманы: не сантехника.
        if (c.area >= 0.02 * m2 && c.area <= 0.8 * m2 && Math.max(cw, ch) <= 2 * pxPerM && Math.min(cw, ch) >= 0.22 * pxPerM && Math.max(cw, ch) <= 4 * Math.min(cw, ch)) mark[c.id] = 1;
      }
      const fx = newBin(w, h);
      for (let i = 0; i < n; i++) if (mark[fc.labels[i]]) fx.d[i] = 1;
      const gross = dilate(fx, 2 * Math.max(1, Math.round(0.12 * pxPerM)) + 1);
      for (let i = 0; i < n; i++) if (free.d[i]) gross.d[i] = 1;
      const { labels: l6, comps: c6 } = components(openBin(gross, Math.max(3, Math.round(0.6 * pxPerM))));
      const bad = new Uint8Array(c6.length + 1), fix = new Uint8Array(c6.length + 1);
      for (let i = 0; i < n; i++) if (l6[i]) { if (seeds.d[i]) bad[l6[i]] = 1; if (fx.d[i]) fix[l6[i]] = 1; }
      const ok = new Uint8Array(c6.length + 1);
      for (const c of c6) if (!bad[c.id] && fix[c.id] && c.area >= 1.0 * m2) ok[c.id] = 1;
      for (let i = 0; i < n; i++) if (ok[l6[i]]) { seeds.d[i] = 1; if (!free.d[i]) onFix.d[i] = 1; }
    }
    const { labels: lab, comps } = components(seeds);
    for (let i = 0; i < n; i++) if (onFix.d[i]) lab[i] = 0;
    labels = lab;
    exteriorIds = new Set(comps.filter(isOutside).map((c) => c.id));
    seedCount = comps.length;
    // Поле у края картинки — всегда «улица», даже если оно слишком узкое для затравки
    // (после обрезки до плана): иначе комната со входной дверью заливает поле через вход,
    // касается края и целиком пропадает как «снаружи».
    const edgeId = comps.length + 1;
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (free.d[y * w + x] && !labels[y * w + x]) labels[y * w + x] = edgeId;
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (free.d[y * w + x] && !labels[y * w + x]) labels[y * w + x] = edgeId;
    exteriorIds.add(edgeId);
    classOfLabels(labels, new Set([edgeId]));
    // Улица — белая бумага: на цветной лоджии или балконе она не растёт.
    if (colored) labelCls.set(edgeId, 0);
    grow(labels, free.d, w, h, cls, labelCls);
    // «Снаружи» уточняем по итоговым областям (затравка после открытия могла не дойти до рамки).
    for (const [id, b] of labelBoxes(labels, w)) if (isOutside(b)) exteriorIds.add(id);
    // Цветная зона у края чертежа (лоджия, балкон) — помещение, а не поле листа: улица на
    // цветной планировке белая. Исключение — то, что касается края картинки.
    if (colored) for (const [id, b] of labelBoxes(labels, w)) {
      const c = labelCls.get(id);
      if (id !== edgeId && c !== undefined && c > 0 && b.x0 > 0 && b.y0 > 0 && b.x1 < w - 1 && b.y1 < h - 1) exteriorIds.delete(id);
    }
    let apt = 0;
    for (let i = 0; i < n; i++) if (labels[i] > 0 && !exteriorIds.has(labels[i])) apt++;
    if (apt < 100) break;
    const next = Math.sqrt(apt / (areaM2 ?? 55));
    if (Math.abs(next - pxPerM) / pxPerM < 0.05) { pxPerM = next; break; }
    pxPerM = next;
  }
  const mmPerPx = 1000 / pxPerM;
  const minRoomPx = 1.0 * pxPerM * pxPerM;

  // 3. Площади меток; мелкие куски (< 1 м²) отдаём соседям.
  const area = new Map<number, number>();
  for (let i = 0; i < n; i++) if (labels[i] > 0) area.set(labels[i], (area.get(labels[i]) ?? 0) + 1);
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l > 0 && !exteriorIds.has(l) && (area.get(l) ?? 0) < minRoomPx) labels[i] = 0;
  }
  grow(labels, free.d, w, h, cls, labelCls);
  // Остатки (белые полосы проёмов между цветными зонами) — ближайшей зоне, без учёта цвета.
  grow(labels, free.d, w, h);

  // Соприкосновение шире 1,4 м — это не дверь, а одна комната, разрезанная текстом или значком: склеиваем.
  let contacts = contactsOf(labels, w, h);
  const parent = new Map<number, number>();
  const find = (x: number): number => { while (parent.has(x)) x = parent.get(x)!; return x; };
  for (const [key, c] of contacts) {
    const [la, lb] = key.split(':').map(Number);
    if (exteriorIds.has(la) || exteriorIds.has(lb)) continue;
    const ext = Math.max(Math.max(...c.xs) - Math.min(...c.xs), Math.max(...c.ys) - Math.min(...c.ys));
    const ca = labelCls.get(la), cb = labelCls.get(lb);
    if (ca !== undefined && cb !== undefined && ca !== cb) continue; // разный цвет пола — разные помещения
    if (ext > 1.4 * pxPerM) { const ra = find(la), rb = find(lb); if (ra !== rb) parent.set(rb, ra); }
  }
  if (parent.size) {
    for (let i = 0; i < n; i++) if (labels[i] > 0) labels[i] = find(labels[i]);
    area.clear();
    for (let i = 0; i < n; i++) if (labels[i] > 0) area.set(labels[i], (area.get(labels[i]) ?? 0) + 1);
    contacts = contactsOf(labels, w, h);
  }
  // Основной план — рамка крупных комнат (≥ 6 м²) с запасом 0,5 м; всё, что целиком вне её, — поле листа.
  const boxes = labelBoxes(labels, w);
  const bigIds = [...boxes.keys()].filter((l) => {
    const b = boxes.get(l)!;
    return !exteriorIds.has(l) && (area.get(l) ?? 0) >= 6 * pxPerM * pxPerM && Math.min(b.x1 - b.x0, b.y1 - b.y0) >= 2 * pxPerM;
  });
  // Отсекаем отдельные блоки листа (печать, таблицу) по соседству областей.
  // Основная группа содержит больше соседних помещений; при равенстве берём площадь.
  // Это только фильтр: он не расширяет прежнюю рамку крупных комнат в поле листа.
  const candidateIds = [...boxes.keys()].filter(l => !exteriorIds.has(l) && (area.get(l) ?? 0) >= minRoomPx);
  let apartmentIds: Set<number> | null = null;
  if (!colored && candidateIds.length) {
    const unseen = new Set(candidateIds), groups: { ids: Set<number>; area: number }[] = [];
    const gap = 1.5 * pxPerM;
    while (unseen.size) {
      const start = unseen.values().next().value!;
      const ids = new Set([start]), queue = [start]; unseen.delete(start);
      for (let j = 0; j < queue.length; j++) {
        const a = boxes.get(queue[j])!;
        for (const id of unseen) {
          const b = boxes.get(id)!;
          const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
          if (Math.hypot(dx, dy) <= gap) { unseen.delete(id); ids.add(id); queue.push(id); }
        }
      }
      groups.push({ ids, area: [...ids].reduce((sum, id) => sum + (area.get(id) ?? 0), 0) });
    }
    if (groups.length > 1) apartmentIds = groups.reduce((best, group) =>
      group.ids.size > best.ids.size || (group.ids.size === best.ids.size && group.area > best.area) ? group : best).ids;
  }
  const m = 0.5 * pxPerM;
  const core = bigIds.length ? bigIds.map((l) => boxes.get(l)!).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : null;
  const inCore = (l: number) => {
    if (apartmentIds && !apartmentIds.has(l)) return false;
    if (!core) return true;
    const b = boxes.get(l)!;
    return b.x1 >= core.x0 - m && b.x0 <= core.x1 + m && b.y1 >= core.y0 - m && b.y0 <= core.y1 + m;
  };
  // Цветная планировка: зоны — цветные. Белая бумага, если почти весь пол квартиры залит цветом, —
  // не помещение (простенок, шахта, поле листа между линиями); цветная зона за рамкой крупных
  // комнат (лоджия, балкон до 2,5 м) — помещение.
  classOfLabels(labels, exteriorIds);
  let tinted = false;
  if (colored) {
    let cf = 0, all = 0;
    for (let i = 0; i < n; i++) if (labels[i] > 0 && !exteriorIds.has(labels[i]) && inCore(labels[i]) && cls[i] >= 0) { all++; if (cls[i] > 0) cf++; }
    tinted = all > 0 && cf >= 0.6 * all;
  }
  const nearCore = (l: number) => {
    if (!core) return true;
    const b = boxes.get(l)!, mc = 2.5 * pxPerM;
    return b.x1 >= core.x0 - mc && b.x0 <= core.x1 + mc && b.y1 >= core.y0 - mc && b.y0 <= core.y1 + mc;
  };
  const roomIds = [...new Set(labels)].filter((l) => {
    if (l <= 0 || exteriorIds.has(l)) return false;
    const c = labelCls.get(l);
    return inCore(l) || (colored && c !== undefined && c > 0 && nearCore(l));
  });
  // Белая зона на цветной планировке, заметно граничащая с улицей (полоса между стеной и
  // размерной линией), — не помещение. Белый санузел внутри квартиры окружён помещениями.
  if (tinted) {
    const ringK = Math.max(3, Math.round(0.8 * pxPerM)) * 2 + 1;
    for (const l of [...roomIds]) {
      if (labelCls.get(l) !== 0) continue;
      const one = newBin(w, h);
      for (let i = 0; i < n; i++) if (labels[i] === l) one.d[i] = 1;
      const ring = dilate(one, ringK);
      let ext = 0, tot = 0;
      for (let i = 0; i < n; i++) if (ring.d[i] && !one.d[i] && labels[i] > 0) { tot++; if (exteriorIds.has(labels[i])) ext++; }
      // Полоса — узкая и длинная; белый санузел у наружной стены тоже граничит с улицей, но он не полоса.
      const bb = boxes.get(l);
      const strip = bb ? Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) < 1.6 * pxPerM && Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) > 3 * Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) : false;
      if (tot && ext > 0.1 * tot && strip) roomIds.splice(roomIds.indexOf(l), 1);
    }
  }
  // Белая бумага на цветной планировке — снаружи квартиры: через неё ищется входная дверь.
  if (tinted) for (const l of new Set(labels)) if (l > 0 && labelCls.get(l) === 0 && !roomIds.includes(l)) exteriorIds.add(l);

  // 3б. Незанятый пол внутри квартиры — отдельное помещение. Узкий коридор (около 1 м) теряет
  // затравку при открытии, а двери-чёрточки не дают соседям его занять: он остаётся «ничьим».
  // Полоски внутри двойных стен (уже 0,5 м) и мелочь (меньше 1 м²) отбрасываются.
  {
    const left = newBin(w, h);
    for (let i = 0; i < n; i++) left.d[i] = free.d[i] && labels[i] === 0 ? 1 : 0;
    const kl = Math.max(3, Math.round(0.5 * pxPerM));
    const { labels: ll, comps: lc } = components(openBin(left, kl));
    // Внутри квартиры кусок пола окружён помещениями; коробки размерных линий снаружи — «улицей».
    // Смотрим полосу 0,8 м вокруг куска: доля улицы мала, доля помещений заметна.
    const roomSet = new Set(roomIds);
    const ringK = Math.max(3, Math.round(0.8 * pxPerM)) * 2 + 1;
    let nextId = Math.max(0, ...roomIds, ...exteriorIds) + 1;
    for (const c of lc) {
      if (c.area < 1.0 * pxPerM * pxPerM || c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1) continue;
      const one = newBin(w, h);
      // Цветная заливка (лоджия, балкон на цветной планировке) — помещение, даже если снаружи
      // оно окружено улицей и лежит за рамкой крупных комнат (до 2,5 м).
      const cc = new Map<number, number>();
      for (let i = 0; i < n; i++) if (ll[i] === c.id) { one.d[i] = 1; if (cls[i] >= 0) cc.set(cls[i], (cc.get(cls[i]) ?? 0) + 1); }
      const tint = [...cc].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      const mc = tint > 0 ? 2.5 * pxPerM : m;
      if (core && (c.x1 < core.x0 - mc || c.x0 > core.x1 + mc || c.y1 < core.y0 - mc || c.y0 > core.y1 + mc)) continue;
      const ring = dilate(one, ringK);
      let ext = 0, rm = 0, tot = 0;
      for (let i = 0; i < n; i++) {
        if (!ring.d[i] || one.d[i]) continue;
        tot++;
        if (exteriorIds.has(labels[i])) ext++; else if (roomSet.has(labels[i])) rm++;
      }
      if (!tot || (tint > 0 ? rm < 0.03 * tot : ext > 0.3 * tot || rm < 0.2 * tot)) continue;
      const id = nextId++;
      let cnt = 0;
      for (let i = 0; i < n; i++) if (ll[i] === c.id) { labels[i] = id; cnt++; }
      area.set(id, cnt);
      roomIds.push(id);
    }
  }

  // 3в. Цветная планировка: зоны — по цвету в первую очередь. Каждое сплошное пятно одного
  // цвета пола — отдельная зона: тонкие линии и надписи внутри (до ~6 см) пятно не режут,
  // замкнутые контуры внутри (сантехника, мебель, до 2 м²) заливаются. Белые помещения
  // (санузел без заливки) и улица остаются от разбиения выше.
  if (tinted) {
    const kc = Math.max(3, Math.round(0.06 * pxPerM)) | 1;
    const m2 = pxPerM * pxPerM, minZone = 0.8 * m2, mc2 = 2.5 * pxPerM;
    const zone = new Int32Array(n);
    let nextId = Math.max(0, ...roomIds, ...exteriorIds) + 1;
    for (let i = 0; i < n; i++) if (labels[i] >= nextId) nextId = labels[i] + 1;
    let nCls = 0;
    for (let i = 0; i < n; i++) if (cls[i] > nCls) nCls = cls[i];
    const zoneIds: number[] = [];
    for (let c = 1; c <= nCls; c++) {
      const m = newBin(w, h);
      for (let i = 0; i < n; i++) if (cls[i] === c) m.d[i] = 1;
      const { labels: cl, comps: cc } = components(erode(dilate(m, kc), kc));
      const ids = new Int32Array(cc.length + 1);
      for (const comp of cc) {
        if (comp.area < minZone || comp.x0 === 0 || comp.y0 === 0 || comp.x1 === w - 1 || comp.y1 === h - 1) continue;
        if (core && (comp.x1 < core.x0 - mc2 || comp.x0 > core.x1 + mc2 || comp.y1 < core.y0 - mc2 || comp.y0 > core.y1 + mc2)) continue;
        ids[comp.id] = nextId++;
        zoneIds.push(ids[comp.id]);
      }
      for (let i = 0; i < n; i++) if (cl[i] && ids[cl[i]] && !zone[i]) zone[i] = ids[cl[i]];
      // Внутри одного цвета квартиру всё равно делят стены (на планировке «всё жёлтое» цвет
      // одинаков у всех комнат): пятно, в котором лежат несколько найденных по стенам помещений,
      // делим между ними; пятно без своего помещения — новая зона.
      for (const comp of cc) {
        const id = ids[comp.id];
        if (!id) continue;
        const cnt = new Map<number, number>();
        for (let i = 0; i < n; i++) if (zone[i] === id && roomIds.includes(labels[i])) cnt.set(labels[i], (cnt.get(labels[i]) ?? 0) + 1);
        const keep = [...cnt].filter(([, k]) => k >= 0.15 * m2).map(([l]) => l);
        if (keep.length < 2) continue;
        const sub = new Int32Array(n), msk = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (zone[i] === id) { msk[i] = 1; if (keep.includes(labels[i])) sub[i] = labels[i]; }
        grow(sub, msk, w, h);
        // Куски, разрезанные только тонкой линией (метка двери, надпись) почти по всей ширине, —
        // одно помещение; соединённые дверным проёмом в стене (контакт короткий) — разные.
        // Тонкая линия между кусками не входит в пятно — смотрим соседство через неё (до ~0,15 м).
        const near = sub.slice(), pm = newBin(w, h);
        for (let i = 0; i < n; i++) pm.d[i] = msk[i];
        const kk = Math.max(3, Math.round(0.15 * pxPerM)) | 1;
        const pmc = erode(dilate(pm, kk), kk);
        grow(near, pmc.d, w, h);
        const bx = labelBoxes(sub, w), par = new Map<number, number>();
        const fd = (x: number): number => { while (par.has(x)) x = par.get(x)!; return x; };
        for (const [key, c] of contactsOf(near, w, h)) {
          const [la, lb] = key.split(':').map(Number);
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let i = 0; i < c.xs.length; i++) { x0 = Math.min(x0, c.xs[i]); x1 = Math.max(x1, c.xs[i]); y0 = Math.min(y0, c.ys[i]); y1 = Math.max(y1, c.ys[i]); }
          const horiz = x1 - x0 >= y1 - y0, len = horiz ? x1 - x0 : y1 - y0;
          const A = bx.get(la)!, B = bx.get(lb)!;
          const side = Math.min(horiz ? A.x1 - A.x0 : A.y1 - A.y0, horiz ? B.x1 - B.x0 : B.y1 - B.y0);
          if (len >= 0.75 * side && len >= 0.9 * pxPerM) { const ra = fd(la), rb = fd(lb); if (ra !== rb) par.set(rb, ra); }
        }
        for (let i = 0; i < n; i++) if (sub[i]) sub[i] = fd(sub[i]);
        for (const l of keep) if (fd(l) === l) zoneIds.push(l);
        zoneIds.splice(zoneIds.indexOf(id), 1);
        for (let i = 0; i < n; i++) if (msk[i] && sub[i]) zone[i] = sub[i];
      }
    }
    if (zoneIds.length >= 2) {
      // Дыры внутри одной зоны (контуры сантехники, мебели, цифры) — её.
      const hole = newBin(w, h);
      for (let i = 0; i < n; i++) hole.d[i] = zone[i] ? 0 : 1;
      const { labels: hl, comps: hc } = components(hole);
      const owner = new Int32Array(hc.length + 1);
      for (let i = 0; i < n; i++) {
        const c = hl[i];
        if (!c || owner[c] < 0) continue;
        const x = i % w;
        for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (q < 0 || q >= n || !zone[q]) continue;
          if (!owner[c]) owner[c] = zone[q];
          else if (owner[c] !== zone[q]) { owner[c] = -1; break; }
        }
      }
      const fill = new Uint8Array(hc.length + 1);
      for (const c of hc) if (owner[c.id] > 0 && c.area <= 2 * m2 && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1) fill[c.id] = 1;
      for (let i = 0; i < n; i++) if (fill[hl[i]]) zone[i] = owner[hl[i]];
      // Новая разметка: цветные зоны; белые помещения и улица — как были.
      const keepRoom = new Set(roomIds.filter((l) => labelCls.get(l) === 0));
      const old = labels;
      const nl = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        if (zone[i]) nl[i] = zone[i];
        else if (keepRoom.has(old[i]) || (old[i] > 0 && !roomIds.includes(old[i]))) nl[i] = old[i]; // белые помещения, улица, прочие метки
      }
      // Оставшийся свободный пол внутри квартиры (белые полосы проёмов) — ближайшей зоне.
      const allow = new Uint8Array(n);
      for (let i = 0; i < n; i++) allow[i] = free.d[i] && old[i] > 0 && !exteriorIds.has(old[i]) ? 1 : 0;
      grow(nl, allow, w, h);
      // Остальной свободный пол (белый проём входной двери и т. п.) — ближайшей метке, включая улицу.
      grow(nl, free.d, w, h);
      labels = nl;
      area.clear();
      for (let i = 0; i < n; i++) if (labels[i] > 0) area.set(labels[i], (area.get(labels[i]) ?? 0) + 1);
      roomIds.length = 0;
      for (const l of [...zoneIds, ...keepRoom]) if ((area.get(l) ?? 0) >= 0.3 * m2) roomIds.push(l);
      classOfLabels(labels, exteriorIds);
      contacts = contactsOf(labels, w, h);
    }
  }
  // 4. Дверные проёмы: где две метки соприкасаются через свободные пиксели.
  const U = (px: number) => px / inp.pxPerUnit; // пиксели распознавания → единицы листа
  const k = mmPerPx * inp.pxPerUnit; // мм на единицу листа
  const openings: Opening[] = [];
  const doorOf = new Map<string, Opening>();
  const roomSet = new Set(roomIds);
  const isRoom = (l: number) => roomSet.has(l), okSide = (l: number) => isRoom(l) || exteriorIds.has(l);
  for (const [key, c] of contacts) {
    const [la, lb] = key.split(':').map(Number);
    // Проём соединяет помещение с помещением или с улицей; карманы между линиями не в счёт.
    if (!(isRoom(la) || isRoom(lb)) || !okSide(la) || !okSide(lb)) continue;
    const x0 = Math.min(...c.xs), x1 = Math.max(...c.xs), y0 = Math.min(...c.ys), y1 = Math.max(...c.ys);
    const horiz = x1 - x0 >= y1 - y0; // линия контакта горизонтальна → проём в горизонтальной «стене»
    const len = (horiz ? x1 - x0 : y1 - y0) * mmPerPx;
    if (len < 450) continue;
    const L = Math.min(len, 1600);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const half = (L / mmPerPx) / 2;
    const a: Pt = horiz ? { x: U(cx - half) * k, y: U(cy) * k } : { x: U(cx) * k, y: U(cy - half) * k };
    const b: Pt = horiz ? { x: U(cx + half) * k, y: U(cy) * k } : { x: U(cx) * k, y: U(cy + half) * k };
    const o: Opening = { id: uid('d'), type: 'door', a, b, thickness: 120, hinge: 'a', swing: 1, isEntrance: exteriorIds.has(la) || exteriorIds.has(lb), sillHeight: null, ...prov(inp.page) };
    doorOf.set(key, o);
    openings.push(o);
  }

  // 4б. Проёмы, перечёркнутые тонкой линией. На БТИ дверь — разрыв в стене с тонкой чертой
  // (иногда с дугой); черта примыкает к стенам и «запечатывает» проём, поэтому выше он не виден.
  // Ищем разрывы в толстых стенах: метки растут сквозь тонкие линии, но не сквозь стены.
  // Стена — это заливка: берём её цвет из середины толстых стен. Цветная заливка (розовые стены
  // техплана) отличает стену от белого проёма с тонкими чертами даже там, где по толщине их
  // не различить; в остальных случаях отсекаем тонкие линии по толщине.
  const walls = newBin(w, h);
  for (let i = 0; i < n; i++) walls.d[i] = free.d[i] ? 0 : 1;
  const coreW = erode(walls, Math.max(3, Math.round(0.2 * pxPerM)));
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let coreN = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) if (coreW.d[i]) { hist[0][rgba[p]]++; hist[1][rgba[p + 1]]++; hist[2][rgba[p + 2]]++; coreN++; }
  const med = (hh: Uint32Array) => { let t = 0; for (let v = 0; v < 256; v++) { t += hh[v]; if (t >= coreN / 2) return v; } return 0; };
  const WC = [med(hist[0]), med(hist[1]), med(hist[2])];
  const chroma = Math.max(...WC) - Math.min(...WC);
  const kThin = Math.max(3, Math.round(0.08 * pxPerM));
  let thickWalls = openBin(walls, kThin);
  // Только явно цветная заливка (серый медианный цвет бывает и у двойных чёрных линий после JPEG).
  if (coreN >= 50 && chroma > 30) {
    thickWalls = newBin(w, h);
    // Достаточно «оттенка» стены: в тонких перегородках после JPEG заливка бледнеет.
    const top = WC.indexOf(Math.max(...WC)), low = WC.indexOf(Math.min(...WC));
    for (let i = 0, p = 0; i < n; i++, p += 4) thickWalls.d[i] = rgba[p + top] - rgba[p + low] >= 0.3 * chroma ? 1 : 0;
  }
  const passable = new Uint8Array(n);
  for (let i = 0; i < n; i++) passable[i] = thickWalls.d[i] ? 0 : 1;
  const through = labels.slice();
  grow(through, passable, w, h);

  // 4а. Зоны, разделённые одной тонкой линией почти по всей стороне (размерная линия внутри
  // комнаты, а не стена — у стены есть толщина), — одно помещение.
  {
    const bx = labelBoxes(labels, w);
    const parent = new Map<number, number>();
    const best = new Map<number, { to: number; len: number }>();
    const find = (x: number): number => { while (parent.has(x)) x = parent.get(x)!; return x; };
    classOfLabels(labels, exteriorIds);
    for (const [key, c] of contactsOf(through, w, h)) {
      const [la, lb] = key.split(':').map(Number);
      if (!roomSet.has(la) || !roomSet.has(lb)) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < c.xs.length; i++) { x0 = Math.min(x0, c.xs[i]); x1 = Math.max(x1, c.xs[i]); y0 = Math.min(y0, c.ys[i]); y1 = Math.max(y1, c.ys[i]); }
      const horiz = x1 - x0 >= y1 - y0, len = horiz ? x1 - x0 : y1 - y0, across = horiz ? y1 - y0 : x1 - x0;
      const A = bx.get(la), B = bx.get(lb);
      if (!A || !B) continue;
      // Куски одной цветной зоны, разрезанные тонкой линией поперёк (метка двери, надпись), —
      // одно помещение: линия идёт почти через всю ширину обоих кусков.
      const ca = labelCls.get(la);
      if (colored && ca !== undefined && ca > 0 && ca === labelCls.get(lb) && across <= 0.3 * pxPerM && len >= 0.5 * pxPerM) {
        const sideMax = Math.max(horiz ? A.x1 - A.x0 : A.y1 - A.y0, horiz ? B.x1 - B.x0 : B.y1 - B.y0);
        if (len >= 0.6 * sideMax) { const ra = find(la), rb = find(lb); if (ra !== rb) parent.set(rb, ra); continue; }
      }
      if (len < 1.5 * pxPerM || across > 0.3 * pxPerM) continue;
      const side = Math.min(horiz ? A.x1 - A.x0 : A.y1 - A.y0, horiz ? B.x1 - B.x0 : B.y1 - B.y0);
      if (len < 0.7 * side) continue;
      // Приклеиваем только узкую полосу (уже 1,1 м) к соседу — две полноценные комнаты не склеиваются.
      const narrow = (b: { x0: number; y0: number; x1: number; y1: number }) => Math.min(b.x1 - b.x0, b.y1 - b.y0) < 1.1 * pxPerM;
      for (const [strip, room, sb, rb] of [[la, lb, A, B], [lb, la, B, A]] as const) {
        if (!narrow(sb) || narrow(rb)) continue;
        const prev = best.get(strip);
        if (!prev || len > prev.len) best.set(strip, { to: room, len });
      }
    }
    for (const [strip, { to }] of best) { const a = find(strip), b = find(to); if (a !== b) parent.set(a, b); }
    if (parent.size) {
      for (let i = 0; i < n; i++) { if (labels[i] > 0) labels[i] = find(labels[i]); if (through[i] > 0) through[i] = find(through[i]); }
      for (const [id] of parent) { const j = roomIds.indexOf(id); if (j >= 0) roomIds.splice(j, 1); roomSet.delete(id); }
      area.clear();
      for (let i = 0; i < n; i++) if (labels[i] > 0) area.set(labels[i], (area.get(labels[i]) ?? 0) + 1);
      // Двери между склеенными зонами больше не нужны.
      for (const [key, o] of [...doorOf]) {
        const [la, lb] = key.split(':').map(Number);
        if (find(la) === find(lb)) { doorOf.delete(key); const j = openings.indexOf(o); if (j >= 0) openings.splice(j, 1); }
      }
    }
  }
  const gapOpenings: { o: Opening; key: string; outside: boolean }[] = [];
  for (const [key, c] of contactsOf(through, w, h)) {
    const [la, lb] = key.split(':').map(Number);
    if (!(isRoom(la) || isRoom(lb)) || !okSide(la) || !okSide(lb)) continue;
    // Без Math.max(...xs): на крупных сканах контакт — десятки тысяч точек.
    let ax0 = Infinity, ax1 = -Infinity, ay0 = Infinity, ay1 = -Infinity;
    for (let i = 0; i < c.xs.length; i++) { ax0 = Math.min(ax0, c.xs[i]); ax1 = Math.max(ax1, c.xs[i]); ay0 = Math.min(ay0, c.ys[i]); ay1 = Math.max(ay1, c.ys[i]); }
    const horiz = ax1 - ax0 >= ay1 - ay0;
    // Точки контакта → отрезки вдоль стены (разрыв больше 0,3 м — следующий проём).
    const along = c.xs.map((x, i) => (horiz ? x : c.ys[i])).sort((a, b) => a - b);
    const across = c.xs.map((x, i) => (horiz ? c.ys[i] : x));
    const mid = [...across].sort((a, b) => a - b)[Math.floor(across.length / 2)];
    // Контакт «размазан» поперёк (двойные тонкие стены, скошенные области) — это не проём.
    // Черта поперёк проёма даёт немного точек в стороне — допускаем до 20 %.
    if (across.filter((v) => Math.abs(v - mid) > 0.3 * pxPerM).length > 0.2 * across.length) continue;
    let s0 = along[0];
    for (let i = 1; i <= along.length; i++) {
      if (i < along.length && along[i] - along[i - 1] <= 0.3 * pxPerM) continue;
      const e0 = along[i - 1], len = (e0 - s0) * mmPerPx;
      // Проём ограничен стенами-«косяками» с обеих сторон (в пределах ~25 см по оси стены).
      // Без этого вдоль пунктирных или тонких перегородок получается цепочка ложных дверей.
      const jamb = (from: number, dir: 1 | -1) => {
        const r = Math.max(2, Math.round(0.25 * pxPerM));
        for (let t = 1; t <= r; t++)
          for (let q = -r; q <= r; q++) {
            const u = from + dir * t, v = Math.round(mid) + q;
            const x = horiz ? u : v, y = horiz ? v : u;
            if (x >= 0 && y >= 0 && x < w && y < h && thickWalls.d[y * w + x]) return true;
          }
        return false;
      };
      if (len >= 450 && len <= 2400 && jamb(s0, -1) && jamb(e0, 1)) {
        const a: Pt = horiz ? { x: U(s0) * k, y: U(mid) * k } : { x: U(mid) * k, y: U(s0) * k };
        const b: Pt = horiz ? { x: U(e0) * k, y: U(mid) * k } : { x: U(mid) * k, y: U(e0) * k };
        const outside = exteriorIds.has(la) || exteriorIds.has(lb);
        // Уже найденный выше проём между теми же помещениями — не дублируем.
        const cm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dup = openings.some((o) => Math.hypot((o.a.x + o.b.x) / 2 - cm.x, (o.a.y + o.b.y) / 2 - cm.y) < 600);
        if (!dup) {
          const o: Opening = { id: uid('d'), type: 'door', a, b, thickness: 120, hinge: 'a', swing: 1, isEntrance: outside, sillHeight: null, ...prov(inp.page) };
          gapOpenings.push({ o, key: `${key}:${gapOpenings.length}`, outside });
        }
      }
      if (i < along.length) s0 = along[i];
    }
  }
  // 4в. Двери-«чёрточки» (старые московские планы БТИ): стена не разорвана, дверь отмечена
  // короткой линией поперёк стены — узким «шипом», торчащим в обе комнаты.
  for (const t of tickCrossings(labels, w, h, pxPerM)) {
    if (!(isRoom(t.la) || isRoom(t.lb)) || !okSide(t.la) || !okSide(t.lb)) continue;
    const half = (0.8 * pxPerM) / 2;
    const s0 = Math.max(t.from, t.at - half), e0 = Math.min(t.to, t.at + half);
    if ((e0 - s0) * mmPerPx < 450) continue;
    const a: Pt = t.horiz ? { x: U(s0) * k, y: U(t.mid) * k } : { x: U(t.mid) * k, y: U(s0) * k };
    const b: Pt = t.horiz ? { x: U(e0) * k, y: U(t.mid) * k } : { x: U(t.mid) * k, y: U(e0) * k };
    const cm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (openings.some((o) => Math.hypot((o.a.x + o.b.x) / 2 - cm.x, (o.a.y + o.b.y) / 2 - cm.y) < 600)) continue;
    if (gapOpenings.some((g) => Math.hypot((g.o.a.x + g.o.b.x) / 2 - cm.x, (g.o.a.y + g.o.b.y) / 2 - cm.y) < 600)) continue;
    const outside = exteriorIds.has(t.la) || exteriorIds.has(t.lb);
    const o: Opening = { id: uid('d'), type: 'door', a, b, thickness: 120, hinge: 'a', swing: 1, isEntrance: outside, sillHeight: null, ...prov(inp.page) };
    gapOpenings.push({ o, key: `${Math.min(t.la, t.lb)}:${Math.max(t.la, t.lb)}:t${gapOpenings.length}`, outside });
  }
  for (const g of gapOpenings) {
    openings.push(g.o);
    if (!g.outside) doorOf.set(g.key, g.o);
  }

  // 5. Полигоны помещений (мм). Комната — всё внутри её стен: сантехника, мебель, цифры площадей
  // отдаются помещению, к которому прилегают (не дальше 0,8 м от его пола). Толстые стены и
  // открытый «ничей» пол (помещение без своей метки) не отдаются.
  const roomPx = labels.slice();
  {
    const pocket = new Uint8Array(n);
    const { labels: fl, comps: fc } = components(free);
    const small = new Uint8Array(fc.length + 1);
    for (const c of fc) if (c.area <= 0.8 * pxPerM * pxPerM) small[c.id] = 1;
    for (let i = 0; i < n; i++) if (fl[i] && small[fl[i]] && labels[i] === 0) pocket[i] = 1;
    // Что здесь стена, решаем по толщинам линий этого же плана: контуры сантехники и мебели
    // бывают толще общего порога, но заметно тоньше перегородок.
    const T = strokeThreshold(free.d, w, h, pxPerM);
    let core = thickWalls;
    if (T) {
      const wl = newBin(w, h);
      for (let i = 0; i < n; i++) wl.d[i] = free.d[i] ? 0 : 1;
      const tw = openBin(wl, T);
      core = newBin(w, h);
      for (let i = 0; i < n; i++) core.d[i] = thickWalls.d[i] && tw.d[i] ? 1 : 0;
    }
    const allowed = new Uint8Array(n);
    for (let i = 0; i < n; i++) allowed[i] = (!free.d[i] && !core.d[i]) || pocket[i] ? 1 : 0;
    // Окна и проёмы — разрыв в стене (до 5 м: окно рядом с балконной дверью) между двумя её кусками на одной линии. Линии
    // остекления в таком разрыве — граница помещения, а не предмет: их не отдаём никому.
    {
      const L = Math.max(3, Math.round(0.5 * pxPerM)), G = Math.round(5 * pxPerM);
      for (const horiz of [true, false]) {
        const A = horiz ? h : w, B = horiz ? w : h;
        const at = (a: number, b: number) => (horiz ? a * w + b : b * w + a);
        for (let a = 0; a < A; a++) {
          let prevEnd = -1;
          for (let b = 0; b < B; ) {
            if (!core.d[at(a, b)]) { b++; continue; }
            let e = b;
            while (e < B && core.d[at(a, e)]) e++;
            if (e - b >= L) {
              if (prevEnd >= 0 && b - prevEnd <= G) for (let q = prevEnd; q < b; q++) allowed[at(a, q)] = 0;
              prevEnd = e;
            }
            b = e;
          }
        }
      }
    }
    // Отдельно стоящее (не связанное с сетью стен) и окружённое одним помещением — его: цифры
    // площадей, мебель, сантехника. По толщине их от стен не отличить — крупный шрифт толстый.
    {
      const bar = newBin(w, h);
      for (let i = 0; i < n; i++) bar.d[i] = free.d[i] ? 0 : 1;
      const { labels: bl, comps: bc } = components(bar);
      const net = bc.reduce((a, c) => (c.area > a.area ? c : a), bc[0])?.id ?? -1;
      const owner = new Int32Array(bc.length + 1);
      for (let i = 0; i < n; i++) {
        const c = bl[i];
        if (!c || c === net || owner[c] < 0) continue;
        const x = i % w;
        for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (q < 0 || q >= n || labels[q] <= 0) continue;
          if (!owner[c]) owner[c] = labels[q];
          else if (owner[c] !== labels[q]) { owner[c] = -1; break; }
        }
      }
      for (let i = 0; i < n; i++) if (bl[i] && owner[bl[i]] > 0 && !roomPx[i]) roomPx[i] = owner[bl[i]];
    }
    let frontier: number[] = [];
    for (let i = 0; i < n; i++) if (roomPx[i] > 0) frontier.push(i);
    for (let step = Math.round(0.8 * pxPerM); step > 0 && frontier.length; step--) {
      const next: number[] = [];
      for (const p of frontier) {
        const x = p % w, l = roomPx[p];
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < n && allowed[q] && roomPx[q] === 0) { roomPx[q] = l; next.push(q); }
      }
      frontier = next;
    }
  }
  const cell = Math.max(2, Math.round(pxPerM * 0.1));
  const rooms: Room[] = [];
  const pxPolys: { id: number; poly: Pt[] }[] = [];
  for (const id of roomIds) {
    const poly = labelPolygon(roomPx, w, h, id, cell);
    if (!poly || poly.length < 4) continue;
    const mm = poly.map((q) => ({ x: Math.round(U(q.x) * k), y: Math.round(U(q.y) * k) }));
    if (polyArea(mm) / 1e6 < 1) continue;
    rooms.push({ id: `r${id}`, name: 'Помещение', type: 'other', polygon: mm, ...prov(inp.page) });
    pxPolys.push({ id, poly });
  }

  // 5а. Углы и края, вырезанные цифрами площадей: недостающие до прямоугольника помещения куски
  // дозаполняются, если там пол (а не стена) и они не заняты соседями. Г-образные комнаты
  // не трогаем: недостающая часть у них велика и занята стеной или соседней комнатой.
  const wallNet = solidComps.comps.reduce((a, c) => (c.area > a.area ? c : a), solidComps.comps[0])?.id ?? -1;
  for (const pp of pxPolys) {
    const xs = pp.poly.map((q) => q.x), ys = pp.poly.map((q) => q.y);
    const bb = [{ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }, { x: Math.min(...xs), y: Math.max(...ys) }];
    const bbA = polyArea(bb);
    const others = pxPolys.filter((o) => o !== pp).map((o) => toGeom(o.poly));
    const miss = difference(toGeom(bb), toGeom(pp.poly), ...others);
    const add: Pt[][] = [];
    for (const part of miss) {
      const ring = fromRing(part[0]);
      const a = polyArea(ring);
      if (a < cell * cell * 4 || a > 0.2 * bbA) continue;
      // В куске не должно быть сплошной стены (пикселей основной сети стен).
      const px = ring.map((q) => q.x), py = ring.map((q) => q.y);
      let wall = 0, outside = 0, all = 0;
      for (let y = Math.max(0, Math.floor(Math.min(...py))); y <= Math.min(h - 1, Math.ceil(Math.max(...py))); y += 2)
        for (let x = Math.max(0, Math.floor(Math.min(...px))); x <= Math.min(w - 1, Math.ceil(Math.max(...px))); x += 2) {
          if (!pointIn({ x: x + 0.5, y: y + 0.5 }, ring)) continue;
          const i = y * w + x;
          all++;
          if (solid.d[i] && solidComps.labels[i] === wallNet) wall++;
          if (exteriorIds.has(labels[i])) outside++;
        }
      // Цифры у самой стены при сглаживании сливаются с ней, поэтому «стены» в куске под надписью
      // бывает до 70 %; настоящая стена занимает кусок почти целиком (90–100 %).
      if (all && a <= 1.6 * pxPerM * pxPerM && wall <= 0.75 * all && outside <= 0.1 * all) { add.push(ring); continue; }
      // Мебель и сантехника вплотную к стене сливаются с ней: неглубокий вырез (до 0,75 м — глубина
      // мебели) тоже дозаполняем, если рядом с ним (0,3 м) нет соседнего помещения — иначе это
      // перегородка между комнатами.
      const bw = Math.max(...px) - Math.min(...px), bh = Math.max(...py) - Math.min(...py);
      if (!all || outside > 0.1 * all || Math.min(bw, bh) > 0.75 * pxPerM || a > 1.2 * pxPerM * pxPerM) continue;
      const mg = Math.round(0.3 * pxPerM);
      let other = 0, tot = 0;
      for (let y = Math.max(0, Math.floor(Math.min(...py)) - mg); y <= Math.min(h - 1, Math.ceil(Math.max(...py)) + mg); y += 2)
        for (let x = Math.max(0, Math.floor(Math.min(...px)) - mg); x <= Math.min(w - 1, Math.ceil(Math.max(...px)) + mg); x += 2) {
          const l = roomPx[y * w + x];
          tot++;
          if (l > 0 && l !== pp.id && (roomSet.has(l) || exteriorIds.has(l))) other++;
        }
      if (other <= 0.03 * tot) add.push(ring);
    }
    if (!add.length) continue;
    const u = union(toGeom(pp.poly), ...add.map((r) => toGeom(r)));
    if (u.length !== 1) continue;
    pp.poly = simplifyRing(fromRing(u[0][0]), 0.5);
    const r = rooms.find((x) => x.id === `r${pp.id}`)!;
    r.polygon = pp.poly.map((q) => ({ x: Math.round(U(q.x) * k), y: Math.round(U(q.y) * k) }));
  }

  // Сглаживание каждого контура независимо может создать перекрытие соседних зон.
  // В спорной части сохраняем владельца по пиксельной разметке до сглаживания.
  // Вырез принимаем только как одно кольцо с положительной площадью: комнату нельзя
  // потерять, разрезать на острова или молча удалить внутреннее отверстие.
  let unresolvedOverlaps = 0;
  for (let a = 0; a < pxPolys.length; a++) for (let b = a + 1; b < pxPolys.length; b++) {
    const A = pxPolys[a], B = pxPolys[b];
    const shared = intersection(toGeom(A.poly), toGeom(B.poly));
    if (!shared.length) continue;
    const points = shared.flatMap(part => fromRing(part[0]));
    let ownedA = 0, ownedB = 0;
    for (let y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)))); y < Math.min(h, Math.ceil(Math.max(...points.map(p => p.y)))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)))); x < Math.min(w, Math.ceil(Math.max(...points.map(p => p.x)))); x++) {
        if (!pointInGeom({ x: x + 0.5, y: y + 0.5 }, shared)) continue;
        if (roomPx[y * w + x] === A.id) ownedA++;
        if (roomPx[y * w + x] === B.id) ownedB++;
      }
    // При равенстве защищаем меньшую зону от расширившегося большого контура.
    const keepA = ownedA > ownedB || (ownedA === ownedB && polyArea(A.poly) <= polyArea(B.poly));
    const owner = keepA ? A : B, other = keepA ? B : A;
    const cut = difference(toGeom(other.poly), toGeom(owner.poly));
    if (cut.length !== 1 || cut[0].length !== 1) { unresolvedOverlaps++; continue; }
    const contour = fromRing(cut[0][0]);
    if (contour.length < 3 || polyArea(contour) < minRoomPx) { unresolvedOverlaps++; continue; }
    other.poly = contour;
    rooms.find(r => r.id === `r${other.id}`)!.polygon = contour.map(q => ({ x: Math.round(U(q.x) * k), y: Math.round(U(q.y) * k) }));
  }
  if (unresolvedOverlaps) notes.push(`Есть ${unresolvedOverlaps} спорных пересечений контуров — проверьте границы помещений.`);

  // Окна: на наружной стороне комнаты в полосе стены — несколько параллельных тонких линий
  // (остекление), в отличие от сплошной или двухконтурной стены.
  const bandPx = Math.max(4, Math.round(0.6 * pxPerM));
  const BAND_MM = 300;
  for (const { id, poly } of pxPolys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L < 0.6 * pxPerM) continue;
      const dir = { x: (q.x - p.x) / L, y: (q.y - p.y) / L };
      let out = { x: dir.y, y: -dir.x };
      const mx = Math.round((p.x + q.x) / 2 + out.x * 3), my = Math.round((p.y + q.y) / 2 + out.y * 3);
      if (mx >= 0 && my >= 0 && mx < w && my < h && labels[my * w + mx] === id) out = { x: -out.x, y: -out.y };
      const flags: boolean[] = [];
      for (let t = 0; t < L; t++) {
        const px = p.x + dir.x * t, py = p.y + dir.y * t;
        let trans = 0, prev = -1, paper = 0, other = false, n2 = 0;
        for (let d = 2; d <= bandPx; d++) {
          const x = Math.round(px + out.x * d), y = Math.round(py + out.y * d);
          if (x < 0 || y < 0 || x >= w || y >= h) break;
          const l = labels[y * w + x];
          if (l > 0 && l !== id && !exteriorIds.has(l)) { other = true; break; }
          const v = barrier.d[y * w + x];
          if (prev >= 0 && v !== prev) trans++;
          prev = v; n2++;
          if (!v) paper++;
        }
        flags.push(!other && trans >= 5 && paper / Math.max(1, n2) > 0.2 && paper / Math.max(1, n2) < 0.9);
      }
      // Серии «оконных» столбцов (с разрывами до 3 px), длиной 0,6–3,2 м.
      let s0 = -1, gapN = 0;
      const flush = (s: number, e: number) => {
        const len = (e - s) / pxPerM;
        if (len < 0.6 || len > 3.2) return;
        const off = (BAND_MM / 2) / mmPerPx;
        const A = { x: p.x + dir.x * s + out.x * off, y: p.y + dir.y * s + out.y * off };
        const B = { x: p.x + dir.x * e + out.x * off, y: p.y + dir.y * e + out.y * off };
        openings.push({ id: uid('o'), type: 'window', a: { x: Math.round(U(A.x) * k), y: Math.round(U(A.y) * k) }, b: { x: Math.round(U(B.x) * k), y: Math.round(U(B.y) * k) }, thickness: BAND_MM, hinge: 'a', swing: 1, isEntrance: false, sillHeight: null, ...prov(inp.page) });
      };
      for (let t = 0; t <= flags.length; t++) {
        if (t < flags.length && flags[t]) { if (s0 < 0) s0 = t; gapN = 0; }
        else if (s0 >= 0) { if (++gapN > 3 || t === flags.length) { flush(s0, t - gapN); s0 = -1; gapN = 0; } }
      }
    }
  }
  // Разрывы наружной стены: там, где уже найдено окно, — это окно; широкие (> 1,2 м) — тоже окна.
  const asWindow: { o: Opening; win: Opening }[] = [];
  for (const g of gapOpenings) {
    if (!g.outside) continue;
    const o = g.o, cm = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    const near = openings.find((x) => x.type === 'window' && Math.hypot((x.a.x + x.b.x) / 2 - cm.x, (x.a.y + x.b.y) / 2 - cm.y) < 800);
    if (near) { openings.splice(openings.indexOf(o), 1); asWindow.push({ o, win: near }); }
    else if (Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y) > 1200) { o.type = 'window'; o.isEntrance = false; o.thickness = BAND_MM; o.id = uid('o'); }
  }
  // Лишние «входы»: оставляем один — ближе всего к типовой ширине двери; остальные разрывы
  // наружной стены — окна.
  const ent = openings.filter((o) => o.isEntrance);
  ent.sort((x, y) => Math.abs(Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y) - 900) - Math.abs(Math.hypot(y.b.x - y.a.x, y.b.y - y.a.y) - 900));
  ent.slice(1).forEach((o) => {
    if (gapOpenings.some((g) => g.o === o)) { o.type = 'window'; o.isEntrance = false; o.thickness = BAND_MM; o.id = uid('o'); }
    else openings.splice(openings.indexOf(o), 1);
  });
  // Входа нет, но есть разрыв наружной стены шириной с дверь, принятый за окно (черты по граням
  // проёма похожи на остекление): считаем входом его.
  if (!ent.length) {
    const cand = asWindow
      .map((x) => ({ ...x, len: Math.hypot(x.o.b.x - x.o.a.x, x.o.b.y - x.o.a.y) }))
      .filter((x) => x.len >= 700 && x.len <= 1100)
      .sort((a, b) => Math.abs(a.len - 900) - Math.abs(b.len - 900))[0];
    if (cand) {
      openings.splice(openings.indexOf(cand.win), 1);
      openings.push(cand.o);
      ent.push(cand.o);
    }
  }
  // Входа всё ещё нет: в квартире вход ведёт в прихожую — помещение, куда открывается больше
  // всего дверей. Если у него есть проём наружу шириной с дверь (часто принят за окно), это вход.
  if (!ent.length && rooms.length >= 2) {
    const roomAt = (q: Pt) => rooms.find((r) => pointIn(q, r.polygon));
    const sides = (o: Opening) => {
      const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1;
      const m = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
      // Пробуем несколько отступов: точка у самого проёма может попасть в толщу стены.
      const side = (sg: number) => {
        for (const d of [350, 600, 900]) { const r = roomAt({ x: m.x + sg * dy / l * d, y: m.y - sg * dx / l * d }); if (r) return r; }
        return undefined;
      };
      return [side(1), side(-1)];
    };
    const deg = new Map<string, number>();
    for (const o of openings) if (o.type === 'door') for (const r of sides(o)) if (r) deg.set(r.id, (deg.get(r.id) ?? 0) + 1);
    // Прихожая и коридор оба «узловые»: пробуем помещения по убыванию числа дверей.
    const hubs = [...deg.entries()].sort((a, b) => b[1] - a[1]).filter((x) => x[1] >= 2);
    // Масштаб здесь ещё не уточнён — ширину сравниваем с медианой дверей этого же плана.
    const dl = openings.filter((o) => o.type === 'door').map((o) => Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y)).sort((a, b) => a - b);
    const typ = dl.length ? dl[Math.floor(dl.length / 2)] : 0;
    for (const hub of typ > 0 ? hubs : []) {
      if (ent.length) break;
      const cand = openings
        .filter((o) => o.type === 'window')
        .map((o) => ({ o, len: Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y), s: sides(o) }))
        .filter((x) => x.len >= 0.6 * typ && x.len <= 2.4 * typ && x.s.some((r) => r?.id === hub[0]) && x.s.some((r) => !r))
        .sort((a, b) => Math.abs(a.len - typ) - Math.abs(b.len - typ))[0];
      if (cand) {
        // Ширину приводим к типичной двери (проём, принятый за окно, обычно шире самой двери).
        const o = cand.o, f = Math.min(1, (1.2 * typ) / cand.len), m = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
        o.a = { x: m.x + (o.a.x - m.x) * f, y: m.y + (o.a.y - m.y) * f };
        o.b = { x: m.x + (o.b.x - m.x) * f, y: m.y + (o.b.y - m.y) * f };
        Object.assign(o, { type: 'door', isEntrance: true, thickness: 120, id: uid('d') });
        ent.push(cand.o);
      }
    }
  }
  const entrance = ent[0] ?? null;
  if (!entrance) notes.push('Вход не найден — отметьте входную дверь, если нужна проверка проходов.');
  // Меньше ~15 px на метр двери и тонкие перегородки уже не различимы.
  if (pxPerM < 15) notes.push('План на картинке слишком мелкий — двери и перегородки могут не распознаться. Загрузите скан крупнее (план хотя бы на пол-листа).');
  // Двери открываются в меньшее помещение.
  for (const [key, o] of doorOf) {
    if (o.isEntrance) { o.swing = 1; continue; }
    const [la, lb] = key.split(':').map(Number);
    const small = (area.get(la) ?? 0) < (area.get(lb) ?? 0) ? la : lb;
    const r = rooms.find((x) => x.id === `r${small}`);
    if (!r) continue;
    const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1;
    const nrm = { x: dy / l, y: -dx / l };
    const m = { x: (o.a.x + o.b.x) / 2 + nrm.x * 300, y: (o.a.y + o.b.y) / 2 + nrm.y * 300 };
    o.swing = pointIn(m, r.polygon) ? 1 : -1;
  }

  let geo: PlanGeometry = {
    ...emptyGeometry(), sourcePage: inp.page, rooms, openings,
    calibration: { p1: { x: 0, y: 0 }, p2: { x: U(pxPerM), y: 0 }, mm: 1000, mmPerUnit: k, method: areaM2 ? 'area' : 'assumed' },
  };
  // Без площади масштаб прикидываем по ширине двух крупнейших комнат ≈ 3,4 м (типично для квартир).
  // Оценка по ширине дверей на стенде (bench/) давала ошибку чаще: проёмы на сканах меряются грубо.
  let scaleMethod: 'area' | 'doors' | 'assumed' = areaM2 ? 'area' : 'assumed';
  if (scaleMethod === 'assumed') {
    const shorts = geo.rooms.map((r) => {
      const xs = r.polygon.map((q) => q.x), ys = r.polygon.map((q) => q.y);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      return { a: polyArea(r.polygon), s: Math.min(bw, bh), l: Math.max(bw, bh) };
    // Типовую ширину оцениваем по почти прямоугольным комнатам: ширина рамки
    // Г-образного коридора зависит от его поворотов и не является шириной помещения.
    }).filter((x) => x.l / x.s < 2.2 && (colored || x.a >= 0.85 * x.s * x.l)).sort((a, b) => b.a - a.a).slice(0, 2);
    if (shorts.length) {
      const f = 3400 / (shorts.reduce((t, x) => t + x.s, 0) / shorts.length);
      if (f > 0.4 && f < 2.5) {
        geo = { ...scaleGeometry(geo, f), calibration: { ...geo.calibration!, mmPerUnit: geo.calibration!.mmPerUnit * f, method: 'typical' } };
        pxPerM /= f;
        scaleMethod = 'doors';
      }
    }
  }
  const typed = assignTypes(geo, [], 1, entrance && geo.openings.find((o) => o.id === entrance.id) || null, inp.children);
  geo = { ...geo, rooms: typed.rooms };
  // Помещение за окном другого помещения — балкон или лоджия (меньшее из двух, наружное).
  {
    const at = (q: Pt) => geo.rooms.find((r) => pointIn(q, r.polygon));
    const balc = new Set<string>();
    for (const o of geo.openings) {
      if (o.type !== 'window') continue;
      const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1, m = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
      const side = (sg: number) => { for (const d of [300, 600, 900]) { const r = at({ x: m.x + sg * (dy / l) * d, y: m.y - sg * (dx / l) * d }); if (r) return r; } return undefined; };
      const r1 = side(1), r2 = side(-1);
      if (!r1 || !r2 || r1.id === r2.id) continue;
      const [sm, bg] = polyArea(r1.polygon) < polyArea(r2.polygon) ? [r1, r2] : [r2, r1];
      // Балкон невелик (до 8 м²) и заметно меньше комнаты, из которой на него выходят.
      if (polyArea(sm.polygon) <= 8e6 && polyArea(sm.polygon) <= 0.5 * polyArea(bg.polygon)) balc.add(sm.id);
    }
    if (balc.size) geo = { ...geo, rooms: geo.rooms.map((r) => (balc.has(r.id) ? { ...r, type: 'balcony', name: 'Балкон / лоджия' } : r)) };
  }
  geo = { ...geo, openings: [...geo.openings, ...inferMissingDoors(geo, inp.page)] };

  // 6. Маска стен для подложки: преграды без мелкого «шума» (текст, цифры), только в пределах квартиры.
  const wallsMask = { rgba: new Uint8ClampedArray(n * 4), w, h };
  const { labels: bl, comps } = components(solid);
  // На подложку — только общая сеть стен (без отдельно висящих надписей и значков).
  const largestWall = comps.reduce((a, c) => (c.area > a.area ? c : a), comps[0]);
  const big = new Set(comps.filter((c) => c === largestWall || (c.area >= largestWall.area * 0.03 && Math.max(c.x1 - c.x0, c.y1 - c.y0) >= pxPerM * 1.2)).map((c) => c.id));
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (let i = 0; i < n; i++) if (labels[i] > 0 && !exteriorIds.has(labels[i])) { const x = i % w, y = (i - x) / w; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const pad = Math.round(pxPerM * 0.6);
  for (let i = 0; i < n; i++) {
    if (!big.has(bl[i])) continue;
    const x = i % w, y = (i - x) / w;
    if (x < bx0 - pad || x > bx1 + pad || y < by0 - pad || y > by1 + pad) continue;
    wallsMask.rgba[i * 4] = wallsMask.rgba[i * 4 + 1] = wallsMask.rgba[i * 4 + 2] = 255;
    wallsMask.rgba[i * 4 + 3] = 255;
  }

  return {
    geometry: geo,
    wallsMask,
    report: {
      rooms: geo.rooms.map((r) => ({ name: r.name, type: r.type, areaM2: Math.round(polyArea(r.polygon) / 1e4) / 100 })),
      doors: openings.length, entrance: !!entrance, pxPerM, areaAssumed: !areaM2, scaleMethod, notes, ms: Date.now() - t0 + seedCount * 0,
    },
  };
}

/**
 * У каждого помещения (кроме балкона) есть дверь. Если распознавание её не нашло, ставим
 * предполагаемую дверь (подсказку) в общей стене с прихожей или коридором, иначе — с соседом,
 * у которого общая стена длиннее. Без этого помещение «недостижимо», и мебель в нём не встаёт.
 */
export function inferMissingDoors(g: PlanGeometry, page: number | null): Opening[] {
  const rooms = g.rooms.filter((r) => r.type !== 'balcony');
  const doors = g.openings.filter((o) => o.type === 'door');
  const touches = (o: Opening, r: Room) => {
    const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1, m = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    return [1, -1].some((sg) => [150, 400, 700].some((d) => pointIn({ x: m.x + sg * (dy / l) * d, y: m.y - sg * (dx / l) * d }, r.polygon)));
  };
  // Общие участки стен: параллельные рёбра двух помещений на расстоянии до 0,6 м, перекрытие от 0,9 м.
  const shared = (r: Room, q: Room) => {
    let best: { len: number; a: Pt; b: Pt; gap: number } | null = null;
    const E = (p: Pt[]) => p.map((a, i) => [a, p[(i + 1) % p.length]] as const);
    for (const [a1, b1] of E(r.polygon)) for (const [a2, b2] of E(q.polygon)) {
      const h1 = Math.abs(a1.y - b1.y) < 1, h2 = Math.abs(a2.y - b2.y) < 1, v1 = Math.abs(a1.x - b1.x) < 1, v2 = Math.abs(a2.x - b2.x) < 1;
      let gap: number, lo: number, hi: number, mid: (t: number) => Pt;
      if (h1 && h2) {
        gap = Math.abs(a1.y - a2.y); lo = Math.max(Math.min(a1.x, b1.x), Math.min(a2.x, b2.x)); hi = Math.min(Math.max(a1.x, b1.x), Math.max(a2.x, b2.x));
        const y = (a1.y + a2.y) / 2; mid = (t) => ({ x: t, y });
      } else if (v1 && v2) {
        gap = Math.abs(a1.x - a2.x); lo = Math.max(Math.min(a1.y, b1.y), Math.min(a2.y, b2.y)); hi = Math.min(Math.max(a1.y, b1.y), Math.max(a2.y, b2.y));
        const x = (a1.x + a2.x) / 2; mid = (t) => ({ x, y: t });
      } else continue;
      if (gap > 600 || hi - lo < 900 || (best && hi - lo <= best.len)) continue;
      const c = (lo + hi) / 2;
      best = { len: hi - lo, a: mid(c - 400), b: mid(c + 400), gap };
    }
    return best;
  };
  const out: Opening[] = [];
  const mk = (s: { a: Pt; b: Pt; gap: number }): Opening => ({ id: uid('d'), type: 'door', a: s.a, b: s.b, thickness: Math.max(80, Math.round(s.gap)), hinge: 'a', swing: 1, isEntrance: false, sillHeight: null, source: 'suggested', verifiedByManager: false, sourcePage: page });
  const isPass = (q: Room) => q.type === 'hall' || q.type === 'corridor';
  // Каждое помещение достижимо от входа: идём от помещения со входной дверью; недостижимое
  // соединяем подсказкой-дверью с уже достижимым соседом (прихожая и коридор — в первую очередь).
  const ent = doors.find((o) => o.isEntrance);
  const start = ent ? rooms.find((r) => touches(ent, r)) : undefined;
  if (start) {
    const reached = new Set([start.id]);
    const linked = (a: Room, b: Room) => [...doors, ...out].some((o) => !o.isEntrance && touches(o, a) && touches(o, b));
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of rooms) if (!reached.has(r.id) && rooms.some((q) => reached.has(q.id) && linked(r, q))) { reached.add(r.id); changed = true; }
      if (changed) continue;
      // Никого нового по дверям — добавляем одну дверь: недостижимое помещение ↔ достижимый сосед.
      let pick: { r: Room; s: { a: Pt; b: Pt; gap: number; len: number }; pass: boolean } | null = null;
      for (const r of rooms) {
        if (reached.has(r.id)) continue;
        for (const q of rooms) {
          if (!reached.has(q.id)) continue;
          const sh = shared(r, q);
          if (!sh) continue;
          const better = !pick || (+isPass(q) > +pick.pass) || (isPass(q) === pick.pass && sh.len > pick.s.len);
          if (better) pick = { r, s: sh, pass: isPass(q) };
        }
      }
      if (!pick) break;
      out.push(mk(pick.s));
      changed = true;
    }
  }
  for (const r of rooms) {
    if (doors.some((o) => touches(o, r)) || out.some((o) => touches(o, r))) continue;
    const cands = rooms.filter((q) => q.id !== r.id).map((q) => ({ q, s: shared(r, q) })).filter((x) => x.s)
      .sort((x, y) => (+(y.q.type === 'hall' || y.q.type === 'corridor') - +(x.q.type === 'hall' || x.q.type === 'corridor')) || y.s!.len - x.s!.len);
    const c = cands[0];
    if (!c) continue;
    out.push(mk(c.s!));
  }
  return out;
}

function pointIn(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function labelBoxes(labels: Int32Array, w: number): Map<number, { x0: number; y0: number; x1: number; y1: number }> {
  const m = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l <= 0) continue;
    const x = i % w, y = (i - x) / w;
    const b = m.get(l);
    if (!b) m.set(l, { x0: x, y0: y, x1: x, y1: y });
    else { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
  }
  return m;
}

/**
 * Чёрточки поперёк стен. Сканируем столбцы (горизонтальные стены) и строки (вертикальные):
 * переход «метка A → преграда → метка B» — пересечение стены. Для каждой стены между A и B
 * берём обычную толщину (медиану); узкое место (до ~10 см вдоль стены), где преграда шире
 * с обеих сторон, — чёрточка двери.
 */
function tickCrossings(labels: Int32Array, w: number, h: number, pxPerM: number) {
  const out: { la: number; lb: number; horiz: boolean; at: number; mid: number; from: number; to: number }[] = [];
  const maxWall = 0.7 * pxPerM, maxTick = Math.max(3, Math.round(0.1 * pxPerM)), stick = Math.max(2, Math.round(0.04 * pxPerM));
  for (const horiz of [true, false]) {
    // horiz: стена горизонтальна, сканируем столбцы x, вдоль столбца — поперёк стены.
    const lines = horiz ? w : h, len = horiz ? h : w;
    const at = (line: number, i: number) => (horiz ? i * w + line : line * w + i);
    const cross = new Map<string, { line: number; a0: number; a1: number }[]>();
    for (let line = 0; line < lines; line++) {
      let prev = 0, runStart = -1;
      for (let i = 0; i < len; i++) {
        const l = labels[at(line, i)];
        if (l <= 0) { if (runStart < 0) runStart = i; continue; }
        if (runStart >= 0 && prev > 0 && l !== prev && i - runStart <= maxWall) {
          const a = Math.min(prev, l), b = Math.max(prev, l);
          const key = `${a}:${b}:${Math.round((runStart + i) / 2 / (0.3 * pxPerM))}`;
          const list = cross.get(key) ?? [];
          list.push({ line, a0: runStart, a1: i - 1 });
          cross.set(key, list);
        }
        prev = l; runStart = -1;
      }
    }
    for (const [key, list] of cross) {
      if (list.length < 3 * maxTick) continue;
      const [la, lb] = key.split(':').map(Number);
      const med = (v: number[]) => v.sort((x, y) => x - y)[Math.floor(v.length / 2)];
      const b0 = med(list.map((c) => c.a0)), b1 = med(list.map((c) => c.a1));
      list.sort((x, y) => x.line - y.line);
      const from = list[0].line, to = list[list.length - 1].line;
      let i = 0;
      while (i < list.length) {
        if (!(list[i].a0 <= b0 - stick && list[i].a1 >= b1 + stick)) { i++; continue; }
        let j = i;
        while (j + 1 < list.length && list[j + 1].line === list[j].line + 1 && list[j + 1].a0 <= b0 - stick && list[j + 1].a1 >= b1 + stick) j++;
        const width = list[j].line - list[i].line + 1;
        // Узкий шип посередине стены (не на её конце, где стена упирается в другую).
        if (width <= maxTick && list[i].line - from > maxTick && to - list[j].line > maxTick)
          out.push({ la, lb, horiz, at: (list[i].line + list[j].line) / 2, mid: (b0 + b1) / 2, from, to });
        i = j + 1;
      }
    }
  }
  return out;
}

/** Где две разные метки соприкасаются (через свободные пиксели). */
function contactsOf(labels: Int32Array, w: number, h: number): Map<string, { xs: number[]; ys: number[] }> {
  const contacts = new Map<string, { xs: number[]; ys: number[] }>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, a = labels[p];
      if (a <= 0) continue;
      for (const q of [x < w - 1 ? p + 1 : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0) continue;
        const b = labels[q];
        if (b <= 0 || b === a) continue;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const c = contacts.get(key) ?? { xs: [], ys: [] };
        c.xs.push(x); c.ys.push(y);
        contacts.set(key, c);
      }
    }
  return contacts;
}

/**
 * Сначала находим сам план на странице: самую крупную «толстую» сеть стен
 * (тонкие линии рамки листа, шапки, штампа и текста так не выглядят), обрезаем до неё,
 * затем ищем комнаты только внутри плана.
 */
export function quickPlan(inp: QuickInput): QuickResult {
  const { w, h, rgba } = inp;
  const n = w * h;
  const P = paperColor(rgba, n);
  const ink = newBin(w, h);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (Math.max(Math.abs(rgba[p] - P[0]), Math.abs(rgba[p + 1] - P[1]), Math.abs(rgba[p + 2] - P[2])) > 32) ink.d[i] = 1;
  }
  const kt = Math.max(2, Math.round(Math.min(w, h) / 300));
  // Закрытие заполняет штриховку и серую заливку стен, открытие убирает тонкие линии рамки и текста.
  const thick = dilate(erode(erode(dilate(ink, kt), kt), kt), kt);
  const { comps } = components(thick);
  if (!comps.length) return quickPlanCore(inp);
  // Крупнейшая толстая компонента + всё толстое рядом с ней (стены, разорванные проёмами).
  const main = comps.reduce((a, c) => (c.area > a.area ? c : a));
  const mw = main.x1 - main.x0, mh = main.y1 - main.y0;
  // Слишком мелкая «толстая» находка (значок легенды, штамп) — не план: не обрезаем.
  if (mw < w * 0.12 || mh < h * 0.08) return quickPlanCore(inp);
  let x0 = main.x0, y0 = main.y0, x1 = main.x1, y1 = main.y1;
  for (const c of comps) {
    if (c.area < main.area * 0.02) continue;
    const near = c.x1 >= x0 - mw * 0.3 && c.x0 <= x1 + mw * 0.3 && c.y1 >= y0 - mh * 0.3 && c.y0 <= y1 + mh * 0.3;
    if (near) { x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1); }
  }
  const padX = Math.round((x1 - x0) * 0.06) + 4, padY = Math.round((y1 - y0) * 0.06) + 4;
  const cx0 = Math.max(0, x0 - padX), cy0 = Math.max(0, y0 - padY), cx1 = Math.min(w - 1, x1 + padX), cy1 = Math.min(h - 1, y1 + padY);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  // План занимает почти всю картинку — обрезать нечего.
  if (cw * ch > n * 0.85) return quickPlanCore(inp);
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((cy0 + y) * w + cx0) * 4, ((cy0 + y) * w + cx0 + cw) * 4), y * cw * 4);
  const r = quickPlanCore({ ...inp, rgba: crop, w: cw, h: ch });
  const k = r.geometry.calibration!.mmPerUnit;
  const ox = (cx0 / inp.pxPerUnit) * k, oy = (cy0 / inp.pxPerUnit) * k;
  const sh = (q: Pt): Pt => ({ x: Math.round(q.x + ox), y: Math.round(q.y + oy) });
  const g = r.geometry;
  return {
    ...r,
    geometry: {
      ...g,
      rooms: g.rooms.map((x) => ({ ...x, polygon: x.polygon.map(sh) })),
      openings: g.openings.map((o) => ({ ...o, a: sh(o.a), b: sh(o.b) })),
      fixed: g.fixed.map((f) => ({ ...f, polygon: f.polygon.map(sh) })),
    },
  };
}
