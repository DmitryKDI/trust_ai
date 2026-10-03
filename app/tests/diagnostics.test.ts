// Opt-in audit export. The existing area benchmark is deliberately kept independent.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { it, expect } from 'vitest';
import { quickPlan } from '../src/quick';
import { polyArea, overlapArea, labelPoint } from '../src/geometry/poly';

it.skipIf(!process.env.PLAN_DIAGNOSTICS)('экспорт исходной геометрии контрольного набора', { timeout: 600_000 }, () => {
  const input = path.resolve(__dirname, '../../bench/plans');
  const out = path.resolve(process.env.PLAN_DIAGNOSTICS!);
  fs.mkdirSync(out, { recursive: true });
  const summaries: unknown[] = [];
  for (const id of fs.readdirSync(input).sort()) {
    const dir = path.join(input, id);
    const img = fs.readdirSync(dir).find(f => /^plan\.(png|jpe?g)$/i.test(f));
    expect(img, `missing image: ${id}`).toBeTruthy();
    const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
    const bytes = fs.readFileSync(path.join(dir, img!));
    const im = /\.jpe?g$/i.test(img!) ? jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024 }) : PNG.sync.read(bytes);
    const result = quickPlan({ rgba: im.data, w: im.width, h: im.height, pxPerUnit: 1, areaM2: truth.inputAreaM2, children: 1, page: 1 });
    const g = result.geometry;
    // IDs include time/randomness; use local audit numbering, preserving opening references if added later.
    const rooms = g.rooms.map((r, i) => ({ ...r, id: `${id}-zone-${i + 1}`, labelPoint: labelPoint(r.polygon) }));
    const overlaps: { a: number; b: number; areaM2: number }[] = [];
    for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) {
      const area = overlapArea(rooms[a].polygon, rooms[b].polygon) / 1e6;
      if (area > 0.0001) overlaps.push({ a: a + 1, b: b + 1, areaM2: area });
    }
    const record = {
      id, img: `${id}-${img}`, w: im.width, h: im.height, k: g.calibration!.mmPerUnit,
      sourceCommit: process.env.PLAN_SOURCE_SHA ?? 'unrecorded', imageSha256: createHash('sha256').update(bytes).digest('hex'),
      recognitionVersion: process.env.PLAN_RECOGNITION_VERSION ?? process.env.PLAN_SOURCE_SHA ?? 'unrecorded',
      calibration: g.calibration, rooms, openings: g.openings, walls: g.walls, report: result.report, truth,
      checks: { overlaps, invalidAreas: rooms.flatMap((r, i) => polyArea(r.polygon) > 0 && r.polygon.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) ? [] : [i + 1]) },
      limitations: ['No approved contour ground truth: IoU and type accuracy are not measured', 'Areas use the recognizer scale, not independent measurements'],
    };
    fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(record, null, 2));
    fs.copyFileSync(path.join(dir, img!), path.join(out, record.img));
    summaries.push({ id, zones: rooms.length, doors: g.openings.filter(o => o.type === 'door').length, windows: g.openings.filter(o => o.type === 'window').length, ms: result.report.ms, ...record.checks });
  }
  expect(summaries).toHaveLength(33);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summaries, null, 2));
});
