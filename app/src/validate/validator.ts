// Валидатор расстановки. Чистые функции: вход — геометрия, предметы, правила, бриф.
import type { Brief, FurnitureItem, Issue, PlanGeometry, Pt } from '../model/types';
import { bedSideStrips, CATALOG, footprint, localRect, serviceZones, sinkCenter } from '../furniture/catalog';
import { bbox, bboxOverlap, dist, EPS_AREA, geomArea, intersection, outsideArea, overlapArea, pointInGeom, polyArea, segmentRect, toGeom, union, type Geom } from '../geometry/poly';
import type { Rules } from '../rules/rules';
import { planContext, roomOfPoint, type PlanContext } from './context';
import { anyCellIn, distanceField, Grid, reachable } from './grid';

const nameOf = (it: FurnitureItem) => CATALOG[it.type].name.toLowerCase();
const issue = (severity: Issue['severity'], code: string, message: string, itemIds: string[] = []): Issue => ({ severity, code, message, itemIds });

function blocksOthers(it: FurnitureItem) {
  return !CATALOG[it.type].soft;
}

/** Доля отрезка `strip`, лежащая на стене. */
function wallContactRatio(ctx: PlanContext, strip: Pt[]): number {
  const a = polyArea(strip);
  return a ? overlapArea(strip, ctx.walls) / a : 0;
}

export function bedHeadStrip(it: FurnitureItem): Pt[] {
  return localRect(it, -it.w / 2 + 50, -it.d / 2 - 80, it.w / 2 - 50, -it.d / 2);
}

export interface LocalCheckInput {
  ctx: PlanContext;
  rules: Rules;
  brief: Pick<Brief, 'bedAccessBothSides'>;
}

/**
 * Локальные проверки одного предмета относительно плана и других предметов
 * (без проходимости — её считает полная проверка). Используется и движком при переборе.
 */
