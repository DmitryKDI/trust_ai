import type { FixedKind, PlanGeometry, Pt, RoomType, WallKind } from '../model/types';
import { dist, add, mul, norm, sub, projectOnSegment } from '../geometry/poly';
import { ROOM_TYPES, roomName, simpleRing } from '../learning/model';

export type ElementSelection = { kind: 'wall' | 'opening' | 'fixed' | 'room' | 'wet'; id: string };
export type PlanSelection = ElementSelection | { kind: 'item'; id: string };
export const ELEMENT_KEYS = { wall: 'walls', opening: 'openings', fixed: 'fixed', room: 'rooms', wet: 'wetZones' } as const;
export const FIXED_TYPES: [FixedKind, string][] = [['shaft', 'Шахта'], ['vent', 'Вентканал'], ['radiator', 'Радиатор'], ['electrical', 'Электрощиток'], ['column', 'Колонна'], ['riser', 'Стояк'], ['void', 'Полость вне площади'], ['other', 'Другое']];
export function selectElement<T extends PlanSelection>(current: T[], element: T, additive: boolean): T[] {
  if (!additive) return [element];
  return current.some(s => s.kind === element.kind && s.id === element.id) ? current.filter(s => s.kind !== element.kind || s.id !== element.id) : [...current, element];
}
export function deleteSelection(g: PlanGeometry, selection: ElementSelection[]): PlanGeometry {
  const ids = (kind: ElementSelection['kind']) => new Set(selection.filter(s => s.kind === kind).map(s => s.id));
  return { ...g, walls: g.walls.filter(x => !ids('wall').has(x.id)), openings: g.openings.filter(x => !ids('opening').has(x.id)), rooms: g.rooms.filter(x => !ids('room').has(x.id)), fixed: g.fixed.filter(x => !ids('fixed').has(x.id)), wetZones: g.wetZones.filter(x => !ids('wet').has(x.id)) };
}
export function changeSelectionType(g: PlanGeometry, selection: ElementSelection[], value: string): PlanGeometry {
  const kind = selection[0]?.kind;
  if (!kind || selection.some(s => s.kind !== kind)) return g;
  const ids = new Set(selection.map(s => s.id)), manual = { source: 'manual' as const, verifiedByManager: true };
  if (kind === 'wall' && ['unknown', 'bearing', 'partition'].includes(value)) return { ...g, walls: g.walls.map(w => ids.has(w.id) ? { ...w, kind: value as WallKind, ...manual } : w) };
  if (kind === 'opening' && (value === 'door' || value === 'window')) return { ...g, openings: g.openings.map(o => ids.has(o.id) ? { ...o, type: value, isEntrance: o.type === value && value === 'door' ? o.isEntrance : false, ...manual } : o) };
  if (kind === 'room' && ROOM_TYPES.some(([t]) => t === value)) return { ...g, rooms: g.rooms.map(r => ids.has(r.id) ? { ...r, type: value as RoomType, name: roomName(value as RoomType), typeSource: 'manual', typeBasis: undefined, ...manual } : r) };
  if (kind === 'fixed' && FIXED_TYPES.some(([t]) => t === value)) return { ...g, fixed: g.fixed.map(f => ids.has(f.id) ? { ...f, kind: value as FixedKind, ...manual } : f) };
  return g;
}
export function geometryVertices(g: PlanGeometry, sel: ElementSelection): Pt[] {
  const item = g[ELEMENT_KEYS[sel.kind]].find(x => x.id === sel.id);
  if (!item) return [];
  return 'polygon' in item ? item.polygon : [item.a, item.b];
}
/** Совпадающие узлы остаются общими. Изменение записывается только после проверки контуров. */
export function moveGeometryVertex(g: PlanGeometry, sel: ElementSelection, index: number, point: Pt): PlanGeometry {
  const vertices = geometryVertices(g, sel), old = vertices[index];
  if (!old || ![point.x, point.y].every(Number.isFinite)) return g;
  const p = { x: Math.round(point.x), y: Math.round(point.y) };
  if (dist(old, p) < .001) return g;
  const shared = sel.kind === 'wall';
  const match = (q: Pt) => dist(q, old) < 1;
  const replace = (q: Pt) => match(q) ? p : q;
  const manual = { source: 'manual' as const, verifiedByManager: true };
  const walls = g.walls.map(w => {
    if (!shared) return w;
    const a = replace(w.a), b = replace(w.b);
    if (a === w.a && b === w.b) return w;
    if (dist(a, b) < 50) throw new Error('Стена должна быть длиной не меньше 50 мм.');
    return { ...w, a, b, ...manual };
  });
  const polygons = <T extends { id: string; polygon: Pt[] }>(all: T[], kind: ElementSelection['kind']) => all.map(item => {
    if (!shared && (sel.kind !== kind || sel.id !== item.id)) return item;
    const polygon = item.polygon.map(replace);
    if (polygon.every((q, i) => q === item.polygon[i])) return item;
    if (!simpleRing(polygon)) throw new Error('Контур пересекается или имеет нулевую площадь. Выберите другое положение угла.');
    return { ...item, polygon, ...manual };
  });
  const openings = g.openings.map(o => {
    // Проёмы, лежащие на изменяемом сегменте, следуют его новой оси.
    if (sel.kind !== 'opening') {
      const wall = g.walls.find((w, i) => walls[i] !== w && projectOnSegment(o.a, w.a, w.b).dist < 2 && projectOnSegment(o.b, w.a, w.b).dist < 2);
      if (wall) {
        const next = walls.find(w => w.id === wall.id)!;
        const mid = mul(add(o.a, o.b), .5), t = projectOnSegment(mid, wall.a, wall.b).t;
        const center = add(next.a, mul(sub(next.b, next.a), t));
        const dir = norm(sub(next.b, next.a)), width = dist(o.a, o.b);
        const sign = (o.b.x - o.a.x) * (wall.b.x - wall.a.x) + (o.b.y - o.a.y) * (wall.b.y - wall.a.y) >= 0 ? 1 : -1;
        return { ...o, a: add(center, mul(dir, -width / 2 * sign)), b: add(center, mul(dir, width / 2 * sign)), ...manual };
      }
    }
    if (!shared && (sel.kind !== 'opening' || sel.id !== o.id)) return o;
    const a = replace(o.a), b = replace(o.b);
    if (a === o.a && b === o.b) return o;
    if (dist(a, b) < 50) throw new Error('Проём должен быть длиной не меньше 50 мм.');
    return { ...o, a, b, ...manual };
  });
  return { ...g, walls, openings, rooms: polygons(g.rooms, 'room'), fixed: polygons(g.fixed, 'fixed'), wetZones: polygons(g.wetZones, 'wet') };
}
