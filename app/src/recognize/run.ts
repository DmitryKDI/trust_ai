import type { PlanGeometry, SourceDocument } from '../model/types';
import { getFile } from '../storage/db';
import { renderForRecognition } from '../pdf/load';
import type { RecognizeInput, RecognizeReport } from './index';
import type { QuickInput, QuickResult } from '../quick';

export interface PlanImage { url: string; widthMm: number; heightMm: number }

export interface ReadResult {
  geometry: PlanGeometry;
  report: RecognizeReport;
  /** Стилизованные стены (для сканов и картинок, где стены не векторные). */
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

function maskToUrl(m: QuickResult['wallsMask']): string {
  const c = document.createElement('canvas');
  c.width = m.w;
  c.height = m.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(m.rgba), m.w, m.h), 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Прочитать план. Векторный PDF (чертёж) — по стенам и размерам; скан, фото, скриншот —
 * по светлым комнатам («заливка»), с чистой стилизованной подложкой стен.
 */
export async function recognizeDocument(doc: SourceDocument, page: number, opts: { briefAreaM2: number | null; children: number; fallbackK: number }): Promise<ReadResult> {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('Файл плана не найден в браузере — загрузите его заново');
  const src = await renderForRecognition(blob, doc.mime, page);
  const vectorDrawing = !!src.vectors && src.vectors.segments.length > 200 && src.texts.length > 10;
  if (vectorDrawing) {
    const input: RecognizeInput = { ...src, briefAreaM2: opts.briefAreaM2, children: opts.children, page, fallbackK: opts.fallbackK };
    const r = await runWorker<{ geometry: PlanGeometry; report: RecognizeReport }>(new URL('./worker.ts', import.meta.url), input, [src.rgba.buffer]);
    return { geometry: r.geometry, report: r.report, planImage: null };
  }
  const q: QuickInput = { rgba: src.rgba, w: src.w, h: src.h, pxPerUnit: src.pxPerUnit, areaM2: opts.briefAreaM2, children: opts.children, page };
  const r = await runWorker<QuickResult>(new URL('../quick/worker.ts', import.meta.url), q, [src.rgba.buffer]);
  const k = r.geometry.calibration!.mmPerUnit;
  const report: RecognizeReport = {
    scale: { k, method: r.report.areaAssumed ? 'assumed' : 'area', support: 0 },
    walls: 0,
    openings: { doors: r.report.doors, windows: 0, entrance: r.report.entrance },
    rooms: r.report.rooms.map((x) => ({ ...x, type: x.type as never, byLabel: false })),
    notes: r.report.notes,
    ms: r.report.ms,
  };
  return { geometry: r.geometry, report, planImage: { url: maskToUrl(r.wallsMask), widthMm: (src.w / src.pxPerUnit) * k, heightMm: (src.h / src.pxPerUnit) * k } };
}
