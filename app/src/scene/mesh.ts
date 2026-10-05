import type { SceneNode } from './build';
type V3 = [number, number, number];

/** Трапеции между уровнями вершин: чётность пересечений учитывает отверстия
 * и вогнутые контуры. В отличие от веера треугольников не заливает проёмы. */
export function capTriangles(geometry: SceneNode['geometry']): [number, number][][] {
  const result: [number, number][][] = [];
  for (const polygon of geometry) {
    const levels = [...new Set(polygon.flatMap(r => r.map(p => p[1])))].sort((a, b) => a - b);
    const edges = polygon.flatMap(ring => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })).filter(e => e.a[1] !== e.b[1]));
    for (let i = 0; i < levels.length - 1; i++) {
      const lo = levels[i], hi = levels[i + 1], mid = (lo + hi) / 2;
      const xAt = (e: typeof edges[number], y: number) => e.a[0] + (y - e.a[1]) * (e.b[0] - e.a[0]) / (e.b[1] - e.a[1]);
      const crossing = edges.filter(e => Math.min(e.a[1], e.b[1]) < mid && Math.max(e.a[1], e.b[1]) > mid).sort((a, b) => xAt(a, mid) - xAt(b, mid));
      for (let j = 0; j + 1 < crossing.length; j += 2) {
        const a: [number, number] = [xAt(crossing[j], lo), lo], b: [number, number] = [xAt(crossing[j + 1], lo), lo];
        const c: [number, number] = [xAt(crossing[j + 1], hi), hi], d: [number, number] = [xAt(crossing[j], hi), hi];
        result.push([a, b, c], [a, c, d]);
      }
    }
  }
  return result;
}

/** Интерливинг position.xyz, normal.xyz, textureUV.xy; единицы GPU — метры. */
export function nodeVertices(node: SceneNode): number[] {
  const out: number[] = [];
  const emit = (vertices: V3[], normal: V3, side = false) => {
    for (const v of vertices) out.push(v[0] / 1000, v[1] / 1000, v[2] / 1000, ...normal, (side && Math.abs(normal[0]) > .5 ? v[2] : v[0]) / 1000, (side ? v[1] : v[2]) / 1000);
  };
  for (const t of capTriangles(node.geometry)) {
    emit(t.map(p => [p[0], node.base + node.height, p[1]] as V3), [0, 1, 0]);
    emit(t.map(p => [p[0], node.base, p[1]] as V3), [0, -1, 0]);
  }
  for (const polygon of node.geometry) for (const ring of polygon) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (!len) continue;
    const a: V3 = [p[0], node.base, p[1]], b: V3 = [q[0], node.base, q[1]], c: V3 = [q[0], node.base + node.height, q[1]], d: V3 = [p[0], node.base + node.height, p[1]];
    emit([a, b, c, a, c, d], [-dz / len, 0, dx / len], true);
  }
  return out;
}
