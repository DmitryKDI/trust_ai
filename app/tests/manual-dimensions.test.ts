import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { orthogonalPoint, resizeOpening, snapPoint } from '../src/editor/ops';
import { resizeFurniture } from '../src/editor/furniture';
import { doorAt } from '../src/editor/quickfix';
import { doorSwingPolygons, geometryHash, openingWidth, wallsGeom } from '../src/geometry/plan';
import { centroid, overlapArea, pointInGeom } from '../src/geometry/poly';
import { emptyGeometry } from '../src/model/defaults';
import { planContext } from '../src/validate/context';
import { checkItem } from '../src/validate/validator';
import { resolveRules } from '../src/rules/rules';
import { FurnitureSymbol } from '../src/furniture/Symbol';
import { PlanView } from '../src/plan/PlanView';
import { brief, door, room, rect, twoRoom, wall } from './fixtures/synthetic';
import type { FurnitureItem } from '../src/model/types';

const tub: FurnitureItem = { id: 'tub', type: 'bathtub', x: 1500, y: 1500, w: 1700, d: 700, rot: 90, roomId: null, ruleId: null, movedByManager: false };
describe('ручные размеры и прямые стены', () => {
  it('Shift сохраняет ось первой точки даже рядом с чужим узлом', () => {
    const g = twoRoom();
    const anchor = { x: 0, y: 500 };
    const raw = { x: 9990, y: 15 };
    expect(snapPoint(raw, { g, k: 1, index: null, radiusMm: 100, anchor, ortho: true, forceOrtho: true, vectors: true })).toEqual({ p: { x: 9990, y: 500 }, kind: 'ortho' });
    expect(orthogonalPoint(anchor, { x: 5, y: -800 })).toEqual({ x: 0, y: -800 });
  });
  it('ширина двери меняется вокруг центра и прорезает стену на новый размер', () => {
    const o = resizeOpening(door({ x: 5000, y: 5000 }, { x: 5000, y: 5800 }, 100, 'a', 1), 1200);
    expect(openingWidth(o)).toBe(1200);
    expect(o.a).toEqual({ x: 5000, y: 4800 });
    expect(o.b).toEqual({ x: 5000, y: 6000 });
    const g = twoRoom(); g.openings = [o];
    expect(pointInGeom({ x: 5000, y: 4900 }, wallsGeom(g))).toBe(false);
    expect(pointInGeom({ x: 5000, y: 4600 }, wallsGeom(g))).toBe(true);
    expect(() => resizeOpening(o, 0)).toThrow();
  });
  it('дверь по щелчку использует ось ручной стены и выбранную ширину', () => {
    const g = emptyGeometry(); g.walls = [wall({ x: 1000, y: 0 }, { x: 1000, y: 5000 }, 180)];
    const o = doorAt(g, { x: 1030, y: 2000 }, 1400)!;
    expect(o.a.x).toBe(1000); expect(o.b.x).toBe(1000);
    expect(openingWidth(o)).toBe(1400); expect(o.thickness).toBe(180);
  });
  it('две створки имеют половину ширины и открываются в одну сторону', () => {
    const o = { ...door({ x: 0, y: 1000 }, { x: 1200, y: 1000 }, 100, 'b', 1), leaves: 2 as const };
    const swings = doorSwingPolygons(o);
    expect(swings).toHaveLength(2);
    expect(swings.map(s => Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y))).toEqual([600, 600]);
    expect(swings.every(s => centroid(s).y < 1000)).toBe(true);
    expect(overlapArea(swings[0], swings[1])).toBeLessThan(1);
    const g = twoRoom(); g.openings = [o];
    expect(geometryHash(g)).not.toBe(geometryHash({ ...g, openings: [{ ...o, leaves: 1 }] }));
    expect(renderToStaticMarkup(createElement(PlanView, { g, mode: 'variant' })).match(/data-door-leaf=/g)).toHaveLength(2);
  });
  it('проверка мебели учитывает обе створки без двух ошибок для одной двери', () => {
    const g = emptyGeometry();
    g.rooms = [room('Ванная', 'bath', rect(-100, -100, 2100, 2100))];
    g.openings = [{ ...door({ x: 200, y: 1000 }, { x: 1400, y: 1000 }, 100, 'a', 1), leaves: 2 }];
    const rules = resolveRules({}); const ctx = planContext(g, rules);
    for (const x of [350, 1250]) {
      const item = { ...tub, type: 'washbasin' as const, x, y: 800, w: 200, d: 200, rot: 0 as const };
      expect(checkItem({ ctx, rules, brief }, item, []).filter(i => i.code === 'door-swing')).toHaveLength(1);
    }
  });
  it('размер ванны изменяется без сдвига и её рисунок остаётся корректным', () => {
    const small = resizeFurniture(tub, 1400, 550);
    expect(small).toMatchObject({ x: 1500, y: 1500, rot: 90, w: 1400, d: 550, movedByManager: true });
    const markup = renderToStaticMarkup(createElement(FurnitureSymbol, { it: resizeFurniture(tub, 100, 100) }));
    expect(markup).not.toMatch(/(?:width|height|rx|ry)="-/);
    expect(() => resizeFurniture(tub, NaN, 700)).toThrow();
  });
  it('изменение размеров устраняет пересечение, модули кухни сохраняют порядок', () => {
    const g = emptyGeometry(); g.rooms = [room('Ванная', 'bath', rect(0, 0, 5000, 5000))];
    const rules = resolveRules({}), ctx = planContext(g, rules);
    const a = { ...tub, x: 1200, y: 2000, rot: 0 as const };
    const b = { ...tub, id: 'other', x: 2800, y: 2000, rot: 0 as const };
    expect(checkItem({ ctx, rules, brief }, a, [b]).some(i => i.code === 'item-collision')).toBe(true);
    expect(checkItem({ ctx, rules, brief }, resizeFurniture(a, 1000, 700), [b]).some(i => i.code === 'item-collision')).toBe(false);
    const kitchen = { ...tub, type: 'kitchen-run' as const, w: 2400, modules: [{ kind: 'base' as const, w: 1800 }, { kind: 'sink' as const, w: 600 }] };
    const resized = resizeFurniture(kitchen, 3600, 500);
    expect(resized.modules!.map(m => m.kind)).toEqual(['base', 'sink']);
    expect(resized.modules!.reduce((sum, m) => sum + m.w, 0)).toBe(3600);
  });
});
