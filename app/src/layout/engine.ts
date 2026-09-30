// Движок расстановки: перебор допустимых позиций по шаблонам + валидатор.
// Кандидаты сначала отсеиваются по растровой карте занятости (O(1) на прямоугольник),
// затем лучшие проходят точную проверку валидатора; частичные расстановки ведутся «лучом» (beam search).
import type { Brief, FurnitureItem, PlanGeometry, Pt, Room, Rot, ScenarioKey } from '../model/types';
import { bedSideStrips, CATALOG, footprint, kitchenModules, serviceZones } from '../furniture/catalog';
import { bbox, centroid, dist, dot, localToWorld, type BBox } from '../geometry/poly';
import type { Rules } from '../rules/rules';
import { planContext, type PlanContext } from '../validate/context';
import { checkItem, reachability } from '../validate/validator';
import { backRot, freeSpans, overlaps, pointAt, roomEdges, sideRots, type RoomEdge } from './edges';
import { Occupancy, type Layer } from './occupancy';
import { buildScenario, type ItemRule, type Scenario } from './templates';

export interface Placement { ruleId: string; roomId: string; edge: number | null; rot: Rot; x: number; y: number }

export interface Skipped { ruleId: string; type: string; roomName: string; mandatory: boolean; reason: string }

export interface EngineResult {
  scenario: Scenario;
  items: FurnitureItem[];
  placements: Placement[];
  skipped: Skipped[];
  /** Обязательный предмет не поместился — вариант нельзя считать готовым. */
  incomplete: boolean;
  score: number;
}

export interface EngineInput {
  g: PlanGeometry;
  brief: Brief;
  rules: Rules;
  scenario: ScenarioKey;
  /** Размещения ключевых предметов из уже построенных вариантов — для разнообразия. */
  avoid?: Placement[];
  beamWidth?: number;
}

interface State {
  items: FurnitureItem[];
  placements: Placement[];
  skipped: Skipped[];
  score: number;
  incomplete: boolean;
}

interface Candidate {
  item: FurnitureItem;
  score: number;
  edge: number | null;
}

const STEP = 25;
/** Счётчики для профилирования движка (только чтение в тестах). */
export const ENGINE_STATS = { exact: 0, exactFail: {} as Record<string, number>, reach: 0, reachFail: 0 };
let seq = 0;
const newId = () => `f${Date.now().toString(36)}${(++seq).toString(36)}`;

class Static {
  occ: Occupancy;
  base: Layer; // запрет для корпусов: вне помещений, инженерные элементы, двери
  svc: Layer; // запрет для зон обслуживания: вне помещений, инженерные элементы (кроме радиаторов)
  win: Layer; // зоны перед окнами (для высокой мебели)
  roomOut = new Map<string, Layer>();
  edges = new Map<string, RoomEdge[]>();
  constructor(readonly ctx: PlanContext) {
    const b = ctx.bounds;
    this.occ = new Occupancy({ minX: b.minX - 200, minY: b.minY - 200, maxX: b.maxX + 200, maxY: b.maxY + 200 }, STEP);
    this.base = this.occ.layer();
    this.base.data.fill(1);
    this.svc = this.occ.layer();
    this.svc.data.fill(1);
    for (const r of ctx.rooms) {
      this.occ.paint(this.base, r.room.polygon, 0);
      this.occ.paint(this.svc, r.room.polygon, 0);
      const out = this.occ.layer();
      out.data.fill(1);
      this.occ.paint(out, r.room.polygon, 0);
      this.roomOut.set(r.room.id, out);
      this.edges.set(r.room.id, roomEdges(r.room.polygon, ctx.g.openings));
    }
    for (const f of ctx.fixed) {
      this.occ.paint(this.base, f.poly, 1);
      if (f.kind !== 'radiator') this.occ.paint(this.svc, f.poly, 1);
    }
    for (const d of ctx.doors) {
      this.occ.paint(this.base, d.swing, 1);
      this.occ.paint(this.base, d.rect, 1);
    }
    this.win = this.occ.layer();
    for (const w of ctx.windows) this.occ.paint(this.win, w.tallZone, 1);
  }
}

