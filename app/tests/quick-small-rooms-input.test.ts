// Optional regression on the private user plan: the image is not published.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { expect, it } from 'vitest';
import { quickPlan } from '../src/quick';
import { overlapArea, pointInPolygon } from '../src/geometry/poly';

const input=process.env.PLAN_SMALL_ROOMS_INPUT;
it.skipIf(!input)('две отмеченные пользователем малые зоны отделены от коридора', {timeout:30_000},()=>{
  const bytes=fs.readFileSync(input!);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(process.env.PLAN_SMALL_ROOMS_SHA256);
  const im=jpeg.decode(bytes,{useTArray:true});
  expect([im.width,im.height]).toEqual([900,779]);
  const r=quickPlan({rgba:im.data,w:im.width,h:im.height,pxPerUnit:1,areaM2:null,children:1,page:1});
  const k=r.geometry.calibration!.mmPerUnit;
  const hit=(x:number,y:number)=>r.geometry.rooms.filter(room=>pointInPolygon({x:x*k,y:y*k},room.polygon));
  const narrow=hit(365,665),wide=hit(455,680);
  expect(narrow).toHaveLength(1);expect(wide).toHaveLength(1);
  expect(narrow[0].id).not.toBe(wide[0].id);
  for(const [x,y] of [[355,650],[385,650],[355,700],[385,700]]) expect(hit(x,y).map(room=>room.id)).toEqual([narrow[0].id]);
  for(const [x,y] of [[415,650],[500,650],[415,710],[500,710]]) expect(hit(x,y).map(room=>room.id)).toEqual([wide[0].id]);
  for(const [x,y] of [[430,580],[300,680],[398,660]]) expect(hit(x,y).some(room=>room.id===narrow[0].id || room.id===wide[0].id)).toBe(false);
  expect(overlapArea(narrow[0].polygon,wide[0].polygon)).toBeLessThanOrEqual(100);
  expect(r.geometry.calibration!.method).toBe('typical');
});
