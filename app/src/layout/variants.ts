// Сборка вариантов: движок по сценариям → проверка → объяснение.
// Вариант с ошибками не выдаётся за готовый: помечается «требует доработки» и не утверждается.
import type { Brief, FurnitureItem, PlanGeometry, ScenarioKey, Variant } from '../model/types';
import { planningInputsHash } from '../brief/requirements';
import { CATALOG } from '../furniture/catalog';
import { geometryHash } from '../geometry/plan';
import type { Rules } from '../rules/rules';
import { planContext } from '../validate/context';
import { freeFloorArea, validate } from '../validate/validator';
import { runEngine, type Placement } from './engine';

export const SCENARIO_ORDER: ScenarioKey[] = ['space', 'storage', 'family'];

export interface Rejected { scenario: ScenarioKey; title: string; reason: string }

export interface BuildResult { variants: Variant[]; rejected: Rejected[] }

const m1 = (mm: number) => (Math.round(mm / 100) / 10).toFixed(1).replace('.', ',');

export function metricsOf(g: PlanGeometry, items: FurnitureItem[], rules: Rules): Record<string, number> {
  const ctx = planContext(g, rules);
  const sum = (types: string[]) => items.filter((i) => types.includes(i.type)).reduce((s, i) => s + i.w, 0);
  return {
    storageMm: sum(['wardrobe', 'shelving']),
    kitchenMm: sum(['kitchen-run']),
    freeFloor: Math.round(freeFloorArea(ctx, items) * 10) / 10,
    seats: items.find((i) => i.type === 'dining')?.seats ?? 0,
    desks: items.filter((i) => i.type === 'desk').length,
    items: items.length,
  };
}

function signature(p: Placement[]): string {
  return p.map((x) => `${x.ruleId}@${x.roomId}:${x.edge}:${x.rot}:${Math.round(x.x / 500)},${Math.round(x.y / 500)}`).sort().join('|');
}

export function explain(g: PlanGeometry, scenario: ScenarioKey, items: FurnitureItem[], rules: Rules, brief: Brief, issues: Variant['issues'], skipped: { type: string; roomName: string; mandatory: boolean; reason: string }[]) {
  const mt = metricsOf(g, items, rules);
  const roomName = (id: string | null) => g.rooms.find((r) => r.id === id)?.name ?? '';
  const benefits: string[] = [];
  const compromises: string[] = [];
  const bed = items.find((i) => i.type === 'bed-double');
  const desks = items.filter((i) => i.type === 'desk');
  const dining = items.find((i) => i.type === 'dining');

  if (scenario === 'space') benefits.push(`Свободная площадь пола — ${mt.freeFloor.toString().replace('.', ',')} м²`, `Проходы не уже ${rules.passageMin} мм`);
  if (scenario === 'storage') benefits.push(`Шкафы и стеллажи — ${m1(mt.storageMm)} п. м`, `Кухонный фронт — ${m1(mt.kitchenMm)} м`);
  if (scenario === 'family') {
    const kid = g.rooms.find((r) => r.type === 'kids');
    if (kid) benefits.push(`Детская: кровать, ${items.some((i) => i.type === 'desk' && i.roomId === kid.id) ? 'стол у окна' : 'место для занятий'} и шкаф`);
    if (dining) { const n = dining.seats ?? 4; benefits.push(`Обеденный стол на ${n} ${n <= 4 ? 'персоны' : 'персон'}`); }
  }
  if (bed) benefits.push(`Кровать ${bed.w}×${bed.d} мм (полный габарит) изголовьем к стене, подход ${brief.bedAccessBothSides ? 'с двух сторон' : 'сбоку'}`);
  for (const d of desks) if (!benefits.some((b) => b.includes('стол у окна'))) benefits.push(`Рабочее место — ${roomName(d.roomId).toLowerCase()}`);
  if (scenario !== 'storage' && mt.storageMm) benefits.push(`Хранение — ${m1(mt.storageMm)} п. м шкафов`);
  if (scenario !== 'space') benefits.push(`Свободная площадь пола — ${mt.freeFloor.toString().replace('.', ',')} м²`);

  for (const s of skipped) compromises.push(s.mandatory ? `${CATALOG[s.type as keyof typeof CATALOG].name}: ${s.reason} (${s.roomName})` : `Не поместилось: ${CATALOG[s.type as keyof typeof CATALOG].name.toLowerCase()} (${s.roomName})`);
  for (const i of issues) if (i.severity === 'warning' && !['geometry-not-approved', 'no-calibration', 'riser-unknown'].includes(i.code)) compromises.push(i.message);
  if (scenario === 'space') compromises.push(`Меньше мест хранения: ${m1(mt.storageMm)} п. м шкафов`);
  if (scenario === 'storage') compromises.push('Больше корпусной мебели — меньше свободного пола');

  const assumptions = [
    'Пороги проходов и зон обслуживания — рабочие допущения, уточняются с дизайнером',
    'Габариты мебели типовые; точные модели подбираются в дизайн-проекте',
  ];
  if (!g.fixed.some((f) => f.kind === 'riser')) assumptions.push('Стояки на обмере не отмечены: положение мойки уточняется на объекте');
  const unknownWalls = g.walls.filter((w) => w.kind === 'unknown').length;
  if (unknownWalls) assumptions.push(`Тип ${unknownWalls} стен не подтверждён (несущая / перегородка) — стены не переносим`);

  const changes = issues.some((i) => i.code === 'wet-moved')
    ? ['Стены и проёмы сохранены', 'Есть перенос мокрой точки — требует отдельной проверки']
    : ['Перепланировка не предполагается: стены, проёмы и мокрые зоны сохранены'];
  return { benefits, compromises, assumptions, changes, metrics: mt };
}

