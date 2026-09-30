// Быстрый режим для сканов, фото и скриншотов плана: ищем не стены, а светлые комнаты
// («заливка»), делим их по узким дверным проёмам, строим контуры, двери и чистую стилизованную подложку.
import type { Opening, PlanGeometry, Pt, Room } from '../model/types';
import { emptyGeometry, uid } from '../model/defaults';
import { closeDir, components, dilate, erode, newBin, or, type Bin } from '../recognize/raster';
import { assignTypes } from '../recognize/index';
import { simplifyRing, union, fromRing, toGeom, polyArea } from '../geometry/poly';
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

/** Цвет «бумаги»: медиана ярких малонасыщенных пикселей. */
function paperColor(d: Uint8ClampedArray | Uint8Array, n: number): [number, number, number] {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let cnt = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    if (Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 30) { hist[0][r]++; hist[1][g]++; hist[2][b]++; cnt++; }
  }
  const med = (h: Uint32Array) => { let s = 0; for (let v = 0; v < 256; v++) { s += h[v]; if (s >= cnt / 2) return v; } return 245; };
  return cnt ? [med(hist[0]), med(hist[1]), med(hist[2])] : [245, 245, 245];
}

const openBin = (b: Bin, k: number) => dilate(erode(b, k), k);

/** Многоисточниковый рост меток по разрешённым пикселям. */
function grow(labels: Int32Array, allowed: Uint8Array, w: number, h: number) {
  let frontier: number[] = [];
  for (let i = 0; i < labels.length; i++) if (labels[i] > 0) frontier.push(i);
  while (frontier.length) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w, y = (p - x) / w, l = labels[p];
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && allowed[q] && labels[q] === 0) { labels[q] = l; next.push(q); }
    }
    frontier = next;
  }
}

