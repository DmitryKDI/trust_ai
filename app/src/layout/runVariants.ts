import type { Brief, PlanGeometry, ScenarioKey } from '../model/types';
import type { BuildResult, BuildOptions } from './variants';

export function runVariantsInWorker(g: PlanGeometry, brief: Brief, overrides: Record<string, number>, scenarios?: ScenarioKey[], options?: BuildOptions): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('Сборка заняла больше двух минут. Проверьте масштаб и сложность плана.')); }, 120000);
    const stop = () => { clearTimeout(timer); w.terminate(); };
    w.onmessage = (e) => {
      stop();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => { stop(); reject(new Error(e.message)); };
    w.onmessageerror = () => { stop(); reject(new Error('Не удалось прочитать результат сборки.')); };
    try { w.postMessage({ g, brief, overrides, scenarios, options }); } catch (e) { stop(); reject(e); }
  });
}
