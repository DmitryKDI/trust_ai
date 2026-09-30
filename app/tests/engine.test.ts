import { describe, expect, it } from 'vitest';
import { runEngine } from '../src/layout/engine';
import { sinkCenter } from '../src/furniture/catalog';
import { resolveRules } from '../src/rules/rules';
import { validate } from '../src/validate/validator';
import { brief, rect, room, twoRoom } from './fixtures/synthetic';

const rules = resolveRules();

describe('движок расстановки', () => {
  for (const scenario of ['space', 'storage', 'family'] as const) {
    it(`сценарий «${scenario}»: без ошибок валидатора`, () => {
      const g = twoRoom();
      const r = runEngine({ g, brief, rules, scenario });
      const v = validate(g, r.items, rules, brief);
      const errors = v.issues.filter((i) => i.severity === 'error');
      expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);
      expect(r.items.some((i) => i.type === 'bed-double')).toBe(true);
      expect(r.items.some((i) => i.type === 'kitchen-run')).toBe(true);
      expect(r.items.some((i) => i.type === 'sofa')).toBe(true);
      expect(r.incomplete).toBe(false);
    });
  }

  it('кухня тянется к стояку', () => {
    const g = twoRoom(); // стояк в левом нижнем углу кухни-гостиной
    const r = runEngine({ g, brief, rules, scenario: 'space' });
    const k = r.items.find((i) => i.type === 'kitchen-run')!;
    const s = sinkCenter(k)!;
    expect(Math.hypot(s.x - 260, s.y - 6740)).toBeLessThan(1500);
  });

  it('кровать изголовьем к глухой стене (не под окном)', () => {
    const g = twoRoom();
    const r = runEngine({ g, brief, rules, scenario: 'family' });
    const bed = r.items.find((i) => i.type === 'bed-double')!;
    // окно спальни — на верхней стене; изголовье к верхней стене = rot 0
    expect(bed.rot).not.toBe(0);
  });

  it('невозможное требование: объясняет причину, а не рисует', () => {
    const g = twoRoom();
    // Крошечная спальня 1,5 × 1,5 м — двуспальная кровать не встанет.
    g.rooms[1] = room('Спальня', 'bedroom', rect(5050, 150, 6550, 1650));
    const r = runEngine({ g, brief, rules, scenario: 'space' });
    expect(r.incomplete).toBe(true);
    expect(r.skipped.find((s) => s.type === 'bed-double')?.reason).toMatch(/не удалось разместить/);
  });

  it('шаблоны не привязаны к координатам: зеркальная квартира тоже решается', () => {
    const g = twoRoom();
    const W = 10000;
    const flip = <T extends { x: number; y: number }>(p: T) => ({ ...p, x: W - p.x });
    g.walls = g.walls.map((w) => ({ ...w, a: flip(w.a), b: flip(w.b) }));
    g.openings = g.openings.map((o) => ({ ...o, a: flip(o.a), b: flip(o.b), swing: (-o.swing) as 1 | -1 }));
    g.rooms = g.rooms.map((r) => ({ ...r, polygon: r.polygon.map(flip).reverse() }));
    g.fixed = g.fixed.map((f) => ({ ...f, polygon: f.polygon.map(flip).reverse() }));
    const r = runEngine({ g, brief, rules, scenario: 'storage' });
    const errors = validate(g, r.items, rules, brief).issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    expect(r.incomplete).toBe(false);
  });
});