export function checkItem(input: LocalCheckInput, it: FurnitureItem, others: FurnitureItem[], pairwiseFootprints = true): Issue[] {
  const { ctx, rules } = input;
  const out: Issue[] = [];
  const cat = CATALOG[it.type];
  const fp = footprint(it);
  const fb = bbox(fp);
  const nm = cat.name;

  // Помещение: предмет целиком внутри своего помещения.
  const room = (it.roomId && ctx.rooms.find((r) => r.room.id === it.roomId)) || ctx.rooms.find((r) => pointInGeom({ x: it.x, y: it.y }, r.geom));
  if (!room) out.push(issue('error', 'outside-room', `${nm}: вне помещений квартиры`, [it.id]));
  else if (outsideArea(fp, room.geom) > EPS_AREA) out.push(issue('error', 'outside-room', `${nm} выходит за пределы помещения «${room.room.name}»`, [it.id]));

  if (!cat.soft) {
    if (overlapArea(fp, ctx.walls) > EPS_AREA) out.push(issue('error', 'wall-collision', `${nm} пересекает стену`, [it.id]));
    for (const f of ctx.fixed) if (overlapArea(fp, f.poly) > EPS_AREA) out.push(issue('error', 'fixed-collision', `${nm} перекрывает ${fixedName(f.kind)}`, [it.id]));
    for (const d of ctx.doors) {
      if (overlapArea(fp, d.swing) > EPS_AREA) out.push(issue('error', 'door-swing', `${nm} мешает открыванию двери`, [it.id]));
      else if (overlapArea(fp, d.rect) > EPS_AREA) out.push(issue('error', 'door-block', `${nm} перекрывает дверной проём`, [it.id]));
    }
    if (cat.tall) for (const w of ctx.windows) if (overlapArea(fp, w.tallZone) > EPS_AREA) out.push(issue('error', 'window-tall', `${nm} — высокая мебель перед окном`, [it.id]));
    if (pairwiseFootprints)
      for (const o of others) {
        if (o.id === it.id || !blocksOthers(o)) continue;
        const ofp = footprint(o);
        if (!bboxOverlap(fb, bbox(ofp))) continue;
        if (overlapArea(fp, ofp) > EPS_AREA) out.push(issue('error', 'item-collision', `${nm} пересекается с предметом «${nameOf(o)}»`, [it.id, o.id]));
      }
  }

  // Зоны обслуживания: помещаются в помещение и свободны от чужих корпусов.
  for (const z of serviceZones(it, rules)) {
    const inRoom = room ? outsideArea(z, ctx.interior) : polyArea(z);
    if (inRoom > polyArea(z) * 0.1) {
      out.push(issue('error', 'service-no-room', `${nm}: не хватает места перед фасадом (нужно ${cat.service ? rules[cat.service] : 0} мм)`, [it.id]));
      continue;
    }
    if (overlapArea(z, ctx.walls) > polyArea(z) * 0.05) out.push(issue('error', 'service-wall', `${nm}: перед фасадом стена`, [it.id]));
    for (const f of ctx.fixed) if (f.kind !== 'radiator' && overlapArea(z, f.poly) > EPS_AREA) out.push(issue('error', 'service-fixed', `${nm}: зону перед фасадом занимает ${fixedName(f.kind)}`, [it.id]));
    const zb = bbox(z);
    for (const o of others) {
      if (o.id === it.id || !blocksOthers(o) || cat.serviceAllows?.includes(o.type)) continue;
      const ofp = footprint(o);
      if (!bboxOverlap(zb, bbox(ofp))) continue;
      if (overlapArea(z, ofp) > EPS_AREA * 10) out.push(issue('error', 'service-blocked', `${nm}: подход перекрыт предметом «${nameOf(o)}»`, [it.id, o.id]));
    }
    for (const d of ctx.doors) if (overlapArea(z, d.swing) > polyArea(z) * 0.3) out.push(issue('warning', 'service-door', `${nm}: дверь открывается в зону перед фасадом`, [it.id]));
  }

  // Симметрично: корпус этого предмета не должен занимать зоны обслуживания других.
  if (!cat.soft)
    for (const o of others) {
      if (o.id === it.id || CATALOG[o.type].serviceAllows?.includes(it.type)) continue;
      for (const z of serviceZones(o, rules)) {
        if (!bboxOverlap(fb, bbox(z))) continue;
        if (overlapArea(fp, z) > EPS_AREA * 10) out.push(issue('error', 'service-blocked', `${CATALOG[o.type].name}: подход перекрыт предметом «${nm.toLowerCase()}»`, [o.id, it.id]));
      }
    }

  // Кровати: изголовье к стене, доступ с нужных сторон.
  if (it.type === 'bed-double' || it.type === 'bed-single') {
    const head = bedHeadStrip(it);
    const ratio = wallContactRatio(ctx, head);
    if (ratio < 0.6) {
      const underWindow = ctx.windows.some((w) => overlapArea(head, w.rect) > EPS_AREA);
      out.push(underWindow
        ? issue('warning', 'bed-head-window', `${nm}: изголовье у окна`, [it.id])
        : issue('error', 'bed-head-wall', `${nm} не стоит изголовьем к стене`, [it.id]));
    }
    const s = bedSideStrips(it, rules);
    const free = (strip: Pt[]) =>
      outsideArea(strip, ctx.interior) < polyArea(strip) * 0.05 &&
      !others.some((o) => o.id !== it.id && blocksOthers(o) && o.type !== 'bedside' && overlapArea(strip, footprint(o)) > EPS_AREA * 10) &&
      !ctx.fixed.some((f) => f.kind !== 'radiator' && overlapArea(strip, f.poly) > EPS_AREA);
    const l = free(s.left), r = free(s.right);
    if (it.type === 'bed-double') {
      if (input.brief.bedAccessBothSides && !(l && r)) out.push(issue('error', 'bed-access', `${nm}: нет подхода с двух сторон (полоса ${rules.bedSideAccess} мм)`, [it.id]));
      else if (!l && !r) out.push(issue('error', 'bed-access', `${nm}: нет бокового подхода`, [it.id]));
    } else if (!l && !r && !free(s.foot)) out.push(issue('error', 'bed-access', `${nm}: нет подхода`, [it.id]));
  }

  // Мокрые зоны.
  const kitchenRoom = room?.room.type === 'kitchen' || room?.room.type === 'kitchen-living';
  if (cat.wet && !pointInGeom({ x: it.x, y: it.y }, ctx.wet) && !(it.type === 'washer' && kitchenRoom))
    out.push(issue('warning', 'wet-moved', `${nm} вне существующей мокрой зоны — перенос требует отдельной проверки`, [it.id]));
  if (it.type === 'kitchen-run') {
    const rt = room?.room.type;
    if (rt !== 'kitchen' && rt !== 'kitchen-living')
      out.push(issue('warning', 'wet-moved', 'Кухня вне исходного помещения кухни — перенос мокрой зоны требует отдельной проверки', [it.id]));
    const sc = sinkCenter(it);
    if (sc && ctx.risers.length) {
      const dmin = Math.min(...ctx.risers.map((p) => dist(p, sc)));
      if (dmin > rules.sinkMaxDistFromRiser) out.push(issue('warning', 'sink-far', `Мойка в ${Math.round(dmin / 100) / 10} м от стояка — требует отдельной проверки`, [it.id]));
    }
  }
  return out;
}