class Dynamic {
  items: Layer;
  zones: Layer;
  constructor(readonly st: Static, list: FurnitureItem[], rules: Rules) {
    this.items = st.occ.layer();
    this.zones = st.occ.layer();
    for (const it of list) this.add(it, rules);
  }
  add(it: FurnitureItem, rules: Rules) {
    if (CATALOG[it.type].soft) return;
    this.st.occ.paint(this.items, footprint(it), 1);
    for (const z of serviceZones(it, rules)) this.st.occ.paint(this.zones, z, 1);
    if (it.type === 'bed-double') {
      const s = bedSideStrips(it, rules);
      this.st.occ.paint(this.zones, s.left, 1);
      this.st.occ.paint(this.zones, s.right, 1);
    }
  }
}

const ZONE_GUESTS = new Set(['coffee-table', 'play-rug', 'bedside']);

function rectOf(poly: Pt[]): BBox {
  return bbox(poly);
}

/** Быстрая растровая проверка кандидата. */
function rasterOk(st: Static, dy: Dynamic, it: FurnitureItem, room: Room, rules: Rules, brief: Brief): boolean {
  const cat = CATALOG[it.type];
  const occ = st.occ;
  const fp = rectOf(footprint(it));
  const inset = 1;
  if (occ.count(st.roomOut.get(room.id)!, fp, inset)) return false;
  if (cat.soft) return true;
  if (occ.count(st.base, fp, inset) || occ.count(dy.items, fp, inset)) return false;
  if (!ZONE_GUESTS.has(it.type) && occ.count(dy.zones, fp, inset)) return false;
  if (cat.tall && occ.count(st.win, fp, inset)) return false;
  for (const z of serviceZones(it, rules)) {
    const zb = rectOf(z);
    if (occ.count(st.svc, zb, inset) || occ.count(dy.items, zb, inset)) return false;
  }
  if (it.type === 'bed-double' || it.type === 'bed-single') {
    const s = bedSideStrips(it, rules);
    const free = (p: Pt[]) => !occ.count(st.svc, rectOf(p), inset) && !occ.count(dy.items, rectOf(p), inset);
    const l = free(s.left), r = free(s.right);
    if (it.type === 'bed-double' ? (brief.bedAccessBothSides ? !(l && r) : !(l || r)) : !(l || r || free(s.foot))) return false;
  }
  return true;
}

function makeItem(rule: ItemRule, room: Room, x: number, y: number, rot: Rot, w: number, d: number): FurnitureItem {
  return { id: newId(), type: rule.type, x: Math.round(x), y: Math.round(y), rot, w, d, roomId: room.id, ruleId: rule.id, movedByManager: false, seats: rule.seats };
}

interface RoomInfo { room: Room; edges: RoomEdge[]; maxLen: number; diag: number; center: Pt; windows: Pt[]; doors: Pt[] }

function roomInfo(st: Static, room: Room): RoomInfo {
  const edges = st.edges.get(room.id) ?? [];
  const b = bbox(room.polygon);
  const ops = st.ctx.g.openings;
  const inRoom = (ids: string[]) => ops.filter((o) => ids.includes(o.id)).map((o) => ({ x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 }));
  return {
    room, edges,
    maxLen: Math.max(1, ...edges.map((e) => e.len)),
    diag: Math.hypot(b.maxX - b.minX, b.maxY - b.minY) || 1,
    center: centroid(room.polygon),
    windows: inRoom(edges.flatMap((e) => e.windows.map((w) => w.openingId))),
    doors: inRoom(edges.flatMap((e) => e.doors.map((w) => w.openingId))),
  };
}

