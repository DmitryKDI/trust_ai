// Переносимость шаблонов: те же правила на других квартирах (разметка клиентов не коммитится —
// при отсутствии файлов тест пропускается).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanGeometry } from '../src/model/types';
import { detectRoomPolygon } from '../src/geometry/plan';
import { labelPoint, polyArea } from '../src/geometry/poly';
import { buildVariants } from '../src/layout/variants';
import { resolveRules } from '../src/rules/rules';
import { validate } from '../src/validate/validator';
import { brief } from './fixtures/synthetic';

const rules = resolveRules();
for (const id of ['ever', 'republic']) {
  const file = path.resolve(__dirname, `../../data/cases/${id}/geometry.json`);
  const has = fs.existsSync(file);
  const load = (): PlanGeometry => ({ ...JSON.parse(fs.readFileSync(file, 'utf8')), approved: true });

  describe.skipIf(!has)(`переносимость: ${id}`, () => {
    it('разметка замкнута: автоконтур совпадает с помещениями, все достижимы', () => {
      const g = load();
      // Открытые зоны (прихожая без стены к гостиной) контуром по клику не находятся — их обводят вручную.
      for (const r of g.rooms.filter((x) => !['hall', 'kitchen-living'].includes(x.type))) {
        const det = detectRoomPolygon(g, labelPoint(r.polygon));
        if (det) expect(Math.abs(polyArea(det) - polyArea(r.polygon)) / polyArea(r.polygon), r.name).toBeLessThan(0.08);
      }
      const v = validate(g, [], rules, brief);
      expect(v.unreachableRooms.map((x) => g.rooms.find((r) => r.id === x)?.name)).toEqual([]);
    });

    it('варианты строятся; готовые — без ошибок проверок', { timeout: 120_000 }, () => {
      const g = load();
      const t = Date.now();
      const res = buildVariants(g, { ...brief, children: 1, workFromHome: true }, rules);
      const report = {
        case: id, ms: Date.now() - t,
        rooms: g.rooms.map((r) => `${r.name} ${(polyArea(r.polygon) / 1e6).toFixed(2)}`),
        variants: res.variants.map((v) => ({ title: v.title, errors: v.issues.filter((i) => i.severity === 'error').map((i) => i.message), compromises: v.compromises, metrics: v.metrics })),
        rejected: res.rejected,
      };
      fs.mkdirSync(path.resolve(__dirname, '../../data/reports'), { recursive: true });
      fs.writeFileSync(path.resolve(__dirname, `../../data/reports/portability-${id}.json`), JSON.stringify(report, null, 1));
      expect(res.variants.length).toBeGreaterThan(0);
      expect(res.variants.filter((v) => !v.issues.some((i) => i.severity === 'error')).length).toBeGreaterThanOrEqual(2);
    });
  });
}
