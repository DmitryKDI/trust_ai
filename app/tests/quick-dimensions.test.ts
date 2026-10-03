import { describe, expect, it } from 'vitest';
import { quickPlan } from '../src/quick';
import { pointInPolygon } from '../src/geometry/poly';

function dimensionPlan(dimensions: boolean, wall = 35, annotationBlock = false) {
  const w = 700, h = 700, rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number, gray: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set([gray, gray, gray, 255], (y * w + x) * 4);
  };
  rect(64, 54, 636, 86, wall); rect(64, 614, 376, 646, wall);
  rect(64, 54, 96, 646, wall); rect(604, 54, 636, 366, wall);
  rect(356, 334, 636, 366, wall); rect(344, 334, 376, 646, wall);
  rect(96, 344, 344, 356, wall); rect(344, 86, 356, 344, wall);
  if (dimensions) {
    for (const y of [396, 466, 536]) rect(96, y, 344, y + 2, 205);
    rect(144, 356, 146, 614, 205);
  }
  if (annotationBlock) {
    // A detached framed service block below the drawing, inside the image crop.
    rect(474, 490, 654, 494, 70); rect(474, 616, 654, 620, 70);
    rect(474, 490, 478, 620, 70); rect(650, 490, 654, 620, 70);
  }
  return { rgba, w, h, pxPerUnit: 1, areaM2: 80, children: 0, page: 1 };
}

describe('монохромные планы с размерными линиями', () => {
  for (const wall of [35, 160]) it(`светлые размеры не дробят комнату, стены ${wall}`, { timeout:30_000 }, () => {
    const input = dimensionPlan(true, wall), result = quickPlan(input);
    expect(result.geometry.rooms).toHaveLength(3);
    const k = result.geometry.calibration!.mmPerUnit;
    // Each known room interior is covered once; the line grid cannot create extra zones.
    const ids = [ [220, 220], [480, 220], [220, 480] ].map(([x,y]) => {
      const rooms = result.geometry.rooms.filter(r => pointInPolygon({ x: x*k, y: y*k }, r.polygon));
      expect(rooms).toHaveLength(1);
      return rooms[0].id;
    });
    expect(new Set(ids).size).toBe(3);
    // Points above and below a dimension line remain in the same physical room.
    const owners = [430, 500, 580].map(y => result.geometry.rooms.find(r => pointInPolygon({x:220*k,y:y*k},r.polygon))?.id);
    expect(owners.every(id => id === ids[2])).toBe(true);
  });
  it('план без размеров сохраняет три физических помещения', () => {
    expect(quickPlan(dimensionPlan(false)).geometry.rooms).toHaveLength(3);
  });
  it('отдельный служебный блок листа не становится помещением', () => {
    const result = quickPlan(dimensionPlan(true, 35, true));
    expect(result.geometry.rooms).toHaveLength(3);
    const k = result.geometry.calibration!.mmPerUnit;
    expect(result.geometry.rooms.some(r => pointInPolygon({x:550*k,y:550*k},r.polygon))).toBe(false);
  });
});
