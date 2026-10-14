import type { FurnitureType } from '../model/types';

export const MATERIAL_SLOTS = ['wall', 'floor', 'tile', 'wood', 'fabric', 'ceramic', 'metal', 'glass'] as const;
export type MaterialSlot = typeof MATERIAL_SLOTS[number];
export interface SceneMaterial {
  id: string;
  name: string;
  category: MaterialSlot;
  color: string;
  /** Локальная текстура PNG/JPEG/WebP, без обращения к внешним серверам. */
  textureDataUrl?: string;
  tileWidthMm?: number;
  tileHeightMm?: number;
  article?: string;
  price?: number;
  unit?: string;
}
export interface MaterialCatalog { version: 1; materials: SceneMaterial[] }
export interface SceneSettings {
  ceilingHeight: number;
  doorHeight: number;
  windowHeight: number;
  windowSill: number;
  fullWalls: boolean;
  showCeiling: boolean;
  heights: Partial<Record<FurnitureType, number>>;
  assignments: Partial<Record<MaterialSlot, string>>;
}
export const SLOT_NAMES: Record<MaterialSlot, string> = {
  wall: 'Стены', floor: 'Пол', tile: 'Пол мокрых зон', wood: 'Корпусная мебель',
  fabric: 'Мягкая мебель', ceramic: 'Сантехника', metal: 'Металл', glass: 'Окна',
};
export const BASE_COLORS: Record<MaterialSlot, string> = {
  wall: '#eee8df', floor: '#c9ad8e', tile: '#d7d9d7', wood: '#997758',
  fabric: '#b8aaa0', ceramic: '#f1f2ed', metal: '#566169', glass: '#b8dce5',
};
export const DEFAULT_HEIGHTS: Record<FurnitureType, number> = {
  'bed-double': 650, 'bed-single': 650, bedside: 500, wardrobe: 2400, dresser: 850,
  sofa: 850, armchair: 850, 'coffee-table': 450, 'tv-unit': 500, dining: 750, desk: 750,
  'kitchen-run': 900, fridge: 1900, bathtub: 600, shower: 2100, toilet: 750,
  washbasin: 850, washer: 850, 'shoe-cabinet': 1000, 'play-rug': 15, shelving: 2000,
};
export function sceneSettings(value?: Partial<SceneSettings>): SceneSettings {
  const size = (n: unknown, fallback: number, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  const heights: SceneSettings['heights'] = {};
  for (const type of Object.keys(DEFAULT_HEIGHTS) as FurnitureType[]) {
    const h = value?.heights?.[type];
    if (typeof h === 'number' && Number.isFinite(h) && h >= 10 && h <= 5000) heights[type] = h;
  }
  const ceilingHeight = size(value?.ceilingHeight, 2800, 2200, 6000);
  return {
    ceilingHeight, doorHeight: Math.min(size(value?.doorHeight, 2100, 1800, 4000), ceilingHeight),
    windowHeight: size(value?.windowHeight, 1400, 300, 4000), windowSill: size(value?.windowSill, 900, 0, 2500),
    fullWalls: value?.fullWalls === true, showCeiling: value?.showCeiling === true,
    heights, assignments: value?.assignments ?? {},
  };
}
