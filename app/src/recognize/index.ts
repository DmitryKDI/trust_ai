// Автораспознавание плана: изображение страницы (+ векторы и текст PDF, если есть) → PlanGeometry.
// Всё найденное помечается source: 'suggested', verifiedByManager: false — менеджер проверяет и правит.
import type { Opening, PlanGeometry, Pt, Room, RoomType, Wall } from '../model/types';
import { emptyGeometry, uid } from '../model/defaults';
import { detectAllRooms } from './rooms';
import { clearBoxes, close, closeDir, filterComponents, inkMask, open, or, type Bin } from './raster';
import { rectThick, wallRects, type PxRect } from './walls';
import { scaleFromDimensions } from './scale';
import type { PageVectors } from '../pdf/vectors';
import type { TextBox } from '../pdf/text';
import { centroid, dist, polyArea, pointInPolygon } from '../geometry/poly';

export interface RecognizeInput {
  rgba: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
  /** Пикселей на единицу листа (PDF: px на pt; растр: 1). */
  pxPerUnit: number;
  /** Пикселей на мм бумаги — задаёт размеры фильтров. Для сканов — оценка (по умолчанию 300 dpi). */
  pxPerPaperMm: number;
  texts?: TextBox[];
  vectors?: PageVectors | null;
  briefAreaM2?: number | null;
  children?: number;
  page: number | null;
  /** Масштаб «на крайний случай», мм на единицу листа. */
  fallbackK: number;
}

export interface RecognizeReport {
  scale: { k: number; method: 'dimensions' | 'area' | 'typical' | 'assumed'; support: number };
  walls: number;
  openings: { doors: number; windows: number; entrance: boolean };
  rooms: { name: string; type: RoomType; areaM2: number; byLabel: boolean }[];
  notes: string[];
  ms: number;
}

const prov = (page: number | null) => ({ source: 'suggested' as const, verifiedByManager: false, sourcePage: page });

const LABELS: [RegExp, RoomType, string][] = [
  [/кухн.*гост|гост.*кухн|кухня-столов/i, 'kitchen-living', 'Кухня-гостиная'],
  [/кухн/i, 'kitchen', 'Кухня'],
  [/гост|общая комн/i, 'living', 'Гостиная'],
  [/детск/i, 'kids', 'Детская'],
  [/спальн|жил/i, 'bedroom', 'Спальня'],
  [/ванн/i, 'bath', 'Ванная'],
  [/с\/?у|санузел|туалет|уборн|wc/i, 'wc', 'Санузел'],
  [/прихож|холл/i, 'hall', 'Прихожая'],
  [/коридор/i, 'corridor', 'Коридор'],
  [/кладов|гардероб|постироч/i, 'storage', 'Кладовая'],
  [/балкон|лодж/i, 'balcony', 'Балкон / лоджия'],
];

/** Для растра без текста пробуем оба способа очистки и берём результат с правдоподобными комнатами. */
export function recognize(inp: RecognizeInput): { geometry: PlanGeometry; report: RecognizeReport } {
  if (inp.texts?.length) return recognizeOnce(inp, false);
  const a = recognizeOnce(inp, true), b = recognizeOnce(inp, false);
  const score = (r: { report: RecognizeReport }) => r.report.rooms.reduce((s, x) => s + (x.areaM2 >= 1.2 && x.areaM2 <= 35 ? 1 : x.areaM2 > 35 ? -2 : 0), 0);
  return score(a) >= score(b) ? a : b;
}

