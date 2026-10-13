import { expect, it } from 'vitest';
import { emptyGeometry } from '../src/model/defaults';
import { snapGeometryPoint } from '../src/editor/geometrySnap';
import { rect, room, wall } from './fixtures/synthetic';

function recognized() {
  const r = { ...room('Найденная зона', 'living', rect(1000, 1000, 4000, 4000)), source: 'suggested' as const, verifiedByManager: false };
  return { ...emptyGeometry(), rooms: [r] };
}
it('точки липнут к середине стороны и углу непроверенной распознанной зоны', () => {
  const g = recognized();
  expect(snapGeometryPoint({ x: 980, y: 2500 }, g, 50).p).toEqual({ x: 1000, y: 2500 });
  expect(snapGeometryPoint({ x: 1020, y: 980 }, g, 50).p).toEqual({ x: 1000, y: 1000 });
  expect(snapGeometryPoint({ x: 980, y: 2500 }, { ...g, rooms: g.rooms.map(r => ({ ...r, source: 'manual' as const })) }, 50).p).toEqual({ x: 1000, y: 2500 });
});
it('Shift совмещает точку с границей, сохраняя горизонталь, в том числе для наклонной стороны', () => {
  const g = recognized();
  expect(snapGeometryPoint({ x: 3980, y: 2450 }, g, 50, { anchor: { x: 2000, y: 2500 }, ortho: true }).p).toEqual({ x: 4000, y: 2500 });
  g.rooms[0].polygon = [{ x: 1000, y: 1000 }, { x: 4000, y: 1000 }, { x: 5000, y: 4000 }, { x: 1000, y: 4000 }];
  expect(snapGeometryPoint({ x: 4490, y: 2470 }, g, 50, { anchor: { x: 2000, y: 2500 }, ortho: true }).p).toEqual({ x: 4500, y: 2500 });
});
it('у стены ось приоритетнее грани зоны; при правке собственный узел не притягивает точку назад', () => {
  const g = recognized();
  g.walls.push(wall({ x: 900, y: 1000 }, { x: 900, y: 4000 }, 200));
  expect(snapGeometryPoint({ x: 980, y: 2500 }, g, 100, { preferWallAxes: true }).p).toEqual({ x: 900, y: 2500 });
  const p = { x: 1020, y: 1030 };
  expect(snapGeometryPoint(p, recognized(), 50, { excludePoint: { x: 1000, y: 1000 } }).p).toEqual(p);
});
it('учитываются границы распознанных мокрых и инженерных зон, вне радиуса привязки нет', () => {
  const g = { ...emptyGeometry(), wetZones: [{ id: 'wet', polygon: rect(1000, 1000, 4000, 4000), source: 'suggested' as const, verifiedByManager: false, sourcePage: 1 }] };
  expect(snapGeometryPoint({ x: 980, y: 2500 }, g, 50).p.x).toBe(1000);
  expect(snapGeometryPoint({ x: 800, y: 2500 }, g, 50).kind).toBe('none');
});
