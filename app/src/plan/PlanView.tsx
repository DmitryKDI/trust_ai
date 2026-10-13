// SVG-чертёж плана в мм: стены, проёмы, помещения, инженерные элементы и мебель.
import { forwardRef, useId, useMemo, type PointerEvent as RPE, type ReactNode } from 'react';
import type { FurnitureItem, Issue, PlanGeometry, PlanStyle, Pt } from '../model/types';
import { doorSwingPolygons, roomArea, roomWallBand, usesRoomWalls, wallPolygon, wallsGeom } from '../geometry/plan';
import { bbox, labelPoint, union, type BBox, type Geom } from '../geometry/poly';
import { FurnitureSymbol, type FurniturePalette } from '../furniture/Symbol';
import { footprint } from '../furniture/catalog';
import { clientLabelPoint } from './clientLabel';

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
  selectedIds?: readonly string[];
  viewBox?: BBox | null;
  onItemPointerDown?: (e: RPE<SVGGElement>, it: FurnitureItem) => void;
  onElementClick?: (kind: 'wall' | 'opening' | 'fixed' | 'room' | 'wet', id: string, event: React.MouseEvent<SVGElement>) => void;
  children?: ReactNode;
  className?: string;
  /** Множитель размера подписей помещений (быстрая правка на телефоне — крупнее). */
  labelScale?: number;
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
  const selected = new Set([...(p.selectedIds ?? []), ...(selectedId ? [selectedId] : [])]);
  const unknownPatternId = 'wallUnknown' + useId().replace(/:/g, '');
  const vb = p.viewBox ?? planBounds(g);
  const walls = useMemo(() => wallsGeom(g), [g]);
  const errIds = new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.itemIds));
  const warnIds = new Set(issues.filter((i) => i.severity === 'warning').flatMap((i) => i.itemIds));
  const editor = mode === 'editor';
  // Font sizes use plan units, not the changing camera box: zoom moves text and
  // geometry together instead of keeping labels large while the plan shrinks.
  const labelBounds = useMemo(() => planBounds(g), [g]);
  const fs = Math.max(120, (labelBounds.maxX - labelBounds.minX) / 90) * (p.labelScale ?? 1);
  const wetRooms = g.rooms.filter((r) => r.type === 'bath' || r.type === 'wc');
  const pal = PALETTES[p.planStyle ?? 'graphite'];
  // Исходный план БТИ (картинка) показывается как есть — поверх только мебель.
  const orig = !!p.wallImage && !editor && p.planStyle === 'original';
  // План без векторных стен (скан): аккуратные стены — ровная полоса вокруг найденных помещений.
  const band = useMemo(() => (!editor && usesRoomWalls(g) ? roomWallBand(g, 200) : null), [g, editor]);
  const displayedWalls = useMemo(() => union(band ?? [], walls), [band, walls]);
  const typedWalls = useMemo(() => g.walls.map(w => ({ wall: w, geom: wallsGeom({ ...g, walls: [w] }) })), [g]);

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
        <pattern id={unknownPatternId} width="100" height="100" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="100" height="100" fill={pal.sheet} /><path d="M0 0V100" stroke={pal.wall} strokeWidth="35" /></pattern>
      </defs>
      <rect x={vb.minX} y={vb.minY} width={vb.maxX - vb.minX} height={vb.maxY - vb.minY} fill={editor ? '#f4f4f1' : pal.sheet} />
      {orig && <image href={p.wallImage!.url} x={0} y={0} width={p.wallImage!.widthMm} height={p.wallImage!.heightMm} preserveAspectRatio="none" />}
      {underlay && <image href={underlay.url} x={0} y={0} width={underlay.widthMm} height={underlay.heightMm} opacity={underlay.opacity} preserveAspectRatio="none" />}

      {/* Помещения */}
      {g.rooms.map((r) => (
        <path key={r.id} data-room-id={r.id} data-selected={selected.has(r.id)} d={polyPath(r.polygon)} fill={orig ? 'none' : r.type === 'balcony' ? '#f1f2ee' : editor ? 'rgba(255,255,255,.55)' : pal.floor}
          stroke={selected.has(r.id) ? '#d2691e' : editor ? (r.verifiedByManager ? '#9fb0a6' : '#c9a36b') : 'none'} strokeWidth={selected.has(r.id) ? 3 : 1} strokeDasharray={editor && !r.verifiedByManager ? '6 4' : undefined} vectorEffect="non-scaling-stroke"
          pointerEvents={orig && p.onElementClick ? 'all' : undefined} onClick={e => p.onElementClick?.('room', r.id, e)} />
      ))}
      {!orig && wetRooms.map((r) => <path key={'wet' + r.id} d={polyPath(r.polygon)} fill="url(#tile)" opacity={editor ? 0.6 : 1} pointerEvents="none" />)}
      {g.wetZones.map((z) => <path key={z.id} data-wet-id={z.id} data-selected={selected.has(z.id)} d={polyPath(z.polygon)} fill="url(#tile)" stroke={selected.has(z.id) ? '#d2691e' : '#9fb7bd'} strokeWidth={selected.has(z.id) ? 3 : 1} vectorEffect="non-scaling-stroke" onClick={e => p.onElementClick?.('wet', z.id, e)} />)}
      {(!orig || !!p.onElementClick) && g.fixed.map((f) => (
        <path key={f.id} data-fixed-id={f.id} data-selected={selected.has(f.id)} d={polyPath(f.polygon)} onClick={e => p.onElementClick?.('fixed', f.id, e)}
          fill={orig ? 'transparent' : f.kind === 'void' ? 'url(#hatch)' : f.kind === 'radiator' ? '#dfeaec' : f.kind === 'riser' ? '#f3d9c4' : '#d9dedc'}
          stroke={selected.has(f.id) ? '#d2691e' : orig ? 'none' : f.kind === 'riser' ? '#c8773f' : f.kind === 'radiator' ? '#7fa3a8' : '#8a9492'} strokeWidth={selected.has(f.id) ? 3 : 1} vectorEffect="non-scaling-stroke"
          strokeDasharray={editor && !f.verifiedByManager ? '5 4' : undefined} opacity={mode === 'client' && f.kind === 'void' ? 0.6 : 1} />
      ))}

      {/* Стены */}
      {editor
        ? g.walls.map((w) => (
            <path key={w.id} data-wall-id={w.id} data-wall-kind={w.kind} data-selected={selected.has(w.id)} d={polyPath(wallPolygon(w))} fill={w.kind === 'unknown' ? `url(#${unknownPatternId})` : WALL_COLORS[w.kind]} fillOpacity={underlay ? 0.55 : 0.9}
              stroke={selected.has(w.id) ? '#d2691e' : w.verifiedByManager ? '#2f3739' : '#c9a36b'} strokeWidth={selected.has(w.id) ? 2.5 : 1}
              strokeDasharray={w.verifiedByManager ? undefined : '6 4'} vectorEffect="non-scaling-stroke" onClick={e => p.onElementClick?.('wall', w.id, e)} />
          ))
        : !orig && <path data-layer="wall-base" data-room-walls={!!band} d={geomPath(displayedWalls)} fill={pal.wall} fillRule="evenodd" />}
      {!editor && typedWalls.filter(({ wall }) => !orig || wall.source === 'manual' || !!p.onElementClick).map(({ wall: w, geom }) => <path key={'typed' + w.id}
        data-wall-id={w.id} data-wall-kind={w.kind} data-selected={selected.has(w.id)} d={geomPath(geom)} fill={orig && w.source !== 'manual' ? 'transparent' : w.kind === 'unknown' ? `url(#${unknownPatternId})` : w.kind === 'partition' ? pal.text : pal.wall}
        fillRule="evenodd" stroke={selected.has(w.id) ? '#d2691e' : pal.wall} strokeWidth={selected.has(w.id) ? 3 : 0.6} vectorEffect="non-scaling-stroke" onClick={e => p.onElementClick?.('wall', w.id, e)} />)}

      {/* Проёмы */}
      {!orig && g.openings.map((o) => {
        const sel = selected.has(o.id);
        if (o.type === 'window') {
          const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y, l = Math.hypot(dx, dy) || 1;
          const nx = (dy / l) * o.thickness * 0.18, ny = (-dx / l) * o.thickness * 0.18;
          return (
            <g key={o.id} data-opening-id={o.id} data-selected={sel} onClick={e => p.onElementClick?.('opening', o.id, e)}>
              <path d={polyPath([{ x: o.a.x + nx * 2.7, y: o.a.y + ny * 2.7 }, { x: o.b.x + nx * 2.7, y: o.b.y + ny * 2.7 }, { x: o.b.x - nx * 2.7, y: o.b.y - ny * 2.7 }, { x: o.a.x - nx * 2.7, y: o.a.y - ny * 2.7 }])} fill="#ffffff" stroke={sel ? '#d2691e' : '#8fb3bf'} strokeWidth={sel ? 2.5 : 1} vectorEffect="non-scaling-stroke" />
              <path d={`M${o.a.x + nx} ${o.a.y + ny}L${o.b.x + nx} ${o.b.y + ny}M${o.a.x - nx} ${o.a.y - ny}L${o.b.x - nx} ${o.b.y - ny}`} stroke="#8fb3bf" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
          );
        }
        const swings = doorSwingPolygons(o);
        return (
          <g key={o.id} data-opening-id={o.id} data-door-leaves={o.leaves ?? 1} data-selected={sel} onClick={e => p.onElementClick?.('opening', o.id, e)}>
            <path d={polyPath(segmentRectLocal(o.a, o.b, o.thickness))} fill={editor ? 'rgba(255,255,255,.9)' : '#ffffff'} stroke={sel ? '#d2691e' : 'none'} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            {swings.map((sw, i) => <g key={i} data-door-leaf={i + 1}>
              <path d={'M' + sw.slice(1).map(q => `${q.x} ${q.y}`).join('L')} fill="none" stroke="#98a4a7" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              <path d={`M${sw[0].x} ${sw[0].y}L${sw[sw.length - 1].x} ${sw[sw.length - 1].y}`} stroke={o.isEntrance ? '#6b4a3a' : '#6f7b7e'} strokeWidth={o.isEntrance ? 2.2 : 1.5} vectorEffect="non-scaling-stroke" />
            </g>)}
          </g>
        );
      })}

      {orig && p.onElementClick && g.openings.map(o => <path key={o.id} data-opening-id={o.id} data-selected={selected.has(o.id)} d={polyPath(segmentRectLocal(o.a, o.b, o.thickness))} fill="transparent" stroke={selected.has(o.id) ? '#d2691e' : 'none'} strokeWidth={3} vectorEffect="non-scaling-stroke" onClick={e => p.onElementClick?.('opening', o.id, e)} />)}

      {/* Подписи помещений */}
      {mode !== 'thumb' && !orig && g.rooms.map((r) => {
        const bounds = bbox(r.polygon);
        const roomFont = Math.min(fs, Math.max(30, (bounds.maxX - bounds.minX) * .78 / Math.max(1, Array.from(r.name).length * .68)), Math.max(30, (bounds.maxY - bounds.minY) / 4));
        const c = mode === 'client' ? clientLabelPoint(r.polygon, [...items.map(footprint), ...g.fixed.map(f => f.polygon)], roomFont * Math.max(Array.from(r.name).length * .72, 7), roomFont) : labelPoint(r.polygon);
        return (
          <g key={'l' + r.id} data-room-label={r.id} pointerEvents="none" fontFamily="Manrope, Arial, sans-serif" textAnchor="middle">
            <text x={c.x} y={c.y} fontSize={roomFont} fontWeight={700} fill={pal.text} letterSpacing={roomFont * 0.04}>{r.name.toUpperCase()}</text>
            <text x={c.x} y={c.y + roomFont * 1.25} fontSize={roomFont * 0.85} fill="#7e898c">{(roomArea(r.polygon) / 1e6).toFixed(1).replace('.', ',')} м²</text>
          </g>
        );
      })}

      {/* Мебель */}
      {items.map((it) => {
        const err = errIds.has(it.id), warn = warnIds.has(it.id), sel = selected.has(it.id);
        return (
          <g key={it.id} data-item-id={it.id} data-item-type={it.type} data-selected={sel} transform={`translate(${it.x} ${it.y}) rotate(${it.rot})`} className={p.onItemPointerDown ? 'item-drag' : undefined}
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
