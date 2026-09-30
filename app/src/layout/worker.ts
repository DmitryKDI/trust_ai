// Сборка вариантов в фоновом потоке, чтобы интерфейс не замирал на время перебора.
import type { Brief, PlanGeometry, ScenarioKey } from '../model/types';
import { resolveRules } from '../rules/rules';
import { buildVariants } from './variants';

export interface WorkerRequest { g: PlanGeometry; brief: Brief; overrides: Record<string, number>; scenarios?: ScenarioKey[] }

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { g, brief, overrides, scenarios } = e.data;
    postMessage({ ok: true, result: buildVariants(g, brief, resolveRules(overrides), scenarios) });
  } catch (err) {
    postMessage({ ok: false, error: String(err) });
  }
};
