// Библиотека мебели: реальные габариты в мм. Локальная система предмета:
// ширина w — вдоль оси x, глубина d — вдоль оси y; «спинка» (к стене) — на y = −d/2,
// фасад / зона обслуживания — на y = +d/2. Поворот rot — по часовой (ось Y вниз):
// rot 0 — спинкой к верхней стене, 90 — к правой, 180 — к нижней, 270 — к левой.
import type { FurnitureItem, FurnitureType, KitchenModule, Pt } from '../model/types';
import type { RuleKey, Rules } from '../rules/rules';
import { localToWorld, orientedRect } from '../geometry/poly';

export interface CatalogEntry {
  type: FurnitureType;
  name: string;
  w: number;
  d: number;
  /** Допустимый диапазон ширины для «тянущихся» предметов (шкаф, кухня). */
  wRange?: [number, number];
  /** Высокий предмет: не ставим перед окнами. */
  tall: boolean;
  /** Мягкий предмет (ковёр): не участвует в коллизиях. */
  soft: boolean;
  /** Сантехника: должна стоять в мокрой зоне. */
  wet: boolean;
  /** Ключ правила глубины зоны обслуживания перед фасадом; null — без зоны. */
  service: RuleKey | null;
  /** Предметы, которым разрешено находиться в зоне обслуживания этого предмета. */
  serviceAllows?: FurnitureType[];
}

export const CATALOG: Record<FurnitureType, CatalogEntry> = {
  'bed-double': { type: 'bed-double', name: 'Кровать двуспальная', w: 1600, d: 2100, tall: false, soft: false, wet: false, service: null },
  'bed-single': { type: 'bed-single', name: 'Кровать односпальная', w: 900, d: 2000, tall: false, soft: false, wet: false, service: null },
  bedside: { type: 'bedside', name: 'Прикроватная тумба', w: 450, d: 400, tall: false, soft: false, wet: false, service: null },
  wardrobe: { type: 'wardrobe', name: 'Шкаф', w: 1600, d: 600, wRange: [800, 3600], tall: true, soft: false, wet: false, service: 'wardrobeFront' },
  dresser: { type: 'dresser', name: 'Комод', w: 1200, d: 500, tall: false, soft: false, wet: false, service: 'accessMin' },
  sofa: { type: 'sofa', name: 'Диван', w: 2200, d: 950, tall: false, soft: false, wet: false, service: 'sofaFront', serviceAllows: ['coffee-table', 'play-rug'] },
  armchair: { type: 'armchair', name: 'Кресло', w: 800, d: 850, tall: false, soft: false, wet: false, service: 'accessMin', serviceAllows: ['coffee-table', 'play-rug'] },
  'coffee-table': { type: 'coffee-table', name: 'Журнальный стол', w: 1000, d: 550, tall: false, soft: false, wet: false, service: null },
  'tv-unit': { type: 'tv-unit', name: 'ТВ-зона', w: 1600, d: 400, tall: false, soft: false, wet: false, service: null },
  dining: { type: 'dining', name: 'Обеденная группа', w: 1200, d: 1700, tall: false, soft: false, wet: false, service: 'diningChairZone' },
  desk: { type: 'desk', name: 'Рабочий стол', w: 1200, d: 600, tall: false, soft: false, wet: false, service: 'deskChairZone' },
  'kitchen-run': { type: 'kitchen-run', name: 'Кухонный гарнитур', w: 3000, d: 600, wRange: [1800, 4800], tall: false, soft: false, wet: false, service: 'kitchenFront' },
  fridge: { type: 'fridge', name: 'Холодильник', w: 600, d: 650, tall: true, soft: false, wet: false, service: 'kitchenFront' },
  bathtub: { type: 'bathtub', name: 'Ванна', w: 1700, d: 700, wRange: [1500, 1800], tall: false, soft: false, wet: true, service: 'sanitaryFront' },
  shower: { type: 'shower', name: 'Душ', w: 900, d: 900, tall: false, soft: false, wet: true, service: 'sanitaryFront' },
  toilet: { type: 'toilet', name: 'Унитаз', w: 400, d: 650, tall: false, soft: false, wet: true, service: 'sanitaryFront' },
  washbasin: { type: 'washbasin', name: 'Раковина', w: 600, d: 450, tall: false, soft: false, wet: true, service: 'sanitaryFront' },
  washer: { type: 'washer', name: 'Стиральная машина', w: 600, d: 600, tall: false, soft: false, wet: true, service: 'sanitaryFront' },
  'shoe-cabinet': { type: 'shoe-cabinet', name: 'Обувница', w: 1000, d: 350, tall: false, soft: false, wet: false, service: 'accessMin' },
  'play-rug': { type: 'play-rug', name: 'Игровая зона (ковёр)', w: 1400, d: 1000, tall: false, soft: true, wet: false, service: null },
  shelving: { type: 'shelving', name: 'Стеллаж', w: 1000, d: 350, wRange: [600, 2400], tall: true, soft: false, wet: false, service: 'accessMin' },
};