function wetTarget(ctx: PlanContext): Pt[] {
  if (ctx.risers.length) return ctx.risers;
  return ctx.g.rooms.filter((r) => r.type === 'bath' || r.type === 'wc').map((r) => centroid(r.polygon))
    .concat(ctx.g.wetZones.map((z) => centroid(z.polygon)));
}

function scoreCandidate(rule: ItemRule, info: RoomInfo, it: FurnitureItem, e: RoomEdge | null, s0: number, s1: number, st: Static, anchor: FurnitureItem | null, avoid: Placement[]): number {
  const w = rule.weights;
  let sc = 0;
  const c = { x: it.x, y: it.y };
  if (w.blankWall && e) sc += w.blankWall * (overlaps(s0, s1, e.windows, 0) ? 0 : 1);
  if (w.longestWall && e) sc += w.longestWall * (e.len / info.maxLen);
  if (w.centered) sc += w.centered * (e ? 1 - Math.abs((s0 + s1) / 2 - e.len / 2) / (e.len / 2) : 1 - Math.min(1, dist(c, info.center) / (info.diag / 2)));
  if (w.corner && e) sc += w.corner * (s0 < 60 || e.len - s1 < 60 ? 1 : 0);
  if (w.nearWindow && info.windows.length) sc += w.nearWindow * (1 - Math.min(1, Math.min(...info.windows.map((p) => dist(p, c))) / info.diag));
  if (w.farFromDoor && info.doors.length) sc += w.farFromDoor * Math.min(1, Math.min(...info.doors.map((p) => dist(p, c))) / info.diag);
  if (w.nearWet) {
    const t = wetTarget(st.ctx);
    // Для гарнитура важен ближайший торец (там встанет мойка), для остального — центр.
    const probes = it.type === 'kitchen-run'
      ? [localToWorld({ x: -it.w / 2 + 300, y: 0 }, it.x, it.y, it.rot), localToWorld({ x: it.w / 2 - 300, y: 0 }, it.x, it.y, it.rot)]
      : [c];
    if (t.length) sc += w.nearWet * (1 - Math.min(1, Math.min(...t.flatMap((p) => probes.map((q) => dist(p, q)))) / 6000));
  }
  if (w.nearEntrance && st.ctx.entranceStart) sc += w.nearEntrance * (1 - Math.min(1, dist(st.ctx.entranceStart, c) / 6000));
  if (w.nearAnchor && anchor) sc += w.nearAnchor * (1 - Math.min(1, dist(anchor, c) / info.diag));
  if (w.facingAnchor && anchor && anchor.roomId === it.roomId) {
    const fa = localToWorld({ x: 0, y: 1 }, 0, 0, anchor.rot), fi = localToWorld({ x: 0, y: 1 }, 0, 0, it.rot);
    const facing = dot(fa, fi) < -0.99;
    const between = dist(anchor, it) - (anchor.d + it.d) / 2;
    const lateral = Math.abs(dot({ x: it.x - anchor.x, y: it.y - anchor.y }, { x: fa.y, y: -fa.x }));
    sc += facing && between >= 1500 ? w.facingAnchor * (1 - Math.min(1, lateral / 3000)) : -w.facingAnchor;
  }
  if (w.diversity && avoid.length) {
    const same = avoid.filter((p) => p.ruleId === rule.id && p.roomId === it.roomId);
    if (same.length) {
      const d = Math.min(...same.map((p) => (e && p.edge === e.index && p.rot === it.rot ? 0 : Math.min(1, dist(p, c) / 1500))));
      sc += w.diversity * d * 2 - w.diversity;
    }
  }
  return sc;
}

function sizesFor(rule: ItemRule): { w: number; d: number }[] {
  const c = CATALOG[rule.type];
  return [rule.size ?? { w: c.w, d: c.d }, ...(rule.fallbackSizes ?? [])];
}

