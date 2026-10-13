import { expect, it } from 'vitest';
import { emptyGeometry } from '../src/model/defaults';
import { repairWallJunctions, snapWallAxis } from '../src/editor/wallJunctions';
import { historyShortcut } from '../src/editor/keyboard';
import { draftReducer } from '../src/editor/useDraftHistory';
import { detectRoomPolygon, wallPolygon } from '../src/geometry/plan';
import { bbox } from '../src/geometry/poly';
import { door, wall } from './fixtures/synthetic';

export function brokenBox() {
  return { ...emptyGeometry(), walls: [
    wall({ x: 0, y: 0 }, { x: 2920, y: 0 }, 40),
    wall({ x: 3000, y: 80 }, { x: 3000, y: 3000 }, 40),
    wall({ x: 3000, y: 3000 }, { x: 0, y: 3000 }, 40),
    wall({ x: 0, y: 3000 }, { x: 0, y: 0 }, 40),
  ] };
}
it('небольшой разрыв угла закрывается вдоль осей, автоконтур снова находится', () => {
  const g = brokenBox();
  expect(detectRoomPolygon(g, { x: 1500, y: 1500 })).toBeNull();
  const repaired = repairWallJunctions(g);
  expect(repaired.walls[0].b.x).toBeCloseTo(3000);
  expect(repaired.walls[0].b.y).toBe(0);
  expect(repaired.walls[1].a).toEqual(repaired.walls[0].b);
  expect(g.walls[0].b.x).toBe(2920);
  expect(detectRoomPolygon(repaired, { x: 1500, y: 1500 })).not.toBeNull();
  expect(repairWallJunctions(repaired)).toBe(repaired);
});
it('крупные разрывы и обозначенные проёмы не закрываются автоматически', () => {
  const g = brokenBox();
  g.walls[0].b.x = 2700;
  expect(repairWallJunctions(g)).toBe(g);
  const opened = brokenBox();
  opened.openings.push(door({ x: 2850, y: 0 }, { x: 3100, y: 0 }, 200, 'a', 1));
  expect(repairWallJunctions(opened)).toBe(opened);
  expect(opened.openings[0].b.x - opened.openings[0].a.x).toBe(250);
});
it('наружный угол заполнен до внешней грани, свободный торец остаётся плоским', () => {
  const a = wall({ x: 0, y: 0 }, { x: 3000, y: 0 }, 100);
  const b = wall({ x: 3000, y: 0 }, { x: 3000, y: 3000 }, 200);
  expect(bbox(wallPolygon(a, [a, b]))).toEqual({ minX: 0, minY: -50, maxX: 3100, maxY: 50 });
});
it('привязка использует ось стены и сохраняет строгую горизонталь по Shift', () => {
  const w = wall({ x: 0, y: 0 }, { x: 3000, y: 0 }, 200);
  expect(snapWallAxis({ x: 3005, y: 80 }, [w], 100)).toEqual(w.b);
  expect(snapWallAxis({ x: 1400, y: 80 }, [w], 100)).toEqual({ x: 1400, y: 0 });
  expect(snapWallAxis({ x: 2990, y: 20 }, [w], 100, { x: 0, y: 50 }, true)).toEqual({ x: 2990, y: 50 });
});
it('отмена и повтор работают с русской раскладкой и физическими клавишами', () => {
  const event = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: 'KeyZ', key: 'я' };
  expect(historyShortcut(event)).toBe('undo');
  expect(historyShortcut({ ...event, code: 'KeyY', key: 'н' })).toBe('redo');
  expect(historyShortcut({ ...event, shiftKey: true })).toBe('redo');
  expect(historyShortcut({ ...event, ctrlKey: false })).toBeNull();
  expect(historyShortcut({ ...event, altKey: true })).toBeNull();
});
it('черновые точки возвращаются после отмены; новая точка очищает повтор', () => {
  const a = { x: 0, y: 0 }, b = { x: 3000, y: 0 };
  const before = { points: [a, b], future: [] };
  const undone = draftReducer(before, { type: 'undo' });
  expect(draftReducer(undone, { type: 'redo' })).toEqual(before);
  const edited = draftReducer(undone, { type: 'set', value: points => [...points, { x: 2000, y: 0 }] });
  expect(draftReducer(edited, { type: 'redo' })).toBe(edited);
});
