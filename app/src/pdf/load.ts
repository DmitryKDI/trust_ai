// Загрузка исходников: PDF (pdf.js) и растровые изображения. Всё локально в браузере, без сервера.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseOperatorList, type OpsCodes, type PageVectors } from './vectors';
import { textBoxes, type RawTextItem, type TextBox } from './text';
import { checkedRasterSize } from './limits';

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
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  try { return (await task.promise).numPages; } finally { await task.destroy(); }
}

async function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
}

/** Рендер страницы PDF в растр подложки + векторы для привязки. */
export async function renderPdfPage(data: ArrayBuffer, pageNo: number, pxPerUnit = 3, withVectors = true): Promise<RenderedPage> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNo);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: pxPerUnit });
    checkedRasterSize(vp.width, vp.height);
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
    await task.destroy();
  }
}

/** Миниатюры страниц для выбора листа с планом. */
export async function pdfThumbnails(data: ArrayBuffer, max = 60, width = 220): Promise<string[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const out: string[] = [];
  try {
    const doc = await task.promise;
    for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / vp1.width });
      checkedRasterSize(vp.width, vp.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      out.push(canvas.toDataURL('image/jpeg', 0.7));
    }
  } finally {
    await task.destroy();
  }
  return out;
}

export async function renderImage(blob: Blob): Promise<RenderedPage> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    checkedRasterSize(img.naturalWidth, img.naturalHeight);
    return { width: img.naturalWidth, height: img.naturalHeight, imageUrl: url, pxPerUnit: 1, vectors: null };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

export interface RecognitionSource {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  /** Пикселей распознавания на единицу листа (подложки). */
  pxPerUnit: number;
  pxPerPaperMm: number;
  vectors: PageVectors | null;
  texts: TextBox[];
}

/** Растр страницы для распознавания: PDF — 200 dpi, плюс векторы и текст; картинка — как скан. */
export async function renderForRecognition(blob: Blob, mime: string, pageNo: number): Promise<RecognitionSource> {
  if (mime === 'application/pdf') {
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(pageNo);
      const ppu = 200 / 72;
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: ppu });
      checkedRasterSize(vp.width, vp.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const ol = await page.getOperatorList();
      const vectors = parseOperatorList(ol.fnArray, ol.argsArray as unknown[][], OPS, vp1.transform as never, vp1.width, vp1.height);
      const tc = await page.getTextContent();
      const texts = textBoxes(tc.items as RawTextItem[], vp1.transform);
      return { rgba: img.data, w: img.width, h: img.height, pxPerUnit: ppu, pxPerPaperMm: 200 / 25.4, vectors, texts };
    } finally {
      await task.destroy();
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    checkedRasterSize(im.naturalWidth, im.naturalHeight);
    // Не больше 4000 px по длинной стороне; единица листа — пиксель исходной картинки.
    const s = Math.min(1, 4000 / Math.max(im.naturalWidth, im.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(im.naturalWidth * s);
    canvas.height = Math.round(im.naturalHeight * s);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Разрешение скана неизвестно: считаем, что длинная сторона — лист А4 (297 мм).
    return { rgba: img.data, w: img.width, h: img.height, pxPerUnit: s, pxPerPaperMm: Math.max(canvas.width, canvas.height) / 297, vectors: null, texts: [] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