function fixedName(kind: string): string {
  return ({ riser: 'стояк', vent: 'вентканал', shaft: 'шахту', radiator: 'радиатор', electrical: 'электрощиток', column: 'колонну', other: 'инженерный элемент' } as Record<string, string>)[kind] ?? 'элемент';
}

export interface ValidationResult {
  issues: Issue[];
  reachableRooms: string[];
  unreachableRooms: string[];
}

export interface ValidateOptions {
  expectedHash?: string;
}

/** Полная проверка варианта. */
export function validate(g: PlanGeometry, items: FurnitureItem[], rules: Rules, brief: Pick<Brief, 'bedAccessBothSides'>, opts: ValidateOptions = {}): ValidationResult {
  const ctx = planContext(g, rules);
  const issues: Issue[] = [];
  if (opts.expectedHash && opts.expectedHash !== ctx.hash)
    issues.push(issue('error', 'geometry-changed', 'Геометрия плана изменилась после построения варианта — вариант нужно пересобрать'));
  if (!g.approved) issues.push(issue('warning', 'geometry-not-approved', 'Геометрия плана ещё не утверждена менеджером'));
  if (!g.calibration) issues.push(issue('warning', 'no-calibration', 'Масштаб не откалиброван — размеры неточные'));
  if (!ctx.risers.length && g.rooms.some((r) => r.type === 'kitchen' || r.type === 'kitchen-living'))
    issues.push(issue('warning', 'riser-unknown', 'Стояки на плане не отмечены — положение мойки требует проверки на объекте'));

  const input: LocalCheckInput = { ctx, rules, brief };
  items.forEach((it, i) => {
    // Пары корпусов проверяем один раз: только с предметами дальше по списку.
    const later = items.slice(i + 1);
    const local = checkItem(input, it, items, false);
    issues.push(...local);
    if (!CATALOG[it.type].soft)
      for (const o of later) {
        if (CATALOG[o.type].soft) continue;
        const a = footprint(it), b = footprint(o);
        if (bboxOverlap(bbox(a), bbox(b)) && overlapArea(a, b) > EPS_AREA)
          issues.push(issue('error', 'item-collision', `${CATALOG[it.type].name} пересекается с предметом «${nameOf(o)}»`, [it.id, o.id]));
      }
  });

  // Диван и ТВ в одном помещении: расстояние просмотра.
  const sofa = items.find((i) => i.type === 'sofa');
  const tv = items.find((i) => i.type === 'tv-unit');
  if (sofa && tv && sofa.roomId === tv.roomId && dist(sofa, tv) - (sofa.d + tv.d) / 2 < rules.tvViewMin)
    issues.push(issue('warning', 'tv-close', 'ТВ-зона ближе рекомендуемого расстояния от дивана', [sofa.id, tv.id]));

  // Проходимость.
  const reach = reachability(ctx, items, rules);
  issues.push(...reach.issues);
  return { issues: dedupe(issues), reachableRooms: reach.reachableRooms, unreachableRooms: reach.unreachableRooms };
}

