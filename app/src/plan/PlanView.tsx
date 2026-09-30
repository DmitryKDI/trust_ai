// SVG-чертёж плана в мм: стены, проёмы, помещения, инженерные элементы и мебель.
import { forwardRef, useMemo, type PointerEvent as RPE, type ReactNode } from 'react';
import type { FurnitureItem, Issue, PlanGeometry, PlanStyle, Pt } from '../model/types';
import { doorSwingPolygon, roomArea, roomWallBand, wallPolygon, wallsGeom } from '../geometry/plan';
import { bbox, labelPoint, type BBox, type Geom } from '../geometry/poly';
import { FurnitureSymbol, type FurniturePalette } from '../furniture/Symbol';

export interface PlanPalette { wall: string; floor: string; sheet: string; text: string; furniture: FurniturePalette }
export const PALETTES: Record<PlanStyle, PlanPalette> = {
  graphite: { wall: '#434b4e', floor: '#ffffff', sheet: '#fbfbf9', text: '#5b676b', furniture: { stroke: '#8a9492', fill: '#e4e8e6', light: '#f7f8f6', dark: '#b3bcb9' } },
  warm: { wall: '#5a3d31', floor: '#fffaf3', sheet: '#f6efe6', text: '#6b4f41', furniture: { stroke: '#9c7f6a', fill: '#eadfd2', light: '#fbf6ef', dark: '#c9b39f' } },
  blueprint: { wall: '#1f4e79', floor: '#f4f9fd', sheet: '#e8f1f9', text: '#1f4e79', furniture: { stroke: '#3b6e99', fill: '#dbe8f4', light: '#f5f9fd', dark: '#a9c4dd' } },
  original: { wall: '#434b4e', floor: '#ffffff', sheet: '#ffffff', text: '#5b676b', furniture: { stroke: '#8a9492', fill: '#e4e8e6', light: '#f7f8f6', dark: '#b3bcb9' } },
};
export const STYLE_NAMES: Record<PlanStyle, string> = { graphite: 'Графит', warm: 'Тёплый', blueprint: 'Чертёж', original: 'Оригинал БТИ' };

export type PlanMode = 'editor' | 'variant' | 'thumb' | 'client';

export interface Underlay { url: string; widthMm: number; heightMm: number; opacity: number }

export interface PlanViewProps {
  g: PlanGeometry;
  items?: FurnitureItem[];
  issues?: Issue[];
  mode: PlanMode;
  underlay?: Underlay | null;
  selectedId?: string | null;
  viewBox?: BBox | null;
  onItemPointerDown?: (e: RPE<SVGGElement>, it: FurnitureItem) => void;
  onElementClick?: (kind: 'wall' | 'opening' | 'fixed' | 'room' | 'wet', id: string) => void;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
  svgProps?: React.SVGProps<SVGSVGElement>;
  /** Исходная картинка плана (скан, фото) — показывается как есть, мебель поверх. */
  wallImage?: { url: string; widthMm: number; heightMm: number } | null;
  planStyle?: PlanStyle;
}

