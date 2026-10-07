// Проходимость по сетке: занятость → евклидово расстояние до препятствия → BFS от входа.
import type { Pt } from '../model/types';
import { bbox, geomBBox, pointInGeom, pointInPolygon, type BBox, type Geom } from '../geometry/poly';

export class Grid {
  readonly nx: number;
  readonly ny: number;
  readonly blocked: Uint8Array;
  constructor(readonly b: BBox, readonly step: number) {
    if (!Number.isFinite(step) || step <= 0 || !Object.values(b).every(Number.isFinite) || b.maxX < b.minX || b.maxY < b.minY) throw new Error('Некорректный масштаб сетки проверки.');
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / step));
    this.ny = Math.max(1, Math.ceil((b.maxY - b.minY) / step));
    if (this.nx * this.ny > 4000000) throw new Error('План слишком большой для проверки. Проверьте масштаб или увеличьте шаг сетки.');
    this.blocked = new Uint8Array(this.nx * this.ny).fill(1);
  }
  center(i: number, j: number): Pt {
    return { x: this.b.minX + (i + 0.5) * this.step, y: this.b.minY + (j + 0.5) * this.step };
  }
  cellOf(p: Pt): [number, number] {
    return [Math.floor((p.x - this.b.minX) / this.step), Math.floor((p.y - this.b.minY) / this.step)];
  }
  inside(i: number, j: number) {
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny;
  }
  /** Растеризация полигона по центрам ячеек. */
  paint(poly: Pt[], value: 0 | 1) {
    const pb = bbox(poly);
    const [i0, j0] = this.cellOf({ x: pb.minX, y: pb.minY });
    const [i1, j1] = this.cellOf({ x: pb.maxX, y: pb.maxY });
    for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++)
        if (pointInPolygon(this.center(i, j), poly)) this.blocked[j * this.nx + i] = value;
  }
  clone(): Grid {
    const g = new Grid(this.b, this.step);
    g.blocked.set(this.blocked);
    return g;
  }
  /** Булева геометрия стен, включая вырезанные дверные проёмы и внутренние кольца. */
  paintGeom(geom: Geom, value: 0 | 1) {
    if (!geom.length) return;
    const b = geomBBox(geom);
    const [i0, j0] = this.cellOf({ x: b.minX, y: b.minY });
    const [i1, j1] = this.cellOf({ x: b.maxX, y: b.maxY });
    for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++)
        if (pointInGeom(this.center(i, j), geom)) this.blocked[j * this.nx + i] = value;
  }
}

/** Квадрат евклидова расстояния (в ячейках) до ближайшей занятой ячейки — алгоритм Фельзенсвальба. */
export function distanceField(grid: Grid): Float64Array {
  const { nx, ny } = grid;
  const INF = 1e20;
  const f = new Float64Array(Math.max(nx, ny));
  const d = new Float64Array(Math.max(nx, ny));
  const v = new Int32Array(Math.max(nx, ny));
  const z = new Float64Array(Math.max(nx, ny) + 1);
  const out = new Float64Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) out[k] = grid.blocked[k] ? 0 : INF;

  const dt1 = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = out[j * nx + i];
    dt1(ny);
    for (let j = 0; j < ny; j++) out[j * nx + i] = d[j];
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = out[j * nx + i];
    dt1(nx);
    for (let i = 0; i < nx; i++) out[j * nx + i] = d[i];
  }
  return out;
}

/**
 * Ячейки, достижимые от старта для «тела» шириной `width` мм
 * (центр тела проходит там, где до препятствия не меньше width/2).
 */
export function reachable(grid: Grid, dist2: Float64Array, start: Pt, width: number, conservative = false): Uint8Array {
  const { nx, ny, step } = grid;
  // В ячейках (центр-центр). Реальный зазор до грани препятствия ≈ need·step − step/2,
  // т. е. допуск дискретизации — полъячейки (25 мм при шаге 50).
  // conservative: на грубой сетке требуем на полъячейки больше — проверка строже точной, узкие места не пропускаются.
  const need = width / 2 / step + (conservative ? 0.5 : 0);
  const need2 = need * need;
  const seen = new Uint8Array(nx * ny);
  const ok = (k: number) => !grid.blocked[k] && dist2[k] >= need2;
  const [si, sj] = grid.cellOf(start);
  const queue: number[] = [];
  // Старт — ближайшая подходящая ячейка в радиусе 400 мм от точки входа.
  const r = Math.ceil(400 / step);
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      const i = si + di, j = sj + dj;
      if (!grid.inside(i, j)) continue;
      const k = j * nx + i;
      if (ok(k)) { seen[k] = 1; queue.push(k); }
    }
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    const i = k % nx, j = (k - i) / nx;
    const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1];
    for (const q of nb) if (q >= 0 && !seen[q] && ok(q)) { seen[q] = 1; queue.push(q); }
  }
  return seen;
}

/** Есть ли в полигоне хотя бы одна отмеченная ячейка. */
export function anyCellIn(grid: Grid, mask: Uint8Array, poly: Pt[]): boolean {
  const pb = bbox(poly);
  const [i0, j0] = grid.cellOf({ x: pb.minX, y: pb.minY });
  const [i1, j1] = grid.cellOf({ x: pb.maxX, y: pb.maxY });
  for (let j = Math.max(0, j0); j <= Math.min(grid.ny - 1, j1); j++)
    for (let i = Math.max(0, i0); i <= Math.min(grid.nx - 1, i1); i++) {
      const k = j * grid.nx + i;
      if (mask[k] && pointInPolygon(grid.center(i, j), poly)) return true;
    }
  return false;
}
