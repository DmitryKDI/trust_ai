import type { PlanGeometry, Pt } from '../model/types';
import { dist, projectOnSegment } from '../geometry/poly';

type Segment = [Pt, Pt];
type Options = { anchor?: Pt | null; ortho?: boolean; preferWallAxes?: boolean; excludePoint?: Pt };

/** All geometry participates, including suggested/unverified recognition results. */
export function snapGeometryPoint(raw: Pt, g: PlanGeometry, radius: number, options: Options = {}) {
  const { anchor, ortho, excludePoint } = options;
  const horizontal = !!anchor && Math.abs(raw.x - anchor.x) >= Math.abs(raw.y - anchor.y);
  const constrained = !!anchor && !!ortho;
  const target = constrained ? horizontal ? { x: raw.x, y: anchor!.y } : { x: anchor!.x, y: raw.y } : raw;
  const aligned = (p: Pt) => !constrained || Math.abs(horizontal ? p.y - anchor!.y : p.x - anchor!.x) < 1e-6;
  const eligible = (segment: Segment) => !excludePoint || segment.every(p => dist(p, excludePoint) >= 1);
  const wallAxes = g.walls.map(w => [w.a, w.b] as Segment).filter(eligible);
  const polygons = [...g.rooms, ...g.fixed, ...g.wetZones];
  const boundaries = [...wallAxes, ...g.openings.map(o => [o.a, o.b] as Segment),
    ...polygons.flatMap(item => item.polygon.map((p, i) => [p, item.polygon[(i + 1) % item.polygon.length]] as Segment))].filter(eligible);
  const nearest = (segments: Segment[]) => {
    const vertices = segments.flat().filter(p => aligned(p) && dist(p, target) <= radius).sort((a, b) => dist(a, target) - dist(b, target));
    if (vertices[0]) return vertices[0];
    const candidates = segments.flatMap(([a, b]) => {
      if (!constrained) return [projectOnSegment(target, a, b).point];
      const delta = horizontal ? b.y - a.y : b.x - a.x;
      if (Math.abs(delta) < 1e-6) return aligned(a) ? [projectOnSegment(target, a, b).point] : [];
      const t = (horizontal ? anchor!.y - a.y : anchor!.x - a.x) / delta;
      return t >= 0 && t <= 1 ? [{ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }] : [];
    }).filter(p => dist(p, target) <= radius).sort((a, b) => dist(a, target) - dist(b, target));
    return candidates[0];
  };
  const hit = (options.preferWallAxes ? nearest(wallAxes) : undefined) ?? nearest(boundaries);
  return hit ? { p: { ...hit }, kind: 'geometry' as const } : { p: target, kind: constrained ? 'ortho' as const : 'none' as const };
}
