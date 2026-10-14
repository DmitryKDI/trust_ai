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
  it('старый план: стены двойными линиями, двери — чёрточки поперёк стены', () => {
    // 9×6 м, 60 px/м; стены — две линии по 2 px, проёмов нет, дверь — поперечная чёрточка.
    const S = 60, W = 760, H = 560, X = 110, Y = 100;
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) d.set([30, 30, 30, 255], (y * W + x) * 4);
    };
    const wall = (x0: number, y0: number, x1: number, y1: number, t: number) => {
      const hz = y0 === y1, T = (t * S) / 2;
      const [a, b] = [Math.min(x0, x1) * S + X, Math.max(x0, x1) * S + X], [c, e] = [Math.min(y0, y1) * S + Y, Math.max(y0, y1) * S + Y];
      if (hz) { fill(a - T, c - T, b + T, c - T + 2); fill(a - T, c + T - 2, b + T, c + T); }
      else { fill(a - T, c - T, a - T + 2, e + T); fill(a + T - 2, c - T, a + T, e + T); }
    };
    const tick = (x: number, y: number, hz: boolean) => {
      const cx = x * S + X, cy = y * S + Y, r = 0.2 * S;
      if (hz) fill(cx - 1, cy - r, cx + 1, cy + r); else fill(cx - r, cy - 1, cx + r, cy + 1);
    };
    wall(0, 0, 9, 0, 0.4); wall(9, 0, 9, 6, 0.4); wall(0, 6, 9, 6, 0.4); wall(0, 0, 0, 6, 0.4);
    wall(4.5, 0, 4.5, 6, 0.15); wall(4.5, 3, 9, 3, 0.15);
    tick(4.5, 4.6, false); // прихожая → гостиная
    tick(6.5, 3, true);    // прихожая → спальня
    const r = run({ rgba: d, w: W, h: H });
    expect(r.geometry.rooms.length).toBe(3);
    expect(r.geometry.openings.filter((o) => o.type === 'door' && !o.isEntrance).length).toBeGreaterThanOrEqual(2);
  });
});
