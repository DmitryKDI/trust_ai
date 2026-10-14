import { describe, expect, it } from 'vitest';
import { clientLabelPoint } from '../src/plan/clientLabel';
import { overlapArea } from '../src/geometry/poly';
import { rect } from './fixtures/synthetic';

describe('client plan labels', () => {
  it('keeps the central point when it is free', () => {
    expect(clientLabelPoint(rect(0, 0, 4000, 4000), [], 1500, 200)).toEqual({ x: 2000, y: 2000 });
  });
  it('moves the whole label away from furniture, inside the room', () => {
    const room = rect(0, 0, 4000, 4000), sofa = rect(1000, 1500, 3000, 2500);
    const p = clientLabelPoint(room, [sofa], 1500, 200);
    const box = rect(p.x - 750, p.y - 200, p.x + 750, p.y + 260);
    expect(overlapArea(box, sofa)).toBe(0); expect(overlapArea(box, room)).toBeCloseTo(1500 * 460);
  });
});
