import type { PlanGeometry, SourceDocument } from '../model/types';
import { getFile } from '../storage/db';
import { renderForRecognition } from '../pdf/load';
import type { RecognizeInput, RecognizeReport } from './index';

/** Распознать выбранную страницу исходника (в фоновом потоке). */
export async function recognizeDocument(doc: SourceDocument, page: number, opts: { briefAreaM2: number | null; children: number; fallbackK: number }): Promise<{ geometry: PlanGeometry; report: RecognizeReport }> {
  const blob = await getFile(doc.id);
  if (!blob) throw new Error('Файл исходника не найден в браузере — загрузите его заново');
  const src = await renderForRecognition(blob, doc.mime, page);
  const input: RecognizeInput = { ...src, briefAreaM2: opts.briefAreaM2, children: opts.children, page, fallbackK: opts.fallbackK };
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); if (e.data.ok) resolve({ geometry: e.data.geometry, report: e.data.report }); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage(input, [src.rgba.buffer]);
  });
}
