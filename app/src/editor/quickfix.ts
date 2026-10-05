// Быстрая правка распознанного плана: разрезать и объединить помещения, дверь по щелчку,
// помещение по щелчку внутри него на картинке плана («волшебная палочка»). Чистые функции.
import type { Opening, PlanGeometry, Pt, Room } from '../model/types';
import { uid } from '../model/defaults';
import { nearestWall } from './ops';
import { components, dilate, erode, newBin } from '../recognize/raster';
import { labelPolygon } from '../quick';
import { difference, dist, fromRing, intersection, pointInPolygon, polyArea, projectOnSegment, toGeom, union } from '../geometry/poly';

const MIN_ROOM_MM2 = 0.5e6;

/** Разрезать помещение прямой через точки a и b. Возвращает две части (или null, если линия его не делит). */
export function splitRoom(room: Room, a: Pt, b: Pt): [Room, Room] | null {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
  if (l < 1) return null;
  const ux = dx / l, uy = dy / l, nx = -uy, ny = ux, R = 1e6;
  // Две огромные полуплоскости по обе стороны линии.
  const half = (s: number): Pt[] => [
    { x: a.x - ux * R, y: a.y - uy * R }, { x: a.x + ux * R, y: a.y + uy * R },
    { x: a.x + ux * R + s * nx * R, y: a.y + uy * R + s * ny * R }, { x: a.x - ux * R + s * nx * R, y: a.y - uy * R + s * ny * R },
  ];
  const biggest = (s: number) => {
    const parts = intersection(toGeom(room.polygon), toGeom(half(s))).map((p) => fromRing(p[0]));
    return parts.sort((p, q) => polyArea(q) - polyArea(p))[0];
  };
  const p1 = biggest(1), p2 = biggest(-1);
  if (!p1 || !p2 || polyArea(p1) < MIN_ROOM_MM2 || polyArea(p2) < MIN_ROOM_MM2) return null;
  const round = (p: Pt[]) => p.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
  return [
    { ...room, polygon: round(p1), verifiedByManager: true },
    { ...room, id: uid('r'), name: 'Помещение', type: 'other', polygon: round(p2), source: 'manual', verifiedByManager: true },
  ];
}

/**
 * Объединить два помещения (например, комнату, разрезанную надписью). Промежуток между ними
 * (толщина стены, до maxGap) заполняется перемычкой по общему участку.
 */
export function mergeRooms(r1: Room, r2: Room, maxGap = 700): Room | null {
  const bb = (p: Pt[]) => ({ x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), y0: Math.min(...p.map((q) => q.y)), y1: Math.max(...p.map((q) => q.y)) });
  const A = bb(r1.polygon), B = bb(r2.polygon);
  const ox0 = Math.max(A.x0, B.x0), ox1 = Math.min(A.x1, B.x1), oy0 = Math.max(A.y0, B.y0), oy1 = Math.min(A.y1, B.y1);
  const parts = [toGeom(r1.polygon), toGeom(r2.polygon)];
  if (ox1 - ox0 > 100 && oy0 - oy1 <= maxGap && oy0 > oy1) parts.push(toGeom([{ x: ox0, y: oy1 - 1 }, { x: ox1, y: oy1 - 1 }, { x: ox1, y: oy0 + 1 }, { x: ox0, y: oy0 + 1 }]));
  if (oy1 - oy0 > 100 && ox0 - ox1 <= maxGap && ox0 > ox1) parts.push(toGeom([{ x: ox1 - 1, y: oy0 }, { x: ox0 + 1, y: oy0 }, { x: ox0 + 1, y: oy1 }, { x: ox1 - 1, y: oy1 }]));
  const u = union(...parts);
  if (u.length !== 1) return null; // не соприкасаются — объединять нечего
  const big = r1.polygon.length && polyArea(r1.polygon) >= polyArea(r2.polygon) ? r1 : r2;
  return { ...big, polygon: fromRing(u[0][0]).map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })), verifiedByManager: true };
}

/** Ближайшая точка контура помещения и расстояние до неё. */
function nearestOnRoom(r: Room, p: Pt) {
  let best = { point: r.polygon[0], dist: Infinity };
  for (let i = 0; i < r.polygon.length; i++) {
    const q = projectOnSegment(p, r.polygon[i], r.polygon[(i + 1) % r.polygon.length]);
    if (q.dist < best.dist) best = { point: q.point, dist: q.dist };
  }
  return best;
}

/**
 * Дверь по щелчку на стене: между двумя ближайшими помещениями (или помещением и улицей —
 * тогда это вход). Ширина 800 мм, по линии стены.
 */
