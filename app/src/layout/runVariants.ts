import type { Brief, PlanGeometry, ScenarioKey } from '../model/types';
import type { BuildResult } from './variants';

export function runVariantsInWorker(g: PlanGeometry, brief: Brief, overrides: Record<string, number>, scenarios?: ScenarioKey[]): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage({ g, brief, overrides, scenarios });
  });
}
