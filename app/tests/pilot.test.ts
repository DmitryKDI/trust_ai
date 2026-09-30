// Проверка на реальной разметке пилотного кейса. Данные клиента не коммитятся:
// при отсутствии data/cases/pilot-r/geometry.json тест пропускается.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanGeometry } from '../src/model/types';
import { detectRoomPolygon } from '../src/geometry/plan';
import { labelPoint, polyArea } from '../src/geometry/poly';
import { runEngine } from '../src/layout/engine';
import { resolveRules } from '../src/rules/rules';
import { validate } from '../src/validate/validator';
import { brief } from './fixtures/synthetic';

const file = path.resolve(__dirname, '../../data/cases/pilot-r/geometry.json');
const has = fs.existsSync(file);
const load = (): PlanGeometry => ({ ...JSON.parse(fs.readFileSync(file, 'utf8')), approved: true });
const rules = resolveRules();
const pilotBrief = { ...brief, children: 1, workFromHome: true };

describe.skipIf(!has)('пилотный кейс (реальная разметка)', () => {
  it('площади помещений совпадают с экспликацией обмера (±0,05 м²)', () => {
    const g = load();
    const expl: Record<string, number> = { 'Детская': 17.54, 'Ванная': 3.76, 'С/у': 1.72, 'Кухня': 13.01, 'Гостиная': 11.97, 'Спальня': 16.16, 'Прихожая / коридор': 11.05 };
    for (const r of g.rooms) if (expl[r.name]) expect(Math.abs(polyArea(r.polygon) / 1e6 - expl[r.name]), r.name).toBeLessThan(0.05);
  });

  it('автоконтур по клику совпадает с контурами помещений', () => {
    const g = load();
    for (const r of g.rooms) {
      const det = detectRoomPolygon(g, labelPoint(r.polygon));
      expect(det, r.name).not.toBeNull();
      expect(Math.abs(polyArea(det!) - polyArea(r.polygon)), r.name).toBeLessThan(20_000);
    }
  });

  it('пустой план: все помещения достижимы от входа', () => {
    const v = validate(load(), [], rules, pilotBrief);
    expect(v.unreachableRooms).toEqual([]);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  for (const scenario of ['space', 'storage', 'family'] as const)
    it(`вариант «${scenario}» строится и проходит проверки`, { timeout: 60_000 }, () => {
      const g = load();
      const r = runEngine({ g, brief: pilotBrief, rules, scenario });
      const errors = validate(g, r.items, rules, pilotBrief).issues.filter((i) => i.severity === 'error');
      expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);
      expect(r.skipped.filter((s) => s.mandatory), JSON.stringify(r.skipped)).toEqual([]);
    });
});