export const DINING_PRESETS: Record<number, { w: number; d: number }> = {
  2: { w: 800, d: 1600 },
  4: { w: 1200, d: 1700 },
  6: { w: 1600, d: 1800 },
};

export function footprint(it: Pick<FurnitureItem, 'x' | 'y' | 'w' | 'd' | 'rot'>): Pt[] {
  return orientedRect(it.x, it.y, it.w, it.d, it.rot);
}

/** Прямоугольник в локальных координатах предмета → мировые координаты. */
export function localRect(it: Pick<FurnitureItem, 'x' | 'y' | 'rot'>, x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
  ].map((p) => localToWorld(p, it.x, it.y, it.rot));
}

/** Зоны обслуживания предмета (перед фасадом; у обеденной группы — с двух длинных сторон). */
export function serviceZones(it: FurnitureItem, rules: Rules): Pt[][] {
  const c = CATALOG[it.type];
  if (!c.service) return [];
  const depth = rules[c.service];
  const { w, d } = it;
  if (it.type === 'dining') {
    return [localRect(it, -w / 2, -d / 2 - depth, w / 2, -d / 2), localRect(it, -w / 2, d / 2, w / 2, d / 2 + depth)];
  }
  return [localRect(it, -w / 2, d / 2, w / 2, d / 2 + depth)];
}

/** Полосы бокового доступа к кровати (левая и правая), без зоны прикроватных тумб. */
export function bedSideStrips(it: FurnitureItem, rules: Rules): { left: Pt[]; right: Pt[]; foot: Pt[] } {
  const a = rules.bedSideAccess;
  const { w, d } = it;
  const y0 = -d / 2 + 450; // полоса начинается за тумбой у изголовья
  return {
    left: localRect(it, -w / 2 - a, y0, -w / 2, d / 2),
    right: localRect(it, w / 2, y0, w / 2 + a, d / 2),
    foot: localRect(it, -w / 2, d / 2, w / 2, d / 2 + rules.bedFootClearance),
  };
}

/** Модули кухни по длине гарнитура: мойка ближе к стояку-концу, варочная — через рабочую зону. */
export function kitchenModules(length: number, sinkAtStart: boolean): KitchenModule[] {
  const mods: KitchenModule[] = [];
  const sink: KitchenModule = { kind: 'sink', w: 600 };
  const dish: KitchenModule = { kind: 'dishwasher', w: length >= 2800 ? 450 : 0 };
  const hob: KitchenModule = { kind: 'hob', w: 600 };
  const fixed = sink.w + dish.w + hob.w;
  const rest = Math.max(0, length - fixed);
  const work = Math.max(300, Math.round((rest * 0.6) / 50) * 50);
  const tail = Math.max(0, length - fixed - work);
  const seq: KitchenModule[] = [sink, ...(dish.w ? [dish] : []), { kind: 'base', w: work }, hob, ...(tail ? [{ kind: 'base' as const, w: tail }] : [])];
  if (!sinkAtStart) seq.reverse();
  for (const m of seq) if (m.w > 0) mods.push(m);
  return mods;
}

/** Центр мойки в мировых координатах (для проверки расстояния до стояка). */
export function sinkCenter(it: FurnitureItem): Pt | null {
  if (it.type !== 'kitchen-run' || !it.modules) return null;
  let x = -it.w / 2;
  for (const m of it.modules) {
    if (m.kind === 'sink') return localToWorld({ x: x + m.w / 2, y: 0 }, it.x, it.y, it.rot);
    x += m.w;
  }
  return null;
}
