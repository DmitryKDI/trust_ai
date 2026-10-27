import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { emptyGeometry, newProject } from '../src/model/defaults';
import { checkedPlan } from '../src/learning/model';
import { getFile, getLearnedPlan, getProject, importLearning, importProject, listLearnedPlans, listProjects, planKey, putFile, saveLearnedPlan, saveProject } from '../src/storage/db';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { vi.restoreAllMocks(); });
const geometry = () => ({ ...emptyGeometry(), sourcePage: 1,
  calibration: { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, mmPerUnit: 1 },
  rooms: [{ id: 'r', name: 'Комната', type: 'living' as const, typeSource: 'manual' as const,
    polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }],
    source: 'manual' as const, verifiedByManager: true, sourcePage: 1 }] });

it.each(['throw', 'abort'])('откатывает весь импорт обучения при %s на втором примере', async (failure) => {
  const first = checkedPlan(await planKey(new Blob(['first']), 1), geometry());
  const second = checkedPlan(await planKey(new Blob(['second']), 1), geometry());
  const old = { ...first, savedAt: '2026-10-01T00:00:00.000Z' };
  await saveLearnedPlan(old);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'learning' && args[0].key === second.key) {
      if (failure === 'throw') throw new DOMException('Synthetic quota', 'QuotaExceededError');
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    }
    return put.apply(this, args);
  });
  await expect(importLearning(JSON.stringify({ format: 'trust-planner-learning', version: 1, plans: [first, second] }))).rejects.toBeDefined();
  expect(await listLearnedPlans()).toEqual([old]);
});

it.each(['throw', 'abort'])('ошибка обучения (%s) не оставляет копию проекта и новые исходники', async (failure) => {
  const p = newProject({ alias: 'Оригинал', city: '', date: '', manager: '' });
  const file = new Blob(['image'], { type: 'image/png' });
  p.documents = [{ id: 'original-doc', name: 'plan.png', mime: file.type, size: file.size, role: 'plan', pageCount: 1, addedAt: p.createdAt }];
  await putFile(p.documents[0].id, file); await saveProject(p);
  const plan = checkedPlan(await planKey(file, 1), geometry());
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'learning') {
      if (failure === 'throw') throw new DOMException('Synthetic quota', 'QuotaExceededError');
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    }
    return put.apply(this, args);
  });
  await expect(importProject(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p,
    files: { 'original-doc': { mime: file.type, base64: btoa('image') } },
    learning: { format: 'trust-planner-learning', version: 1, plans: [plan] },
  }))).rejects.toBeDefined();
  expect(await listProjects()).toEqual([p]);
  expect(await (await getFile('original-doc'))!.text()).toBe('image');
  expect(await listLearnedPlans()).toEqual([]);
  const fileCount = await new Promise<number>((resolve, reject) => {
    const q = indexedDB.open('trust-planner', 2);
    q.onsuccess = () => { const db = q.result; const tx = db.transaction('files'); const request = tx.objectStore('files').count();
      tx.oncomplete = () => { resolve(request.result); db.close(); }; tx.onabort = () => { reject(tx.error); db.close(); }; };
    q.onerror = () => reject(q.error);
  });
  expect(fileCount).toBe(1);
  expect(await getProject(p.id)).toEqual(p);
  expect(await getLearnedPlan(plan.key)).toBeUndefined();
});

it('пакетный импорт сохраняет более новую ручную правку и добавляет второй пример', async () => {
  const first = checkedPlan(await planKey(new Blob(['first']), 1), geometry());
  const newer = { ...first, savedAt: '2026-10-02T00:00:00.000Z' };
  const older = { ...first, savedAt: '2026-10-01T00:00:00.000Z' };
  const second = checkedPlan(await planKey(new Blob(['second']), 1), geometry());
  await saveLearnedPlan(newer);
  await importLearning(JSON.stringify({ format: 'trust-planner-learning', version: 1, plans: [older, second] }));
  expect(await getLearnedPlan(first.key)).toEqual(newer);
  expect(await getLearnedPlan(second.key)).toEqual(second);
  expect(await listLearnedPlans()).toHaveLength(2);
});