function recognizeOnce(inp: RecognizeInput, dropSmallBlobs: boolean): { geometry: PlanGeometry; report: RecognizeReport } {
  const t0 = Date.now();
  const { w, h, pxPerUnit: ppu, pxPerPaperMm: ppm } = inp;
  const notes: string[] = [];

  // 1. Маска стен: чернила без текста → закрытие (штриховка) → открытие (тонкие линии) → крупные компоненты.
  let ink = inkMask(inp.rgba, w, h);
  if (inp.texts?.length) clearBoxes(ink, inp.texts.map((t) => [t.x0 * ppu, t.y0 * ppu, t.x1 * ppu, t.y1 * ppu] as [number, number, number, number]), 2);
  else if (dropSmallBlobs) {
    // Растр без текстового слоя (скан, фото): убираем мелкие отдельные пятна — буквы, цифры, стрелки.
    const small = 3 * ppm;
    ink = filterComponents(ink, (c) => Math.max(c.x1 - c.x0, c.y1 - c.y0) >= small);
  }
  const kClose = Math.max(3, Math.round(1.2 * ppm));
  const kDir = Math.max(5, Math.round(2.2 * ppm)); // перегородка «двумя линиями» до ~2 мм на бумаге
  const kOpen = Math.max(3, Math.round(0.6 * ppm));
  let mask = open(or(close(ink, kClose), closeDir(ink, kDir, true), closeDir(ink, kDir, false)), kOpen);
  mask = filterComponents(mask, (c, L) => {
    const side = Math.max(c.x1 - c.x0, c.y1 - c.y0), Lside = Math.max(L.x1 - L.x0, L.y1 - L.y0);
    // рядом с основным планом (легенда, штамп и подписи обычно в стороне)
    const pad = Lside * 0.08;
    const near = c.x1 >= L.x0 - pad && c.x0 <= L.x1 + pad && c.y1 >= L.y0 - pad && c.y0 <= L.y1 + pad;
    return near && (c.area >= L.area * 0.01 || side >= Lside * 0.08);
  });
  const rects = wallRects(mask, Math.round(2 * ppm), kOpen, 2);
  if (!rects.length) {
    notes.push('Стены не найдены: проверьте, что выбрана страница с планом.');
    return { geometry: { ...emptyGeometry(), sourcePage: inp.page }, report: { scale: { k: inp.fallbackK, method: 'assumed', support: 0 }, walls: 0, openings: { doors: 0, windows: 0, entrance: false }, rooms: [], notes, ms: Date.now() - t0 } };
  }

  // 2. Масштаб: размерные числа (PDF) → иначе позже по площади из брифа → иначе условный.
  let method: RecognizeReport['scale']['method'] = 'assumed';
  let k = inp.fallbackK, support = 0;
  let cal: PlanGeometry['calibration'] = null;
  if (inp.texts?.length && inp.vectors?.segments.length) {
    const s = scaleFromDimensions(inp.texts, inp.vectors.segments);
    if (s) { k = s.k; method = 'dimensions'; support = s.support; cal = { p1: s.p1, p2: s.p2, mm: s.mm, mmPerUnit: s.k, method }; }
  }

  // 3. Стены в единицах листа.
  const U = (px: number) => px / ppu;
  const wallsU: (Wall & { r: PxRect })[] = rects.map((r) => {
    const t = U(rectThick(r));
    const a = r.horizontal ? { x: U(r.x0), y: U((r.y0 + r.y1 + 1) / 2) } : { x: U((r.x0 + r.x1 + 1) / 2), y: U(r.y0) };
    const b = r.horizontal ? { x: U(r.x1 + 1), y: a.y } : { x: a.x, y: U(r.y1 + 1) };
    return { id: uid('w'), a, b, thickness: t, kind: 'unknown', ...prov(inp.page), r };
  });

  // Пороги проёмов: в мм, если масштаб известен; иначе относительно толщины перегородок.
  const ts = wallsU.map((x) => x.thickness).sort((a, b) => a - b);
  const tRef = ts[Math.floor(ts.length * 0.25)] || 1;
  const gapMin = method === 'dimensions' ? 450 / k : tRef * 3.5;
  // Широкие разрывы (окна) — только в толстых (наружных) стенах; двери — до 1,3 м.
  const gapWindow = method === 'dimensions' ? 3300 / k : tRef * 28;
  const gapDoor = method === 'dimensions' ? 1300 / k : tRef * 11;
  const thickWall = method === 'dimensions' ? 250 / k : tRef * 2;

  // 4. Проёмы.
  const openingsU: (Opening & { glazing: boolean; arc: boolean })[] = [];
  const axis = (W: Wall & { r: PxRect }) => ({ hz: W.r.horizontal, c: W.r.horizontal ? W.a.y : W.a.x, s: W.r.horizontal ? W.a.x : W.a.y, e: W.r.horizontal ? W.b.x : W.b.y });
  const collinear = (A: Wall & { r: PxRect }, B: Wall & { r: PxRect }) =>
    A.r.horizontal === B.r.horizontal && Math.abs(axis(A).c - axis(B).c) <= Math.max(A.thickness, B.thickness) * 0.35;
  // Торец стены в Т-образном стыке (поперечная стена идёт в обе стороны) — не откос: иначе «проём» через комнату.
  const endBlocked = (A: Wall & { r: PxRect }, along: number) => {
    const { hz, c } = axis(A);
    return wallsU.some((B) => {
      if (B.r.horizontal === hz) return false;
      const bb = axis(B);
      if (Math.abs(bb.c - along) > B.thickness / 2 + tRef * 0.3) return false;
      return c - bb.s >= A.thickness * 2 && bb.e - c >= A.thickness * 2;
    });
  };
  // Кусок W лежит в полосе толщины стены N (соосно или у её края).
  const inBand = (W: Wall & { r: PxRect }, N: Wall & { r: PxRect }) =>
    W.r.horizontal === N.r.horizontal && Math.abs(axis(W).c - axis(N).c) <= N.thickness / 2 + W.thickness / 2 * 0.2;
  const addOpening = (hz: boolean, c: number, from: number, to: number, t: number, forceWindow = false) => {
    const a: Pt = hz ? { x: from, y: c } : { x: c, y: from };
    const b: Pt = hz ? { x: to, y: c } : { x: c, y: to };
    if (openingsU.some((o) => (dist(o.a, a) < tRef && dist(o.b, b) < tRef) || (dist(o.a, b) < tRef && dist(o.b, a) < tRef))) return;
    const glazing = forceWindow || hasGlazing(ink, a, b, t, ppu);
    const arcDoor = forceWindow ? null : doorArc(inp.vectors, ink, a, b, t, ppu);
    openingsU.push({
      id: uid('o'), type: glazing && !arcDoor ? 'window' : 'door', a, b, thickness: t,
      hinge: arcDoor?.hinge ?? 'a', swing: arcDoor?.swing ?? 1, isEntrance: false, sillHeight: null, ...prov(inp.page),
      glazing, arc: !!arcDoor,
    });
  };

  // 4а. Окно, «заложенное» тонкой полосой (подоконник + остекление): тонкий кусок между двумя толстыми соосными.
  for (const W of wallsU.slice()) {
    const { hz, s, e } = axis(W);
    const L = e - s;
    if (L < gapMin || L > gapWindow) continue;
    const left = wallsU.find((A) => A !== W && A.thickness > W.thickness && inBand(W, A) && Math.abs(axis(A).e - s) <= tRef * 0.6);
    const right = wallsU.find((B) => B !== W && B.thickness > W.thickness && inBand(W, B) && Math.abs(axis(B).s - e) <= tRef * 0.6);
    const tn = Math.min(left?.thickness ?? 0, right?.thickness ?? 0);
    if (left && right && tn >= thickWall && W.thickness <= tn * 0.65) {
      wallsU.splice(wallsU.indexOf(W), 1);
      addOpening(hz, (axis(left).c + axis(right).c) / 2, s, e, tn, true);
    }
  }

  // 4б. Разрывы между соосными кусками и между свободным торцом и гранью перпендикулярной стены (дверь у угла).
  for (const A of wallsU) {
    const { hz, c: ac } = axis(A);
    const aT = A.thickness;
    for (const dirSign of [1, -1] as const) {
      const aEnd = dirSign > 0 ? axis(A).e : axis(A).s;
      if (endBlocked(A, aEnd)) continue;
      let best: { at: number; t: number } | null = null;
      for (const B of wallsU) {
        if (B === A) continue;
        if (collinear(A, B)) {
          if (dirSign < 0) continue; // соосные пары учитываются один раз (A.e → B.s)
          const bStart = axis(B).s;
          if (endBlocked(B, bStart)) continue;
          const gap = bStart - aEnd;
          const maxGap = Math.min(aT, B.thickness) >= thickWall ? gapWindow : gapDoor;
          if (gap >= gapMin && gap <= maxGap && (!best || bStart < best.at)) best = { at: bStart, t: Math.min(aT, B.thickness) };
        } else if (B.r.horizontal !== hz) {
          const bb = axis(B);
          if (ac < bb.s - 1e-6 || ac > bb.e + 1e-6) continue;
          const face = bb.c - dirSign * B.thickness / 2;
          const gap = (face - aEnd) * dirSign;
          if (gap >= gapMin && gap <= gapDoor && (!best || Math.abs(face - aEnd) < Math.abs(best.at - aEnd))) best = { at: face, t: aT };
        }
      }
      if (!best) continue;
      const lo = Math.min(aEnd, best.at), hi = Math.max(aEnd, best.at);
      const mid = (lo + hi) / 2;
      const blocked = wallsU.some((C) => C !== A && collinear(A, C) && axis(C).s < mid && axis(C).e > mid);
      if (blocked) continue;
      addOpening(hz, ac, lo, hi, best.t);
    }
  }

  // 5. Геометрия в мм (пока с текущим масштабом) и помещения.
  const toMm = (f: number) => ({
    walls: wallsU.map(({ r: _r, ...x }) => ({ ...x, a: sc(x.a, f), b: sc(x.b, f), thickness: x.thickness * f })),
    openings: openingsU.map(({ glazing: _g, arc: _a, ...x }) => ({ ...x, a: sc(x.a, f), b: sc(x.b, f), thickness: x.thickness * f })),
  });
  let geo: PlanGeometry = { ...emptyGeometry(), sourcePage: inp.page, ...toMm(k) };
  let regions = detectAllRooms(geo);

  if (method !== 'dimensions' && inp.briefAreaM2 && inp.briefAreaM2 > 10 && regions.length) {
    const sum = regions.filter((r) => polyArea(r) > 0).reduce((s, r) => s + polyArea(r), 0) / 1e6;
    if (sum > 0) {
      const f = Math.sqrt(inp.briefAreaM2 / sum);
      k *= f;
      method = 'area';
      geo = { ...emptyGeometry(), sourcePage: inp.page, ...toMm(k) };
      regions = detectAllRooms(geo);
      notes.push('Масштаб определён по площади из брифа — подтвердите калибровкой по размеру.');
    }
  } else if (method === 'assumed') notes.push('Масштаб не найден: укажите общую площадь квартиры (она есть на плане БТИ).');

  if (!cal) {
    const longest = geo.walls.reduce((a, c) => (dist(c.a, c.b) > dist(a.a, a.b) ? c : a));
    cal = { p1: sc(longest.a, 1 / k), p2: sc(longest.b, 1 / k), mm: Math.round(dist(longest.a, longest.b)), mmPerUnit: k, method };
  }

  // 6. Помещения: крупные замкнутые области; мелкие — полости/шахты.
  const rooms: Room[] = [];
  const fixed: PlanGeometry['fixed'] = [];
  for (const poly of regions) {
    const a = polyArea(poly) / 1e6;
    if (a >= 1.0) rooms.push({ id: uid('r'), name: 'Помещение', type: 'other', polygon: poly, ...prov(inp.page) });
    else if (a >= 0.05) fixed.push({ id: uid('f'), kind: 'void', polygon: poly, label: 'Полость / шахта (распознано)', ...prov(inp.page) });
  }
  geo = { ...geo, rooms, fixed, calibration: cal };

  // 7. Окна/двери по сторонам: снаружи ли проём; вход.
  const side = (o: Opening, s: 1 | -1): Room | null => {
    const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1;
    const n = { x: dy / l, y: -dx / l };
    const m = { x: (o.a.x + o.b.x) / 2 + n.x * s * (o.thickness / 2 + 350), y: (o.a.y + o.b.y) / 2 + n.y * s * (o.thickness / 2 + 350) };
    return rooms.find((r) => pointInPolygon(m, r.polygon)) ?? null;
  };
  const meta = new Map(openingsU.map((o) => [o.id, o]));
  const exteriorDoors: Opening[] = [];
  for (const o of geo.openings) {
    const L = side(o, 1), R = side(o, -1);
    const exterior = !L || !R;
    const m = meta.get(o.id)!;
    if (!exterior && o.type === 'window') o.type = 'door'; // внутреннее «окно» — это проход
    if (exterior && o.type === 'door' && !m.arc) o.type = 'window'; // наружный проём без дуги — окно
    if (exterior && o.type === 'door') exteriorDoors.push(o);
    if (o.type === 'door' && !m.arc) {
      // без дуги: открывание внутрь помещения, куда дверь ведёт (по умолчанию — в меньшее)
      const la = L ? polyArea(L.polygon) : Infinity, ra = R ? polyArea(R.polygon) : Infinity;
      o.swing = la <= ra ? 1 : -1;
    }
  }
  const widthMm = (o: Opening) => dist(o.a, o.b);
  let entrance = exteriorDoors.filter((o) => meta.get(o.id)!.arc).sort((x, y) => widthMm(y) - widthMm(x))[0]
    ?? exteriorDoors.sort((x, y) => Math.abs(widthMm(x) - 950) - Math.abs(widthMm(y) - 950))[0];
  if (!entrance) {
    // Нет двери с дугой снаружи: берём неостеклённый внешний проём шириной 750–1300 мм.
    entrance = geo.openings.filter((o) => (!side(o, 1) || !side(o, -1)) && !meta.get(o.id)!.glazing && widthMm(o) > 750 && widthMm(o) < 1300)
      .sort((x, y) => Math.abs(widthMm(x) - 950) - Math.abs(widthMm(y) - 950))[0];
    if (entrance) entrance.type = 'door';
  }
  // Помещение, в которое не ведёт ни одна дверь, — полость, шахта или оконная ниша, а не комната.
  const adj = (r: Room, doorsOnly: boolean) => geo.openings.some((o) => (!doorsOnly || o.type === 'door') && r.polygon.some((_, i) => segNear(o, r.polygon[i], r.polygon[(i + 1) % r.polygon.length])));
  const touches = (r: Room) => adj(r, false) && (adj(r, true) || polyArea(r.polygon) / 1e6 >= 2.5);
  const closed = rooms.filter((r) => !touches(r));
  if (closed.length) {
    geo = {
      ...geo,
      rooms: rooms.filter((r) => touches(r)),
      fixed: [...geo.fixed, ...closed.map((r) => ({ id: uid('f'), kind: 'void' as const, polygon: r.polygon, label: 'Замкнутая область без проёмов (шахта / полость?)', ...prov(inp.page) }))],
    };
  }
  if (entrance) {
    entrance.isEntrance = true;
    // входная дверь открывается наружу
    entrance.swing = side(entrance, 1) ? -1 : 1;
  } else notes.push('Входная дверь не найдена — отметьте её вручную.');

  // 8. Назначение помещений: подписи на плане → иначе признаки.
  const typed = assignTypes(geo, inp.texts ?? [], k, entrance ?? null, inp.children ?? 0);
  geo = { ...geo, rooms: typed.rooms };

  const report: RecognizeReport = {
    scale: { k, method, support },
    walls: geo.walls.length,
    openings: { doors: geo.openings.filter((o) => o.type === 'door').length, windows: geo.openings.filter((o) => o.type === 'window').length, entrance: !!entrance },
    rooms: geo.rooms.map((r) => ({ name: r.name, type: r.type, areaM2: Math.round(polyArea(r.polygon) / 1e4) / 100, byLabel: typed.byLabel.has(r.id) })),
    notes,
    ms: Date.now() - t0,
  };
  return { geometry: geo, report };
}

