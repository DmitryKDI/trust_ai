import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/scene/build';
import { capTriangles, nodeVertices } from '../src/scene/mesh';
import { DEFAULT_HEIGHTS, sceneSettings } from '../src/scene/types';
import { parseMaterialCatalog } from '../src/scene/catalog';
import { emptyGeometry, defaultConcept } from '../src/model/defaults';
import { footprint } from '../src/furniture/catalog';
import { bbox, pointInGeom, toGeom } from '../src/geometry/poly';
import type { FurnitureItem, FurnitureType, Opening } from '../src/model/types';

const room = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
const meta = { source: 'manual' as const, verifiedByManager: true, sourcePage: null };
const furniture = (type: FurnitureType, rot: FurnitureItem['rot'] = 90): FurnitureItem => ({ id: 'f', type, x: 2500, y: 2100, w: 1700, d: 700, rot, roomId: null, ruleId: null, movedByManager: true });
const opening: Opening = { id: 'd', ...meta, type: 'door', a: { x: 2000, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200, hinge: 'a', swing: 1, isEntrance: false, sillHeight: null };

describe('Процедурная 3D-сцена', () => {
  it('все предметы помещаются в повернутое пятно из редактора; размеры и центр сохраняются', () => {
    for (const type of Object.keys(DEFAULT_HEIGHTS) as FurnitureType[]) for (const rot of [0, 90, 180, 270] as const) {
      const item = furniture(type, rot), expected = bbox(footprint(item));
      const nodes = buildScene(emptyGeometry(), [item]).nodes;
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        for (const poly of node.geometry) for (const ring of poly) for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(expected.minX - .001); expect(x).toBeLessThanOrEqual(expected.maxX + .001);
          expect(y).toBeGreaterThanOrEqual(expected.minY - .001); expect(y).toBeLessThanOrEqual(expected.maxY + .001);
        }
        expect(nodeVertices(node).every(Number.isFinite)).toBe(true);
      }
    }
    const tub = buildScene(emptyGeometry(), [furniture('bathtub')], { heights: { bathtub: 550 } }).nodes;
    expect(Math.max(...tub.map(n => n.base + n.height))).toBe(550);
  });
  it('дверь прорезает стену до 2100 мм, перемычка остаётся; окно сохраняет подоконник', () => {
    const g = emptyGeometry(); g.walls = [{ id: 'w', ...meta, a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200, kind: 'partition' }];
    g.openings = [opening, { ...opening, id: 'win', type: 'window', a: { x: 4000, y: 0 }, b: { x: 5000, y: 0 }, sillHeight: 1000 }];
    const model = buildScene(g, [], { fullWalls: true, ceilingHeight: 2800 });
    const walls = model.nodes.filter(n => n.kind === 'wall');
    expect(walls.some(n => n.base <= 500 && n.base + n.height > 500 && pointInGeom({ x: 2500, y: 0 }, n.geometry))).toBe(false);
    expect(walls.some(n => n.base === 2100 && pointInGeom({ x: 2500, y: 0 }, n.geometry))).toBe(true);
    expect(model.nodes.find(n => n.id === 'sill:win')?.height).toBe(1000);
    expect(model.nodes.find(n => n.id === 'lintel:win')?.base).toBe(2400);
  });
  it('строит стены скана из комнат и сохраняет ручные перегородки', () => {
    const g = emptyGeometry(); g.wallMode = 'rooms'; g.rooms = [{ id: 'r', ...meta, name: 'Комната', type: 'living', polygon: room }];
    g.walls = [{ id: 'w', ...meta, a: { x: 3000, y: 1000 }, b: { x: 3000, y: 3000 }, thickness: 150, kind: 'partition' }];
    const walls = buildScene(g, []).nodes.find(n => n.id === 'walls')!;
    expect(pointInGeom({ x: -100, y: 2000 }, walls.geometry)).toBe(true);
    expect(pointInGeom({ x: 3000, y: 2000 }, walls.geometry)).toBe(true);
    expect(pointInGeom({ x: 1000, y: 2000 }, walls.geometry)).toBe(false);
  });
  it('кап-геометрия не заливает внутренние отверстия и вогнутые участки', () => {
    const area = (tri: number[][]) => Math.abs((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1])) / 2;
    expect(capTriangles([[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]]]).reduce((s, t) => s + area(t), 0)).toBe(84);
    const concave = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 }];
    expect(capTriangles(toGeom(concave)).reduce((s, t) => s + area(t), 0)).toBe(51);
  });
  it('старые проекты получают настройки без обязательной миграции; не создаются стоковые фото', () => {
    expect(sceneSettings()).toMatchObject({ ceilingHeight: 2800, doorHeight: 2100, fullWalls: false });
    expect(sceneSettings({ ceilingHeight: NaN, heights: { sofa: -5 } }).heights.sofa).toBeUndefined();
    expect(defaultConcept().references).toEqual([]);
  });
});

describe('Каталог материалов', () => {
  it('импортирует локальную текстуру и справочные данные', () => {
    const m = { id: 'oak', name: 'Дуб', category: 'floor', color: '#c9ad8e', article: '123', price: 2500, unit: 'м²', tileWidthMm: 1200, textureDataUrl: 'data:image/png;base64,YQ==' };
    expect(parseMaterialCatalog(JSON.stringify({ version: 1, materials: [m] })).materials[0]).toEqual(m);
    expect(parseMaterialCatalog('{"version":1,"materials":[]}').materials).toEqual([]);
  });
  it('отклоняет повреждённую базу и внешние URL текстур до изменения проекта', () => {
    const m = { id: 'oak', name: 'Дуб', category: 'floor', color: '#c9ad8e' };
    for (const data of [{ version: 2, materials: [] }, { version: 1, materials: [m, m] }, { version: 1, materials: [{ ...m, textureDataUrl: 'https://site.test/texture.jpg' }] }, { version: 1, materials: [{ ...m, tileWidthMm: 0 }] }]) expect(() => parseMaterialCatalog(JSON.stringify(data))).toThrow();
  });
});
