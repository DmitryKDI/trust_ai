// Автораспознавание на реальных листах (данные клиентов локально; без них тест пропускается).
// Сравнение с ручной разметкой: для каждого помещения — IoU с лучшим распознанным.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { PlanGeometry } from '../src/model/types';
import { recognize } from '../src/recognize';
import { parseOperatorList, type OpsCodes } from '../src/pdf/vectors';
import { textBoxes, type RawTextItem } from '../src/pdf/text';
import { geomArea, intersection, polyArea, toGeom } from '../src/geometry/poly';

const root = path.resolve(__dirname, '../../data/cases');
const CASES = [
  { id: 'pilot-r', page: 'полуальбом-p1' },
  { id: 'ever', page: 'жк-p3' },
  { id: 'republic', page: 'репаблик-p3' },
  { id: 'deferred-d', page: 'декабристов-p23' },
  { id: 'deferred-m', page: 'максимов-p16' },
];

async function loadPdf(file: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const vectors = parseOperatorList(ol.fnArray, ol.argsArray as unknown[][], pdfjs.OPS as unknown as OpsCodes, vp.transform as never, vp.width, vp.height);
  const tc = await page.getTextContent();
  const texts = textBoxes(tc.items as RawTextItem[], vp.transform);
  await doc.destroy();
  return { vectors, texts };
}

function iouReport(manual: PlanGeometry, auto: PlanGeometry) {
  return manual.rooms.map((m) => {
    let best = 0, name = '—';
    for (const a of auto.rooms) {
      const inter = geomArea(intersection(toGeom(m.polygon), toGeom(a.polygon)));
      const iou = inter / (polyArea(m.polygon) + polyArea(a.polygon) - inter);
      if (iou > best) { best = iou; name = `${a.name}/${a.type}`; }
    }
    return { room: `${m.name}/${m.type}`, iou: Math.round(best * 100) / 100, auto: name };
  });
}

for (const c of CASES) {
  const png = path.join(root, c.id, 'pages', `${c.page}.png`);
  const pdf = path.join(root, c.id, 'pages', `${c.page}.pdf`);
  const has = fs.existsSync(png) && fs.existsSync(pdf);
  describe.skipIf(!has)(`распознавание: ${c.id}`, () => {
    for (const mode of ['vector', 'scan'] as const)
      it(`${mode === 'vector' ? 'PDF с векторами' : 'как скан (только растр)'}`, { timeout: 180_000 }, async () => {
        const img = PNG.sync.read(fs.readFileSync(png));
        const ppu = 200 / 72;
        const { vectors, texts } = mode === 'vector' ? await loadPdf(pdf) : { vectors: null, texts: [] };
        const manualFile = path.join(root, c.id, 'geometry.json');
        const manual: PlanGeometry | null = fs.existsSync(manualFile) ? JSON.parse(fs.readFileSync(manualFile, 'utf8')) : null;
        const briefArea = manual ? manual.rooms.filter((r) => r.type !== 'balcony').reduce((s, r) => s + polyArea(r.polygon), 0) / 1e6 : null;
        const { geometry, report } = recognize({
          rgba: img.data, w: img.width, h: img.height, pxPerUnit: ppu, pxPerPaperMm: 200 / 25.4,
          texts, vectors, briefAreaM2: mode === 'scan' ? briefArea : null, children: 1, page: 1, fallbackK: (25.4 / 72) * 50,
        });
        const out = { case: c.id, mode, report, iou: manual ? iouReport(manual, geometry) : null, manualK: manual?.calibration?.mmPerUnit };
        fs.mkdirSync(path.resolve(root, '../reports'), { recursive: true });
        fs.writeFileSync(path.resolve(root, `../reports/recognize-${c.id}-${mode}.json`), JSON.stringify(out, null, 1));
        fs.writeFileSync(path.resolve(root, `${c.id}/auto-${mode}.json`), JSON.stringify(geometry, null, 1));
        expect(report.walls).toBeGreaterThan(5);
      });
  });
}
