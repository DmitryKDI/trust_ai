// Быстрая правка плана: разрезать, объединить, дверь по щелчку, помещение по картинке.
import { describe, expect, it } from 'vitest';
import { doorAt, mergeRooms, roomFromCorners, roomFromImage, splitRoom } from '../src/editor/quickfix';
import { emptyGeometry } from '../src/model/defaults';
import { polyArea } from '../src/geometry/poly';
import type { Room } from '../src/model/types';

const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id: string, poly: { x: number; y: number }[]): Room => ({ id, name: 'Помещение', type: 'other', polygon: poly, source: 'suggested', verifiedByManager: false, sourcePage: 1 });

describe('быстрая правка', () => {
  it('разрезать помещение линией', () => {
    const r = room('r1', rect(0, 0, 6000, 4000));
    const parts = splitRoom(r, { x: 3000, y: -500 }, { x: 3000, y: 4500 })!;
    expect(parts).not.toBeNull();
    expect(polyArea(parts[0].polygon) / 1e6).toBeCloseTo(12, 1);
    expect(polyArea(parts[1].polygon) / 1e6).toBeCloseTo(12, 1);
    expect(parts[0].id).toBe('r1');
    expect(parts[1].id).not.toBe('r1');
    // Линия мимо помещения — не режет.
    expect(splitRoom(r, { x: 9000, y: 0 }, { x: 9000, y: 4000 })).toBeNull();
  });

  it('объединить две части через стену', () => {
    const a = room('a', rect(0, 0, 3000, 4000)), b = room('b', rect(3200, 0, 6000, 4000));
    const m = mergeRooms(a, b)!;
    expect(polyArea(m.polygon) / 1e6).toBeCloseTo(24, 0);
    // Далеко друг от друга — не объединяются.
    expect(mergeRooms(a, room('c', rect(5000, 0, 8000, 4000)))).toBeNull();
  });

  it('дверь по щелчку на стене между помещениями и вход снаружи', () => {
    const g = { ...emptyGeometry(), rooms: [room('a', rect(0, 0, 3000, 4000)), room('b', rect(3200, 0, 6000, 4000))] };
    const d = doorAt(g, { x: 3100, y: 2000 })!;
    expect(d.type).toBe('door');
    expect(d.isEntrance).toBe(false);
    expect(Math.abs(d.a.x - d.b.x)).toBeLessThan(5); // дверь в вертикальной стене
    expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)).toBeCloseTo(800, 0);
    const e = doorAt(g, { x: 1500, y: 4150 })!;
    expect(e.isEntrance).toBe(true);
    expect(Math.abs(e.a.y - e.b.y)).toBeLessThan(5);
    expect(doorAt(g, { x: 20000, y: 20000 })).toBeNull();
  });

  it('помещение по щелчку на картинке: не утекает через дверной проём', () => {
    // 50 px/м: две комнаты 4×4 м и 3×4 м, стена 0,2 м с проёмом 0,9 м, надпись внутри.
    const S = 50, W = 600, H = 320, d = new Uint8ClampedArray(W * H * 4).fill(255);
    const ink = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([20, 20, 20, 255], (y * W + x) * 4); };
    ink(40, 40, 40 + 7.4 * S, 50); ink(40, 50 + 4 * S, 40 + 7.4 * S, 60 + 4 * S); // верх, низ
    ink(40, 40, 50, 60 + 4 * S); ink(30 + 7.4 * S, 40, 40 + 7.4 * S, 60 + 4 * S); // лево, право
    ink(50 + 4 * S, 40, 60 + 4 * S, 60 + 4 * S); // перегородка
    for (let y = 120; y < 120 + 0.9 * S; y++) for (let x = 50 + 4 * S; x < 60 + 4 * S; x++) d.set([255, 255, 255, 255], (y * W + x) * 4); // проём
    ink(120, 140, 160, 150); ink(130, 130, 140, 165); // «цифра» внутри первой комнаты
    const poly = roomFromImage({ data: d, width: W, height: H }, { x: 100, y: 100 }, 1000 / S)!;
    expect(poly).not.toBeNull();
    expect(polyArea(poly) / 1e6).toBeGreaterThan(14);
    expect(polyArea(poly) / 1e6).toBeLessThan(18);
    // Щелчок снаружи плана — заливка утекает на весь лист.
    expect(roomFromImage({ data: d, width: W, height: H }, { x: 10, y: 10 }, 1000 / S)).toBeNull();
  });
  it('помещение по двум углам без наложения на соседей', () => {
    const rooms = [room('a', rect(0, 0, 3000, 4000))];
    const p = roomFromCorners({ x: 2500, y: 0 }, { x: 5000, y: 2000 }, rooms)!;
    expect(polyArea(p) / 1e6).toBeCloseTo(4, 1); // 2,5×2 м минус перекрытие 0,5×2 м
    expect(roomFromCorners({ x: 100, y: 100 }, { x: 900, y: 900 }, rooms)).toBeNull();
  });
});
