import { describe, expect, it } from 'vitest';
import { checkedPlan, learnedTypes, parseLearning, simpleRing } from '../src/learning/model';
import { emptyGeometry } from '../src/model/defaults';
import type { PlanGeometry, Room, RoomType } from '../src/model/types';

const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function plan(type: RoomType = 'bath', manual = true): PlanGeometry {
  const room = (id: string, polygon: Room['polygon'], t: RoomType, confirmed: boolean): Room => ({ id, polygon, type: t, name: t, source: 'suggested', sourcePage: 1, verifiedByManager: confirmed, ...(confirmed ? { typeSource: 'manual' } : {}) });
  return { ...emptyGeometry(), sourcePage: 1, calibration: { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, mmPerUnit: 1, method: 'typical' }, rooms: [room('small', rect(0, 0, 2000, 2000), type, manual), room('large', rect(2100, 0, 6000, 6000), 'living', false)] };
}
const example = (n: number, g = plan()) => checkedPlan(n.toString(16).padStart(64, '0') + ':1', g);

describe('обучение назначения и память исправлений', () => {
  it('один или два файла не меняют предположение на новом плане', () => {
    const g = plan('other', false);
    expect(learnedTypes(g, [example(1)]).geometry).toBe(g);
    expect(learnedTypes(g, [example(1), example(2)]).count).toBe(0);
  });
  it('три согласующихся примера меняют только назначение, без контура и масштаба', () => {
    const g = plan('kitchen', false);
    const result = learnedTypes(g, [example(1), example(2), example(3)]);
    expect(result.count).toBe(1);
    expect(result.geometry.rooms[0]).toMatchObject({ type: 'bath', typeSource: 'learned', verifiedByManager: false });
    expect(result.geometry.rooms[0].polygon).toBe(g.rooms[0].polygon);
    expect(result.geometry.calibration).toBe(g.calibration);
  });
  it('неопределенность/противоречия и повторные страницы не добавляют уверенности', () => {
    const g = plan('other', false);
    expect(learnedTypes(g, [example(1), example(2), example(3, plan('wc'))]).count).toBe(0);
    const e = example(1);
    expect(learnedTypes(g, [e, { ...e, key: e.key.replace(':1', ':2') }, { ...e, key: e.key.replace(':1', ':3') }]).count).toBe(0);
  });
  it('автоматические и повторно предположенные названия не обучают модель', () => {
    const g = plan('other', false);
    const auto = plan('bath', false);
    expect(learnedTypes(g, [example(1, auto), example(2, auto), example(3, auto)]).count).toBe(0);
    auto.rooms[0].typeSource = 'learned';
    expect(learnedTypes(g, [example(1, auto), example(2, auto), example(3, auto)]).count).toBe(0);
  });
  it('ручное назначение защищено от переобучения', () => {
    const g = plan('wc');
    expect(learnedTypes(g, [example(1), example(2), example(3)]).geometry).toBe(g);
  });
  it('распознанная подпись имеет приоритет перед похожими формами', () => {
    const g = plan('wc', false);
    expect(learnedTypes(g, [example(1), example(2), example(3)], new Set(['small'])).geometry).toBe(g);
  });
  it('масштаб и поворот не создают новую информацию о назначении', () => {
    const g = plan('other', false);
    for (const room of g.rooms) room.polygon = room.polygon.map(p => ({ x: -2 * p.y, y: 2 * p.x }));
    expect(learnedTypes(g, [example(1), example(2), example(3)]).geometry.rooms[0].type).toBe('bath');
  });
  it('сохраняет исправленный контур и удаленный проем отдельно от ID документа', () => {
    const g = plan();g.sourceDocumentId = 'private-doc';
    const saved = example(1, g);
    expect(saved.geometry.sourceDocumentId).toBeNull();
    expect(saved.geometry.rooms).toEqual(g.rooms);
    expect(saved.geometry.rooms).not.toBe(g.rooms);
    expect(saved.geometry.approved).toBe(false);
  });
  it('отказывает в обучении на пересечениях и самопересекающихся контурах', () => {
    const g = plan();g.rooms[1].polygon = rect(0, 0, 5000, 5000);
    expect(() => example(1, g)).toThrow(/пересекаются/);
    expect(simpleRing([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 5, y: 0 }])).toBe(false);
  });
  it('импорт имеет версию и не принимает дубликаты или сломанный batch', () => {
    const e = example(1);
    const backup = { format: 'trust-planner-learning', version: 1, plans: [e] };
    expect(parseLearning(JSON.stringify(backup))).toEqual([e]);
    expect(() => parseLearning(JSON.stringify({ ...backup, version: 2 }))).toThrow();
    expect(() => parseLearning(JSON.stringify({ ...backup, plans: [e, e] }))).toThrow();
    expect(() => checkedPlan(e.key.replace(':1', ':2'), e.geometry)).toThrow(/Страница/);
  });
});