const sc = (p: Pt, f: number): Pt => ({ x: Math.round(p.x * f), y: Math.round(p.y * f) });

/** Остекление: в полосе проёма есть ≥2 тонкие линии вдоль стены на ≥70 % длины. */
function hasGlazing(ink: Bin, a: Pt, b: Pt, t: number, ppu: number): boolean {
  const hz = Math.abs(a.y - b.y) < 1e-6;
  const x0 = Math.round(Math.min(a.x, b.x) * ppu), x1 = Math.round(Math.max(a.x, b.x) * ppu);
  const y0 = Math.round(Math.min(a.y, b.y) * ppu), y1 = Math.round(Math.max(a.y, b.y) * ppu);
  const half = Math.round((t / 2) * ppu);
  const L = hz ? x1 - x0 : y1 - y0;
  if (L < 4) return false;
  let lines = 0, prev = false;
  for (let o = -half; o <= half; o++) {
    let s = 0;
    for (let i = 0; i < L; i++) {
      const x = hz ? x0 + i : x0 + o, y = hz ? y0 + o : y0 + i;
      if (x >= 0 && y >= 0 && x < ink.w && y < ink.h) s += ink.d[y * ink.w + x];
    }
    const full = s >= L * 0.7;
    if (full && !prev) lines++;
    prev = full;
  }
  return lines >= 2;
}