export function doorAt(g: PlanGeometry, p: Pt, width = 800, reach = 600): Opening | null {
  if (!Number.isFinite(width) || width < 300 || width > 6000) return null;
  const near = g.rooms.map((r) => ({ r, ...nearestOnRoom(r, p) })).filter((x) => x.dist <= reach).sort((a, b) => a.dist - b.dist);
  const explicit = nearestWall(g, p, reach);
  if (explicit) {
    const w = explicit.wall, c = explicit.point, length = dist(w.a, w.b);
    if (length < 1) return null;
    const dx = (w.b.x - w.a.x) * width / (2 * length), dy = (w.b.y - w.a.y) * width / (2 * length);
    return { id: uid('d'), type: 'door', a: { x: c.x - dx, y: c.y - dy }, b: { x: c.x + dx, y: c.y + dy },
      thickness: w.thickness, hinge: 'a', swing: 1, isEntrance: near.length === 1 && !g.openings.some(o => o.isEntrance),
      sillHeight: null, source: 'manual', verifiedByManager: true, sourcePage: g.sourcePage };
  }
  if (!near.length) return null;
  const q1 = near[0].point;
  const q2 = near.find((x) => x.r.id !== near[0].r.id)?.point ?? null;
  // Направление «поперёк стены»: от одного помещения к другому, иначе — от помещения к точке щелчка.
  const across = q2 ? { x: q2.x - q1.x, y: q2.y - q1.y } : { x: p.x - q1.x, y: p.y - q1.y };
  let l = Math.hypot(across.x, across.y);
  let ax = across.x / (l || 1), ay = across.y / (l || 1);
  if (l < 1) { ax = 0; ay = 1; l = 0; }
  // Стены на планах почти всегда ортогональны — выравниваем.
  if (Math.abs(ax) > Math.abs(ay)) { ax = Math.sign(ax); ay = 0; } else { ax = 0; ay = Math.sign(ay) || 1; }
  const c = q2 ? { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 } : { x: q1.x + ax * 100, y: q1.y + ay * 100 };
  const ux = -ay, uy = ax; // вдоль стены
  const thickness = q2 ? Math.max(80, Math.round(dist(q1, q2))) : 200;
  const entrance = !q2 && !g.openings.some((o) => o.isEntrance);
  return {
    id: uid('d'), type: 'door', thickness, hinge: 'a', swing: 1, isEntrance: entrance, sillHeight: null,
    a: { x: Math.round(c.x - (ux * width) / 2), y: Math.round(c.y - (uy * width) / 2) },
    b: { x: Math.round(c.x + (ux * width) / 2), y: Math.round(c.y + (uy * width) / 2) },
    source: 'manual', verifiedByManager: true, sourcePage: g.sourcePage,
  };
}

