// Процедурная сцена: координаты плана остаются в мм. Y — вертикальная ось 3D.
// Детали предметов строятся внутри их существующего 2D-пятна, не меняя планировку.
import type { FurnitureItem, PlanGeometry, Pt } from '../model/types';
import { roomWallBand, usesRoomWalls, wallsGeom, openingRect, outlineGeom } from '../geometry/plan';
import { difference, fromRing, localToWorld, toGeom, union, type Geom } from '../geometry/poly';
import { DEFAULT_HEIGHTS, sceneSettings, type MaterialSlot, type SceneSettings } from './types';

export interface SceneNode { id: string; kind: 'floor' | 'wall' | 'opening' | 'furniture' | 'fixed' | 'ceiling'; geometry: Geom; base: number; height: number; material: MaterialSlot }
export interface SceneModel { nodes: SceneNode[]; bounds: { minX: number; minZ: number; maxX: number; maxZ: number }; ceilingHeight: number }
export function buildScene(g: PlanGeometry, items: FurnitureItem[], raw?: Partial<SceneSettings>): SceneModel {
  const s = sceneSettings(raw), nodes: SceneNode[] = [];
  const add = (id: string, kind: SceneNode['kind'], geometry: Geom, base: number, height: number, material: MaterialSlot) => {
    if (height > 0 && geometry.length) nodes.push({ id, kind, geometry, base, height, material });
  };
  for (const r of g.rooms) add(`floor:${r.id}`, 'floor', toGeom(r.polygon), -80, 80, r.type === 'bath' || r.type === 'wc' ? 'tile' : 'floor');
  const solid = union(usesRoomWalls(g) ? roomWallBand({ ...g, openings: [] }, 200) : [], wallsGeom(g, false));
  const cuts = union(...g.openings.map(o => toGeom(openingRect(o, usesRoomWalls(g) ? 800 : 4))));
  const wallTop = s.fullWalls ? s.ceilingHeight : Math.min(700, s.ceilingHeight);
  add('walls', 'wall', difference(solid, cuts), 0, wallTop, 'wall');
  for (const o of g.openings) {
    const opening = toGeom(openingRect(o, usesRoomWalls(g) ? 800 : 4));
    const footprint = difference(solid, difference(solid, opening));
    const sill = o.type === 'window' ? Math.min(o.sillHeight ?? s.windowSill, s.ceilingHeight - 300) : 0;
    const top = Math.min(s.ceilingHeight, o.type === 'window' ? sill + s.windowHeight : s.doorHeight);
    if (sill > 0) add(`sill:${o.id}`, 'wall', footprint, 0, Math.min(sill, wallTop), 'wall');
    if (top < wallTop) add(`lintel:${o.id}`, 'wall', footprint, top, wallTop - top, 'wall');
    // В обзорном разрезе стекло/полотно скрыто, чтобы не закрывать помещения.
    if (s.fullWalls) {
      const width = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
      const angle = Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x);
      const center = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
      const part = (x0: number, x1: number) => toGeom([{ x: x0, y: -18 }, { x: x1, y: -18 }, { x: x1, y: 18 }, { x: x0, y: 18 }].map(p => ({ x: center.x + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: center.y + p.x * Math.sin(angle) + p.y * Math.cos(angle) })));
      if (o.type === 'door' && o.leaves === 2) {
        add(`opening:${o.id}:a`, 'opening', part(-width / 2, -8), sill, top - sill, 'wood');
        add(`opening:${o.id}:b`, 'opening', part(8, width / 2), sill, top - sill, 'wood');
      } else add(`opening:${o.id}`, 'opening', part(-width / 2, width / 2), sill, top - sill, o.type === 'window' ? 'glass' : 'wood');
    }
  }
  for (const f of g.fixed) if (f.kind !== 'void') add(`fixed:${f.id}`, 'fixed', toGeom(f.polygon), 0, f.kind === 'radiator' ? 600 : s.ceilingHeight, f.kind === 'radiator' ? 'metal' : 'wall');
  for (const it of items) {
    if (![it.x, it.y, it.w, it.d, it.rot].every(Number.isFinite) || it.w <= 0 || it.d <= 0) continue;
    const h = Math.min(s.heights[it.type] ?? DEFAULT_HEIGHTS[it.type] ?? 800, s.ceilingHeight);
    let index = 0;
    const box = (x0: number, z0: number, x1: number, z1: number, base: number, height: number, material: MaterialSlot) => {
      const poly: Pt[] = [{ x: x0 * it.w, y: z0 * it.d }, { x: x1 * it.w, y: z0 * it.d }, { x: x1 * it.w, y: z1 * it.d }, { x: x0 * it.w, y: z1 * it.d }].map(p => localToWorld(p, it.x, it.y, it.rot));
      add(`item:${it.id}:${index++}`, 'furniture', toGeom(poly), base * h, height * h, material);
    };
    const legs = (top: number) => { for (const x of [-0.43, 0.37]) for (const z of [-0.43, 0.37]) box(x, z, x + .06, z + .06, 0, top, 'metal'); };
    switch (it.type) {
      case 'bed-double': case 'bed-single':
        box(-.5, -.5, .5, .5, 0, .4, 'wood'); box(-.48, -.45, .48, .48, .4, .3, 'fabric');
        box(-.5, -.5, .5, -.45, .4, .6, 'wood'); box(-.42, -.38, .42, -.2, .7, .12, 'ceramic'); break;
      case 'sofa': case 'armchair':
        box(-.5, -.5, .5, .5, 0, .3, 'wood'); box(-.4, -.36, .4, .48, .3, .25, 'fabric');
        box(-.5, -.5, .5, -.36, .3, .7, 'fabric'); box(-.5, -.36, -.4, .5, .3, .45, 'fabric'); box(.4, -.36, .5, .5, .3, .45, 'fabric'); break;
      case 'desk': case 'coffee-table': legs(.9); box(-.5, -.5, .5, .5, .9, .1, 'wood'); break;
      case 'dining': {
        // Пятно обеденной группы включает стулья; стол занимает центральную часть.
        for (const x of [-.43, .37]) for (const z of [-.17, .11]) box(x, z, x + .06, z + .06, 0, .9, 'metal');
        box(-.5, -.24, .5, .24, .9, .1, 'wood');
        const pairs = Math.max(1, Math.min(3, Math.ceil((it.seats ?? 4) / 2)));
        for (let n = 0; n < pairs; n++) for (const side of [-1, 1]) {
          const x = -.46 + n * .92 / pairs, end = x + .82 / pairs;
          box(x, side < 0 ? -.5 : .28, end, side < 0 ? -.28 : .5, .55, .08, 'fabric');
          box(x, side < 0 ? -.5 : .47, end, side < 0 ? -.47 : .5, .55, .45, 'wood');
        } break;
      }
      case 'bathtub':
        box(-.5, -.5, .5, -.36, 0, 1, 'ceramic'); box(-.5, .36, .5, .5, 0, 1, 'ceramic');
        box(-.5, -.36, -.4, .36, 0, 1, 'ceramic'); box(.4, -.36, .5, .36, 0, 1, 'ceramic'); box(-.4, -.36, .4, .36, 0, .25, 'ceramic'); break;
      case 'shower': box(-.5, -.5, .5, .5, 0, .06, 'ceramic'); box(-.5, -.5, .5, -.48, .06, .94, 'glass'); box(-.5, -.48, -.48, .5, .06, .94, 'glass'); break;
      case 'toilet': box(-.3, -.4, .3, .4, 0, .5, 'ceramic'); box(-.5, -.14, .5, .5, .5, .1, 'ceramic'); box(-.44, -.5, .44, -.2, .5, .5, 'ceramic'); break;
      case 'washbasin': box(-.5, -.5, .5, .5, 0, .85, 'wood'); box(-.5, -.5, .5, .5, .85, .15, 'ceramic'); break;
      case 'washer': box(-.5, -.5, .5, .5, 0, 1, 'ceramic'); box(-.32, .49, .32, .5, .22, .52, 'metal'); break;
      case 'kitchen-run': {
        box(-.5, -.5, .5, .5, 0, .96, 'wood'); box(-.5, -.5, .5, .5, .96, .04, 'ceramic');
        const total = it.modules?.reduce((sum, m) => sum + m.w, 0) || it.w;
        let pos = -.5;
        for (const m of it.modules ?? []) {
          const width = m.w / total;
          if (m.kind === 'sink' || m.kind === 'hob') box(pos + width * .12, -.32, pos + width * .88, .32, .995, .005, 'metal');
          pos += width;
        } break;
      }
      case 'shelving': {
        box(-.5, -.5, -.45, .5, 0, 1, 'wood'); box(.45, -.5, .5, .5, 0, 1, 'wood'); box(-.45, -.5, .45, -.45, 0, 1, 'wood');
        for (let n = 0; n < 5; n++) box(-.45, -.45, .45, .5, n * .24, .04, 'wood'); break;
      }
      default: box(-.5, -.5, .5, .5, 0, 1, it.type === 'play-rug' ? 'fabric' : it.type === 'fridge' ? 'ceramic' : 'wood');
    }
  }
  if (s.showCeiling) add('ceiling', 'ceiling', outlineGeom(g), s.ceilingHeight, 80, 'wall');
  const points = nodes.flatMap(n => n.geometry.flatMap(p => fromRing(p[0])));
  const bounds = points.length ? { minX: Math.min(...points.map(p => p.x)), minZ: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxZ: Math.max(...points.map(p => p.y)) } : { minX: 0, minZ: 0, maxX: 10000, maxZ: 7000 };
  return { nodes, bounds, ceilingHeight: s.ceilingHeight };
}