/** Дуга открывания: вектор PDF (точно) или растровый поиск четверти окружности у откоса. */
function doorArc(v: PageVectors | null | undefined, ink: Bin, a: Pt, b: Pt, t: number, ppu: number): { hinge: 'a' | 'b'; swing: 1 | -1 } | null {
  const L = dist(a, b);
  const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: dir.y, y: -dir.x };
  if (v?.arcs.length) {
    for (const arc of v.arcs) {
      if (arc.r < L * 0.6 || arc.r > L * 1.2) continue;
      for (const [hinge, P] of [['a', a], ['b', b]] as const) {
        if (dist(arc.center, P) > Math.max(t, L * 0.25)) continue;
        const mid = { x: (arc.start.x + arc.end.x) / 2 - arc.center.x, y: (arc.start.y + arc.end.y) / 2 - arc.center.y };
        return { hinge, swing: mid.x * n.x + mid.y * n.y >= 0 ? 1 : -1 };
      }
    }
  }
  // Растр: четверть окружности радиуса ≈ ширины проёма от грани стены.
  let best: { hinge: 'a' | 'b'; swing: 1 | -1; score: number } | null = null;
  for (const hinge of ['a', 'b'] as const)
    for (const swing of [1, -1] as const) {
      const H = hinge === 'a' ? a : b;
      const closed = hinge === 'a' ? dir : { x: -dir.x, y: -dir.y };
      const face = { x: H.x + n.x * swing * t / 2, y: H.y + n.y * swing * t / 2 };
      let hit = 0, N = 0;
      for (let i = 2; i <= 16; i++) {
        const ang = (i / 18) * (Math.PI / 2);
        const r = L * 0.95;
        const p = { x: face.x + (closed.x * Math.cos(ang) + n.x * swing * Math.sin(ang)) * r, y: face.y + (closed.y * Math.cos(ang) + n.y * swing * Math.sin(ang)) * r };
        const px = Math.round(p.x * ppu), py = Math.round(p.y * ppu);
        N++;
        let on = 0;
        for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2 && !on; dx++) {
          const x = px + dx, y = py + dy;
          if (x >= 0 && y >= 0 && x < ink.w && y < ink.h && ink.d[y * ink.w + x]) on = 1;
        }
        hit += on;
      }
      const score = hit / N;
      if (!best || score > best.score) best = { hinge, swing, score };
    }
  return best && best.score >= 0.6 ? { hinge: best.hinge, swing: best.swing } : null;
}

