import { describe, expect, it } from 'vitest';
import { quickPlan } from '../src/quick';
import { overlapArea, pointInPolygon } from '../src/geometry/poly';

// Small rooms with narrow doors, connected dimension grids and height symbols.
// This is a generated plan, not a copy of a client's image.
function smallRooms(annotations: boolean) {
  const w=700,h=650,rgba=new Uint8ClampedArray(w*h*4).fill(255);
  const rect=(x0:number,y0:number,x1:number,y1:number,color:number|number[])=>{
    const rgb=typeof color==='number'?[color,color,color]:color;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) rgba.set([...rgb,255],(y*w+x)*4);
  };
  // Two large rooms above, corridor in the middle, three rooms below.
  rect(50,50,630,70,40); rect(50,570,630,590,40);
  rect(50,50,70,590,40); rect(610,50,630,590,40);
  rect(335,70,345,310,40); rect(70,305,610,315,40);
  rect(70,405,610,415,40); rect(415,415,425,570,40);
  rect(475,415,485,570,40);
  for(const [x0,x1,y] of [[260,300,305],[540,580,305],[300,340,405],[432,467,405],[520,560,405]]) rect(x0,y,x1,y+10,255);
  rect(610,345,630,390,255);
  if(annotations) {
    for(const x of [442,501,535,569]) rect(x,415,x+2,570,205);
    for(const y of [446,480,514,548]) rect(425,y,610,y+2,205);
    for(const [x,y] of [[448,468],[540,499]]) {
      // A height mark and a short inscription, joined to the faint grid.
      const c=[170,75,75];
      rect(x-2,y-10,x+2,y+10,c); rect(x-10,y-2,x+10,y+2,c);
      rect(x+12,y-14,x+14,y-5,c); rect(x+22,y-14,x+24,y-5,c);
      rect(x+12,y-10,x+24,y-8,c);
    }
  }
  return {rgba,w,h,pxPerUnit:1,areaM2:75,children:0,page:1};
}

describe('маленькие помещения рядом с коридором',()=>{
  for(const annotations of [false,true]) it(`оба помещения имеют отдельные контуры, помехи: ${annotations}`,{timeout:30_000},()=>{
    const r=quickPlan(smallRooms(annotations)),k=r.geometry.calibration!.mmPerUnit;
    const owner=(x:number,y:number)=>{
      const hits=r.geometry.rooms.filter(room=>pointInPolygon({x:x*k,y:y*k},room.polygon));
      expect(hits).toHaveLength(1); return hits[0];
    };
    const narrow=owner(450,520),wide=owner(550,530),corridor=owner(450,360),neighbor=owner(300,520);
    expect(new Set([narrow.id,wide.id,corridor.id,neighbor.id]).size).toBe(4);
    for(const y of [435,475,550]) expect(owner(450,y).id).toBe(narrow.id);
    for(const [x,y] of [[505,435],[585,435],[505,550],[585,550]]) expect(owner(x,y).id).toBe(wide.id);
    expect(overlapArea(narrow.polygon,wide.polygon)).toBeLessThanOrEqual(100);
    expect(overlapArea(narrow.polygon,corridor.polygon)).toBeLessThanOrEqual(100);
    expect(overlapArea(wide.polygon,corridor.polygon)).toBeLessThanOrEqual(100);
  });
});
