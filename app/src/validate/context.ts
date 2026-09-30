// Предрасчёт статической части плана для быстрых проверок (кэшируется на версию геометрии).
import type { Opening, PlanGeometry, Pt, Room } from '../model/types';
import { doorSwingPolygon, geometryHash, interiorGeom, openingRect, wallsGeom } from '../geometry/plan';
import { add, bbox, centroid, difference, geomBBox, mul, norm, pointInGeom, segmentRect, toGeom, union, type BBox, type Geom } from '../geometry/poly';
import type { Rules } from '../rules/rules';

export interface PlanContext {
  g: PlanGeometry;
  hash: string;
  walls: Geom;
  interior: Geom;
  rooms: { room: Room; geom: Geom; bbox: BBox }[];
  doors: { o: Opening; rect: Pt[]; swing: Pt[] }[];
  windows: { o: Opening; rect: Pt[]; tallZone: Pt[] }[];
  fixed: { id: string; kind: string; poly: Pt[] }[];
  wet: Geom;
  risers: Pt[];
  entranceStart: Pt | null;
  bounds: BBox;
}

/** Зона перед окном со стороны помещения (глубина — windowTallClearance). */
function windowInnerZone(o: Opening, interior: Geom, depth: number): Pt[] {
  const n = norm({ x: o.b.y - o.a.y, y: -(o.b.x - o.a.x) });
  const mid = mul(add(o.a, o.b), 0.5);
  const probe = add(mid, mul(n, o.thickness / 2 + 100));
  const side = pointInGeom(probe, interior) ? 1 : -1;
  const off = mul(n, side * (o.thickness / 2));
  const deep = mul(n, side * (o.thickness / 2 + depth));
  return [add(o.a, off), add(o.b, off), add(o.b, deep), add(o.a, deep)];
}

function entranceStartPoint(g: PlanGeometry, interior: Geom): Pt | null {
  const e = g.openings.find((o) => o.type === 'door' && o.isEntrance);
  if (!e) return null;
  const mid = mul(add(e.a, e.b), 0.5);
  const n = norm({ x: e.b.y - e.a.y, y: -(e.b.x - e.a.x) });
  for (const k of [1, -1]) {
    const p = add(mid, mul(n, k * (e.thickness / 2 + 450)));
    if (pointInGeom(p, interior)) return p;
  }
  return null;
}

const cache = new WeakMap<PlanGeometry, Map<string, PlanContext>>();

export function planContext(g: PlanGeometry, rules: Rules): PlanContext {
  const key = `${rules.windowTallClearance}`;
  let m = cache.get(g);
  if (!m) cache.set(g, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;

  const interior = interiorGeom(g);
  // План без векторных стен (скан, картинка): стена — всё вокруг помещений, кроме дверных проёмов.
  const walls = g.walls.length ? wallsGeom(g) : wallsFromRooms(g, interior);
  const ctx: PlanContext = {
    g,
    hash: geometryHash(g),
    walls,
    interior,
    rooms: g.rooms.map((room) => {
      const geom = toGeom(room.polygon);
      return { room, geom, bbox: bbox(room.polygon) };
    }),
    doors: g.openings.filter((o) => o.type === 'door').map((o) => ({ o, rect: openingRect(o, 0), swing: doorSwingPolygon(o) })),
    windows: g.openings.filter((o) => o.type === 'window').map((o) => ({ o, rect: segmentRect(o.a, o.b, o.thickness), tallZone: windowInnerZone(o, interior, rules.windowTallClearance) })),
    fixed: g.fixed.filter((f) => f.kind !== 'void').map((f) => ({ id: f.id, kind: f.kind, poly: f.polygon })),
    wet: [
      ...g.wetZones.map((z) => toGeom(z.polygon)[0]),
      ...g.rooms.filter((r) => r.type === 'bath' || r.type === 'wc').map((r) => toGeom(r.polygon)[0]),
    ],
    risers: g.fixed.filter((f) => f.kind === 'riser').map((f) => centroid(f.polygon)),
    entranceStart: entranceStartPoint(g, interior),
    bounds: interior.length ? geomBBox(interior) : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
  m.set(key, ctx);
  return ctx;
}

export function roomOfPoint(ctx: PlanContext, p: Pt): Room | null {
  for (const r of ctx.rooms) if (pointInGeom(p, r.geom)) return r.room;
  return null;
}

function wallsFromRooms(g: PlanGeometry, interior: Geom): Geom {
  if (!interior.length) return [];
  const b = geomBBox(interior);
  const pad = 600;
  const frame = toGeom([{ x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.maxY + pad }, { x: b.minX - pad, y: b.maxY + pad }]);
  const doors = union(...g.openings.filter((o) => o.type === 'door').map((o) => toGeom(segmentRect(o.a, o.b, Math.max(o.thickness, 400)))));
  return difference(frame, interior, doors);
}