function wallCandidates(rule: ItemRule, info: RoomInfo, size: { w: number; d: number }, rules: Rules, st: Static, anchor: FurnitureItem | null, avoid: Placement[]): Candidate[] {
  const out: Candidate[] = [];
  const cat = CATALOG[rule.type];
  const gap = rules.wallGap;
  const contacts = rule.contact === 'either' ? ['back', 'side'] : [rule.contact ?? 'back'];
  for (const e of info.edges) {
    const br = backRot(e.inward);
    if (br === null) continue;
    for (const contact of contacts) {
      const rots: Rot[] = contact === 'back' ? [br] : sideRots(e.inward);
      for (const rot of rots) {
        const spans = freeSpans(e, rules.doorJambOffset, cat.tall);
        for (const [a, b] of spans) {
          const spanLen = b - a;
          let widths: number[];
          if (rule.width && contact === 'back') {
            const { mode, min, max, target, reserve = 0 } = rule.width;
            const cap = Math.floor(Math.min(max, spanLen - reserve) / 50) * 50;
            const capFull = Math.floor(Math.min(max, spanLen) / 50) * 50;
            if (capFull < min) continue;
            // С запасом под соседний предмет (холодильник) и без него — если иначе не помещается.
            const pick = (c: number) => (mode === 'max' ? c : Math.min(c, target ?? c));
            const set = new Set<number>([cap >= min ? pick(cap) : 0, pick(capFull)]);
            // Более короткие варианты — чтобы обойти двери и соседей; длинные предпочитаются оценкой.
            for (let w = pick(capFull) - 200, n = 0; w >= min && n < 8; w -= 200, n++) set.add(w);
            widths = [...set].filter((x) => x >= min);
          } else widths = [size.w];
          for (const w of widths) {
            const along = contact === 'back' ? w : size.d;
            const out_ = contact === 'back' ? size.d : w;
            if (along > spanLen) continue;
            const positions = new Set<number>([a + along / 2, b - along / 2, (a + b) / 2]);
            for (let s = a + along / 2; s <= b - along / 2; s += 100) positions.add(s);
            for (const s of positions) {
              if (s - along / 2 < a - 0.5 || s + along / 2 > b + 0.5) continue;
              const p = pointAt(e, s);
              const cx = p.x + e.inward.x * (out_ / 2 + gap), cy = p.y + e.inward.y * (out_ / 2 + gap);
              const it = makeItem(rule, info.room, cx, cy, rot, w, size.d);
              let score = scoreCandidate(rule, info, it, e, s - along / 2, s + along / 2, st, anchor, avoid);
              if (rule.width) {
                const { mode, min, max, target } = rule.width;
                score += mode === 'max' ? (2 * (w - min)) / Math.max(1, max - min) : -Math.abs(w - (target ?? w)) / 1000;
              }
              out.push({ item: it, edge: e.index, score });
            }
          }
        }
      }
    }
  }
  return out;
}

function freeCandidates(rule: ItemRule, info: RoomInfo, size: { w: number; d: number }, st: Static, anchor: FurnitureItem | null, avoid: Placement[]): Candidate[] {
  const out: Candidate[] = [];
  const b = bbox(info.room.polygon);
  for (const rot of [0, 90] as Rot[])
    for (let x = b.minX + 50; x < b.maxX; x += 50)
      for (let y = b.minY + 50; y < b.maxY; y += 50) {
        const it = makeItem(rule, info.room, x, y, rot, size.w, size.d);
        out.push({ item: it, edge: null, score: scoreCandidate(rule, info, it, null, 0, 0, st, anchor, avoid) });
      }
  return out;
}

