import { describe, expect, it } from 'vitest';
import { detectRoomPolygon, doorSwingPolygon, geometryHash, wallsGeom } from '../src/geometry/plan';
import { centroid, geomArea, orientedRect, overlapArea, polyArea, pointInPolygon } from '../src/geometry/poly';
import { twoRoom } from './fixtures/synthetic';

describe('геометрия', () => {
  it('поворот прямоугольника: rot 90 — спинкой к правой стене', () => {
    const r = orientedRect(0, 0, 2000, 1000, 90);
    // Спинка локально на y=−d/2 → после поворота на 90° оказывается справа (x = +500).
    const xs = r.map((p) => Math.round(p.x));
    expect(Math.max(...xs)).toBe(500);
    expect(Math.round(polyArea(r))).toBe(2_000_000);
  });

  it('автоконтур помещения по клику совпадает с гранями стен', () => {
    const g = twoRoom();
    const poly = detectRoomPolygon(g, { x: 2000, y: 2000 })!;
    expect(poly).not.toBeNull();
    expect(Math.round(polyArea(poly))).toBe(4800 * 6700);
    const bed = detectRoomPolygon(g, { x: 7000, y: 1000 })!;
    expect(Math.round(polyArea(bed))).toBe(4800 * 3300);
  });

  it('клик вне квартиры или в стене — нет контура', () => {
    const g = twoRoom();
    expect(detectRoomPolygon(g, { x: -1000, y: 1000 })).toBeNull();
    expect(detectRoomPolygon(g, { x: 5000, y: 1000 })).toBeNull();
  });

  it('дверной проём прорезает стену', () => {
    const g = twoRoom();
    const full = geomArea(wallsGeom(g, false));
    const cut = geomArea(wallsGeom(g, true));
    expect(full - cut).toBeGreaterThan(800 * 100);
  });

  it('дуга двери открывается в нужную сторону', () => {
    const g = twoRoom();
    const toBedroom = g.openings[1];
    const c = centroid(doorSwingPolygon(toBedroom));
    expect(c.y).toBeLessThan(3500); // в спальню (вверх)
    const entrance = g.openings[0];
    expect(centroid(doorSwingPolygon(entrance)).y).toBeGreaterThan(7000); // наружу
    const toLiving = g.openings[2];
    expect(centroid(doorSwingPolygon(toLiving)).x).toBeLessThan(5000); // в гостиную
    expect(pointInPolygon(c, g.rooms[1].polygon)).toBe(true);
  });

  it('хэш геометрии стабилен и меняется при правке', () => {
    const g = twoRoom();
    const h = geometryHash(g);
    expect(geometryHash(twoRoom())).toBe(h);
    g.walls[4].thickness = 120;
    expect(geometryHash(g)).not.toBe(h);
  });

  it('площадь пересечения', () => {
    expect(Math.round(overlapArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }]))).toBe(25);
  });
});
