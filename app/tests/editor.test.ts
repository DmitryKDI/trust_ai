import { describe, expect, it } from 'vitest';
import { calibrate, doorFromArc, isWallFill, openingFromClicks, snapPoint, wallFromFill } from '../src/editor/ops';
import { emptyGeometry } from '../src/model/defaults';
import { centroid, dist } from '../src/geometry/poly';
import { doorSwingPolygon } from '../src/geometry/plan';
import { parseOperatorList, SnapIndex, type OpsCodes, type PageVectors } from '../src/pdf/vectors';
import { twoRoom } from './fixtures/synthetic';

describe('редактор разметки', () => {
  it('калибровка пересчитывает всю геометрию', () => {
    const g = twoRoom(); // стены 10000 мм при k = 1
    // Отрезок, который сейчас 5000 «мм», на самом деле 4000 мм.
    const c = calibrate(g, { x: 0, y: 0 }, { x: 5000, y: 0 }, 4000, 1);
    expect(c.calibration!.mmPerUnit).toBeCloseTo(0.8);
    expect(c.walls[0].b.x).toBeCloseTo(8000);
    expect(c.walls[0].thickness).toBeCloseTo(240);
  });

  it('стена из прямоугольной заливки чертежа', () => {
    const w = wallFromFill({ x0: 10, y0: 20, x1: 110, y1: 28, color: '#dedede' }, 18, 1);
    expect(w.thickness).toBe(144);
    expect(w.a).toEqual({ x: 180, y: 432 });
    expect(w.b).toEqual({ x: 1980, y: 432 });
    expect(w.source).toBe('suggested');
    expect(w.verifiedByManager).toBe(false);
  });

  it('короткий обрезок стены берёт направление соседней стены', () => {
    const g = twoRoom();
    // Обрезок 100×80 на вертикальной перегородке x=5000 (толщина 100).
    const stub = wallFromFill({ x0: 4950, y0: 6000, x1: 5050, y1: 6080, color: '#dedede' }, 1, 1, g);
    expect(stub.a.x).toBe(5000);
    expect(stub.b.x).toBe(5000);
    expect(stub.thickness).toBe(100);
  });

  it('дверь из дуги: петля, ширина и сторона открывания', () => {
    const g = twoRoom();
    // Стена y=3500 (спальня сверху). Дуга: центр (5300,3550), закрытое положение → (6100,3550), открытое → (5300,2750).
    const arc = { center: { x: 5300, y: 3550 }, r: 800, start: { x: 6100, y: 3550 }, end: { x: 5300, y: 2750 } };
    const d = doorFromArc(g, arc, 1, 1)!;
    expect(d.a.y).toBe(3500);
    expect(dist(d.a, d.b)).toBeGreaterThan(780);
    expect(centroid(doorSwingPolygon(d)).y).toBeLessThan(3500); // открывается вверх, в спальню
  });

  it('проём по двум кликам ложится на ось стены', () => {
    const o = openingFromClicks(twoRoom(), { x: 6500, y: 30 }, { x: 8000, y: -20 }, 'window', 1);
    expect(o.a.y).toBe(0);
    expect(o.b.y).toBe(0);
    expect(o.thickness).toBe(300);
  });

  it('привязка: точка разметки важнее ортогонали', () => {
    const g = twoRoom();
    const r = snapPoint({ x: 9990, y: 15 }, { g, k: 1, index: null, radiusMm: 100, anchor: { x: 0, y: 500 }, ortho: true, vectors: true });
    expect(r.kind).toBe('geometry');
    const o = snapPoint({ x: 3000, y: 530 }, { g: emptyGeometry(), k: 1, index: null, radiusMm: 50, anchor: { x: 0, y: 500 }, ortho: true, vectors: true });
    expect(o).toEqual({ p: { x: 3000, y: 500 }, kind: 'ortho' });
  });

  it('цвет стены на чертеже', () => {
    expect(isWallFill('#dedede')).toBe(true);
    expect(isWallFill('#ffffff')).toBe(false);
    expect(isWallFill('#000000')).toBe(false);
    expect(isWallFill('#0000ff')).toBe(false);
  });

  it('разбор операторов pdf.js с матрицей преобразования', () => {
    const ops: OpsCodes = { save: 10, restore: 11, transform: 12, constructPath: 91, setStrokeRGBColor: 58, setFillRGBColor: 59, setLineWidth: 2, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27 };
    // Прямоугольник-заливка 0..10 × 0..5 в пространстве, масштабированном ×2; viewport переворачивает Y (высота 100).
    const rect = new Float32Array([0, 0, 0, 1, 10, 0, 1, 10, 5, 1, 0, 5, 4]);
    const line = new Float32Array([0, 0, 0, 1, 20, 0]);
    const v: PageVectors = parseOperatorList(
      [10, 12, 59, 91, 58, 91, 11],
      [[], [2, 0, 0, 2, 0, 0], ['#dedede'], [22, [rect], null], ['#0000ff'], [20, [line], null], []] as unknown[][],
      ops, [1, 0, 0, -1, 0, 100], 100, 100,
    );
    expect(v.fills).toHaveLength(1);
    expect(v.fills[0]).toMatchObject({ x0: 0, x1: 20, y0: 90, y1: 100, color: '#dedede' });
    expect(v.segments.some((s) => s.color === '#0000ff' && Math.abs(s.b.x - 40) < 1e-6)).toBe(true);
    const idx = new SnapIndex(v);
    expect(idx.nearestPoint({ x: 19, y: 91 }, 3)).toEqual({ x: 20, y: 90 });
  });
});
