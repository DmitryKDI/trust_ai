import type { PlanGeometry, SourceDocument } from '../model/types';
import { getFile, listLearnedPlans, planKey } from '../storage/db';
import { learnedTypes, type LearnedPlan } from '../learning/model';
import { polyArea } from '../geometry/poly';
import { renderForRecognition } from '../pdf/load';
import type { RecognizeInput, RecognizeReport } from './index';
import type { QuickInput, QuickResult } from '../quick';

export interface PlanImage { url: string; widthMm: number; heightMm: number }

export interface ReadResult {
  geometry: PlanGeometry;
  report: RecognizeReport;
  /** Исходная картинка плана (сканы, фото) — мебель рисуется поверх неё.*/
  planImage: PlanImage | null;
}

function runWorker<T>(w: Worker, msg: unknown, transfer: Transferable[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { w.terminate(); reject(new Error('Распознавание заняло больше двух минут. Уменьшите разрешение плана.')); }, 120000);
    const stop = () => { clearTimeout(timer); w.terminate(); };
    w.onmessage = (e) => { stop(); if (e.data.ok) resolve(e.data as T); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { stop(); reject(new Error(e.message)); };
    w.onmessageerror = () => { stop(); reject(new Error('Не удалось прочитать результат распознавания.')); };
    try { w.postMessage(msg, transfer); } catch (e) { stop(); reject(e); }
  });
}

function imageUrl(rgba: Uint8ClampedArray, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

/**
 * Прочитать план. Векторный PDF (чертёж) — по стенам и размерам; скан, фото, скриншот —
 * по светлым комнатам («заливка»). В обоих случаях под мебелью показывается исходный план как есть.
 */
export async function recognizeDocument(doc: SourceDocument, page: number, opts: { briefAreaM2: number | null; children: number; fallbackK: number; useLearning?: boolean }): Promise<ReadResult> {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('Файл плана не найден в хранилище — загрузите его заново');
  const src = await renderForRecognition(blob, doc.mime, page);
  const vectorDrawing = !!src.vectors && src.vectors.segments.length > 200 && src.texts.length > 10;
  // Исходный план как есть — подложка для мебели (копию делаем до передачи пикселей в фоновый поток).
  const original = imageUrl(src.rgba, src.w, src.h);
  let plans: LearnedPlan[] = [];
  const learningNotes: string[] = [];
  if (opts.useLearning !== false) {
    try {
      const key = await planKey(blob, page);
      plans = await listLearnedPlans();
      const saved = plans.find(p => p.key === key);
      if (saved) {
        const geometry = { ...structuredClone(saved.geometry), sourceDocumentId: doc.id, sourcePage: page };
        const k = geometry.calibration!.mmPerUnit;
        const method = geometry.calibration!.method ?? 'assumed';
        const report: RecognizeReport = {
          scale: { k, method: method === 'manual' ? 'dimensions' : method, support: 0 },
          walls: geometry.walls.length,
          openings: { doors: geometry.openings.filter(o => o.type === 'door').length, windows: geometry.openings.filter(o => o.type === 'window').length, entrance: geometry.openings.some(o => o.isEntrance) },
          rooms: geometry.rooms.map(r => ({ name: r.name, type: r.type, areaM2: polyArea(r.polygon) / 1e6, byLabel: false })),
          notes: ['Использован проверенный вами план для этого файла и страницы. Масштаб сохранён вместе с правками; для нового распознавания отключите обучение на шаге «Загрузка».'],
          ms: 0,
        };
        return { geometry, report, planImage: { url: original, widthMm: src.w / src.pxPerUnit * k, heightMm: src.h / src.pxPerUnit * k } };
      }
    } catch {
      learningNotes.push('Локальные примеры обучения недоступны; выполнено обычное распознавание.');
    }
  }
  const applyTypes = (geometry: PlanGeometry, report: RecognizeReport) => {
    const labeled = new Set(geometry.rooms.filter((_, i) => report.rooms[i]?.byLabel).map(r => r.id));
    const withLabels = labeled.size ? { ...geometry, rooms: geometry.rooms.map(r => labeled.has(r.id) ? { ...r, typeBasis: 'Назначение по подписи на плане' } : r) } : geometry;
    const result = learnedTypes(withLabels, plans, labeled);
    if (result.count) {
      report.notes.push(`Назначения ${result.count} зон предположены по вашим подтверждённым примерам. Проверьте их.`);
      report.rooms = result.geometry.rooms.map(r => ({ name: r.name, type: r.type, areaM2: polyArea(r.polygon) / 1e6, byLabel: labeled.has(r.id) }));
    }
    report.notes.push(...learningNotes);
    return result.geometry;
  };
  if (vectorDrawing) {
    const input: RecognizeInput = { ...src, briefAreaM2: opts.briefAreaM2, children: opts.children, page, fallbackK: opts.fallbackK };
    // Keep Worker + URL together: Vite must see this expression to bundle the TS entry.
    const r = await runWorker<{ geometry: PlanGeometry; report: RecognizeReport }>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), input, [src.rgba.buffer]);
    const kv = r.geometry.calibration?.mmPerUnit ?? opts.fallbackK;
    return { geometry: applyTypes(r.geometry, r.report), report: r.report, planImage: { url: original, widthMm: (src.w / src.pxPerUnit) * kv, heightMm: (src.h / src.pxPerUnit) * kv } };
  }
  const q: QuickInput = { rgba: src.rgba, w: src.w, h: src.h, pxPerUnit: src.pxPerUnit, areaM2: opts.briefAreaM2, children: opts.children, page };
  const r = await runWorker<QuickResult>(new Worker(new URL('../quick/worker.ts', import.meta.url), { type: 'module' }), q, [src.rgba.buffer]);
  const k = r.geometry.calibration!.mmPerUnit;
  const report: RecognizeReport = {
    scale: { k, method: r.report.scaleMethod === 'doors' ? 'typical' : r.report.scaleMethod, support: 0 },
    walls: 0,
    openings: { doors: r.geometry.openings.filter((o) => o.type === 'door').length, windows: r.geometry.openings.filter((o) => o.type === 'window').length, entrance: r.report.entrance },
    rooms: r.report.rooms.map((x) => ({ ...x, type: x.type as never, byLabel: false })),
    notes: r.report.notes,
    ms: r.report.ms,
  };
  return { geometry: applyTypes(r.geometry, report), report, planImage: { url: original, widthMm: (src.w / src.pxPerUnit) * k, heightMm: (src.h / src.pxPerUnit) * k } };
}
