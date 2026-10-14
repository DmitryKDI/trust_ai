import type { Concept } from '../model/types';
import { MATERIAL_SLOTS, type MaterialCatalog, type MaterialSlot, type SceneMaterial, type SceneSettings } from './types';

export function sceneMaterials(catalog: MaterialCatalog, settings: SceneSettings, palette?: Concept['palette']) {
  const out: Partial<Record<MaterialSlot, SceneMaterial>> = {};
  const colors: Partial<Record<MaterialSlot, string | undefined>> = { wall: palette?.[0]?.hex, floor: palette?.[1]?.hex, tile: palette?.[1]?.hex, wood: palette?.[2]?.hex, fabric: palette?.[3]?.hex };
  for (const slot of MATERIAL_SLOTS) {
    const assigned = catalog.materials.find(m => m.id === settings.assignments[slot] && m.category === slot);
    const color = colors[slot];
    if (assigned) out[slot] = assigned;
    else if (color && /^#[0-9a-f]{6}$/i.test(color)) out[slot] = { id: `palette-${slot}`, name: 'Палитра концепции', category: slot, color };
  }
  return out;
}