export function assignTypes(g: PlanGeometry, texts: TextBox[], k: number, entrance: Opening | null, children: number): { rooms: Room[]; byLabel: Set<string> } {
  const byLabel = new Set<string>();
  const rooms = g.rooms.map((r) => ({ ...r }));
  // Подписи внутри помещения
  for (const r of rooms) {
    const inside = texts.filter((t) => pointInPolygon({ x: ((t.x0 + t.x1) / 2) * k, y: ((t.y0 + t.y1) / 2) * k }, r.polygon)).map((t) => t.str).join(' ');
    const hit = LABELS.find(([re]) => re.test(inside));
    if (hit) { r.type = hit[1]; r.name = hit[2]; byLabel.add(r.id); }
  }
  const windowsOf = (r: Room) => g.openings.filter((o) => o.type === 'window' && r.polygon.some((_, i) => segNear(o, r.polygon[i], r.polygon[(i + 1) % r.polygon.length]))).length;
  const doorsTo = (r: Room, o: Opening) => r.polygon.some((_, i) => segNear(o, r.polygon[i], r.polygon[(i + 1) % r.polygon.length]));
  const free = rooms.filter((r) => !byLabel.has(r.id));
  const area = (r: Room) => polyArea(r.polygon) / 1e6;
  // Вход
  if (entrance) { const hall = free.find((r) => doorsTo(r, entrance)); if (hall) { hall.type = 'hall'; hall.name = 'Прихожая'; } }
  // Балкон определяем только по подписи: по признакам его легко спутать с нишей или санузлом.
  // Мокрые зоны: небольшие помещения (< 6 м²); окна в них часто «находятся» ложно из-за трубопроводов на чертеже.
  const wet = free.filter((r) => r.type === 'other' && area(r) < 6).sort((a, b) => area(b) - area(a));
  wet.forEach((r, i) => { r.type = i === 0 ? 'bath' : 'wc'; r.name = i === 0 ? (wet.length === 1 ? 'Санузел' : 'Ванная') : 'С/у'; });
  // Коридоры: без окон, вытянутые. Если окна не определялись вовсе (скан) — только по форме.
  const windowsKnown = g.openings.some((o) => o.type === 'window');
  for (const r of free.filter((x) => x.type === 'other' && windowsOf(x) === 0)) {
    const bb = bboxOf(r.polygon);
    const elongated = Math.max(bb.w, bb.h) / Math.min(bb.w, bb.h) > 2.2;
    if (!windowsKnown && !elongated) continue;
    r.type = elongated || area(r) < 8 ? 'corridor' : 'storage';
    r.name = r.type === 'corridor' ? 'Коридор' : 'Кладовая';
  }
  // Жилые с окнами
  const lit = free.filter((r) => r.type === 'other').sort((a, b) => area(b) - area(a));
  const hasKitchen = rooms.some((r) => r.type === 'kitchen' || r.type === 'kitchen-living');
  const hasLiving = rooms.some((r) => r.type === 'living' || r.type === 'kitchen-living');
  const wetC = rooms.filter((r) => r.type === 'bath' || r.type === 'wc').map((r) => centroid(r.polygon));
  if (!hasKitchen && lit.length) {
    if (lit.length <= 2) {
      // Одна-две светлые комнаты («евро»): бо́льшая — кухня-гостиная.
      lit[0].type = 'kitchen-living';
      lit[0].name = 'Кухня-гостиная';
    } else {
      // Кухня: ближайшая к мокрым зонам комната 5–18 м², кроме самой большой.
      const pool = lit.filter((r, i) => area(r) >= 5 && area(r) <= 18 && i > 0);
      const kitchen = (pool.length ? pool : lit).slice().sort((a, b) => nearest(a, wetC) - nearest(b, wetC))[0];
      kitchen.type = 'kitchen';
      kitchen.name = 'Кухня';
    }
  }
  const rest = lit.filter((r) => r.type === 'other');
  if (!hasLiving && rest.length >= 2) { rest[0].type = 'living'; rest[0].name = 'Гостиная'; }
  const beds = rest.filter((r) => r.type === 'other');
  beds.forEach((r) => { r.type = 'bedroom'; r.name = 'Спальня'; });
  if (children > 0 && beds.length >= 2) {
    const kid = beds.slice().sort((a, b) => area(a) - area(b))[0];
    kid.type = 'kids'; kid.name = 'Детская';
  }
  // Одинаковые названия — нумеруем
  const count = new Map<string, number>();
  for (const r of rooms) count.set(r.name, (count.get(r.name) ?? 0) + 1);
  const idx = new Map<string, number>();
  for (const r of rooms) if ((count.get(r.name) ?? 0) > 1) { const i = (idx.get(r.name) ?? 0) + 1; idx.set(r.name, i); r.name = `${r.name} ${i}`; }
  return { rooms, byLabel };
}

function segNear(o: Opening, p: Pt, q: Pt): boolean {
  const m = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
  const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((m.x - p.x) * dx + (m.y - p.y) * dy) / l2));
  return Math.hypot(m.x - (p.x + dx * t), m.y - (p.y + dy * t)) <= o.thickness / 2 + 60;
}
function bboxOf(p: Pt[]) { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
function nearest(r: Room, pts: Pt[]) { const c = centroid(r.polygon); return pts.length ? Math.min(...pts.map((p) => dist(p, c))) : 0; }
