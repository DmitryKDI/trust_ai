import type { PlanGeometry, Project } from '../model/types';
import { defaultBrief } from '../model/defaults';
import { CATALOG } from '../furniture/catalog';
import { ROOM_TYPES, simpleRing } from '../learning/model';
import { parseMaterialCatalog } from '../scene/catalog';
import { sceneSettings } from '../scene/types';
import { RULE_DEFS, validRuleValue, type RuleKey } from '../rules/rules';

export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 60 * 1024 * 1024;
export const DOCUMENT_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/gif'];
const fail = (field: string): never => { throw new Error(`Некорректные данные: ${field}.`); };
const record = (v: any, field: string) => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(field); return v; };
const str = (v: any, field: string, max = 20000) => { if (typeof v !== 'string' || v.length > max) fail(field); };
const num = (v: any, field: string, min = -1e6, max = 1e6) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(field); };
const bool = (v: any, field: string) => { if (typeof v !== 'boolean') fail(field); };
const one = (v: any, values: readonly any[], field: string) => { if (!values.includes(v)) fail(field); };
const nullable = (v: any, fn: (v: any) => void) => { if (v !== null) fn(v); };
const arr = (v: any, field: string, max: number) => { if (!Array.isArray(v) || v.length > max) fail(field); return v as any[]; };
const texts = (v: any, field: string, max = 200) => arr(v, field, max).forEach(x => str(x, field));
const id = (v: any) => { str(v, 'id', 160); if (!v.trim() || ['__proto__', 'constructor', 'prototype'].includes(v)) fail('id'); };
const ids = (values: any[]) => { const seen = new Set(); values.forEach(v => { record(v, 'элемент'); id(v.id); if (seen.has(v.id)) fail('повторный id'); seen.add(v.id); }); };
const point = (p: any) => { record(p, 'точка'); num(p.x, 'x'); num(p.y, 'y'); };
const page = (v: any) => nullable(v, x => { num(x, 'страница', 1, 100000); if (!Number.isInteger(x)) fail('страница'); });
const provenance = (v: any) => { one(v.source, ['manual', 'suggested'], 'источник'); bool(v.verifiedByManager, 'подтверждение'); page(v.sourcePage); };
const polygon = (v: any) => { const p = arr(v, 'контур', 2000); p.forEach(point); if (!simpleRing(p)) fail('контур пересекается или имеет нулевую площадь'); };

/** Accept incomplete drafts, but never unsafe shapes, missing arrays or unbounded coordinates. */
export function checkedGeometry(value: unknown): PlanGeometry {
  const g = record(value, 'разметка');
  num(g.version, 'версия разметки', 1); nullable(g.sourceDocumentId, id); page(g.sourcePage);
  bool(g.approved, 'утверждение'); nullable(g.approvedAt, x => str(x, 'дата')); nullable(g.approvedHash, x => str(x, 'хэш', 160));
  if (g.wallMode !== undefined) one(g.wallMode, ['rooms', 'explicit'], 'основа стен');
  if (g.calibration !== null) {
    const c = record(g.calibration, 'масштаб'); point(c.p1); point(c.p2); num(c.mm, 'размер', 0.000001); num(c.mmPerUnit, 'масштаб', 0.000001, 10000);
    if (c.method !== undefined) one(c.method, ['manual', 'dimensions', 'area', 'typical', 'assumed'], 'метод масштаба');
  }
  const all: any[] = [];
  for (const key of ['walls', 'openings', 'fixed', 'wetZones', 'rooms']) {
    const values = arr(g[key], key, key === 'walls' || key === 'openings' ? 2000 : 200); ids(values); all.push(...values);
    for (const v of values) {
      provenance(v);
      if (key === 'walls' || key === 'openings') {
        point(v.a); point(v.b); if (v.a.x === v.b.x && v.a.y === v.b.y) fail('отрезок нулевой длины'); num(v.thickness, 'толщина', 1, 5000);
        if (key === 'walls') one(v.kind, ['bearing', 'partition', 'unknown'], 'тип стены');
        else {
          one(v.type, ['door', 'window'], 'проём'); one(v.hinge, ['a', 'b'], 'петли'); one(v.swing, [-1, 1], 'направление двери'); bool(v.isEntrance, 'вход'); nullable(v.sillHeight, x => num(x, 'подоконник', 0, 6000));
          if (v.leaves !== undefined) one(v.leaves, [1, 2], 'створки');
        }
      } else {
        polygon(v.polygon);
        if (v.label !== undefined) str(v.label, 'подпись');
        if (key === 'fixed') one(v.kind, ['riser', 'vent', 'shaft', 'radiator', 'electrical', 'column', 'void', 'other'], 'препятствие');
        if (key === 'rooms') { str(v.name, 'название зоны'); one(v.type, ROOM_TYPES.map(t => t[0]), 'тип зоны'); if (v.typeSource !== undefined) one(v.typeSource, ['manual', 'learned'], 'назначение'); if (v.typeBasis !== undefined) str(v.typeBasis, 'основание'); }
      }
    }
  }
  ids(all);
  const pts = all.flatMap(v => v.polygon ?? [v.a, v.b]);
  if (pts.length > 30000) fail('слишком много точек');
  for (const axis of ['x', 'y']) if (pts.length && Math.max(...pts.map(p => p[axis])) - Math.min(...pts.map(p => p[axis])) > 100000) fail('габариты плана больше 100 м');
  return g as PlanGeometry;
}

