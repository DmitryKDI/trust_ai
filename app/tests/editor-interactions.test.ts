import { describe, expect, it } from 'vitest';
import { twoRoom, wall } from './fixtures/synthetic';
import { selectElement, changeSelectionType, moveGeometryVertex, deleteSelection } from '../src/editor/selection';
import { snapPolylineClosure } from '../src/editor/ops';
import { furnitureSnapContext, resizeFurnitureAtHandle, snapFurnitureMove, snapFurnitureResize } from '../src/editor/furniture-interaction';
import { changeFurnitureType } from '../src/editor/furniture';
import { footprint } from '../src/furniture/catalog';
import { bbox, overlapArea } from '../src/geometry/poly';
import type { FurnitureItem } from '../src/model/types';

const item: FurnitureItem = { id: 'one', type: 'sofa', x: 2000, y: 2000, w: 1000, d: 600, rot: 0, roomId: null, ruleId: null, movedByManager: false };
describe('selection and corners', () => {
  it('Shift toggles; mixed wall types change together without changing other walls', () => {
    const g = twoRoom(), a = { kind: 'wall' as const, id: g.walls[0].id }, b = { kind: 'wall' as const, id: g.walls[4].id };
    const selected = selectElement(selectElement([], a, false), b, true);
    const next = changeSelectionType(g, selected, 'partition');
    expect(next.walls[0].kind).toBe('partition'); expect(next.walls[4].kind).toBe('partition'); expect(next.walls[1]).toBe(g.walls[1]);
    expect(selectElement(selected, a, true)).toEqual([b]); expect(deleteSelection(g, selected).walls).toHaveLength(4);
    expect(changeSelectionType(g, [...selected, { kind: 'room', id: g.rooms[0].id }], 'bearing')).toBe(g);
  });
  it('closure uses the exact first point, with at least three vertices', () => {
    const points = [{ x: 123, y: 456 }, { x: 2000, y: 456 }, { x: 2000, y: 3000 }];
    expect(snapPolylineClosure({ x: 130, y: 450 }, points, 30)).toEqual(points[0]);
    expect(snapPolylineClosure({ x: 130, y: 450 }, points.slice(0, 2), 30)).toBeNull();
    expect(snapPolylineClosure({ x: 2000, y: 2900 }, points, 30)).toBeNull();
  });
  it('wall rotation keeps shared junctions and opening width', () => {
    const g = twoRoom(), selected = { kind: 'wall' as const, id: g.walls[0].id };
    const next = moveGeometryVertex(g, selected, 1, { x: 9000, y: 1000 });
    expect(next.walls[1].a).toEqual(next.walls[0].b);
    const opening = next.openings.find(o => o.id === g.openings[3].id)!;
    expect(Math.hypot(opening.b.x - opening.a.x, opening.b.y - opening.a.y)).toBeCloseTo(1500);
    expect(opening.a.y).not.toBe(0);
  });
  it('zone editing does not move another zone at the same corner; rejects crossed outlines', () => {
    const g = twoRoom(); g.wetZones = [{ id: 'wet', polygon: [...g.rooms[0].polygon], source: 'manual', sourcePage: 1, verifiedByManager: true }];
    const next = moveGeometryVertex(g, { kind: 'wet', id: 'wet' }, 0, { x: 500, y: 500 });
    expect(next.wetZones[0].polygon[0]).toEqual({ x: 500, y: 500 }); expect(next.rooms[0]).toBe(g.rooms[0]);
    expect(() => moveGeometryVertex(g, { kind: 'wet', id: 'wet' }, 0, { x: 6000, y: 6000 })).toThrow();
  });
});
describe('furniture dragging', () => {
  it.each([0, 90, 180, 270] as const)('resizes with fixed opposite corner at rotation %i', rot => {
    const source = { ...item, rot }, angle = rot * Math.PI / 180;
    const pointer = { x: source.x + 900 * Math.cos(angle) - 500 * Math.sin(angle), y: source.y + 900 * Math.sin(angle) + 500 * Math.cos(angle) };
    const next = resizeFurnitureAtHandle(source, { x: 1, y: 1 }, pointer);
    expect(next.w).toBeCloseTo(1400); expect(next.d).toBeCloseTo(800);
    const beforeCorner = footprint(source)[0], nextCorner = footprint(next)[0];
    expect(nextCorner.x).toBeCloseTo(beforeCorner.x); expect(nextCorner.y).toBeCloseTo(beforeCorner.y);
  });
  it('side resizing leaves depth unchanged and never inverts', () => {
    const next = resizeFurnitureAtHandle(item, { x: 1, y: 0 }, { x: 100, y: 8000 });
    expect(next.w).toBe(100); expect(next.d).toBe(item.d); expect(next.x - next.w / 2).toBe(item.x - item.w / 2);
  });
  it('snaps to the wall face, respecting thickness', () => {
    const g = twoRoom(), source = { ...item, x: 2000, y: 470 };
    const context = furnitureSnapContext(g, []), next = snapFurnitureMove(source, context, 40);
    expect(next.item.y).toBeCloseTo(450); expect(next.guides.some(g => g.kind === 'wall')).toBe(true);
    expect(overlapArea(footprint(next.item), context.walls)).toBeLessThanOrEqual(1);
    expect(snapFurnitureMove({ ...source, y: 700 }, context, 40).guides).toHaveLength(0);
  });
  it('snaps to another object and resizes to its edge without overlap', () => {
    const g = twoRoom(), other = { ...item, id: 'two', x: 4000 };
    const context = furnitureSnapContext(g, [other]);
    const next = snapFurnitureMove({ ...item, x: 2980 }, context, 40);
    expect(bbox(footprint(next.item)).maxX).toBe(3500);
    expect(next.guides.some(g => g.kind === 'item')).toBe(true);
    const resized = snapFurnitureResize(item, { x: 1, y: 0 }, { x: 3480, y: 2000 }, context, 40);
    expect(bbox(footprint(resized.item)).maxX).toBe(3500);
    expect(overlapArea(footprint(resized.item), footprint(other))).toBe(0);
  });
  it('diagonal wall contact never pushes a footprint through a wall', () => {
    const g = twoRoom(); g.rooms = []; g.walls = [wall({ x: 0, y: 0 }, { x: 5000, y: 5000 }, 200)]; g.openings = []; g.fixed = [];
    const context = furnitureSnapContext(g, []), source = { ...item, x: 2000, y: 2780 };
    const next = snapFurnitureMove(source, context, 200);
    expect(next.guides.some(g => g.kind === 'wall')).toBe(true); expect(overlapArea(footprint(next.item), context.walls)).toBeLessThanOrEqual(1);
  });
  it('type change preserves size, kitchen modules resize to width', () => {
    const kitchen = changeFurnitureType(item, 'kitchen-run');
    const next = resizeFurnitureAtHandle(kitchen, { x: 1, y: 0 }, { x: 3400, y: 2000 });
    expect(next.modules!.reduce((sum, m) => sum + m.w, 0)).toBeCloseTo(next.w);
    expect(changeFurnitureType(next, 'sofa').modules).toBeUndefined();
  });
});
