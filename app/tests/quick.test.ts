// Быстрый режим на реальных картинках планов (локальные данные; без них тест пропускается).
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { quickPlan } from '../src/quick';
import { buildVariants } from '../src/layout/variants';
import { resolveRules } from '../src/rules/rules';
import { brief } from './fixtures/synthetic';

const root = path.resolve(__dirname, '../../data/cases');
const CASES = [
  { id: 'user-bti', file: 'bti.jpg', area: 82 },
  { id: 'republic', file: 'репаблик-p3.png', area: 48.4 },
  { id: 'pilot-r', file: 'полуальбом-p1.png', area: 75.2 },
  { id: 'ever', file: 'жк-p3.png', area: 88.7 },
];

function load(file: string) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.jpg')) { const j = jpeg.decode(buf, { useTArray: true }); return { data: j.data, width: j.width, height: j.height }; }
  const p = PNG.sync.read(buf);
  return { data: p.data, width: p.width, height: p.height };
}

for (const c of CASES) {
  const file = path.join(root, c.id, 'pages', c.file);
  describe.skipIf(!fs.existsSync(file))(`быстрый режим: ${c.id}`, () => {
    it('комнаты, двери и варианты', { timeout: 180_000 }, () => {
      const img = load(file);
      const r = quickPlan({ rgba: img.data, w: img.width, h: img.height, pxPerUnit: 1, areaM2: c.area, children: 1, page: 1 });
      const t = Date.now();
      const v = buildVariants({ ...r.geometry, approved: true }, { ...brief, children: 1 }, resolveRules());
      const out = { report: r.report, variants: v.variants.map((x) => ({ title: x.title, items: x.items.length, errors: x.issues.filter((i) => i.severity === 'error').map((i) => i.message) })), rejected: v.rejected, engineMs: Date.now() - t };
      fs.mkdirSync(path.resolve(root, '../reports'), { recursive: true });
      fs.writeFileSync(path.resolve(root, `../reports/quick-${c.id}.json`), JSON.stringify(out, null, 1));
      fs.writeFileSync(path.resolve(root, `${c.id}/quick.json`), JSON.stringify(r.geometry, null, 1));
      const png = new PNG({ width: img.width, height: img.height });
      png.data = Buffer.from(r.wallsMask.rgba);
      fs.writeFileSync(path.resolve(root, `${c.id}/quick-walls.png`), PNG.sync.write(png));
      expect(r.geometry.rooms.length).toBeGreaterThan(1);
    });
  });
}
