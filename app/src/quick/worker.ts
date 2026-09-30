// Быстрый режим (сканы, фото, скриншоты) в фоновом потоке.
import { quickPlan, type QuickInput } from './index';

self.onmessage = (e: MessageEvent<QuickInput>) => {
  try {
    const r = quickPlan(e.data);
    postMessage({ ok: true, ...r }, { transfer: [r.wallsMask.rgba.buffer] });
  } catch (err) {
    postMessage({ ok: false, error: String((err as Error).stack ?? err) });
  }
};
