// Собственные 2D-обозначения мебели (вид сверху) в локальных мм предмета:
// центр в (0,0), спинка на y = −d/2, фасад на y = +d/2.
import type { FurnitureItem } from '../model/types';
import { CATALOG } from './catalog';

export interface FurniturePalette { stroke: string; fill: string; light: string; dark: string }
export const DEFAULT_FURNITURE: FurniturePalette = { stroke: '#8a9492', fill: '#e4e8e6', light: '#f7f8f6', dark: '#b3bcb9' };

export function FurnitureSymbol({ it, pal = DEFAULT_FURNITURE }: { it: FurnitureItem; pal?: FurniturePalette }) {
  const c = CATALOG[it.type];
  // Рисунок из типового размера масштабируется вместе с габаритом. Малые
  // пользовательские размеры не дают отрицательных размеров внутренних деталей.
  const w = c.w;
  const modules = it.modules?.map(m => ({ ...m, w: m.w * c.w / it.w }));
  return <g transform={`scale(${it.w / w} ${it.d / c.d})`}>
    <FurnitureDrawing it={{ ...it, w, d: c.d, modules }} pal={pal} />
  </g>;
}

function FurnitureDrawing({ it, pal }: { it: FurnitureItem; pal: FurniturePalette }) {
  const S = pal.stroke, F = pal.fill, F2 = pal.light, D = pal.dark;
  const line = { stroke: S, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, fill: 'none' };
  const body = { stroke: S, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const, fill: F };
  const { w, d } = it;
  const x0 = -w / 2, y0 = -d / 2;
  switch (it.type) {
    case 'bed-double':
    case 'bed-single': {
      const double = it.type === 'bed-double';
      const pw = double ? (w - 180) / 2 : w - 160;
      return (
        <g>
          <rect x={x0} y={y0} width={w} height={100} rx={20} fill={D} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <rect x={x0 + 20} y={y0 + 90} width={w - 40} height={d - 100} rx={50} {...body} />
          <rect x={x0 + 70} y={y0 + 160} width={pw} height={330} rx={70} fill={F2} {...{ stroke: S, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} />
          {double && <rect x={x0 + 110 + pw} y={y0 + 160} width={pw} height={330} rx={70} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          <path d={`M${x0 + 20} ${y0 + 700} H${-x0 - 20}`} {...line} />
          <path d={`M${x0 + 20} ${y0 + 700} l120 90 M${-x0 - 20} ${y0 + 700} l-120 90`} {...line} />
        </g>
      );
    }
    case 'bedside':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={30} {...body} /><circle r={Math.min(w, d) * 0.22} fill={F2} {...{ stroke: S, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} /></g>;
    case 'wardrobe':
    case 'shelving': {
      const n = Math.max(1, Math.round(w / (it.type === 'wardrobe' ? 600 : 500)));
      return (
        <g>
          <rect x={x0} y={y0} width={w} height={d} {...body} />
          {Array.from({ length: n - 1 }, (_, i) => <path key={i} d={`M${x0 + ((i + 1) * w) / n} ${y0} V${-y0}`} {...line} />)}
          {it.type === 'wardrobe'
            ? <path d={`M${x0 + 30} ${y0 + d * 0.5} H${-x0 - 30}`} stroke={S} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            : Array.from({ length: n }, (_, i) => <path key={i} d={`M${x0 + (i * w) / n + 60} ${y0 + 60} l${w / n - 120} ${d - 120}`} {...line} />)}
        </g>
      );
    }
    case 'dresser':
    case 'shoe-cabinet':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={20} {...body} /><path d={`M${x0} ${y0 + d * 0.62} H${-x0}`} {...line} /><path d={`M${-80} ${y0 + d * 0.8} h160`} stroke={S} strokeWidth={2} vectorEffect="non-scaling-stroke" /></g>;
    case 'sofa':
    case 'armchair': {
      const arm = it.type === 'sofa' ? 180 : 150, back = 220;
      const seats = it.type === 'sofa' ? Math.max(2, Math.round((w - 2 * arm) / 800)) : 1;
      const sw = (w - 2 * arm) / seats;
      return (
        <g>
          <rect x={x0} y={y0} width={w} height={d} rx={90} {...body} />
          <rect x={x0 + arm} y={y0 + 20} width={w - 2 * arm} height={back} rx={60} fill={D} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {Array.from({ length: seats }, (_, i) => <rect key={i} x={x0 + arm + i * sw + 15} y={y0 + back + 30} width={sw - 30} height={d - back - 70} rx={60} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        </g>
      );
    }
    case 'coffee-table':
      return <rect x={x0} y={y0} width={w} height={d} rx={Math.min(w, d) / 2} {...body} />;
    case 'tv-unit':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={15} {...body} /><rect x={-w * 0.35} y={y0 + 40} width={w * 0.7} height={60} fill="#56646a" /></g>;
    case 'dining': {
      const td = Math.max(600, d - 900);
      const seats = it.seats ?? 4;
      const per = Math.max(1, Math.round(seats / 2));
      const cw = 420;
      const chairs = [];
      for (let side of [-1, 1])
        for (let i = 0; i < per; i++) {
          const cx = x0 + ((i + 0.5) * w) / per;
          chairs.push(<rect key={`${side}${i}`} x={cx - cw / 2} y={side < 0 ? y0 + 20 : -y0 - 20 - 400} width={cw} height={400} rx={90} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
        }
      return <g>{chairs}<rect x={x0} y={-td / 2} width={w} height={td} rx={40} {...body} /></g>;
    }
    case 'desk':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={20} {...body} /><rect x={-230} y={y0 + 60} width={460} height={40} fill={D} /><circle cy={-y0 + 230} r={230} fill={F2} stroke={S} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" /></g>;
    case 'kitchen-run': {
      const mods = it.modules ?? [{ kind: 'base' as const, w }];
      let x = x0;
      const parts = mods.map((m, i) => {
        const cx = x + m.w / 2;
        const el = (
          <g key={i}>
            {i > 0 && <path d={`M${x} ${y0} V${-y0}`} {...line} />}
            {m.kind === 'sink' && <><rect x={cx - m.w / 2 + 70} y={y0 + 90} width={m.w - 140} height={d - 200} rx={60} fill={F2} {...{ stroke: S, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} /><circle cx={cx} cy={y0 + 60} r={25} fill={S} /></>}
            {m.kind === 'hob' && [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], k) => <circle key={k} cx={cx + a * m.w * 0.22} cy={b * d * 0.2} r={m.w * 0.15} fill="none" stroke="#56646a" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {m.kind === 'dishwasher' && <path d={`M${cx - m.w / 2 + 60} ${-y0 - 60} h${m.w - 120}`} stroke={S} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </g>
        );
        x += m.w;
        return el;
      });
      return <g><rect x={x0} y={y0} width={w} height={d} {...body} />{parts}</g>;
    }
    case 'fridge':
      return <g><rect x={x0} y={y0} width={w} height={d} {...body} /><path d={`M${x0} ${-y0 - 60} H${-x0}`} {...line} /><path d={`M${x0 + 60} ${y0 + 60} L${-x0 - 60} ${-y0 - 120} M${-x0 - 60} ${y0 + 60} L${x0 + 60} ${-y0 - 120}`} stroke={S} strokeWidth={0.6} vectorEffect="non-scaling-stroke" /></g>;
    case 'bathtub':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={60} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /><rect x={x0 + 70} y={y0 + 70} width={w - 140} height={d - 140} rx={Math.min(250, d / 2 - 70)} fill="#edf2f3" stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /><circle cx={x0 + 200} cy={0} r={30} fill={S} /></g>;
    case 'shower':
      return <g><rect x={x0} y={y0} width={w} height={d} fill="#edf2f3" stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /><path d={`M${x0} ${y0} L${-x0} ${-y0} M${-x0} ${y0} L${x0} ${-y0}`} stroke={D} strokeWidth={0.6} vectorEffect="non-scaling-stroke" /><circle r={40} fill={S} /></g>;
    case 'toilet':
      return <g><rect x={x0} y={y0} width={w} height={180} rx={30} {...body} /><ellipse cy={y0 + 180 + (d - 180) / 2} rx={w / 2 - 10} ry={(d - 180) / 2} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /></g>;
    case 'washbasin':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={40} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /><ellipse cy={30} rx={w / 2 - 80} ry={d / 2 - 90} fill="#edf2f3" stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /></g>;
    case 'washer':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={30} {...body} /><circle cy={30} r={Math.min(w, d) * 0.33} fill={F2} stroke={S} strokeWidth={1} vectorEffect="non-scaling-stroke" /></g>;
    case 'play-rug':
      return <g><rect x={x0} y={y0} width={w} height={d} rx={Math.min(w, d) / 2} fill="#eeeee6" stroke="#b9c0b6" strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" /><circle cx={-w * 0.18} cy={-d * 0.1} r={90} fill="#cfdcdd" /><circle cx={w * 0.2} cy={d * 0.15} r={70} fill="#dcdfd2" /></g>;
    default:
      return <rect x={x0} y={y0} width={w} height={d} {...body} />;
  }
}
