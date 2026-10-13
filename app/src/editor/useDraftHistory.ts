import { useCallback, useReducer, type SetStateAction } from 'react';
import type { Pt } from '../model/types';
type State = { points: Pt[]; future: Pt[] };
type Action = { type: 'set'; value: SetStateAction<Pt[]> } | { type: 'undo' | 'redo' };
export function draftReducer(state: State, action: Action): State {
  if (action.type === 'set') return { points: typeof action.value === 'function' ? action.value(state.points) : action.value, future: [] };
  if (action.type === 'undo' && state.points.length) return { points: state.points.slice(0, -1), future: [state.points.at(-1)!, ...state.future] };
  if (action.type === 'redo' && state.future.length) return { points: [...state.points, state.future[0]], future: state.future.slice(1) };
  return state;
}
export function useDraftHistory() {
  const [state, dispatch] = useReducer(draftReducer, { points: [], future: [] });
  const set = useCallback((value: SetStateAction<Pt[]>) => dispatch({ type: 'set', value }), []);
  return { points: state.points, set, undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }), canRedo: state.future.length > 0 };
}
