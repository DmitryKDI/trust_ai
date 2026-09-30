// Пороги берутся только отсюда: config/rules.default.json + правки владельца в проекте.
import defaults from '@config/rules.default.json';

export type RuleKey = keyof typeof defaults.values;

export interface RuleDef {
  value: number;
  unit: string;
  status: string;
  note: string;
}

export const RULE_DEFS = defaults.values as Record<RuleKey, RuleDef>;
export const COST_INFO = defaults.cost;

export type Rules = Record<RuleKey, number>;

export function resolveRules(overrides: Partial<Record<string, number>> = {}): Rules {
  const out = {} as Rules;
  for (const k of Object.keys(RULE_DEFS) as RuleKey[]) {
    const o = overrides[k];
    out[k] = typeof o === 'number' && Number.isFinite(o) ? o : RULE_DEFS[k].value;
  }
  return out;
}