function attachCandidates(rule: ItemRule, info: RoomInfo, size: { w: number; d: number }, anchor: FurnitureItem): Candidate[] {
  const out: Candidate[] = [];
  const locals: Pt[] = [];
  if (rule.attach === 'ends') {
    const y = -anchor.d / 2 + size.d / 2;
    locals.push({ x: -(anchor.w / 2 + size.w / 2 + 10), y }, { x: anchor.w / 2 + size.w / 2 + 10, y });
  } else if (rule.attach === 'bedsides') {
    const y = -anchor.d / 2 + size.d / 2 + 50;
    locals.push({ x: -(anchor.w / 2 + size.w / 2 + 20), y }, { x: anchor.w / 2 + size.w / 2 + 20, y });
  } else if (rule.attach === 'front') {
    locals.push({ x: 0, y: anchor.d / 2 + 350 + size.d / 2 });
  }
  for (const l of locals) {
    const p = localToWorld(l, anchor.x, anchor.y, anchor.rot);
    out.push({ item: makeItem(rule, info.room, p.x, p.y, anchor.rot, size.w, size.d), edge: null, score: 0 });
  }
  return out;
}

/** Модули кухни: мойка на том торце, что ближе к стояку / мокрой зоне. */
function finishKitchen(it: FurnitureItem, ctx: PlanContext) {
  if (it.type !== 'kitchen-run') return;
  const t = wetTarget(ctx);
  const start = localToWorld({ x: -it.w / 2, y: 0 }, it.x, it.y, it.rot);
  const end = localToWorld({ x: it.w / 2, y: 0 }, it.x, it.y, it.rot);
  const dS = t.length ? Math.min(...t.map((p) => dist(p, start))) : 0;
  const dE = t.length ? Math.min(...t.map((p) => dist(p, end))) : 1;
  it.modules = kitchenModules(it.w, dS <= dE);
}

function reachBad(ctx: PlanContext, items: FurnitureItem[], rules: Rules): number {
  // Грубая сетка (100 мм) с запасом в полъячейки: строже точной итоговой проверки, но в разы быстрее.
  return reachability(ctx, items, rules, Math.max(100, rules.gridStep), true).issues.filter((i) => i.severity === 'error').length;
}

