import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { newProject, emptyGeometry } from '../src/model/defaults';
import { checkedPlan } from '../src/learning/model';
import { clearLearning, exportProject, getFile, getLearnedPlan, getProject, importLearning, importProject, listLearnedPlans, planKey, putFile, saveLearnedPlan } from '../src/storage/db';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => { const q = indexedDB.deleteDatabase('trust-planner'); q.onsuccess = () => resolve(); q.onerror = () => reject(q.error); });
});
const project = () => newProject({ alias: 'synthetic', city: '', date: '', manager: '' });
function geometry() {
  return { ...emptyGeometry(), sourcePage: 1, calibration: { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, mmPerUnit: 1 }, rooms: [{ id: 'r', name: 'Ванная', type: 'bath' as const, typeSource: 'manual' as const, polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], source: 'manual' as const, verifiedByManager: true, sourcePage: 1 }] };
}
it('миграция IndexedDB 1->2 сохраняет старые проекты и исходники', async () => {
  const p = project();
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const q = indexedDB.open('trust-planner', 1); q.onupgradeneeded = () => { q.result.createObjectStore('projects', { keyPath: 'id' }); q.result.createObjectStore('files'); }; q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(['projects', 'files'], 'readwrite'); tx.objectStore('projects').put(p); tx.objectStore('files').put(new Blob(['original']), 'doc'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });db.close();
  expect(await listLearnedPlans()).toEqual([]);
  expect((await getProject(p.id))?.alias).toBe('synthetic');
  expect(await (await getFile('doc'))?.text()).toBe('original');
});
it('одинаковые байты имеют одну память, страницы независимы; повторное сохранение заменяет пример', async () => {
  const b = new Blob(['image bytes']);const key = await planKey(b, 1);
  await saveLearnedPlan(checkedPlan(key, geometry()));
  const g = geometry();g.rooms[0].name = 'Исправлено';await saveLearnedPlan(checkedPlan(await planKey(new Blob(['image bytes']), 1), g));
  expect(await listLearnedPlans()).toHaveLength(1);
  expect((await getLearnedPlan(key))?.geometry.rooms[0].name).toBe('Исправлено');
  expect(await getLearnedPlan(await planKey(b, 2))).toBeUndefined();
});
it('резервная копия проекта переносит его обучение; старый JSON version 1 остается допустимым', async () => {
  const p = project();const b = new Blob(['image']);await putFile('doc', b);
  p.documents = [{ id: 'doc', name: 'plan.jpg', mime: 'image/jpeg', size: b.size, pageCount: 1, role: 'plan', addedAt: p.createdAt }];
  await saveLearnedPlan(checkedPlan(await planKey(b, 1), geometry()));
  const text = await (await exportProject(p)).text();await clearLearning();
  await importProject(text);expect(await listLearnedPlans()).toHaveLength(1);
  const old = JSON.parse(text);delete old.learning;await clearLearning();
  await importProject(JSON.stringify(old));expect(await listLearnedPlans()).toEqual([]);
  expect((await getProject(p.id))?.documents).toEqual(p.documents);
});
it('невалидный импорт не записывает даже первые корректные примеры', async () => {
  const e = checkedPlan(await planKey(new Blob(['one']), 1), geometry());
  await expect(importLearning(JSON.stringify({ format: 'trust-planner-learning', version: 1, plans: [e, { ...e, key: 'invalid' }] }))).rejects.toThrow();
  expect(await listLearnedPlans()).toEqual([]);
});
it('одновременные сохранения не теряют примеры; старый импорт не отменяет новую правку', async () => {
  const key = await planKey(new Blob(['one']), 1);
  const newer = { ...checkedPlan(key, geometry()), savedAt: '2026-10-03T12:00:00.000Z' };
  newer.geometry.rooms[0].name = 'Новое исправление';
  const older = { ...checkedPlan(key, geometry()), savedAt: '2026-10-02T12:00:00.000Z' };
  const second = checkedPlan(await planKey(new Blob(['two']), 1), geometry());
  await Promise.all([saveLearnedPlan(newer), saveLearnedPlan(second), saveLearnedPlan(older)]);
  expect(await listLearnedPlans()).toHaveLength(2);
  expect((await getLearnedPlan(key))?.geometry.rooms[0].name).toBe('Новое исправление');
});
