// Стенд оценки распознавания на наборе планов bench/plans/<id>/ (картинка + truth.json).
// Считает баллы по каждому плану и общий; падает, если общий балл ниже зафиксированного
// в bench/baseline.json. Обновить базу: BENCH_UPDATE=1 npx vitest run tests/bench.test.ts
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { expect, it } from 'vitest';
import { quickPlan } from '../src/quick';
import { buildVariants, isReady } from '../src/layout/variants';
import { resolveRules } from '../src/rules/rules';
import { brief } from './fixtures/synthetic';

interface Truth {
  source: string;
  style?: string;
  inputAreaM2: number | null;
  /** Площади помещений, м² (по экспликации или подписям на плане). */
  rooms: number[];
  /** false — перечислены не все помещения: лишние найденные не штрафуются. */
  roomsComplete: boolean;
  /** Число помещений (без балконов и лоджий) — для планов без подписей площадей. */
  roomCount?: number;
  doors: number | null;
  windows: number | null;
  entrance: boolean | null;
}

const root = path.resolve(__dirname, '../../bench');
const plansDir = path.join(root, 'plans');

function load(file: string) {
  const buf = fs.readFileSync(file);
  if (/\.jpe?g$/i.test(file)) { const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 }); return { data: j.data, width: j.width, height: j.height }; }
  const p = PNG.sync.read(buf);
  return { data: p.data, width: p.width, height: p.height };
}

/** Доля эталонных помещений, для которых найдено помещение с площадью в пределах ±25 %. */
function matchRooms(truth: number[], found: number[]) {
  const free = [...found];
  let hit = 0;
  for (const t of [...truth].sort((a, b) => b - a)) {
    let best = -1, bestErr = 0.25;
    free.forEach((f, i) => { const e = Math.abs(f - t) / t; if (e <= bestErr) { best = i; bestErr = e; } });
    if (best >= 0) { hit++; free.splice(best, 1); }
  }
  return { hit, extra: free.length };
}

const countScore = (found: number, truth: number) => Math.max(0, 1 - Math.abs(found - truth) / Math.max(1, truth));

it('стенд: распознавание планов', { timeout: 600_000 }, () => {
  if (!fs.existsSync(plansDir)) return;
  const rows: string[] = [];
  const scores: number[] = [];
  let readySum = 0, itemsSum = 0;
  for (const id of fs.readdirSync(plansDir).sort()) {
    const dir = path.join(plansDir, id);
    const img = fs.readdirSync(dir).find((f) => /^plan\.(png|jpe?g)$/i.test(f));
    if (!img || !fs.existsSync(path.join(dir, 'truth.json'))) continue;
    const truth: Truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
    const im = load(path.join(dir, img));
    const r = quickPlan({ rgba: im.data, w: im.width, h: im.height, pxPerUnit: 1, areaM2: truth.inputAreaM2, children: 1, page: 1 });
    const found = r.report.rooms.map((x) => x.areaM2);
    const doors = r.geometry.openings.filter((o) => o.type === 'door').length;
    const windows = r.geometry.openings.filter((o) => o.type === 'window').length;
    const m = matchRooms(truth.rooms, found);
    const parts: number[] = [];
    if (truth.rooms.length) {
      // Помещения: полнота; при полном перечне — ещё и точность (лишние помещения).
      const recall = m.hit / truth.rooms.length;
      const precision = truth.roomsComplete ? m.hit / Math.max(1, found.length) : 1;
      parts.push(precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0);
    }
    if (truth.roomCount != null) parts.push(countScore(found.length, truth.roomCount));
    if (truth.doors != null) parts.push(countScore(doors, truth.doors));
    if (truth.windows != null) parts.push(countScore(windows, truth.windows));
    if (truth.entrance != null) parts.push(r.report.entrance === truth.entrance ? 1 : 0);
    const score = parts.reduce((a, b) => a + b, 0) / parts.length;
    // Расстановка мебели прямо по распознанному плану, без правок менеджера.
    const lay = buildVariants({ ...r.geometry, approved: true }, { ...brief, children: 1 }, resolveRules());
    const ready = lay.variants.filter(isReady).length;
    const items = Math.max(0, ...lay.variants.map((v) => v.items.length));
    readySum += ready; itemsSum += items;
    scores.push(score);
    const roomsCell = truth.rooms.length ? `${m.hit}/${truth.rooms.length}${truth.roomsComplete ? '' : '+'} (лишних ${m.extra})` : `всего ${found.length}/${truth.roomCount}`;
    rows.push(`| ${id} | ${(score * 100).toFixed(0)} | ${roomsCell} | ${doors}${truth.doors != null ? '/' + truth.doors : ''} | ${windows}${truth.windows != null ? '/' + truth.windows : ''} | ${r.report.entrance ? 'да' : 'нет'}${truth.entrance != null ? (r.report.entrance === truth.entrance ? ' ✓' : ' ✗') : ''} | ${r.report.pxPerM.toFixed(0)} | ${ready}/${lay.variants.length} | ${items} |`);
  }
  if (!scores.length) return;
  const total = scores.reduce((a, b) => a + b, 0) / scores.length;
  const report = [
    '# Стенд распознавания планов',
    '',
    `Общий балл: **${(total * 100).toFixed(1)}** из 100 (планов: ${scores.length}).`,
    `Расстановка без правок: готовых вариантов в среднем **${(readySum / scores.length).toFixed(2)}** из 3, мебели в лучшем варианте — ${(itemsSum / scores.length).toFixed(1)} предм.`,
    '',
    'Помещения: совпало по площади (±25 %)/в эталоне («+» — эталон неполный) или «всего найдено/должно быть». Двери и окна: найдено/в эталоне.',
    '',
    '| План | Балл | Помещения | Двери | Окна | Вход | px/м | Готовых вариантов | Мебели |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'report.md'), report);
  console.log(report);
  const basePath = path.join(root, 'baseline.json');
  if (process.env.BENCH_UPDATE || !fs.existsSync(basePath)) {
    fs.writeFileSync(basePath, JSON.stringify({ total: Math.round(total * 1000) / 1000, plans: scores.length }, null, 1) + '\n');
    return;
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  // Новые планы могут снизить средний балл — тогда базу обновляют осознанно (BENCH_UPDATE=1).
  if (base.plans === scores.length) expect(total).toBeGreaterThanOrEqual(base.total - 0.005);
});
