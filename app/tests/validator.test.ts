import { describe, expect, it } from 'vitest';
import type { FurnitureItem, FurnitureType, Rot } from '../src/model/types';
import { CATALOG } from '../src/furniture/catalog';
import { resolveRules } from '../src/rules/rules';
import { validate } from '../src/validate/validator';
import { twoRoom } from './fixtures/synthetic';

const rules = resolveRules();
const brief = { bedAccessBothSides: true };
let k = 0;
function item(type: FurnitureType, x: number, y: number, rot: Rot = 0, w?: number, d?: number, roomId: string | null = null): FurnitureItem {
  const c = CATALOG[type];
  return { id: `i${++k}`, type, x, y, rot, w: w ?? c.w, d: d ?? c.d, roomId, ruleId: null, movedByManager: false };
}
const codes = (items: FurnitureItem[]) => validate(twoRoom(), items, rules, brief).issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('валидатор', () => {
  it('пустой план: ошибок нет, все помещения достижимы', () => {
    const r = validate(twoRoom(), [], rules, brief);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.unreachableRooms).toEqual([]);
    expect(r.reachableRooms).toHaveLength(3);
  });

  it('кровать изголовьем к глухой стене с проходами — без ошибок', () => {
    // Спальня x 5050..9850, y 150..3450; окно на верхней стене 6500..8000. Изголовье к правой стене.
    const bed = item('bed-double', 9850 - 1050 - 10, 1800, 90);
    expect(codes([bed])).toEqual([]);
  });

  it('предмет пересекает стену', () => {
    expect(codes([item('wardrobe', 5000, 1500, 90)])).toContain('wall-collision');
  });

  it('кровать посреди комнаты — не у стены', () => {
    expect(codes([item('bed-double', 7400, 1800, 0)])).toContain('bed-head-wall');
  });

  it('высокий шкаф перед окном', () => {
    expect(codes([item('wardrobe', 7250, 150 + 300 + 10, 0, 1600, 600)])).toContain('window-tall');
  });

  it('мебель в зоне открывания двери', () => {
    // Дверь в спальню 5300..6100 открывается вверх (в спальню).
    expect(codes([item('dresser', 5700, 3450 - 260, 180)])).toContain('door-swing');
  });

  it('шкаф поперёк прихожей отрезает спальню и гостиную', () => {
    // Прихожая y 3550..6850; шкаф поперёк на 3000 мм оставляет проход 300 мм.
    const a = item('wardrobe', 7300, 3550 + 1500, 90, 3000, 600);
    const r = validate(twoRoom(), [a], rules, brief);
    const errs = r.issues.filter((i) => i.severity === 'error').map((i) => i.code);
    expect(errs).toContain('room-unreachable');
  });

  it('пересечение двух предметов', () => {
    expect(codes([item('dresser', 7000, 1000), item('dresser', 7300, 1000)])).toContain('item-collision');
  });

  it('ковёр не участвует в коллизиях', () => {
    expect(codes([item('play-rug', 2500, 3500), item('coffee-table', 2500, 3500)])).not.toContain('item-collision');
  });

  it('сантехника вне мокрой зоны — предупреждение о переносе', () => {
    const r = validate(twoRoom(), [item('toilet', 7000, 3450 - 325 - 10, 180)], rules, brief);
    expect(r.issues.some((i) => i.code === 'wet-moved' && i.severity === 'warning')).toBe(true);
  });

  it('несоответствие версии геометрии', () => {
    const r = validate(twoRoom(), [], rules, brief, { expectedHash: 'deadbeef' });
    expect(r.issues.map((i) => i.code)).toContain('geometry-changed');
  });
});
