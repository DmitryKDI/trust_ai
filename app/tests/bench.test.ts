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

// Строгая проверка (ТЗ 7.1 п. 2): фиксированный набор bench/manifest.json, без молчаливых пропусков,
// балл не ниже baseline без допуска. Планы вне набора оцениваются отдельно и порог не меняют.
const manifestPath = path.join(root, 'manifest.json');
const basePath = path.join(root, 'baseline.json');

interface PlanResult { id: string; score: number; ready: number; complete: number; variants: number; items: number; row: string }

function evaluate(id: string): PlanResult {
  const dir = path.join(plansDir, id);
  if (!fs.existsSync(dir)) throw new Error(`план ${id} из bench/manifest.json отсутствует`);
  const img = fs.readdirSync(dir).find((f) => /^plan\.(png|jpe?g)$/i.test(f));
  if (!img) throw new Error(`план ${id}: нет картинки plan.png/plan.jpg`);
  if (!fs.existsSync(path.join(dir, 'truth.json'))) throw new Error(`план ${id}: нет truth.json`);
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
  if (!parts.length) throw new Error(`план ${id}: в truth.json нет ни одного проверяемого поля`);
  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  // Расстановка мебели прямо по распознанному плану, без правок менеджера.
  const lay = buildVariants({ ...r.geometry, approved: true }, { ...brief, children: 1 }, resolveRules());
  const ready = lay.variants.filter(isReady).length;
  // Полный вариант: готов и не попал в «отклонённые» (там же — варианты с неразмещёнными
  // обязательными предметами). Метрика к LAY-05: «готовых» без полноты — завышенная оценка.
  const rejected = new Set(lay.rejected.map((x) => x.scenario));
  const complete = lay.variants.filter((v) => isReady(v) && !rejected.has(v.scenario)).length;
  const items = Math.max(0, ...lay.variants.map((v) => v.items.length));
  const roomsCell = truth.rooms.length ? `${m.hit}/${truth.rooms.length}${truth.roomsComplete ? '' : '+'} (лишних ${m.extra})` : `всего ${found.length}/${truth.roomCount}`;
  const row = `| ${id} | ${(score * 100).toFixed(0)} | ${roomsCell} | ${doors}${truth.doors != null ? '/' + truth.doors : ''} | ${windows}${truth.windows != null ? '/' + truth.windows : ''} | ${r.report.entrance ? 'да' : 'нет'}${truth.entrance != null ? (r.report.entrance === truth.entrance ? ' ✓' : ' ✗') : ''} | ${r.report.pxPerM.toFixed(0)} | ${ready}/${lay.variants.length} | ${complete}/${lay.variants.length} | ${items} |`;
  return { id, score, ready, complete, variants: lay.variants.length, items, row };
}

const HEAD = '| План | Балл | было | Помещения | Двери | Окна | Вход | px/м | Готовых вариантов | Полных вариантов | Мебели |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|---|';

it('стенд: распознавание планов', { timeout: 900_000 }, () => {
  expect(fs.existsSync(plansDir), 'нет папки bench/plans').toBe(true);
  expect(fs.existsSync(manifestPath), 'нет bench/manifest.json').toBe(true);
  const core: string[] = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).core;
  expect(core.length, 'пустой основной набор').toBeGreaterThan(0);
  const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : null;
  const before: Record<string, number> = base?.perPlan ?? {};
  const withBefore = (p: PlanResult) => p.row.replace(/^\| ([^|]+) \| ([^|]+) \|/, (_s, id, sc) => `| ${id} | ${sc} | ${before[id] != null ? (before[id] * 100).toFixed(0) : '—'} |`);

  const res = core.map(evaluate);
  const extraIds = fs.readdirSync(plansDir).filter((id) => !core.includes(id) && fs.statSync(path.join(plansDir, id)).isDirectory()).sort();
  const extra = extraIds.map(evaluate);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const total = avg(res.map((p) => p.score));
  const report = [
    '# Стенд распознавания планов',
    '',
    `Общий балл: **${(total * 100).toFixed(1)}** из 100 (основной набор: ${res.length} планов, bench/manifest.json; порог — ${base ? (base.total * 100).toFixed(2) : 'не задан'}).`,
    `Расстановка без правок: готовых вариантов в среднем **${avg(res.map((p) => p.ready)).toFixed(2)}** из 3, полных (все обязательные предметы на месте) — **${avg(res.map((p) => p.complete)).toFixed(2)}**, мебели в лучшем варианте — ${avg(res.map((p) => p.items)).toFixed(1)} предм.`,
    '',
    'Помещения: совпало по площади (±25 %)/в эталоне («+» — эталон неполный) или «всего найдено/должно быть». Двери и окна: найдено/в эталоне. «было» — балл плана в baseline.',
    '',
    HEAD,
    SEP,
    ...res.map(withBefore),
    '',
    ...(extra.length
      ? ['## Дополнительные планы (вне основного набора, порог не влияет)', '', `Средний балл: ${(avg(extra.map((p) => p.score)) * 100).toFixed(1)} (планов: ${extra.length}).`, '', HEAD, SEP, ...extra.map(withBefore), '']
      : []),
  ].join('\n');
  fs.writeFileSync(path.join(root, 'report.md'), report);
  console.log(report);

  const perPlan = Object.fromEntries(res.map((p) => [p.id, Math.round(p.score * 1e6) / 1e6]));
  if (process.env.BENCH_UPDATE || !base) {
    // Понижать baseline нельзя (ТЗ 7.1 п. 2): только осознанно, с согласия заказчика.
    if (base && total < base.total && !process.env.BENCH_ALLOW_LOWER) throw new Error(`новый балл ${total} ниже baseline ${base.total}: понижение baseline запрещено (BENCH_ALLOW_LOWER=1 — только по согласованию)`);
    fs.writeFileSync(basePath, JSON.stringify({ total, plans: res.length, perPlan }, null, 1) + '\n');
    return;
  }
  expect(base.plans, 'размер основного набора не совпадает с baseline').toBe(res.length);
  expect(total, 'общий балл ниже baseline').toBeGreaterThanOrEqual(base.total);
});