/** Контур метки на грубой сетке → прямоугольный полигон (внешнее кольцо). */
function labelPolygon(labels: Int32Array, w: number, h: number, id: number, cell: number): Pt[] | null {
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
  return straighten(simplifyRing(fromRing(biggest[0]), cell * 0.5), cell * 3);
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
  for (let iter = 0; iter < 3; iter++) {
    // Текст и мелкие значки (меньше ~0,6 м) — не преграда: иначе режут комнату на куски.
    const small = new Uint8Array(solidComps.comps.length + 1);
    // Стены — одна большая связная сеть; отдельно висящие надписи и значки (даже крупные) — не стены.
    const largest = solidComps.comps.reduce((a, c) => (c.area > a.area ? c : a), solidComps.comps[0]);
    for (const c of solidComps.comps) small[c.id] = Math.max(c.x1 - c.x0, c.y1 - c.y0) < 0.8 * pxPerM || (c !== largest && c.area < largest.area * 0.03) ? 1 : 0;
    for (let i = 0; i < n; i++) free.d[i] = solid.d[i] && !small[solidComps.labels[i]] ? 0 : 1;
    const k = Math.max(3, Math.round(0.9 * pxPerM));
    const seeds = openBin(free, k);
    const { labels: lab, comps } = components(seeds);
    labels = lab;
    exteriorIds = new Set(comps.filter(isOutside).map((c) => c.id));
    seedCount = comps.length;
    grow(labels, free.d, w, h);
    // «Снаружи» уточняем по итоговым областям (затравка после открытия могла не дойти до рамки).
    for (const [id, b] of labelBoxes(labels, w)) if (isOutside(b)) exteriorIds.add(id);
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
  grow(labels, free.d, w, h);

  // Соприкосновение шире 1,4 м — это не дверь, а одна комната, разрезанная текстом или значком: склеиваем.
  let contacts = contactsOf(labels, w, h);
  const parent = new Map<number, number>();
  const find = (x: number): number => { while (parent.has(x)) x = parent.get(x)!; return x; };
  for (const [key, c] of contacts) {
    const [la, lb] = key.split(':').map(Number);
    if (exteriorIds.has(la) || exteriorIds.has(lb)) continue;
    const ext = Math.max(Math.max(...c.xs) - Math.min(...c.xs), Math.max(...c.ys) - Math.min(...c.ys));
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
  const m = 0.5 * pxPerM;
  const core = bigIds.length ? bigIds.map((l) => boxes.get(l)!).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : null;
  const inCore = (l: number) => {
    if (!core) return true;
    const b = boxes.get(l)!;
    return b.x1 >= core.x0 - m && b.x0 <= core.x1 + m && b.y1 >= core.y0 - m && b.y0 <= core.y1 + m;
  };
  const roomIds = [...new Set(labels)].filter((l) => l > 0 && !exteriorIds.has(l) && inCore(l));

  // 4. Дверные проёмы: где две метки соприкасаются через свободные пиксели.
  const U = (px: number) => px / inp.pxPerUnit; // пиксели распознавания → единицы листа
  const k = mmPerPx * inp.pxPerUnit; // мм на единицу листа
  const openings: Opening[] = [];
  const doorOf = new Map<string, Opening>();
  for (const [key, c] of contacts) {
    const [la, lb] = key.split(':').map(Number);
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

  // 5. Полигоны помещений (мм).
  const cell = Math.max(2, Math.round(pxPerM * 0.1));
  const rooms: Room[] = [];
  const pxPolys: { id: number; poly: Pt[] }[] = [];
  for (const id of roomIds) {
    const poly = labelPolygon(labels, w, h, id, cell);
    if (!poly || poly.length < 4) continue;
    const mm = poly.map((q) => ({ x: Math.round(U(q.x) * k), y: Math.round(U(q.y) * k) }));
    if (polyArea(mm) / 1e6 < 1) continue;
    rooms.push({ id: `r${id}`, name: 'Помещение', type: 'other', polygon: mm, ...prov(inp.page) });
    pxPolys.push({ id, poly });
  }

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
  // Лишние «входы»: оставляем один — ближе всего к типовой ширине двери.
  const ent = openings.filter((o) => o.isEntrance);
  ent.sort((x, y) => Math.abs(Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y) - 900) - Math.abs(Math.hypot(y.b.x - y.a.x, y.b.y - y.a.y) - 900));
  ent.slice(1).forEach((o) => openings.splice(openings.indexOf(o), 1));
  const entrance = ent[0] ?? null;
  if (!entrance) notes.push('Вход не найден — отметьте входную дверь, если нужна проверка проходов.');
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
  // Без площади масштаб прикидываем по дверным проёмам: межкомнатная дверь ≈ 0,85 м.
  let scaleMethod: 'area' | 'doors' | 'assumed' = areaM2 ? 'area' : 'assumed';
  if (!areaM2) {
    const ws = openings.filter((o) => !o.isEntrance).map((o) => Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y)).filter((x) => x >= 450 && x < 1600).sort((a, b) => a - b);
    if (ws.length >= 2) {
      const f = 850 / ws[Math.floor(ws.length / 2)];
      if (f > 0.5 && f < 2) {
        geo = { ...scaleGeometry(geo, f), calibration: { ...geo.calibration!, mmPerUnit: geo.calibration!.mmPerUnit * f, method: 'typical' } };
        pxPerM /= f;
        scaleMethod = 'doors';
      }
    }
  }
  // Нет ни площади, ни дверей: ширина двух крупнейших комнат ≈ 3,8 м (типично для квартир).
  if (scaleMethod === 'assumed') {
    const shorts = geo.rooms.map((r) => {
      const xs = r.polygon.map((q) => q.x), ys = r.polygon.map((q) => q.y);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      return { a: polyArea(r.polygon), s: Math.min(bw, bh), l: Math.max(bw, bh) };
    }).filter((x) => x.l / x.s < 2.2).sort((a, b) => b.a - a.a).slice(0, 2);
    if (shorts.length) {
      const f = 3800 / (shorts.reduce((t, x) => t + x.s, 0) / shorts.length);
      if (f > 0.4 && f < 2.5) {
        geo = { ...scaleGeometry(geo, f), calibration: { ...geo.calibration!, mmPerUnit: geo.calibration!.mmPerUnit * f, method: 'typical' } };
        pxPerM /= f;
        scaleMethod = 'doors';
      }
    }
  }
  const typed = assignTypes(geo, [], 1, entrance && geo.openings.find((o) => o.id === entrance.id) || null, inp.children);
  geo = { ...geo, rooms: typed.rooms };

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