function dedupe(list: Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.message}|${[...i.itemIds].sort().join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const baseGridCache = new WeakMap<PlanContext, Map<number, Grid>>();

/** Сетка статических препятствий: всё вне помещений и дверных проёмов занято, плюс инженерные элементы. */
export function baseGrid(ctx: PlanContext, step: number): Grid {
  let m = baseGridCache.get(ctx);
  if (!m) baseGridCache.set(ctx, (m = new Map()));
  const hit = m.get(step);
  if (hit) return hit;
  const b = ctx.bounds;
  const grid = new Grid({ minX: b.minX - 500, minY: b.minY - 500, maxX: b.maxX + 500, maxY: b.maxY + 500 }, step);
  for (const r of ctx.rooms) grid.paint(r.room.polygon, 0);
  // На скане (стены не нарисованы) между контурами соседних помещений лежит стена 200–500 мм,
  // а проём распознан тонкой линией: расширяем его поперёк стены, чтобы он соединял помещения.
  const bridge = ctx.g.walls.length ? 0 : 600;
  for (const d of ctx.doors) grid.paint(bridge ? segmentRect(d.o.a, d.o.b, d.o.thickness + bridge) : d.rect, 0);
  for (const f of ctx.fixed) grid.paint(f.poly, 1);
  m.set(step, grid);
  return grid;
}

export function reachability(ctx: PlanContext, items: FurnitureItem[], rules: Rules, step = rules.gridStep, conservative = false) {
  const issues: Issue[] = [];
  const reachableRooms: string[] = [];
  const unreachableRooms: string[] = [];
  if (!ctx.rooms.length) return { issues, reachableRooms, unreachableRooms };
  if (!ctx.entranceStart) {
    issues.push(issue('warning', 'no-entrance', 'Входная дверь не отмечена — проходы от входа не проверены'));
    return { issues, reachableRooms, unreachableRooms };
  }
  const grid = baseGrid(ctx, step).clone();
  for (const it of items) if (!CATALOG[it.type].soft) grid.paint(footprint(it), 1);
  const d2 = distanceField(grid);
  const passage = reachable(grid, d2, ctx.entranceStart, rules.passageMin, conservative);
  const access = reachable(grid, d2, ctx.entranceStart, rules.accessMin, conservative);
  if (!passage.some((v) => v)) {
    issues.push(issue('error', 'entrance-blocked', `У входа нет прохода шириной ${rules.passageMin} мм`));
    return { issues, reachableRooms, unreachableRooms };
  }
  for (const r of ctx.rooms) {
    if (anyCellIn(grid, passage, r.room.polygon)) reachableRooms.push(r.room.id);
    else if (r.room.type === 'balcony') {
      // Выход на балкон на сканах обычно распознаётся как окно; мебель там не ставится.
      unreachableRooms.push(r.room.id);
      issues.push(issue('warning', 'room-unreachable', `Выход на «${r.room.name}» не отмечен — проверьте дверь на балкон`));
    } else {
      unreachableRooms.push(r.room.id);
      const blockers = items.filter((it) => it.roomId === r.room.id || nearDoorOf(ctx, it, r.room.polygon)).map((i) => i.id);
      issues.push(issue('error', 'room-unreachable', `Нет прохода ${rules.passageMin} мм в помещение «${r.room.name}»`, blockers));
    }
  }
  for (const it of items) {
    const cat = CATALOG[it.type];
    const zones = it.type === 'bed-double' || it.type === 'bed-single' ? bedZones(it, rules) : serviceZones(it, rules);
    if (!zones.length) continue;
    // Зона узкая (напр. 300 мм у стульев) — ищем проход в её окрестности на полширины подхода.
    const pad = rules.accessMin / 2;
    const ok = zones.some((z) => {
      const b = bbox(z);
      return anyCellIn(grid, access, [
        { x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.minY - pad },
        { x: b.maxX + pad, y: b.maxY + pad }, { x: b.minX - pad, y: b.maxY + pad },
      ]);
    });
    if (!ok) issues.push(issue('error', 'no-access', `${cat.name}: к предмету нет подхода шириной ${rules.accessMin} мм`, [it.id]));
  }
  return { issues, reachableRooms, unreachableRooms };
}

function bedZones(it: FurnitureItem, rules: Rules) {
  const s = bedSideStrips(it, rules);
  return [s.left, s.right, s.foot];
}

function nearDoorOf(ctx: PlanContext, it: FurnitureItem, room: Pt[]): boolean {
  const fp = footprint(it);
  return ctx.doors.some((d) => overlapArea(d.rect, room) >= 0 && dist(d.o.a, it) < 1500 && overlapArea(fp, room) > 0);
}

/** Свободная площадь пола (помещения минус корпуса мебели), м². */
export function freeFloorArea(ctx: PlanContext, items: FurnitureItem[]): number {
  const occupied: Geom = union(...items.filter((i) => !CATALOG[i.type].soft).map((i) => toGeom(footprint(i))));
  return (geomArea(ctx.interior) - geomArea(intersection(ctx.interior, occupied))) / 1e6;
}

export { roomOfPoint };
