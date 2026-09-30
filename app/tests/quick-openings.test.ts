// Проёмы на растровых планах БТИ: дверь — разрыв в стене, перечёркнутый тонкой чертой.
// Картинки рисуются здесь же (не клиентские данные).
import { describe, expect, it } from 'vitest';
import { quickPlan } from '../src/quick';

type RGB = [number, number, number];

/** Квартира 9×6 м (90 px/м): гостиная слева, спальня справа сверху, прихожая справа снизу. */
function drawPlan(wall: RGB, outline: boolean) {
  const S = 90, W = 1100, H = 800, X = 100, Y = 120;
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) d.set([...c, 255], (y * W + x) * 4);
  };
  const ink: RGB = [40, 40, 40], paper: RGB = [255, 255, 255];
  const px = (m: number) => m * S;
  // Стена от (x0,y0) до (x1,y1) в метрах, толщина t м; контур — тонкие линии по граням.
  const wallRect = (x0: number, y0: number, x1: number, y1: number, t: number) => {
    const r = [X + px(Math.min(x0, x1)) - px(t) / 2, Y + px(Math.min(y0, y1)) - px(t) / 2, X + px(Math.max(x0, x1)) + px(t) / 2, Y + px(Math.max(y0, y1)) + px(t) / 2];
    fill(r[0], r[1], r[2], r[3], wall);
    if (outline) { fill(r[0], r[1], r[2], r[1] + 1, ink); fill(r[0], r[3] - 1, r[2], r[3], ink); fill(r[0], r[1], r[0] + 1, r[3], ink); fill(r[2] - 1, r[1], r[2], r[3], ink); }
  };
  // Дверь: проём в стене, по граням продолжаются тонкие линии, посередине — черта поперёк.
  const door = (x: number, y: number, horiz: boolean, len: number, t: number) => {
    const a = horiz ? [X + px(x), Y + px(y) - px(t) / 2 + 1, X + px(x + len), Y + px(y) + px(t) / 2 - 1] : [X + px(x) - px(t) / 2 + 1, Y + px(y), X + px(x) + px(t) / 2 - 1, Y + px(y + len)];
    fill(a[0], a[1], a[2], a[3], paper);
    if (horiz) { fill(a[0], a[1], a[2], a[1] + 1, ink); fill(a[0], a[3] - 1, a[2], a[3], ink); fill((a[0] + a[2]) / 2, a[1], (a[0] + a[2]) / 2 + 1, a[3], ink); }
    else { fill(a[0], a[1], a[0] + 1, a[3], ink); fill(a[2] - 1, a[1], a[2], a[3], ink); fill(a[0], (a[1] + a[3]) / 2, a[2], (a[1] + a[3]) / 2 + 1, ink); }
  };
  wallRect(0, 0, 9, 0, 0.4); wallRect(9, 0, 9, 6, 0.4); wallRect(9, 6, 0, 6, 0.4); wallRect(0, 6, 0, 0, 0.4);
  wallRect(4.5, 0, 4.5, 6, 0.15); wallRect(4.5, 3, 9, 3, 0.15);
  door(4.5, 4.2, false, 0.9, 0.15); // прихожая → гостиная
  door(6, 3, true, 0.9, 0.15);      // прихожая → спальня
  door(7.5, 6, true, 0.9, 0.4);     // вход
  return { rgba: d, w: W, h: H };
}

const run = (img: { rgba: Uint8ClampedArray; w: number; h: number }) =>
  quickPlan({ rgba: img.rgba, w: img.w, h: img.h, pxPerUnit: 1, areaM2: 50, children: 0, page: 1 });

describe('быстрый режим: проёмы, перечёркнутые тонкой чертой', () => {
  it('техплан с розовыми стенами: двери между комнатами и вход', () => {
    const r = run(drawPlan([250, 195, 195], true));
    expect(r.geometry.rooms.length).toBe(3);
    const doors = r.geometry.openings.filter((o) => o.type === 'door');
    expect(doors.filter((o) => !o.isEntrance).length).toBeGreaterThanOrEqual(2);
    expect(r.report.entrance).toBe(true);
  });
  it('чёрные стены: черта в проёме не делает его стеной', () => {
    const r = run(drawPlan([30, 30, 30], false));
    expect(r.geometry.rooms.length).toBe(3);
    expect(r.geometry.openings.filter((o) => o.type === 'door' && !o.isEntrance).length).toBeGreaterThanOrEqual(2);
  });
});