export interface ImageData8 { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/**
 * «Волшебная палочка»: контур помещения по щелчку внутри него на картинке плана.
 * Заливка по цвету пола в точке щелчка, затем открытие на ~0,7 м отсекает утечки через дверные
 * проёмы, затем контур по сетке. mmPerPx — сколько мм в пикселе картинки.
 */
export function roomFromImage(img: ImageData8, px: { x: number; y: number }, mmPerPx: number): Pt[] | null {
  const { data, width: w, height: h } = img;
  const x0 = Math.round(px.x), y0 = Math.round(px.y);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  const pxPerM = 1000 / mmPerPx;
  // Цвет пола — самый частый светлый цвет в радиусе ~30 см: щелчок может попасть на цифру
  // или нарисованную сантехнику.
  const rad = Math.max(3, Math.round(0.3 * pxPerM));
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = (y * w + x) * 4, r = data[p], g = data[p + 1], b = data[p + 2];
    if (0.299 * r + 0.587 * g + 0.114 * b < 110) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
  }
  if (!bins.size) return null;
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  const F = [top.r / top.n, top.g / top.n, top.b / top.n];
  const floor = newBin(w, h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4)
    floor.d[i] = Math.max(Math.abs(data[p] - F[0]), Math.abs(data[p + 1] - F[1]), Math.abs(data[p + 2] - F[2])) <= 40 ? 1 : 0;
  // Цифры и значки внутри помещения — отдельные мелкие пятна (меньше ~0,6 м): считаем их полом.
  // Стены — одна большая связная сеть, она остаётся преградой.
  const notFloor = newBin(w, h);
  for (let i = 0; i < w * h; i++) notFloor.d[i] = floor.d[i] ? 0 : 1;
  const spots = components(notFloor);
  const small = new Uint8Array(spots.comps.length + 1);
  for (const c of spots.comps) small[c.id] = Math.max(c.x1 - c.x0, c.y1 - c.y0) < 0.6 * pxPerM ? 1 : 0;
  const closed = newBin(w, h);
  for (let i = 0; i < w * h; i++) closed.d[i] = floor.d[i] || small[spots.labels[i]] ? 1 : 0;
  // Дверные проёмы: открытие шире двери (1,0 м) отрывает соседние помещения. Узкое помещение
  // (коридор) при этом исчезает — тогда пробуем окно поуже.
  const levels = [1.0, 0.7, 0.45, 0.3].map((km) => {
    const ko = Math.max(3, Math.round(km * pxPerM));
    return components(dilate(erode(closed, ko), ko));
  });
  const cell = Math.max(2, Math.round(pxPerM * 0.1));
  // Найденное ядро помещения дорастает по полу на ~0,6 м (сантехника и мебель режут пол на части;
  // прихваченный через дверь кусок соседней комнаты вычитается в newRoomFromImage).
  const grow = (lv: (typeof levels)[number], id: number) => {
    const lab = new Int32Array(w * h);
    let front: number[] = [];
    for (let i = 0; i < w * h; i++) if (lv.labels[i] === id) { lab[i] = 1; front.push(i); }
    for (let step = 0, n = Math.round(0.6 * pxPerM); step < n && front.length; step++) {
      const next: number[] = [];
      for (const q of front) {
        const x = q % w;
        for (const t of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
          if (t < 0 || t >= w * h || lab[t] || !closed.d[t]) continue;
          lab[t] = 1; next.push(t);
        }
      }
      front = next;
    }
    return lab;
  };
  const toPoly = (lv: (typeof levels)[number], id: number) => {
    const poly = labelPolygon(grow(lv, id), w, h, 1, cell);
    if (!poly || poly.length < 4) return null;
    const mm = poly.map((q) => ({ x: Math.round(q.x * mmPerPx), y: Math.round(q.y * mmPerPx) }));
    return polyArea(mm) >= MIN_ROOM_MM2 ? mm : null;
  };
  const edge = (c: { x0: number; y0: number; x1: number; y1: number }) => c.x0 === 0 || c.y0 === 0 || c.x1 === w - 1 || c.y1 === h - 1;
  // 1) Щёлкнули прямо в пол: от широкого окна к узкому (широкое отрывает соседей через двери).
  for (const lv of levels) {
    const id = lv.labels[y0 * w + x0];
    if (!id) continue;
    if (edge(lv.comps[id - 1])) return null; // заливка утекла на весь лист — помещение не замкнуто
    const p = toPoly(lv, id);
    if (p) return p;
  }
  // 2) Щелчок на сантехнику или цифру: пол рядом (до 0,4 м), начиная с самого узкого окна —
  //    так берётся маленькое помещение, а не соседняя большая комната.
  const r = Math.round(0.4 * pxPerM);
  for (const lv of [...levels].reverse()) {
    let id = 0, best = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || !lv.labels[y * w + x]) continue;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; id = lv.labels[y * w + x]; }
    }
    if (!id || edge(lv.comps[id - 1])) continue;
    const p = toPoly(lv, id);
    if (p) return p;
  }
  return null;
}

/**
 * Новое помещение по щелчку: контур по картинке минус уже существующие помещения
 * (заливка может захватить соседнюю комнату через тонкую или прерванную стену).
 * Остаётся кусок, в который щёлкнули (или крупнейший рядом).
 */
export function newRoomFromImage(img: ImageData8, px: { x: number; y: number }, mmPerPx: number, rooms: Room[]): Pt[] | null {
  const poly = roomFromImage(img, px, mmPerPx);
  if (!poly) return null;
  const rest = rooms.length ? difference(toGeom(poly), ...rooms.map((r) => toGeom(r.polygon))) : toGeom(poly);
  const click = { x: px.x * mmPerPx, y: px.y * mmPerPx };
  const parts = rest.map((p) => fromRing(p[0])).filter((p) => polyArea(p) >= MIN_ROOM_MM2);
  const hit = parts.find((p) => pointInPolygon(click, p)) ?? parts.sort((a, b) => polyArea(b) - polyArea(a))[0];
  return hit ? hit.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) : null;
}

/** Помещение прямоугольником по двум углам (санузлы, забитые сантехникой) минус соседние помещения. */
export function roomFromCorners(a: Pt, b: Pt, rooms: Room[]): Pt[] | null {
  const r = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }].map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
  if (polyArea(r) < MIN_ROOM_MM2) return null;
  const rest = rooms.length ? difference(toGeom(r), ...rooms.map((x) => toGeom(x.polygon))) : toGeom(r);
  const parts = rest.map((p) => fromRing(p[0])).filter((p) => polyArea(p) >= MIN_ROOM_MM2).sort((p, q) => polyArea(q) - polyArea(p));
  return parts[0] ? parts[0].map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) : null;
}
