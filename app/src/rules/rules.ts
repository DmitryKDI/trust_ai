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

export function validRuleValue(key: RuleKey, value: unknown): value is number {
  const min = key === 'gridStep' ? 25 : key.startsWith('costRate') ? 0 : 1;
  const max = key === 'gridStep' ? 500 : key.startsWith('costRate') ? 10000000 : 20000;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function resolveRules(overrides: Partial<Record<string, number>> = {}): Rules {
  const out = {} as Rules;
  for (const k of Object.keys(RULE_DEFS) as RuleKey[]) {
    const o = overrides[k];
    out[k] = validRuleValue(k, o) ? o : RULE_DEFS[k].value;
  }
  return out;
}