export function geomPath(g: Geom): string {
  return g.map((poly) => poly.map((ring) => 'M' + ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z').join('')).join('');
}
export const polyPath = (p: Pt[]) => 'M' + p.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('L') + 'Z';

export function planBounds(g: PlanGeometry, pad = 600): BBox {
  const pts: Pt[] = [...g.walls.flatMap((w) => wallPolygon(w)), ...g.rooms.flatMap((r) => r.polygon)];
  if (!pts.length) return { minX: 0, minY: 0, maxX: 10000, maxY: 7000 };
  const b = bbox(pts);
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

const WALL_COLORS = { bearing: '#3d4649', partition: '#7d878a', unknown: '#56606a' };

export const PlanView = forwardRef<SVGSVGElement, PlanViewProps>(function PlanView(p, ref) {
  const { g, items = [], issues = [], mode, underlay, selectedId } = p;
  const vb = p.viewBox ?? planBounds(g);
  const walls = useMemo(() => wallsGeom(g), [g]);
  const errIds = new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.itemIds));
  const warnIds = new Set(issues.filter((i) => i.severity === 'warning').flatMap((i) => i.itemIds));
  const editor = mode === 'editor';
  const fs = Math.max(120, (vb.maxX - vb.minX) / 90);
  const wetRooms = g.rooms.filter((r) => r.type === 'bath' || r.type === 'wc');
  const pal = PALETTES[p.planStyle ?? 'graphite'];
  // Исходный план БТИ (картинка) показывается как есть — поверх только мебель.
  const orig = !!p.wallImage && !editor && p.planStyle === 'original';
  // План без векторных стен (скан): аккуратные стены — ровная полоса вокруг найденных помещений.
  const band = useMemo(() => (!editor && !g.walls.length && g.rooms.length ? roomWallBand(g, 200) : null), [g, editor]);

  return (
    <svg
      ref={ref}
      className={`plan-svg ${p.className ?? ''}`}
      viewBox={`${vb.minX} ${vb.minY} ${vb.maxX - vb.minX} ${vb.maxY - vb.minY}`}
      role="img"
      aria-label={p.ariaLabel ?? 'План квартиры'}
      preserveAspectRatio="xMidYMid meet"
      {...p.svgProps}
    >
      <defs>
        <pattern id="tile" width="200" height="200" patternUnits="userSpaceOnUse"><rect width="200" height="200" fill="#eef3f4" /><path d="M0 0H200M0 0V200" stroke="#d5e0e2" strokeWidth="6" /></pattern>
        <pattern id="hatch" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V120" stroke="#c9cfcf" strokeWidth="14" /></pattern>
      </defs>
      <rect x={vb.minX} y={vb.minY} width={vb.maxX - vb.minX} height={vb.maxY - vb.minY} fill={editor ? '#f4f4f1' : pal.sheet} />
      {orig && <image href={p.wallImage!.url} x={0} y={0} width={p.wallImage!.widthMm} height={p.wallImage!.heightMm} preserveAspectRatio="none" />}
      {underlay && <image href={underlay.url} x={0} y={0} width={underlay.widthMm} height={underlay.heightMm} opacity={underlay.opacity} preserveAspectRatio="none" />}

      {/* Помещения */}
      {g.rooms.map((r) => (
        <path key={r.id} d={polyPath(r.polygon)} fill={orig ? 'none' : r.type === 'balcony' ? '#f1f2ee' : editor ? 'rgba(255,255,255,.55)' : pal.floor}
          stroke={editor ? (r.verifiedByManager ? '#9fb0a6' : '#c9a36b') : 'none'} strokeWidth={1} strokeDasharray={editor && !r.verifiedByManager ? '6 4' : undefined} vectorEffect="non-scaling-stroke"
          onClick={() => p.onElementClick?.('room', r.id)} />
      ))}
      {!orig && wetRooms.map((r) => <path key={'wet' + r.id} d={polyPath(r.polygon)} fill="url(#tile)" opacity={editor ? 0.6 : 1} pointerEvents="none" />)}
      {g.wetZones.map((z) => <path key={z.id} d={polyPath(z.polygon)} fill="url(#tile)" stroke="#9fb7bd" strokeWidth={1} vectorEffect="non-scaling-stroke" onClick={() => p.onElementClick?.('wet', z.id)} />)}
      {!orig && g.fixed.map((f) => (
        <path key={f.id} d={polyPath(f.polygon)} onClick={() => p.onElementClick?.('fixed', f.id)}
          fill={f.kind === 'void' ? 'url(#hatch)' : f.kind === 'radiator' ? '#dfeaec' : f.kind === 'riser' ? '#f3d9c4' : '#d9dedc'}
          stroke={f.kind === 'riser' ? '#c8773f' : f.kind === 'radiator' ? '#7fa3a8' : '#8a9492'} strokeWidth={1} vectorEffect="non-scaling-stroke"
          strokeDasharray={editor && !f.verifiedByManager ? '5 4' : undefined} opacity={mode === 'client' && f.kind === 'void' ? 0.6 : 1} />
      ))}

      {/* Стены */}
      {editor
        ? g.walls.map((w) => (
            <path key={w.id} d={polyPath(wallPolygon(w))} fill={WALL_COLORS[w.kind]} fillOpacity={underlay ? 0.55 : 0.9}
              stroke={w.id === selectedId ? '#d2691e' : w.verifiedByManager ? '#2f3739' : '#c9a36b'} strokeWidth={w.id === selectedId ? 2.5 : 1}
              strokeDasharray={w.verifiedByManager ? undefined : '6 4'} vectorEffect="non-scaling-stroke" onClick={() => p.onElementClick?.('wall', w.id)} />
          ))
        : !orig && <path d={geomPath(band ?? walls)} fill={pal.wall} fillRule="evenodd" />}

      {/* Проёмы */}
      {!orig && g.openings.map((o) => {
        const sel = o.id === selectedId;
        if (o.type === 'window') {
          const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1;
          const nx = (dy / l) * o.thickness * 0.18, ny = (-dx / l) * o.thickness * 0.18;
          return (
            <g key={o.id} onClick={() => p.onElementClick?.('opening', o.id)}>
              <path d={polyPath([{ x: o.a.x + nx * 2.7, y: o.a.y + ny * 2.7 }, { x: o.b.x + nx * 2.7, y: o.b.y + ny * 2.7 }, { x: o.b.x - nx * 2.7, y: o.b.y - ny * 2.7 }, { x: o.a.x - nx * 2.7, y: o.a.y - ny * 2.7 }])} fill="#ffffff" stroke={sel ? '#d2691e' : '#8fb3bf'} strokeWidth={sel ? 2.5 : 1} vectorEffect="non-scaling-stroke" />
              <path d={`M${o.a.x + nx} ${o.a.y + ny}L${o.b.x + nx} ${o.b.y + ny}M${o.a.x - nx} ${o.a.y - ny}L${o.b.x - nx} ${o.b.y - ny}`} stroke="#8fb3bf" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
          );
        }
        const sw = doorSwingPolygon(o);
        const hinge = sw[0], open = sw[sw.length - 1];
        const arc = sw.slice(1);
        return (
          <g key={o.id} onClick={() => p.onElementClick?.('opening', o.id)}>
            <path d={polyPath(segmentRectLocal(o.a, o.b, o.thickness))} fill={editor ? 'rgba(255,255,255,.9)' : '#ffffff'} stroke={sel ? '#d2691e' : 'none'} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            <path d={'M' + arc.map((q) => `${q.x} ${q.y}`).join('L')} fill="none" stroke="#98a4a7" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            <path d={`M${hinge.x} ${hinge.y}L${open.x} ${open.y}`} stroke={o.isEntrance ? '#6b4a3a' : '#6f7b7e'} strokeWidth={o.isEntrance ? 2.2 : 1.5} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}

      {/* Подписи помещений */}
      {mode !== 'thumb' && !orig && g.rooms.map((r) => {
        const c = labelPoint(r.polygon);
        return (
          <g key={'l' + r.id} pointerEvents="none" fontFamily="Manrope, Arial, sans-serif" textAnchor="middle">
            <text x={c.x} y={c.y} fontSize={fs} fontWeight={700} fill={pal.text} letterSpacing={fs * 0.04}>{r.name.toUpperCase()}</text>
            <text x={c.x} y={c.y + fs * 1.25} fontSize={fs * 0.85} fill="#7e898c">{(roomArea(r.polygon) / 1e6).toFixed(1).replace('.', ',')} м²</text>
          </g>
        );
      })}

      {/* Мебель */}
      {items.map((it) => {
        const err = errIds.has(it.id), warn = warnIds.has(it.id), sel = it.id === selectedId;
        return (
          <g key={it.id} transform={`translate(${it.x} ${it.y}) rotate(${it.rot})`} className={p.onItemPointerDown ? 'item-drag' : undefined}
            onPointerDown={p.onItemPointerDown ? (e) => p.onItemPointerDown!(e, it) : undefined}>
            <FurnitureSymbol it={it} pal={pal.furniture} />
            {(err || warn || sel) && mode !== 'client' && (
              <rect x={-it.w / 2 - 25} y={-it.d / 2 - 25} width={it.w + 50} height={it.d + 50} rx={40} fill={err ? 'rgba(192,57,43,.08)' : 'none'}
                stroke={err ? '#c0392b' : sel ? '#2f6f8f' : '#d39b2a'} strokeWidth={sel ? 2.4 : 1.8} strokeDasharray={sel && !err ? undefined : '6 4'} vectorEffect="non-scaling-stroke" />
            )}
          </g>
        );
      })}
      {p.children}
    </svg>
  );
});

function segmentRectLocal(a: Pt, b: Pt, t: number): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const nx = (dy / l) * (t / 2 + 4), ny = (-dx / l) * (t / 2 + 4);
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
}

/** Масштабная линейка 1 м (для клиентского листа). */
export function ScaleBar({ vb }: { vb: BBox }) {
  const x = vb.maxX - 1600, y = vb.maxY - 250;
  return (
    <g fontFamily="Manrope, Arial, sans-serif" fontSize={110} fill="#7e898c">
      <path d={`M${x} ${y - 60}V${y}H${x + 1000}V${y - 60}`} fill="none" stroke="#7e898c" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <text x={x} y={y - 90}>0</text>
      <text x={x + 1000} y={y - 90} textAnchor="end">1 м</text>
    </g>
  );
}
