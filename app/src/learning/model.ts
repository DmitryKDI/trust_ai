import type { PlanGeometry, Pt, Room, RoomType } from '../model/types';
import { bbox, overlapArea, polyArea } from '../geometry/poly';

const bboxOf = (pts: Pt[]) => { const b = bbox(pts); return { ...b, w: b.maxX - b.minX, h: b.maxY - b.minY }; };

export const ROOM_TYPES: [RoomType, string][] = [
  ['other', 'Не определено'], ['bath', 'Ванная / совмещённый санузел'], ['wc', 'Туалет'],
  ['living', 'Гостиная'], ['bedroom', 'Спальня'], ['kids', 'Детская'], ['kitchen', 'Кухня'],
  ['kitchen-living', 'Кухня-гостиная'], ['hall', 'Прихожая'], ['corridor', 'Коридор'],
  ['storage', 'Кладовая / гардероб'], ['balcony', 'Балкон / лоджия'],
];
export const roomName = (type: RoomType) => ROOM_TYPES.find(x => x[0] === type)?.[1] ?? 'Помещение';

export interface LearnedPlan {
  version: 1;
  key: string; // SHA-256 original file + page, never a filename or benchmark ID.
  savedAt: string;
  geometry: PlanGeometry;
}
export interface LearningBackup { format: 'trust-planner-learning'; version: 1; plans: LearnedPlan[] }

function cross(a: Pt, b: Pt, c: Pt) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function on(a: Pt, b: Pt, c: Pt) {
  return Math.abs(cross(a, b, c)) < 1e-6 && c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
}
export function simpleRing(poly: Pt[]): boolean {
  if (poly.length < 3 || poly.length > 2000 || poly.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || polyArea(poly) <= 0) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.x === b.x && a.y === b.y) return false;
    for (let j = i + 1; j < poly.length; j++) {
      if (j === i + 1 || (i === 0 && j === poly.length - 1)) continue;
      const c = poly[j], d = poly[(j + 1) % poly.length];
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) return false;
    }
  }
  return true;
}
export function validateGeometry(g: PlanGeometry) {
  if (!g || !Array.isArray(g.rooms) || !g.rooms.length || g.rooms.length > 200 || !g.calibration || !(g.calibration.mmPerUnit > 0) || !Number.isFinite(g.calibration.mmPerUnit)) throw new Error('Нужны помещения и корректный масштаб.');
  for (const room of g.rooms) {
    if (!Array.isArray(room.polygon) || !simpleRing(room.polygon)) throw new Error('Контур зоны должен иметь положительную площадь и не пересекать сам себя.');
    if (!ROOM_TYPES.some(t => t[0] === room.type)) throw new Error('Неизвестное назначение зоны.');
    if (room.typeSource && !['manual', 'learned'].includes(room.typeSource)) throw new Error('Неизвестный источник назначения.');
  }
  const point = (p: Pt) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!point(g.calibration.p1) || !point(g.calibration.p2) || !Number.isFinite(g.calibration.mm) || g.calibration.mm <= 0) throw new Error('Некорректная калибровка.');
  if (![g.walls, g.openings, g.fixed, g.wetZones].every(Array.isArray)) throw new Error('Неполная геометрия.');
  if (g.walls.some(w => !point(w.a) || !point(w.b) || !(w.thickness > 0) || !Number.isFinite(w.thickness))) throw new Error('Некорректные стены.');
  if (g.openings.some(o => !point(o.a) || !point(o.b) || !['door', 'window'].includes(o.type) || !(o.thickness > 0) || !Number.isFinite(o.thickness) || !['a', 'b'].includes(o.hinge) || ![1, -1].includes(o.swing))) throw new Error('Некорректные проёмы.');
  if ([...g.fixed, ...g.wetZones].some(f => !Array.isArray(f.polygon) || !simpleRing(f.polygon))) throw new Error('Некорректный контур препятствия.');
  for (let i = 0; i < g.rooms.length; i++) for (let j = i + 1; j < g.rooms.length; j++) {
    if (overlapArea(g.rooms[i].polygon, g.rooms[j].polygon) > 100) throw new Error(`Зоны ${i + 1} и ${j + 1} пересекаются. Исправьте границы перед обучением.`);
  }
}
export function checkedPlan(key: string, g: PlanGeometry): LearnedPlan {
  if (!/^[a-f0-9]{64}:[1-9]\d*$/.test(key)) throw new Error('Некорректный источник обучения.');
  validateGeometry(g);
  if (g.sourcePage !== Number(key.split(':')[1])) throw new Error('Страница примера не соответствует источнику.');
  const geometry = structuredClone(g);
  geometry.sourceDocumentId = null;
  geometry.approved = false; geometry.approvedAt = null; geometry.approvedHash = null;
  return { version: 1, key, savedAt: new Date().toISOString(), geometry };
}
export function parseLearning(text: string): LearnedPlan[] {
  if (new TextEncoder().encode(text).byteLength > 5_000_000) throw new Error('Файл обучения больше 5 МБ.');
  const data = JSON.parse(text) as LearningBackup;
  if (data.format !== 'trust-planner-learning' || data.version !== 1 || !Array.isArray(data.plans) || data.plans.length > 200) throw new Error('Неподдерживаемый файл обучения.');
  const keys = new Set<string>();
  return data.plans.map(plan => {
    if (plan.version !== 1 || keys.has(plan.key)) throw new Error('Повторный или неподдерживаемый пример.');
    keys.add(plan.key);
    const clean = checkedPlan(plan.key, plan.geometry);
    if (typeof plan.savedAt !== 'string' || !Number.isFinite(Date.parse(plan.savedAt))) throw new Error('Некорректная дата примера.');
    clean.savedAt = plan.savedAt;
    return clean;
  });
}

