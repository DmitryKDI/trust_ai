// Параметрические шаблоны: описывают правила размещения, а не координаты.
// Сценарии — разные наборы приоритетов и состава предметов для одной и той же квартиры.
import type { Brief, FurnitureType, RoomType, ScenarioKey } from '../model/types';
import { DINING_PRESETS } from '../furniture/catalog';

export type Weights = Partial<{
  /** Не перекрывать окна (для кроватей — изголовье к глухой стене). */
  blankWall: number;
  /** Длинная стена помещения. */
  longestWall: number;
  /** По центру стены. */
  centered: number;
  /** Вплотную к углу. */
  corner: number;
  /** Ближе к окну (рабочее место, обеденный стол). */
  nearWindow: number;
  /** Дальше от входной двери помещения. */
  farFromDoor: number;
  /** Ближе к стояку / мокрой зоне (мойка). */
  nearWet: number;
  /** Ближе ко входу в квартиру (прихожая). */
  nearEntrance: number;
  /** Ближе к предмету-якорю (холодильник рядом с гарнитуром). */
  nearAnchor: number;
  /** Напротив предмета-якоря (ТВ напротив дивана). */
  facingAnchor: number;
  /** Не на той же стене, что предметы-«соседи» (разнообразие). */
  diversity: number;
}>;

export interface ItemRule {
  id: string;
  type: FurnitureType;
  /** Типы помещений в порядке предпочтения. */
  rooms: RoomType[];
  /** 'each' — в каждом подходящем помещении, 'first' — в первом, где получилось. */
  scope: 'each' | 'first';
  mandatory: boolean;
  placement: 'wall' | 'free' | 'attach';
  /** Запасной способ, если основной не дал ни одной позиции. */
  fallbackPlacement?: 'wall' | 'free';
  contact?: 'back' | 'side' | 'either';
  size?: { w: number; d: number };
  /** Для «тянущихся» предметов: максимум, целевой размер или фиксированный. */
  width?: { mode: 'max' | 'target'; min: number; max: number; target?: number; /** Запас по длине стены (напр. под холодильник на торце). */ reserve?: number };
  anchor?: string;
  /** Привязка к якорю: к торцам, по бокам изголовья, перед фасадом. */
  attach?: 'ends' | 'bedsides' | 'front';
  weights: Weights;
  /** Запасные размеры, если основной не помещается. */
  fallbackSizes?: { w: number; d: number }[];
  /** Ключевой предмет — участвует в оценке «содержательного» отличия вариантов. */
  key?: boolean;
  seats?: number;
  note?: string;
}

export interface Scenario {
  key: ScenarioKey;
  title: string;
  idea: string;
  rules: ItemRule[];
}

const bedrooms: RoomType[] = ['bedroom'];
const kids: RoomType[] = ['kids'];

