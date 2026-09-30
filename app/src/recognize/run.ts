import type { PlanGeometry, SourceDocument } from '../model/types';
import { getFile } from '../storage/db';
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

function runWorker<T>(url: URL, msg: unknown, transfer: Transferable[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(url, { type: 'module' });
    w.onmessage = (e) => { w.terminate(); if (e.data.ok) resolve(e.data as T); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage(msg, transfer);
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
export async function recognizeDocument(doc: SourceDocument, page: number, opts: { briefAreaM2: number | null; children: number; fallbackK: number }): Promise<ReadResult> {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('Файл плана не найден в браузере — загрузите его заново');
  const src = await renderForRecognition(blob, doc.mime, page);
  const vectorDrawing = !!src.vectors && src.vectors.segments.length > 200 && src.texts.length > 10;
  // Исходный план как есть — подложка для мебели (копию делаем до передачи пикселей в фоновый поток).
  const original = imageUrl(src.rgba, src.w, src.h);
  if (vectorDrawing) {
    const input: RecognizeInput = { ...src, briefAreaM2: opts.briefAreaM2, children: opts.children, page, fallbackK: opts.fallbackK };
    const r = await runWorker<{ geometry: PlanGeometry; report: RecognizeReport }>(new URL('./worker.ts', import.meta.url), input, [src.rgba.buffer]);
    const kv = r.geometry.calibration?.mmPerUnit ?? opts.fallbackK;
    return { geometry: r.geometry, report: r.report, planImage: { url: original, widthMm: (src.w / src.pxPerUnit) * kv, heightMm: (src.h / src.pxPerUnit) * kv } };
  }
  const q: QuickInput = { rgba: src.rgba, w: src.w, h: src.h, pxPerUnit: src.pxPerUnit, areaM2: opts.briefAreaM2, children: opts.children, page };
  const r = await runWorker<QuickResult>(new URL('../quick/worker.ts', import.meta.url), q, [src.rgba.buffer]);
  const k = r.geometry.calibration!.mmPerUnit;
  const report: RecognizeReport = {
    scale: { k, method: r.report.scaleMethod === 'doors' ? 'typical' : r.report.scaleMethod, support: 0 },
    walls: 0,
    openings: { doors: r.report.doors, windows: 0, entrance: r.report.entrance },
    rooms: r.report.rooms.map((x) => ({ ...x, type: x.type as never, byLabel: false })),
    notes: r.report.notes,
    ms: r.report.ms,
  };
  return { geometry: r.geometry, report, planImage: { url: original, widthMm: (src.w / src.pxPerUnit) * k, heightMm: (src.h / src.pxPerUnit) * k } };
}
