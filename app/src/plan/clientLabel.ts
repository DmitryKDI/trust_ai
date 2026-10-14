import type { Pt } from '../model/types';
import { bbox, labelPoint, overlapArea } from '../geometry/poly';

/** Place the complete label rectangle inside the room and away from furniture. */
export function clientLabelPoint(polygon: Pt[], obstacles: Pt[][], width: number, height: number): Pt {
  const initial = labelPoint(polygon), b = bbox(polygon);
  const candidates = [initial];
  for (let y = 1; y <= 7; y++) for (let x = 1; x <= 7; x++) candidates.push({ x: b.minX + (b.maxX - b.minX) * x / 8, y: b.minY + (b.maxY - b.minY) * y / 8 });
  candidates.sort((a, b) => Math.hypot(a.x - initial.x, a.y - initial.y) - Math.hypot(b.x - initial.x, b.y - initial.y));
  return candidates.find(p => {
    const r = [{ x: p.x - width / 2, y: p.y - height }, { x: p.x + width / 2, y: p.y - height }, { x: p.x + width / 2, y: p.y + height * 1.3 }, { x: p.x - width / 2, y: p.y + height * 1.3 }];
    const area = width * height * 2.3;
    return overlapArea(r, polygon) >= area - 1 && !obstacles.some(o => overlapArea(r, o) > 1);
  }) ?? initial;
}
