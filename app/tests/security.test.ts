import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { twoRoom } from './fixtures/synthetic';
import { checkedGeometry, checkedProject, parseSafeJson, safeSourceUrl } from '../src/storage/validate';
import { getFile, getProject, importProject, importLearning, listLearnedPlans, putFile, saveProject } from '../src/storage/db';
import { checkedPlan } from '../src/learning/model';
import { Autosave } from '../src/state/autosave';
import { checkedRasterSize } from '../src/pdf/limits';
import { Grid } from '../src/validate/grid';
import { resolveRules } from '../src/rules/rules';

const project = () => newProject({ alias: 'audit', city: '', manager: '', date: '' });
const backup = (p: ReturnType<typeof project>, files = {}) => JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files });
beforeEach(async () => { await new Promise<void>((resolve, reject) => { const q = indexedDB.deleteDatabase('trust-planner'); q.onsuccess = () => resolve(); q.onerror = () => reject(q.error); }); });

it('valid draft and existing synthetic geometry remain importable', () => {
  expect(checkedProject(project()).documents).toEqual([]);
  expect(checkedGeometry(twoRoom()).rooms).toHaveLength(3);
});
it('rejects prototype keys, unsupported versions and structurally incomplete projects', async () => {
  expect(() => parseSafeJson('{"__proto__":{"polluted":true}}')).toThrow();
  expect(() => parseSafeJson('{"ruleOverrides":{"constructor":1}}')).toThrow();
  const data = JSON.parse(backup(project())); data.version = 2;
  await expect(importProject(JSON.stringify(data))).rejects.toThrow();
  data.version = 1; data.project.geometry.openings = null;
  await expect(importProject(JSON.stringify(data))).rejects.toThrow();
});
it('rejects scripts, HTML/SVG data URLs, unsafe source links and remote wall masks', () => {
  const p = project(); p.concept.references = [{ id: 'ref', url: 'data:image/svg+xml;base64,PHN2Zz4=', caption: '', sourceName: '', sourceUrl: '', kind: 'reference' }];
  expect(() => checkedProject(p)).toThrow(); p.concept.references[0].url = 'https://example.com/photo.png'; p.concept.references[0].sourceUrl = 'javascript:alert(1)';
  expect(() => checkedProject(p)).toThrow(); p.concept.references = []; p.planImage = { url: 'https://example.com/track', widthMm: 10, heightMm: 10 };
  expect(() => checkedProject(p)).toThrow(); expect(safeSourceUrl('https://example.com/source')).toBe(true); expect(safeSourceUrl('data:text/html,test')).toBe(false);
});
it('rejects invalid furniture and crossed outlines before rendering', () => {
  const p = project(); p.geometry = twoRoom(); p.geometry.rooms[0].polygon = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
  expect(() => checkedProject(p)).toThrow(); p.geometry = twoRoom(); p.geometry.walls[0].a.x = Infinity;
  expect(() => checkedProject(p)).toThrow();
});
it('invalid later file cannot replace an earlier source or existing project', async () => {
  const p = project(); await saveProject(p); await putFile('first', new Blob(['old']));
  p.alias = 'replacement'; p.documents = ['first', 'second'].map(id => ({ id, name: 'plan.png', mime: 'image/png', size: 3, pageCount: 1, role: 'plan' as const, addedAt: p.createdAt }));
  await expect(importProject(backup(p, { first: { mime: 'image/png', base64: btoa('new') }, second: { mime: 'image/png', base64: 'invalid!' } }))).rejects.toThrow();
  expect(await (await getFile('first'))!.text()).toBe('old'); expect((await getProject(p.id))!.alias).toBe('audit');
});
it('rejects undeclared files and absent originals', async () => {
  const p = project(); await expect(importProject(backup(p, { alien: { mime: 'image/png', base64: '' } }))).rejects.toThrow();
  p.documents = [{ id: 'missing', name: 'a.pdf', mime: 'application/pdf', size: 10, pageCount: 1, role: 'plan', addedAt: p.createdAt }];
  await expect(importProject(backup(p))).rejects.toThrow(); expect(await getProject(p.id)).toBeUndefined();
});
it('a backup cannot overwrite files owned by another project', async () => {
  const owner = project(); owner.documents = [{ id: 'shared', name: 'plan.png', mime: 'image/png', size: 3, pageCount: 1, role: 'plan', addedAt: owner.createdAt }];
  await saveProject(owner); await putFile('shared', new Blob(['old']));
  const other = project(); other.documents = owner.documents;
  await expect(importProject(backup(other, { shared: { mime: 'image/png', base64: btoa('new') } }))).rejects.toThrow();
  expect(await (await getFile('shared'))!.text()).toBe('old'); expect(await getProject(other.id)).toBeUndefined();
});
it('rejects unsafe grid rules and huge allocations before allocating memory', () => {
  expect(resolveRules({ gridStep: 0, passageMin: -1, costRateMin: -50 }).gridStep).toBe(50);
  expect(() => new Grid({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0)).toThrow();
  expect(() => new Grid({ minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, 25)).toThrow();
  expect(() => checkedRasterSize(1e6, 1e6)).toThrow(); expect(() => checkedRasterSize(100, NaN)).toThrow();
  expect(() => checkedRasterSize(2500, 3500)).not.toThrow();
});
it('learning import rejects malformed metadata before saving any examples', async () => {
  const plan = checkedPlan('1'.repeat(64) + ':1', twoRoom());
  const bad = structuredClone(plan); bad.key = '2'.repeat(64) + ':1'; (bad.geometry.rooms[0] as any).name = { html: '<script>' };
  await expect(importLearning(JSON.stringify({ format: 'trust-planner-learning', version: 1, plans: [plan, bad] }))).rejects.toThrow();
  expect(await listLearnedPlans()).toEqual([]);
});
it('autosave retains failed edits and reports failure until retry succeeds', async () => {
  const states: [boolean, string | null][] = []; let fail = true; let saved: any;
  const s = new Autosave(async p => { if (fail) throw new Error('quota'); saved = p; }, (busy, error) => states.push([busy, error]));
  const p = project(); s.schedule(p); await expect(s.flush()).rejects.toThrow('quota');
  expect(s.dirty).toBe(true); expect(states.at(-1)).toEqual([false, 'quota']);
  fail = false; await s.flush(); expect(saved.alias).toBe('audit'); expect(s.dirty).toBe(false); expect(states.at(-1)).toEqual([false, null]);
});
it('autosave serializes in-flight writes and flushes the newest revision', async () => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); const saved: string[] = [];
  const s = new Autosave(async p => { if (!saved.length) await gate; saved.push(p.alias); }, () => {});
  const p = project(); s.schedule(p); const saving = s.flush(); s.schedule({ ...p, alias: 'latest' });
  expect(s.flush()).toBe(saving); release(); await saving;
  expect(saved).toEqual(['audit', 'latest']); expect(s.dirty).toBe(false);
});