// Scale-free descriptors: share of apartment area, aspect, compactness, outer-edge distance.
// They deliberately do not use falsely detected windows or RGB->room labels.
export function roomFeatures(g: PlanGeometry, room: Room): number[] {
  const b = bboxOf(room.polygon), all = bboxOf(g.rooms.flatMap(r => r.polygon));
  const area = polyArea(room.polygon), total = g.rooms.reduce((sum, r) => sum + polyArea(r.polygon), 0);
  const edge = Math.min(b.minX - all.minX, all.maxX - b.maxX, b.minY - all.minY, all.maxY - b.maxY) / Math.max(all.w, all.h, 1);
  return [Math.log(area / total), Math.log(Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h))), area / Math.max(1, b.w * b.h), edge];
}
export function learnedTypes(g: PlanGeometry, plans: LearnedPlan[], labeledRoomIds: ReadonlySet<string> = new Set()): { geometry: PlanGeometry; count: number } {
  const samples = plans.flatMap(plan => plan.geometry.rooms.filter(r => r.typeSource === 'manual' && r.type !== 'other').map(r => ({ key: plan.key, type: r.type, features: roomFeatures(plan.geometry, r) })));
  let count = 0;
  const rooms = g.rooms.map(room => {
    if (room.typeSource === 'manual' || room.verifiedByManager || labeledRoomIds.has(room.id)) return room;
    const f = roomFeatures(g, room);
    const near = samples.filter(s => {
      const weights = [0.35, 0.4, 0.8, 2];
      const distance = Math.hypot(...s.features.map((v, i) => (v - f[i]) * weights[i]));
      return Number.isFinite(distance) && distance <= 0.16;
    });
    const sourceFiles = new Set(near.map(s => s.key.split(':')[0]));
    const types = new Set(near.map(s => s.type));
    // Three distinct original files, unanimous nearby labels. Re-saves/pages do not add votes.
    if (sourceFiles.size < 3 || types.size !== 1) return room;
    const type = near[0].type;
    if (type === 'balcony' && f[3] > 0.03) return room;
    count++;
    return { ...room, type, name: roomName(type), typeSource: 'learned' as const, typeBasis: `Предположение по вашим примерам: ${sourceFiles.size} разных планов` };
  });
  return { geometry: count ? { ...g, rooms } : g, count };
}
