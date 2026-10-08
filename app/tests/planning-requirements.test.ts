import { expect, it } from 'vitest';
import { brief, twoRoom } from './fixtures/synthetic';
import { resolveRules } from '../src/rules/rules';
import { runEngine } from '../src/layout/engine';
import { buildVariants } from '../src/layout/variants';
import { invalidatePlanningInputs, requirementIssues, requirementStatus, variantCurrent } from '../src/brief/requirements';
import { newProject } from '../src/model/defaults';
import { checkedProject } from '../src/storage/validate';
import { furnitureMeasurements } from '../src/editor/measurements';
import { furnitureSnapContext } from '../src/editor/furniture-interaction';
import type { Brief, FurnitureItem } from '../src/model/types';
const rules = resolveRules();
const needs = (patch: Partial<NonNullable<Brief['layoutNeeds']>> = {}): Brief => ({ ...brief, layoutNeeds: { workplaces: 0, required: [], forbidden: [], ...patch } });
const sofa = (patch: Partial<FurnitureItem> = {}): FurnitureItem => ({ id: 'fixed-sofa', type: 'sofa', x: 2000, y: 2000, w: 1000, d: 600, rot: 0, roomId: null, ruleId: null, movedByManager: true, ...patch });
it('подбор выполняет запреты и точные размеры без второй кровати', () => {
  const g = twoRoom(), b = needs({ forbidden: ['armchair', 'coffee-table'], required: [{ id: 'bed', type: 'bed-double', count: 1, roomType: 'bedroom', w: 1500, d: 2050 }] });
  const r = runEngine({ g, brief: b, rules, scenario: 'family' });
  expect(r.items.filter(i => i.type === 'bed-double')).toHaveLength(1);
  expect(r.items.find(i => i.type === 'bed-double')).toMatchObject({ w: 1500, d: 2050 });
  expect(r.items.some(i => b.layoutNeeds!.forbidden.includes(i.type))).toBe(false);
  expect(requirementIssues(g, r.items, b)).toEqual([]);
});
it('два взрослых стола обязательны, детский стол не засчитывается', () => {
  const g = twoRoom(), b = needs({ workplaces: 2 });
  const r = runEngine({ g, brief: b, rules, scenario: 'space' }); expect(requirementIssues(g, r.items, b)).toEqual([]);
  g.rooms[1].type = 'kids'; expect(requirementStatus(g, [sofa({ type: 'desk', roomId: g.rooms[1].id })], b)[0].actual).toBe(0);
});
it('невозможное требование не выдаётся за готовое', () => {
  const g = twoRoom(), b = needs({ required: [{ id: 'huge', type: 'bed-double', count: 1, roomType: 'bedroom', w: 9000, d: 9000 }] });
  expect(buildVariants(g, b, rules, ['space']).variants[0].issues.some(i => i.code === 'brief-requirement')).toBe(true);
  expect(requirementIssues(g, [], needs({ required: [{ id: 'bath', type: 'bathtub', count: 1, roomType: 'bath' }] }))).toHaveLength(1);
});
it('закреплённая мебель сохраняет все поля и не дублируется', () => {
  const g = twoRoom(), first = runEngine({ g, brief, rules, scenario: 'space' });
  const bed = { ...first.items.find(i => i.type === 'bed-double')!, locked: true }; const original = structuredClone(bed);
  const r = runEngine({ g, brief, rules, scenario: 'space', seed: 91, fixed: [bed] });
  expect(r.items.find(i => i.id === bed.id)).toEqual(original); expect(bed).toEqual(original); expect(r.items.filter(i => i.type === 'bed-double')).toHaveLength(1);
});
it('при пересборке комнаты остальная мебель точно сохранена', () => {
  const g = twoRoom(), first = runEngine({ g, brief, rules, scenario: 'space' }); const roomId = g.rooms[1].id, fixed = first.items.filter(i => i.roomId !== roomId);
  const r = runEngine({ g, brief, rules, scenario: 'space', seed: 917, roomIds: [roomId], fixed });
  expect(r.items.filter(i => i.roomId !== roomId)).toEqual(fixed); expect(r.items.find(i => i.type === 'bed-double')?.roomId).toBe(roomId);
});
it('бриф и правила снимают утверждение; смена палитры сохраняет его; старые проекты совместимы', () => {
  const p = newProject({ alias: 'Тест', city: '', manager: '', date: '' }); p.geometry = twoRoom(); p.variants = buildVariants(p.geometry, p.brief, rules, ['space']).variants;
  p.variants[0].inputsHash = undefined; p.variants[0].approved = true; p.selectedVariantId = p.variants[0].id;
  expect(variantCurrent(p.variants[0], p)).toBe(true);
  const changed = invalidatePlanningInputs(p, { ...p, brief: { ...p.brief, priorities: 'Другое' } }); expect(changed.selectedVariantId).toBeNull(); expect(changed.variants[0].approved).toBe(false); expect(variantCurrent(changed.variants[0], changed)).toBe(false);
  expect(invalidatePlanningInputs(p, { ...p, ruleOverrides: { passageMin: 1200 } }).variants[0].approved).toBe(false);
  const palette = { ...p, concept: { ...p.concept, palette: [{ name: 'Белый', hex: '#ffffff' }] } }; expect(invalidatePlanningInputs(p, palette)).toBe(palette);
  p.brief = needs(); p.variants[0].items[0].locked = true; expect(checkedProject(p)).toBe(p);
  const bad = structuredClone(p); (bad.variants[0].items[0] as any).locked = 'true'; expect(() => checkedProject(bad)).toThrow();
  expect(() => checkedProject({ ...p, brief: { ...p.brief, layoutNeeds: { ...p.brief.layoutNeeds, workplaces: 1.5 } } })).toThrow();
});
it('расстояния измеряются до граней толстых стен и соседей с учётом поворота', () => {
  const g = twoRoom(); g.openings = [];
  const m = furnitureMeasurements(sofa({ rot: 90 }), furnitureSnapContext(g, [sofa({ id: 'other', x: 4000 })]));
  expect(m.find(x => x.id === 'wall-left')?.mm).toBe(1550); expect(m.find(x => x.id === 'wall-top')?.mm).toBe(1350); expect(m.find(x => x.id === 'nearest-item')?.mm).toBe(1200);
});
it('наклонная стена, наложение и пустой план дают корректные расстояния', () => {
  expect(furnitureMeasurements(sofa(), { walls: [], edges: [{ a: { x: 500, y: 500 }, b: { x: 1500, y: 2500 } }], others: [] }).find(x => x.id === 'wall-left')?.mm).toBe(250);
  expect(furnitureMeasurements(sofa(), { walls: [], edges: [], others: [sofa({ id: 'other', x: 2200 })] })[0].mm).toBe(0);
  expect(furnitureMeasurements(sofa(), { walls: [], edges: [], others: [] })).toEqual([]);
});
