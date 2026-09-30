// Распознавание плана в фоновом потоке.
import { recognize, type RecognizeInput } from './index';

self.onmessage = (e: MessageEvent<RecognizeInput>) => {
  try {
    postMessage({ ok: true, ...recognize(e.data) });
  } catch (err) {
    postMessage({ ok: false, error: String((err as Error).stack ?? err) });
  }
};
