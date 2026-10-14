import type { PlanGeometry, Provenance } from '../model/types';
import { doorSwingPolygons, wallPolygon } from '../geometry/plan';
import { polyPath } from './PlanView';

export type MarkSource = 'automatic' | 'verified' | 'manual';
export const MARK_COLORS: Record<MarkSource, string> = { automatic: '#2469b0', verified: '#2e7c54', manual: '#b86b2c' };
export function markSource(item: Provenance): MarkSource {
  return item.source === 'manual' ? 'manual' : item.verifiedByManager ? 'verified' : 'automatic';
}
/** Highlights actual geometry returned by recognition; never invents missing objects. */
export function RecognitionOverlay({ geometry: g }: { geometry: PlanGeometry }) {
  const polygon = (item: Provenance & { id: string }, kind: string, points: Parameters<typeof polyPath>[0], fill: boolean) => {
    const source = markSource(item), color = MARK_COLORS[source];
    return <path key={`${kind}-${item.id}`} data-recognition-id={item.id} data-recognition-kind={kind} data-recognition-source={source}
      d={polyPath(points)} fill={fill ? color : 'none'} fillOpacity={kind === 'room' ? 0.05 : 0.18} stroke={color} strokeWidth={kind === 'room' ? 2 : 2.5}
      strokeDasharray={source === 'automatic' ? '5 3' : undefined} vectorEffect="non-scaling-stroke" />;
  };
  return <g data-recognition-overlay="true" pointerEvents="none" aria-hidden="true">
    {g.rooms.map(r => polygon(r, 'room', r.polygon, true))}
    {g.wetZones.map(z => polygon(z, 'wet', z.polygon, false))}
    {g.fixed.map(f => polygon(f, 'fixed', f.polygon, true))}
    {g.walls.map(w => polygon(w, 'wall', wallPolygon(w), true))}
    {g.openings.map(o => { const source = markSource(o); return <g key={o.id} data-recognition-id={o.id} data-recognition-kind={o.type} data-recognition-source={source} stroke={MARK_COLORS[source]} fill="none">
      <path d={`M${o.a.x} ${o.a.y}L${o.b.x} ${o.b.y}`} strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {o.type === 'door' && doorSwingPolygons(o).map((s, i) => <path key={i} d={`M${s.slice(1).map(p => `${p.x} ${p.y}`).join('L')}`} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />)}
    </g>; })}
  </g>;
}

export function RecognitionLegend({ geometry: g }: { geometry: PlanGeometry }) {
  const rows = [
    ['Стены', g.walls], ['Двери', g.openings.filter(o => o.type === 'door')], ['Окна', g.openings.filter(o => o.type === 'window')],
    ['Зоны / комнаты', g.rooms], ['Мокрые зоны', g.wetZones], ['Инженерные элементы', g.fixed],
  ] as const;
  return <div style={{ marginTop: 12 }}>
    <div className="counts" aria-label="Легенда распознавания">{([['automatic', 'Найдено программой · проверьте'], ['verified', 'Найдено и проверено'], ['manual', 'Добавлено / исправлено вручную']] as const).map(([source, label]) => <span key={source} className="badge" style={{ color: MARK_COLORS[source], border: `1px solid ${MARK_COLORS[source]}` }}>{label}</span>)}</div>
    <details style={{ marginTop: 10 }}><summary>Что нанесено на план</summary>
      <table className="rules" aria-label="Найденные и ручные элементы"><thead><tr><th>Элемент</th><th>Найдено</th><th>Проверено</th><th>Вручную</th></tr></thead><tbody>{rows.map(([label, values]) => <tr key={label}><td>{label}</td>{(['automatic', 'verified', 'manual'] as const).map(source => <td key={source}>{values.filter(v => markSource(v) === source).length}</td>)}</tr>)}</tbody></table>
    </details>
  </div>;
}
