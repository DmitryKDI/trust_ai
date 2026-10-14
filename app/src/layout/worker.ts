// Сборка вариантов в фоновом потоке, чтобы интерфейс не замирал на время перебора.
import type { Brief, PlanGeometry, ScenarioKey } from '../model/types';
import { resolveRules } from '../rules/rules';
import { buildVariants, type BuildOptions } from './variants';

export interface WorkerRequest { g: PlanGeometry; brief: Brief; overrides: Record<string, number>; scenarios?: ScenarioKey[]; options?: BuildOptions }

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { g, brief, overrides, scenarios, options } = e.data;
    postMessage({ ok: true, result: buildVariants(g, brief, resolveRules(overrides), scenarios, options) });
  } catch (err) {
    postMessage({ ok: false, error: String(err) });
  }
};
