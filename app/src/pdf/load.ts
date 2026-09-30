// Загрузка исходников: PDF (pdf.js) и растровые изображения. Всё локально в браузере, без сервера.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseOperatorList, type OpsCodes, type PageVectors } from './vectors';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  /** Размер листа в единицах листа (pt для PDF, px для растра). */
  width: number;
  height: number;
  /** Растр подложки (object URL) и его масштаб: пикселей на единицу листа. */
  imageUrl: string;
  pxPerUnit: number;
  vectors: PageVectors | null;
}

const OPS = pdfjs.OPS as unknown as OpsCodes;

export async function pdfPageCount(data: ArrayBuffer): Promise<number> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

async function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
}

/** Рендер страницы PDF в растр подложки + векторы для привязки. */
export async function renderPdfPage(data: ArrayBuffer, pageNo: number, pxPerUnit = 3, withVectors = true): Promise<RenderedPage> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  try {
    const page = await doc.getPage(pageNo);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: pxPerUnit });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const imageUrl = await canvasToUrl(canvas);
    let vectors: PageVectors | null = null;
    if (withVectors) {
      const ol = await page.getOperatorList();
      vectors = parseOperatorList(ol.fnArray, ol.argsArray as unknown[][], OPS, vp1.transform as never, vp1.width, vp1.height);
    }
    return { width: vp1.width, height: vp1.height, imageUrl, pxPerUnit, vectors };
  } finally {
    await doc.destroy();
  }
}

/** Миниатюры страниц для выбора листа с планом. */
export async function pdfThumbnails(data: ArrayBuffer, max = 60, width = 220): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const out: string[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / vp1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      out.push(canvas.toDataURL('image/jpeg', 0.7));
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

export async function renderImage(blob: Blob): Promise<RenderedPage> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight, imageUrl: url, pxPerUnit: 1, vectors: null };
}