export function runEngine(input: EngineInput): EngineResult {
  const { g, brief, rules } = input;
  const scenario = buildScenario(input.scenario, brief);
  const ctx = planContext(g, rules);
  const st = new Static(ctx);
  const beam = input.beamWidth ?? 5;
  const avoid = input.avoid ?? [];
  const localInput = { ctx, rules, brief };

  let states: State[] = [{ items: [], placements: [], skipped: [], score: 0, incomplete: false }];

  for (const rule of scenario.rules) {
    const typed = rule.rooms.flatMap((t) => g.rooms.filter((r) => r.type === t));
    if (!typed.length) continue;
    const roomGroups: Room[][] = rule.scope === 'each' ? typed.map((r) => [r]) : [typed];

    for (const group of roomGroups) {
      const next: State[] = [];
      for (const state of states) {
        const dyn = new Dynamic(st, state.items, rules);
        const baseBad = reachBad(ctx, state.items, rules);
        let found: Candidate[] = [];
        let tried = '';
        const modes = [rule.placement, ...(rule.fallbackPlacement ? [rule.fallbackPlacement] : [])];
        for (const [ri, room] of group.entries()) {
          const info = roomInfo(st, room);
          const roomBonus = (group.length - ri - 1) * 3; // предпочтение порядка помещений в правиле
          const anchorRule = rule.anchor;
          const anchor = anchorRule ? state.items.find((i) => i.ruleId === anchorRule && (rule.placement !== 'attach' || i.roomId === room.id)) ?? null : null;
          for (const mode of modes) {
            if (mode === 'attach' && !anchor) continue;
            for (const size of sizesFor(rule)) {
              const cands =
                mode === 'wall' ? wallCandidates(rule, info, size, rules, st, anchor, avoid)
                : mode === 'free' ? freeCandidates(rule, info, size, st, anchor, avoid)
                : attachCandidates(rule, info, size, anchor!);
              const ok = cands.filter((c) => rasterOk(st, dyn, c.item, room, rules, brief)).sort((a, b) => b.score - a.score);
              const valid: Candidate[] = [];
              let tries = 0;
              for (const c of ok) {
                if (++tries > 80) break;
                finishKitchen(c.item, ctx);
                const errs = checkItem(localInput, c.item, state.items).filter((i) => i.severity === 'error');
                ENGINE_STATS.exact++;
                if (errs.length) { for (const e of errs) ENGINE_STATS.exactFail[e.code] = (ENGINE_STATS.exactFail[e.code] ?? 0) + 1; continue; }
                ENGINE_STATS.reach++;
                // Кандидат не должен ухудшать проходимость (перекрыть коридор, подход к другим предметам).
                if (!CATALOG[c.item.type].soft && reachBad(ctx, [...state.items, c.item], rules) > baseBad) { ENGINE_STATS.reachFail++; continue; }
                // Для луча нужны разные решения: не больше двух кандидатов на одну стену/поворот.
                const k = `${c.edge}:${c.item.rot}`;
                if (valid.filter((v) => `${v.edge}:${v.item.rot}` === k).length >= 2 && mode !== 'attach') continue;
                valid.push(c);
                if (valid.length >= (mode === 'attach' ? 2 : 3)) break;
              }
              if (valid.length) { found = valid.map((v) => ({ ...v, score: v.score + roomBonus })); break; }
            }
            if (found.length) break;
          }
          if (found.length) break;
          tried = room.name;
        }

        if (!found.length) {
          const roomName = tried || group.map((r) => r.name).join(', ');
          const reason = rule.mandatory
            ? `не удалось разместить «${CATALOG[rule.type].name}» с соблюдением проходов и зон обслуживания`
            : 'не хватило места — предмет пропущен';
          next.push({ ...state, skipped: [...state.skipped, { ruleId: rule.id, type: rule.type, roomName, mandatory: rule.mandatory, reason }], incomplete: state.incomplete || rule.mandatory, score: state.score - (rule.mandatory ? 50 : 2) });
          continue;
        }
        // Тумбы ставим обе (если помещаются), остальное — варианты для луча.
        if (rule.attach === 'bedsides' && found[0].edge === null) {
          const items = [...state.items];
          for (const c of found)
            if (!checkItem(localInput, c.item, items).some((i) => i.severity === 'error') && reachBad(ctx, [...items, c.item], rules) <= baseBad) items.push(c.item);
          next.push({ ...state, items, placements: state.placements });
          continue;
        }
        for (const c of found.slice(0, beam)) {
          const items = [...state.items, c.item];
          next.push({
            items,
            placements: [...state.placements, ...(rule.key ? [{ ruleId: rule.id, roomId: c.item.roomId!, edge: c.edge, rot: c.item.rot, x: c.item.x, y: c.item.y }] : [])],
            skipped: state.skipped,
            score: state.score + c.score,
            incomplete: state.incomplete,
          });
        }
      }
      // Отбор: сначала без новых проблем проходимости, затем по оценке.
      const scored = next.map((s) => ({ s, bad: reachBad(ctx, s.items, rules) }));
      scored.sort((a, b) => a.bad - b.bad || b.s.score - a.s.score);
      const seen = new Set<string>();
      states = [];
      for (const { s, bad } of scored) {
        const sig = s.items.map((i) => `${i.type}${i.x},${i.y},${i.rot},${i.w}`).join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);
        // Состояние с нарушенной проходимостью: убираем последний предмет, если есть альтернатива.
        if (bad && states.length && scored[0].bad === 0) continue;
        states.push(s);
        if (states.length >= beam) break;
      }
      if (!states.length) states = [scored[0].s];
    }
  }

  const best = states[0];
  return { scenario, items: best.items, placements: best.placements, skipped: best.skipped, incomplete: best.incomplete, score: best.score };
}
