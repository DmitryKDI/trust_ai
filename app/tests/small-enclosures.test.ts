import { describe, expect, it } from 'vitest';
import { newBin } from '../src/recognize/raster';
import { smallEnclosures } from '../src/quick/small-rooms';

function enclosure(gap=28,partition=false) {
  const mask=newBin(250,250);
  const fill=(x0:number,y0:number,x1:number,y1:number,v=1)=>{
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) mask.d[y*mask.w+x]=v;
  };
  fill(60,40,158,48);fill(60,180,158,188);
  fill(60,40,68,188);fill(150,40,158,188);
  if(gap)fill(92,40,92+gap,48,0);
  if(partition)fill(107,48,115,180);
  return {mask,fill};
}

describe('подтверждение малого контура стенами',()=>{
  it('дверной разрыв допустим при трёх сплошных стенах',()=>{
    expect(smallEnclosures(enclosure().mask,50)).toEqual([{x0:68,y0:48,x1:150,y1:180}]);
  });
  it('открытый участок не становится закрытым помещением',()=>{
    const {mask,fill}=enclosure();fill(60,40,158,48,0);
    expect(smallEnclosures(mask,50)).toEqual([]);
  });
  it('слишком широкий разрыв не выдаётся за дверь',()=>{
    const {mask,fill}=enclosure(0);fill(69,40,146,48,0);
    expect(smallEnclosures(mask,50)).toEqual([]);
  });
  it('внутренняя перегородка не пересекается общим прямоугольником',()=>{
    const boxes=smallEnclosures(enclosure(0,true).mask,50);
    expect(boxes).toHaveLength(2);
    expect(boxes.every(box=>box.x1<=107 || box.x0>=115)).toBe(true);
  });
});
