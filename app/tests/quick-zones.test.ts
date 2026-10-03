import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { expect, it } from 'vitest';
import { quickPlan } from '../src/quick';
import { EPS_AREA, overlapArea } from '../src/geometry/poly';

it('net15: семь зон сохраняются, коридор не перекрывает санузлы, скос балкона остаётся', { timeout: 30_000 }, () => {
  const image = jpeg.decode(fs.readFileSync(path.resolve(__dirname, '../../bench/plans/net15/plan.jpg')), { useTArray: true });
  const result = quickPlan({rgba: image.data, w: image.width, h: image.height, pxPerUnit:1, areaM2:48.4, children:1, page:1});
  const rooms = result.geometry.rooms;
  expect(rooms).toHaveLength(7);
  for (let a=0; a<rooms.length; a++) for (let b=a+1; b<rooms.length; b++)
    expect(overlapArea(rooms[a].polygon, rooms[b].polygon)).toBeLessThanOrEqual(EPS_AREA);
  expect(rooms.some(room => room.polygon.some((p,i) => {
    const q=room.polygon[(i+1)%room.polygon.length];
    return Math.abs(p.x-q.x)>100 && Math.abs(p.y-q.y)>100;
  }))).toBe(true);
});
