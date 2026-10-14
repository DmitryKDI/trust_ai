import type { FurnitureItem } from '../model/types';
import { RESIZE_HANDLES, type ResizeHandle } from './furniture-interaction';

export function FurnitureHandles({ item, radius, onDown }: { item: FurnitureItem; radius: number; onDown: (e: React.PointerEvent<SVGRectElement>, handle: ResizeHandle) => void }) {
  return <g transform={`translate(${item.x} ${item.y}) rotate(${item.rot})`} data-furniture-handles={item.id}>
    <rect x={-item.w / 2} y={-item.d / 2} width={item.w} height={item.d} fill="none" stroke="#2f6f8f" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
    {RESIZE_HANDLES.map(h => <rect key={`${h.x}:${h.y}`} data-resize-handle={`${h.x},${h.y}`} x={h.x * item.w / 2 - radius} y={h.y * item.d / 2 - radius} width={radius * 2} height={radius * 2} fill="#fff" stroke="#2f6f8f" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: h.x && h.y ? (h.x === h.y) !== (item.rot === 90 || item.rot === 270) ? 'nwse-resize' : 'nesw-resize' : (h.x !== 0) !== (item.rot === 90 || item.rot === 270) ? 'ew-resize' : 'ns-resize' }} onPointerDown={e => onDown(e, h)} />)}
  </g>;
}