export interface BuildOptions { seed?: number; previous?: FurnitureItem[]; fixedByScenario?: Partial<Record<ScenarioKey, FurnitureItem[]>>; roomIds?: string[] }

export function layoutSignature(items: FurnitureItem[]): string {
  return items.map(i => `${i.type}:${i.roomId}:${i.rot}:${i.w}:${i.d}:${Math.round(i.x)},${Math.round(i.y)}`).sort().join('|');
}

export function buildVariants(g: PlanGeometry, brief: Brief, rules: Rules, scenarios: ScenarioKey[] = SCENARIO_ORDER, options: BuildOptions = {}): BuildResult {
  const variants: Variant[] = [];
  const rejected: Rejected[] = [];
  const avoid: Placement[] = (options.previous ?? []).filter(i => i.ruleId && i.roomId).map(i => ({ ruleId: i.ruleId!, roomId: i.roomId!, rot: i.rot, x: i.x, y: i.y, edge: null }));
  const sigs: { sig: string; title: string; storage: number }[] = [];
  const hash = geometryHash(g);

  for (const scenario of scenarios) {
    const fixed = options.fixedByScenario?.[scenario] ?? [];
    const fixedIds = new Set(fixed.map(i => i.id));
    if (fixed.some(i => brief.layoutNeeds?.forbidden.includes(i.type))) throw new Error('Закреплённый предмет запрещён новым брифом. Снимите закрепление или измените запрет; прежний вариант сохранён.');
    const r = runEngine({ g, brief, rules, scenario, avoid, seed: options.seed, fixed, roomIds: options.roomIds });
    let v = validate(g, r.items, rules, brief, { expectedHash: hash });
    // Доводка: точная проверка нашла проблему у необязательного предмета — убираем его и перепроверяем.
    const mandatory = new Set(r.scenario.rules.filter((x) => x.mandatory).map((x) => x.id));
    for (let round = 0; round < 6; round++) {
      const errs = v.issues.filter((i) => i.severity === 'error' && i.code !== 'brief-requirement');
      if (!errs.length) break;
      const implicated = [...new Set(errs.flatMap((i) => i.itemIds))].map((id) => r.items.find((it) => it.id === id)).filter((it): it is FurnitureItem => !!it && !fixedIds.has(it.id) && !mandatory.has(it.ruleId ?? ''));
      if (!implicated.length) break;
      const drop = implicated[implicated.length - 1];
      r.items = r.items.filter((it) => it.id !== drop.id);
      r.skipped.push({ ruleId: drop.ruleId ?? '', type: drop.type, roomName: g.rooms.find((x) => x.id === drop.roomId)?.name ?? '', mandatory: false, reason: 'убран при проверке подходов' });
      v = validate(g, r.items, rules, brief, { expectedHash: hash });
    }
    if (v.issues.some(i => i.severity === 'error' && i.code !== 'brief-requirement' && i.itemIds.some(id => fixedIds.has(id)))) throw new Error('Закреплённая мебель или предметы вне выбранной комнаты нарушают текущие правила. Исправьте их или снимите закрепление; прежний вариант сохранён.');
    const errors = v.issues.filter((i) => i.severity === 'error');
    const sig = signature(r.placements);
    const storage = metricsOf(g, r.items, rules).storageMm;
    const dup = sigs.find((s) => s.sig === sig && Math.abs(s.storage - storage) < 500);
    if (dup) {
      rejected.push({ scenario, title: r.scenario.title, reason: `в этой квартире совпадает с вариантом «${dup.title}» — не показываем как отдельный` });
      continue;
    }
    const ex = explain(g, scenario, r.items, rules, brief, v.issues, r.skipped);
    if (r.incomplete || errors.length) {
      const why = r.skipped.filter((s) => s.mandatory).map((s) => `${CATALOG[s.type as keyof typeof CATALOG].name} (${s.roomName})`).join(', ');
      rejected.push({ scenario, title: r.scenario.title, reason: why ? `не удалось безопасно разместить: ${why}. Можно доработать вручную.` : `не прошёл проверки (${errors.length}). Можно доработать вручную.` });
    }
    variants.push({
      id: `v-${scenario}-${Date.now().toString(36)}`,
      scenario,
      title: r.scenario.title,
      idea: r.scenario.idea,
      geometryHash: hash,
      inputsHash: planningInputsHash(brief, rules),
      items: r.items,
      ...ex,
      issues: v.issues,
      approved: false,
      editedByManager: false,
    });
    sigs.push({ sig, title: r.scenario.title, storage });
    avoid.push(...r.placements);
  }
  return { variants, rejected };
}

/** Готов ли вариант к показу клиенту: нет ошибок проверок. */
export function isReady(v: Variant): boolean {
  return !v.issues.some((i) => i.severity === 'error');
}
