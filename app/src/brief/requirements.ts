import type { Brief, FurnitureItem, FurnitureRequirement, Issue, LayoutNeeds, PlanGeometry, Project, Variant } from '../model/types';
import { CATALOG } from '../furniture/catalog';
import { resolveRules, type Rules } from '../rules/rules';
import { geometryHash } from '../geometry/plan';
import { roomName } from '../learning/model';

export function layoutNeeds(brief: Pick<Brief, 'workFromHome' | 'layoutNeeds'>): LayoutNeeds {
  return brief.layoutNeeds ?? { workplaces: brief.workFromHome ? 1 : 0, required: [], forbidden: [] };
}
export function matchesRequirement(item: FurnitureItem, req: FurnitureRequirement, g: PlanGeometry): boolean {
  return item.type === req.type && (req.roomType === null || g.rooms.some(r => r.id === item.roomId && r.type === req.roomType))
    && (req.w === undefined || Math.abs(item.w - req.w) < 1) && (req.d === undefined || Math.abs(item.d - req.d) < 1);
}
export interface RequirementStatus { id: string; label: string; fulfilled: boolean; actual: number; needed: number; itemIds: string[] }
export function requirementStatus(g: PlanGeometry, items: FurnitureItem[], brief: Partial<Brief>): RequirementStatus[] {
  // Legacy projects keep their previous behavior until structured requirements are selected.
  if (!brief.layoutNeeds) return [];
  const needs = brief.layoutNeeds;
  const result: RequirementStatus[] = needs.required.map(req => {
    const matched = items.filter(i => matchesRequirement(i, req, g));
    return { id: req.id, label: `${CATALOG[req.type].name}${req.roomType ? ` · ${roomName(req.roomType)}` : ''}${req.w !== undefined && req.d !== undefined ? ` · ${req.w}×${req.d} мм` : ''}`, fulfilled: matched.length >= req.count, actual: matched.length, needed: req.count, itemIds: matched.map(i => i.id) };
  });
  if (needs.workplaces) {
    const desks = items.filter(i => i.type === 'desk' && g.rooms.some(r => r.id === i.roomId && r.type !== 'kids'));
    result.push({ id: 'adult-workplaces', label: 'Рабочие места взрослых', fulfilled: desks.length >= needs.workplaces, actual: desks.length, needed: needs.workplaces, itemIds: desks.map(i => i.id) });
  }
  for (const type of needs.forbidden) {
    const found = items.filter(i => i.type === type);
    result.push({ id: `ban-${type}`, label: `Без предмета «${CATALOG[type].name}»`, fulfilled: !found.length, actual: found.length, needed: 0, itemIds: found.map(i => i.id) });
  }
  return result;
}
export function requirementIssues(g: PlanGeometry, items: FurnitureItem[], brief: Partial<Brief>): Issue[] {
  return requirementStatus(g, items, brief).filter(s => !s.fulfilled).map(s => ({ severity: 'error', code: 'brief-requirement', message: s.needed ? `${s.label}: нужно не менее ${s.needed}, размещено ${s.actual}` : `${s.label}: запрещённых предметов ${s.actual}`, itemIds: s.itemIds }));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function planningInputsHash(brief: Brief, rules: Rules): string {
  const s = canonical([brief, rules]); let a = 2166136261, b = 5381;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ s.charCodeAt(i); }
  return `inputs-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${s.length}`;
}
export function variantCurrent(v: Variant, p: Project): boolean {
  return p.geometry.approved && v.geometryHash === geometryHash(p.geometry) && (!v.inputsHash || v.inputsHash === planningInputsHash(p.brief, resolveRules(p.ruleOverrides)));
}
export function invalidatePlanningInputs(before: Project, next: Project): Project {
  const oldHash = planningInputsHash(before.brief, resolveRules(before.ruleOverrides));
  if (oldHash === planningInputsHash(next.brief, resolveRules(next.ruleOverrides))) return next;
  return { ...next, variants: next.variants.map(v => ({ ...v, inputsHash: v.inputsHash ?? oldHash, approved: false })), selectedVariantId: null, review: null };
}