export function buildScenario(key: ScenarioKey, brief: Brief): Scenario {
  const wfh = brief.workFromHome;
  const seats = key === 'family' ? Math.max(4, brief.diningSeats) : brief.diningSeats;
  const dining = DINING_PRESETS[seats >= 6 ? 6 : seats <= 2 ? 2 : 4];
  const wardrobe = (mode: 'max' | 'target', target: number, max = 3600) => ({ mode, min: 800, max, target });

  const rules: ItemRule[] = [];
  const add = (r: ItemRule) => rules.push(r);

  // ——— Мокрые зоны: сантехника остаётся в санузлах, стояки не переносим.
  add({ id: 'bath', type: brief.preferShower ? 'shower' : 'bathtub', rooms: ['bath'], scope: 'each', mandatory: true, placement: 'wall', contact: 'back',
    width: brief.preferShower ? undefined : { mode: 'max', min: 1500, max: 1800 }, weights: { corner: 3, longestWall: 1 },
    fallbackSizes: brief.preferShower ? [] : [{ w: 900, d: 900 }] });
  add({ id: 'bath-basin', type: 'washbasin', rooms: ['bath'], scope: 'each', mandatory: true, placement: 'wall', contact: 'back', weights: { nearWet: 1, farFromDoor: -0.5 } });
  add({ id: 'wc-toilet', type: 'toilet', rooms: ['wc', 'bath'], scope: 'first', mandatory: true, placement: 'wall', contact: 'back', weights: { farFromDoor: 2, centered: 1 } });
  add({ id: 'wc-basin', type: 'washbasin', rooms: ['wc'], scope: 'each', mandatory: false, placement: 'wall', contact: 'back', size: { w: 450, d: 300 }, weights: { centered: 0.5 } });

  // ——— Кухня: гарнитур вдоль стены ближе к мокрой зоне / стояку, холодильник на торце.
  add({ id: 'kitchen', type: 'kitchen-run', rooms: ['kitchen', 'kitchen-living'], scope: 'first', mandatory: true, placement: 'wall', contact: 'back', key: true,
    width: key === 'space' ? { mode: 'target', min: 1800, max: 4800, target: 2700, reserve: 610 } : { mode: 'max', min: 1800, max: key === 'storage' ? 4800 : 3600, reserve: 610 },
    weights: { nearWet: 6, corner: 1, longestWall: 1, blankWall: 0.3, diversity: 1 } });
  add({ id: 'fridge', type: 'fridge', rooms: ['kitchen', 'kitchen-living'], scope: 'first', mandatory: true, placement: 'attach', anchor: 'kitchen',
    attach: 'ends', fallbackPlacement: 'wall', contact: 'back', weights: { nearAnchor: 4, corner: 1 } });
  add({ id: 'dining', type: 'dining', rooms: ['kitchen', 'kitchen-living', 'living'], scope: 'first', mandatory: true, placement: 'free', size: dining, seats, key: true,
    weights: { nearWindow: 2, centered: 0.5, diversity: 1 } });
  add({ id: 'washer', type: 'washer', rooms: ['bath', 'wc', 'kitchen', 'kitchen-living'], scope: 'first', mandatory: key === 'storage', placement: 'wall', contact: 'back', weights: { corner: 1 } });

  // ——— Спальни.
  add({ id: 'bed', type: 'bed-double', rooms: bedrooms, scope: 'each', mandatory: true, placement: 'wall', contact: 'back', key: true,
    size: { w: 1600, d: 2100 }, fallbackSizes: [{ w: 1400, d: 2100 }], weights: { blankWall: 4, centered: 2, longestWall: 1, farFromDoor: 0.5, diversity: 2 } });
  add({ id: 'bedside', type: 'bedside', rooms: bedrooms, scope: 'each', mandatory: false, placement: 'attach', anchor: 'bed',
    attach: 'bedsides', weights: {} });
  add({ id: 'bed-wardrobe', type: 'wardrobe', rooms: bedrooms, scope: 'each', mandatory: key !== 'space', placement: 'wall', contact: 'back', key: true,
    width: key === 'storage' ? wardrobe('max', 3600) : key === 'space' ? wardrobe('target', 1600, 2000) : wardrobe('target', 2400, 3000),
    weights: { corner: 2, blankWall: 1, diversity: 2 } });
  if (wfh && key !== 'family')
    add({ id: 'bed-desk', type: 'desk', rooms: bedrooms, scope: 'first', mandatory: false, placement: 'wall', contact: 'back', weights: { nearWindow: 3, corner: 0.5 } });
  if (key === 'storage')
    add({ id: 'bed-dresser', type: 'dresser', rooms: bedrooms, scope: 'each', mandatory: false, placement: 'wall', contact: 'back', weights: { centered: 0.5 } });

  // ——— Детские (помещения типа «детская» из разметки; без детей в брифе — гостевая по тому же шаблону).
  {
    add({ id: 'kid-bed', type: 'bed-single', rooms: kids, scope: 'each', mandatory: true, placement: 'wall', contact: 'either', key: true,
      weights: { corner: 3, farFromDoor: 1, blankWall: 1, diversity: 2 } });
    add({ id: 'kid-desk', type: 'desk', rooms: kids, scope: 'each', mandatory: key === 'family', placement: 'wall', contact: 'back', key: true,
      size: key === 'family' ? { w: 1400, d: 650 } : undefined, weights: { nearWindow: 4, corner: 0.5 } });
    add({ id: 'kid-wardrobe', type: 'wardrobe', rooms: kids, scope: 'each', mandatory: key !== 'space', placement: 'wall', contact: 'back', key: true,
      width: key === 'storage' ? wardrobe('max', 3000) : wardrobe('target', 1200, 1800), weights: { corner: 2, blankWall: 1, diversity: 1 } });
    if (key === 'family')
      add({ id: 'kid-play', type: 'play-rug', rooms: kids, scope: 'each', mandatory: false, placement: 'free', weights: { centered: 1 } });
    if (key === 'storage')
      add({ id: 'kid-shelf', type: 'shelving', rooms: kids, scope: 'each', mandatory: false, placement: 'wall', contact: 'back', width: { mode: 'max', min: 600, max: 1600 }, weights: { corner: 1 } });
  }

  // ——— Гостиная.
  add({ id: 'sofa', type: 'sofa', rooms: ['living', 'kitchen-living'], scope: 'first', mandatory: true, placement: 'wall', contact: 'back', key: true,
    size: key === 'space' ? { w: 2000, d: 900 } : { w: 2200, d: 950 }, fallbackSizes: [{ w: 1800, d: 900 }],
    weights: { blankWall: 2, longestWall: 1, centered: 1.5, farFromDoor: 0.5, diversity: 2 } });
  add({ id: 'coffee', type: 'coffee-table', rooms: ['living', 'kitchen-living'], scope: 'first', mandatory: false, placement: 'attach', anchor: 'sofa',
    attach: 'front', weights: {} });
  add({ id: 'tv', type: 'tv-unit', rooms: ['living', 'kitchen-living'], scope: 'first', mandatory: false, placement: 'wall', contact: 'back', weights: { facingAnchor: 5, centered: 0.5 }, anchor: 'sofa' });
  if (key === 'family' && wfh)
    add({ id: 'living-desk', type: 'desk', rooms: ['living', 'bedroom'], scope: 'first', mandatory: false, placement: 'wall', contact: 'back', key: true, weights: { nearWindow: 3, corner: 1 } });
  if (key !== 'space')
    add({ id: 'armchair', type: 'armchair', rooms: ['living', 'kitchen-living'], scope: 'first', mandatory: false, placement: 'wall', contact: 'back', weights: { nearWindow: 1, corner: 1 } });
  if (key === 'storage')
    add({ id: 'living-storage', type: 'shelving', rooms: ['living', 'kitchen-living'], scope: 'first', mandatory: false, placement: 'wall', contact: 'back', key: true,
      width: { mode: 'max', min: 800, max: 2400 }, weights: { corner: 1, blankWall: 1 } });

  // ——— Прихожая.
  add({ id: 'hall-wardrobe', type: 'wardrobe', rooms: ['hall', 'corridor'], scope: 'first', mandatory: key === 'storage', placement: 'wall', contact: 'back', key: true,
    size: undefined, width: key === 'storage' ? { mode: 'max', min: 800, max: 3000, target: 3000 } : { mode: 'target', min: 800, max: 1600, target: 1200 },
    weights: { nearEntrance: 3, corner: 1 } });
  if (key !== 'storage')
    add({ id: 'hall-shoes', type: 'shoe-cabinet', rooms: ['hall', 'corridor'], scope: 'first', mandatory: false, placement: 'wall', contact: 'back', size: { w: 800, d: 350 }, weights: { nearEntrance: 3 } });

  const meta: Record<ScenarioKey, { title: string; idea: string }> = {
    space: { title: 'Больше пространства', idea: 'Меньше корпусной мебели, свободные проходы и светлая общая зона' },
    storage: { title: 'Максимум хранения', idea: 'Каждой вещи — своё место: шкафы на всю длину свободных стен' },
    family: { title: 'Семейный', idea: 'У каждого своё место: полноценная детская, рабочее место и общий стол' },
  };
  return { key, ...meta[key], rules };
}
