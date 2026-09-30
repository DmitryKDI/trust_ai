// Состояние открытого проекта: автосохранение в IndexedDB и история правок геометрии (отмена/повтор).
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { PlanGeometry, Project } from '../model/types';
import { saveProject } from '../storage/db';
import { resolveRules, type Rules } from '../rules/rules';

interface Store {
  project: Project;
  rules: Rules;
  update: (fn: (p: Project) => Project) => void;
  /** Правка геометрии с записью в историю. Любая правка снимает утверждение. */
  editGeometry: (fn: (g: PlanGeometry) => PlanGeometry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
}

interface S { project: Project; past: PlanGeometry[]; future: PlanGeometry[] }
type A =
  | { t: 'update'; fn: (p: Project) => Project }
  | { t: 'geom'; fn: (g: PlanGeometry) => PlanGeometry }
  | { t: 'undo' }
  | { t: 'redo' };

function reducer(s: S, a: A): S {
  switch (a.t) {
    case 'update': return { ...s, project: a.fn(s.project) };
    case 'geom': {
      const g = s.project.geometry;
      const next = a.fn(g);
      if (next === g) return s;
      const geometry: PlanGeometry = { ...next, approved: false, approvedAt: null, approvedHash: null, version: g.version + (g.approved ? 1 : 0) };
      return { project: { ...s.project, geometry }, past: [...s.past.slice(-99), g], future: [] };
    }
    case 'undo': {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { project: { ...s.project, geometry: prev }, past: s.past.slice(0, -1), future: [s.project.geometry, ...s.future] };
    }
    case 'redo': {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return { project: { ...s.project, geometry: next }, past: [...s.past, s.project.geometry], future: rest };
    }
  }
}

const Ctx = createContext<Store | null>(null);

export function ProjectProvider({ initial, children }: { initial: Project; children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, { project: initial, past: [], future: [] });
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | null>(null);
  const { project } = s;

  useEffect(() => {
    setSaving(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      saveProject({ ...project, updatedAt: new Date().toISOString() }).finally(() => setSaving(false));
    }, 400);
  }, [project]);

  const update = useCallback((fn: (p: Project) => Project) => dispatch({ t: 'update', fn }), []);
  const editGeometry = useCallback((fn: (g: PlanGeometry) => PlanGeometry) => dispatch({ t: 'geom', fn }), []);
  const undo = useCallback(() => dispatch({ t: 'undo' }), []);
  const redo = useCallback(() => dispatch({ t: 'redo' }), []);
  const rules = useMemo(() => resolveRules(project.ruleOverrides), [project.ruleOverrides]);

  const value: Store = { project, rules, update, editGeometry, undo, redo, canUndo: s.past.length > 0, canRedo: s.future.length > 0, saving };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore вне ProjectProvider');
  return v;
}
