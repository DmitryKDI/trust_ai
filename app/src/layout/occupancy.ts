// Растровая карта занятости с таблицей сумм (summed-area table):
// быстрая предварительная проверка прямоугольника за O(1) при переборе позиций.
import type { Pt } from '../model/types';
import { bbox, pointInPolygon, type BBox } from '../geometry/poly';

export class Layer {
  readonly data: Uint8Array;
  private sat: Int32Array | null = null;
  constructor(readonly nx: number, readonly ny: number) {
    this.data = new Uint8Array(nx * ny);
  }
  invalidate() { this.sat = null; }
  table(): Int32Array {
    if (this.sat) return this.sat;
    const { nx, ny, data } = this;
    const s = new Int32Array((nx + 1) * (ny + 1));
    for (let j = 0; j < ny; j++) {
      let row = 0;
      for (let i = 0; i < nx; i++) {
        row += data[j * nx + i];
        s[(j + 1) * (nx + 1) + (i + 1)] = s[j * (nx + 1) + (i + 1)] + row;
      }
    }
    return (this.sat = s);
  }
  copyFrom(o: Layer) { this.data.set(o.data); this.invalidate(); }
}

export class Occupancy {
  readonly nx: number;
  readonly ny: number;
  constructor(readonly b: BBox, readonly step: number) {
    this.nx = Math.max(1, Math.ceil((b.maxX - b.minX) / step));
    this.ny = Math.max(1, Math.ceil((b.maxY - b.minY) / step));
  }
  layer(): Layer { return new Layer(this.nx, this.ny); }

  /** Закрашивает ячейки, центр которых внутри полигона. */
  paint(layer: Layer, poly: Pt[], value = 1) {
    const pb = bbox(poly);
    const i0 = Math.max(0, Math.floor((pb.minX - this.b.minX) / this.step));
    const i1 = Math.min(this.nx - 1, Math.floor((pb.maxX - this.b.minX) / this.step));
    const j0 = Math.max(0, Math.floor((pb.minY - this.b.minY) / this.step));
    const j1 = Math.min(this.ny - 1, Math.floor((pb.maxY - this.b.minY) / this.step));
    const axis = isAxisRect(poly);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = { x: this.b.minX + (i + 0.5) * this.step, y: this.b.minY + (j + 0.5) * this.step };
        if (axis ? c.x > pb.minX && c.x < pb.maxX && c.y > pb.minY && c.y < pb.maxY : pointInPolygon(c, poly)) layer.data[j * this.nx + i] = value;
      }
    layer.invalidate();
  }

  /** Число занятых ячеек, центры которых попадают внутрь осевого прямоугольника (с отступом внутрь inset мм). */
  count(layer: Layer, r: BBox, inset = 0): number {
    const x0 = r.minX + inset, x1 = r.maxX - inset, y0 = r.minY + inset, y1 = r.maxY - inset;
    if (x1 <= x0 || y1 <= y0) return 0;
    // Ячейки с центром в (x0, x1): i такие, что minX + (i+0.5)*step ∈ (x0, x1).
    const i0 = Math.max(0, Math.ceil((x0 - this.b.minX) / this.step - 0.5));
    const i1 = Math.min(this.nx - 1, Math.floor((x1 - this.b.minX) / this.step - 0.5));
    const j0 = Math.max(0, Math.ceil((y0 - this.b.minY) / this.step - 0.5));
    const j1 = Math.min(this.ny - 1, Math.floor((y1 - this.b.minY) / this.step - 0.5));
    // Прямоугольник, выходящий за границы карты, считаем занятым.
    const outside = (x0 < this.b.minX || y0 < this.b.minY || x1 > this.b.maxX || y1 > this.b.maxY) ? 1 : 0;
    if (i1 < i0 || j1 < j0) return outside;
    const s = layer.table();
    const W = this.nx + 1;
    return s[(j1 + 1) * W + (i1 + 1)] - s[j0 * W + (i1 + 1)] - s[(j1 + 1) * W + i0] + s[j0 * W + i0] + outside;
  }
}

export function isAxisRect(poly: Pt[]): boolean {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false;
  }
  return true;
}
