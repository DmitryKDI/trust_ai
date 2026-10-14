import type { Bin } from '../recognize/raster';

export interface RoomBox { x0: number; y0: number; x1: number; y1: number }

// Recover small rectangular enclosures from thick wall evidence. Text and single
// dimension strokes must already have been removed from this mask.
export function smallEnclosures(walls: Bin, pxPerM: number): RoomBox[] {
  const {w,h,d}=walls;
  const bands=(values:Uint8Array)=>{
    const out:{from:number;to:number}[]=[];
    for(let i=0;i<values.length;) {
      if(!values[i]) {i++;continue;}
      const from=i; while(i<values.length && values[i]) i++;
      out.push({from,to:i});
    }
    return out;
  };
  const vertical=new Uint8Array(w);
  for(let x=0;x<w;x++) {
    let run=0;
    for(let y=0;y<h;y++) {
      run=d[y*w+x]?run+1:0;
      if(run>=0.8*pxPerM) {vertical[x]=1;break;}
    }
  }
  const xs=bands(vertical), boxes:RoomBox[]=[];
  for(let a=0;a<xs.length;a++) for(let b=a+1;b<xs.length;b++) {
    const x0=xs[a].to,x1=xs[b].from,bw=x1-x0;
    if(bw<0.65*pxPerM || bw>2.7*pxPerM) continue;
    const horizontal=new Uint8Array(h),margin=Math.round(0.4*pxPerM);
    for(let y=0;y<h;y++) {
      let run=0;
      for(let x=Math.max(0,x0-margin);x<Math.min(w,x1+margin);x++) {
        run=d[y*w+x]?run+1:0;
        // The side wall alone occupies at most margin pixels; it is not a horizontal wall.
        if(run>margin) {horizontal[y]=1;break;}
      }
    }
    const ys=bands(horizontal);
    for(let c=0;c<ys.length;c++) for(let e=c+1;e<ys.length;e++) {
      const y0=ys[c].to,y1=ys[e].from,bh=y1-y0,area=bw*bh;
      if(bh<0.9*pxPerM || bh>3.2*pxPerM || area<pxPerM*pxPerM || area>8*pxPerM*pxPerM) continue;
      const support=(horizontal:boolean,band:{from:number;to:number})=>{
        const start=horizontal?x0:y0,end=horizontal?x1:y1;
        let present=0,gap=0,longestGap=0;
        for(let along=start;along<end;along++) {
          let hit=false;
          for(let across=band.from;across<band.to;across++) if(d[horizontal?across*w+along:along*w+across]) {hit=true;break;}
          if(hit) {present++;gap=0;} else {gap++;longestGap=Math.max(longestGap,gap);}
        }
        return {coverage:present/(end-start),longestGap};
      };
      const sides=[support(false,xs[a]),support(false,xs[b]),support(true,ys[c]),support(true,ys[e])];
      if(sides.filter(s=>s.coverage>=0.95 && s.longestGap<=0.15*pxPerM).length<3) continue;
      if(sides.some(s=>s.coverage<0.15 || s.longestGap>1.1*pxPerM)) continue;
      let ink=0;
      for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) ink+=d[y*w+x];
      // No hidden divider or solid obstacle may be crossed inside the enclosure.
      if(ink>0.2*area) continue;
      let divider=false;
      const margin=Math.max(2,Math.round(0.15*pxPerM));
      for(let y=y0+margin;y<y1-margin;y++) {
        let count=0; for(let x=x0;x<x1;x++) count+=d[y*w+x];
        if(count>=0.95*bw) {divider=true;break;}
      }
      for(let x=x0+margin;x<x1-margin&&!divider;x++) {
        let count=0; for(let y=y0;y<y1;y++) count+=d[y*w+x];
        if(count>=0.95*bh) divider=true;
      }
      if(divider) continue;
      boxes.push({x0,y0,x1,y1});
    }
  }
  // Keep the widest supported enclosure, checking only boxes actually retained.
  const kept:RoomBox[]=[];
  for(const box of boxes.sort((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)-(a.x1-a.x0)*(a.y1-a.y0))) {
    const area=(box.x1-box.x0)*(box.y1-box.y0);
    if(kept.some(other=>Math.max(0,Math.min(box.x1,other.x1)-Math.max(box.x0,other.x0))*Math.max(0,Math.min(box.y1,other.y1)-Math.max(box.y0,other.y0))>0.5*area)) continue;
    kept.push(box);
  }
  return kept;
}
