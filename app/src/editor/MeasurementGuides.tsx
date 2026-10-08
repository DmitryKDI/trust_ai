import type { Measurement } from './measurements';
export function MeasurementGuides({ measurements, unit }: { measurements: Measurement[]; unit: number }) {
  return <g pointerEvents="none" aria-hidden="true">{measurements.map(m => <g key={m.id} data-measurement={m.id} data-mm={m.mm}>
    <path d={`M${m.a.x} ${m.a.y}L${m.b.x} ${m.b.y}`} stroke={m.kind === 'wall' ? '#91643f' : '#2f6f8f'} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
    <text x={(m.a.x + m.b.x) / 2} y={(m.a.y + m.b.y) / 2 - 4 * unit} textAnchor="middle" fontSize={11 * unit} fill="#523c2e" stroke="#fff" strokeWidth={3 * unit} paintOrder="stroke">{m.mm} мм</text>
  </g>)}</g>;
}
