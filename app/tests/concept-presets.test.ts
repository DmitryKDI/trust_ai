import { expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { applyStyle, alternatePalette, CLIENT_GOALS, randomStyleIndex, STYLE_PRESETS } from '../src/concept/presets';
import { sceneMaterials } from '../src/scene/materials';
import { sceneSettings } from '../src/scene/types';
import { layoutSignature } from '../src/layout/variants';

it('ready styles fill material choices and explanations for client needs', () => {
  const c = newProject({ alias: '', city: '', manager: '', date: '' }).concept;
  c.clientGoals = ['care', 'budget']; const next = applyStyle(c, 2);
  expect(next.materials.length).toBeGreaterThanOrEqual(3); expect(next.rationale).toContain(CLIENT_GOALS[2].text); expect(next.rationale).toContain(CLIENT_GOALS[4].text);
  for (const p of STYLE_PRESETS) { expect(p.palette).toHaveLength(4); expect(p.palette.every(s => /^#[0-9a-f]{6}$/.test(s.hex))).toBe(true); }
});
it('random style differs, palette adjusts all channels together and keeps the style', () => {
  const c = applyStyle(newProject({ alias: '', city: '', manager: '', date: '' }).concept, 1);
  expect(randomStyleIndex(c.styleName, () => 0)).not.toBe(1);
  const p = alternatePalette(c, () => .7); expect(p).not.toEqual(c.palette);
  for (let i = 0; i < 4; i++) for (const channel of [1, 3, 5]) expect(parseInt(p[i].hex.slice(channel, channel + 2), 16) - parseInt(c.palette[i].hex.slice(channel, channel + 2), 16)).toBe(10);
  expect(alternatePalette({ ...c, palette: p }, () => .7)).toEqual(c.palette);
});
it('3D uses concept colors; explicit catalog choices take precedence', () => {
  const c = applyStyle(newProject({ alias: '', city: '', manager: '', date: '' }).concept, 4), settings = sceneSettings();
  const material = { id: 'floor', name: 'Пол заказчика', category: 'floor' as const, color: '#123456' }; settings.assignments.floor = 'floor';
  const resolved = sceneMaterials({ version: 1, materials: [material] }, settings, c.palette);
  expect(resolved.floor).toBe(material); expect(resolved.wall?.color).toBe(c.palette[0].hex); expect(resolved.fabric?.color).toBe(c.palette[3].hex);
});
it('layout equality ignores regenerated IDs and array ordering', () => {
  const item = { id: 'old', type: 'sofa' as const, x: 1000, y: 2000, rot: 0 as const, w: 2000, d: 800, roomId: 'r', ruleId: null, movedByManager: false };
  expect(layoutSignature([item])).toBe(layoutSignature([{ ...item, id: 'new' }])); expect(layoutSignature([item])).not.toBe(layoutSignature([{ ...item, x: 1500 }]));
});