export function localImageUrl(value: unknown, maxBytes = 16 * 1024 * 1024): boolean {
  return typeof value === 'string' && value.length <= maxBytes && /^data:image\/(png|jpeg|webp|bmp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
export function safeSourceUrl(value: unknown): boolean {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

export function checkedProject(value: unknown): Project {
  const p = record(value, 'проект'); id(p.id);
  for (const k of ['alias', 'city', 'manager', 'date', 'createdAt', 'updatedAt', 'referenceNotes']) str(p[k], k);
  record(p.brief, 'бриф');
  for (const [k, v] of Object.entries(defaultBrief())) {
    if (typeof v === 'string') str(p.brief[k], k);
    else if (typeof v === 'boolean') bool(p.brief[k], k);
    else { num(p.brief[k], k, 0, 100); if (!Number.isInteger(p.brief[k])) fail(k); }
  }
  const docs = arr(p.documents, 'документы', 20); ids(docs);
  docs.forEach(d => { str(d.name, 'имя файла', 1000); one(d.mime, DOCUMENT_MIMES, 'формат файла'); num(d.size, 'размер файла', 0, MAX_DOCUMENT_BYTES); num(d.pageCount, 'число страниц', 1, 100000); if (!Number.isInteger(d.pageCount)) fail('число страниц'); one(d.role, ['plan', 'reference'], 'роль файла'); str(d.addedAt, 'дата файла'); });
  checkedGeometry(p.geometry); page(p.referencePage);
  if (p.geometry.sourceDocumentId !== null && !docs.some(d => d.id === p.geometry.sourceDocumentId)) fail('источник разметки отсутствует');
  const variants = arr(p.variants, 'варианты', 20); ids(variants);
  variants.forEach(v => {
    one(v.scenario, ['space', 'storage', 'family'], 'сценарий'); for (const k of ['title', 'idea', 'geometryHash']) str(v[k], k);
    for (const k of ['benefits', 'compromises', 'assumptions', 'changes']) texts(v[k], k);
    bool(v.approved, 'вариант'); bool(v.editedByManager, 'правки варианта');
    const items = arr(v.items, 'мебель', 500); ids(items); items.forEach(i => {
      one(i.type, Object.keys(CATALOG), 'тип мебели'); point(i); num(i.w, 'ширина', 1, 10000); num(i.d, 'глубина', 1, 10000); one(i.rot, [0, 90, 180, 270], 'поворот'); nullable(i.roomId, id); nullable(i.ruleId, id); bool(i.movedByManager, 'ручная мебель');
      if (i.seats !== undefined) num(i.seats, 'места', 1, 100);
      if (i.modules !== undefined) arr(i.modules, 'модули', 100).forEach(m => { record(m, 'модуль'); one(m.kind, ['sink', 'hob', 'base', 'dishwasher', 'oven', 'tall'], 'тип модуля'); num(m.w, 'ширина модуля', 1, 10000); });
    });
    arr(v.issues, 'замечания', 2000).forEach(i => { record(i, 'замечание'); one(i.severity, ['warning', 'error'], 'важность'); str(i.code, 'код'); str(i.message, 'сообщение'); texts(i.itemIds, 'id предметов', 500); });
    Object.values(record(v.metrics, 'метрики')).forEach(n => num(n, 'метрика'));
  });
  nullable(p.selectedVariantId, x => { id(x); if (!variants.some(v => v.id === x)) fail('выбранный вариант отсутствует'); });
  if (p.review !== null) { record(p.review, 'утверждение'); for (const k of ['variantId', 'approvedBy', 'approvedAt', 'note']) str(p.review[k], k); }
  for (const [k, n] of Object.entries(record(p.ruleOverrides, 'правила'))) if (!Object.hasOwn(RULE_DEFS, k) || !validRuleValue(k as RuleKey, n)) fail(`правило ${k}`);
  const c = record(p.concept, 'концепция'); str(c.styleName, 'стиль'); str(c.rationale, 'обоснование'); texts(c.materials, 'материалы', 20);
  if (c.clientGoals !== undefined) texts(c.clientGoals, 'задачи', 30);
  arr(c.palette, 'палитра', 20).forEach(s => { record(s, 'цвет'); str(s.name, 'название цвета'); if (typeof s.hex !== 'string' || !/^#[a-f0-9]{6}$/i.test(s.hex)) fail('цвет'); });
  const references = arr(c.references, 'изображения', 4); ids(references);
  references.forEach(r => { if (!localImageUrl(r.url) && !(typeof r.url === 'string' && r.url.startsWith('https://') && safeSourceUrl(r.url))) fail('URL изображения'); if (!safeSourceUrl(r.sourceUrl)) fail('ссылка на источник'); for (const k of ['caption', 'sourceName']) str(r[k], k); one(r.kind, ['reference', 'illustration'], 'тип изображения'); });
  if (c.materialCatalog !== undefined) c.materialCatalog = parseMaterialCatalog(JSON.stringify(c.materialCatalog));
  if (c.scene3d !== undefined) { record(c.scene3d, '3D'); const clean = sceneSettings(c.scene3d); record(c.scene3d.assignments ?? {}, 'материалы 3D'); c.scene3d = clean; }
  if (p.planImage !== undefined) { record(p.planImage, 'подложка'); if (!localImageUrl(p.planImage.url)) fail('подложка должна быть локальным изображением'); num(p.planImage.widthMm, 'ширина подложки', 1, 100000); num(p.planImage.heightMm, 'высота подложки', 1, 100000); }
  if (p.planStyle !== undefined) one(p.planStyle, ['graphite', 'warm', 'blueprint', 'original'], 'стиль плана');
  if (p.recognition !== undefined) {
    const r = record(p.recognition, 'распознавание'); record(r.scale, 'масштаб распознавания'); num(r.scale.k, 'масштаб', 0.000001); one(r.scale.method, ['dimensions', 'area', 'typical', 'assumed'], 'метод'); num(r.scale.support, 'поддержка', 0); num(r.walls, 'стены', 0); num(r.ms, 'время', 0); texts(r.notes, 'заметки');
    record(r.openings, 'проёмы'); num(r.openings.doors, 'двери', 0); num(r.openings.windows, 'окна', 0); bool(r.openings.entrance, 'вход'); arr(r.rooms, 'найденные зоны', 200).forEach(x => { record(x, 'зона'); str(x.name, 'название'); one(x.type, ROOM_TYPES.map(t => t[0]), 'тип'); num(x.areaM2, 'площадь', 0); bool(x.byLabel, 'подпись'); });
  }
  return p as Project;
}

export function parseSafeJson(text: string, maxBytes = MAX_BACKUP_BYTES): any {
  if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Файл JSON превышает допустимый размер.');
  let nodes = 0;
  return JSON.parse(text, (key, value) => {
    if (++nodes > 200000 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('структура JSON');
    return value;
  });
}
