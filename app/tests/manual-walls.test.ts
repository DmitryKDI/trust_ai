import { expect, it } from 'vitest';
import { emptyGeometry } from '../src/model/defaults';
import { addPlanWall } from '../src/editor/ops';
import { geometryHash, usesRoomWalls } from '../src/geometry/plan';
import { checkedPlan, parseLearning } from '../src/learning/model';
import { resolveRules } from '../src/rules/rules';
import { planContext } from '../src/validate/context';
import { reachability, validate } from '../src/validate/validator';
import { Grid } from '../src/validate/grid';
import { difference, toGeom } from '../src/geometry/poly';
import { door, rect, room, twoRoom, wall } from './fixtures/synthetic';
import type { FurnitureItem } from '../src/model/types';

const rules = resolveRules();
function raster() {
  return { ...emptyGeometry(), sourcePage: 1, calibration: { p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, mm: 1000, mmPerUnit: 1 },
    rooms: [room('Санузел', 'bath', rect(0, 0, 2000, 4000)), room('Коридор', 'corridor', rect(2000, 0, 4000, 4000))],
    openings: [door({ x: 0, y: 1500 }, { x: 0, y: 2500 }, 100, 'a', 1, true)] };
}
const divider = () => wall({ x: 2000, y: 0 }, { x: 2000, y: 4000 }, 100, 'partition');
it('первая ручная стена сохраняет основу скана и старые границы коллизий', () => {
  const old = raster(), g = addPlanWall(old, divider());
  expect(usesRoomWalls(g)).toBe(true);
  expect(g.rooms).toBe(old.rooms);
  const item: FurnitureItem = { id: 'cab', type: 'dresser', x: 2000, y: 1000, w: 500, d: 500, rot: 0, roomId: null, ruleId: null, movedByManager: true };
  const codes = (x: number) => validate(g, [{ ...item, x }], rules, { bedAccessBothSides: false }).issues.map(i => i.code);
  expect(codes(2000)).toContain('wall-collision');
  expect(codes(4000)).toContain('wall-collision');
  expect(codes(1000)).not.toContain('wall-collision');
  expect(geometryHash(g)).not.toBe(geometryHash(old));
});
it('ручная перегородка блокирует проход; дверь в ней открывает проход', () => {
  const g = addPlanWall(raster(), divider());
  expect(reachability(planContext(g, rules), [], rules).unreachableRooms).toContain(g.rooms[1].id);
  const opened = { ...g, openings: [...g.openings, door({ x: 2000, y: 1500 }, { x: 2000, y: 2500 }, 100, 'a', 1)] };
  expect(reachability(planContext(opened, rules), [], rules).unreachableRooms).toEqual([]);
});
it('векторный план сохраняет явную основу стен', () => {
  const g = addPlanWall(twoRoom(), divider());
  expect(usesRoomWalls(g)).toBe(false);
});
it('память обучения переносит стену, тип, толщину и основу скана', () => {
  const g = addPlanWall(raster(), divider());
  const e = checkedPlan('a'.repeat(64) + ':1', g);
  const restored = parseLearning(JSON.stringify({ format: 'trust-planner-learning', version: 1, plans: [e] }))[0].geometry;
  expect(restored.walls).toEqual(g.walls);
  expect(restored.wallMode).toBe('rooms');
  const invalid = { ...g, walls: [{ ...g.walls[0], kind: 'invented' as never }] };
  expect(() => checkedPlan(e.key, invalid)).toThrow(/стены/);
});
it('растр стен не закрашивает внутренние кольца и проёмы', () => {
  const grid = new Grid({ minX: 0, minY: 0, maxX: 4000, maxY: 4000 }, 100);
  grid.paint(rect(0, 0, 4000, 4000), 0);
  grid.paintGeom(difference(toGeom(rect(1000, 1000, 3000, 3000)), toGeom(rect(1500, 1500, 2500, 2500))), 1);
  const value = (x: number, y: number) => { const [i, j] = grid.cellOf({ x, y }); return grid.blocked[j * grid.nx + i]; };
  expect(value(1100, 1100)).toBe(1);
  expect(value(2000, 2000)).toBe(0);
  expect(value(500, 500)).toBe(0);
});
