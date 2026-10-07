// Хранение проектов и исходных файлов в IndexedDB браузера + резервная копия в JSON.
import type { Project } from '../model/types';
import { parseLearning, type LearnedPlan, type LearningBackup } from '../learning/model';
import { checkedGeometry, checkedProject, parseSafeJson, MAX_DOCUMENT_BYTES } from './validate';

const DB = 'trust-planner';
const VERSION = 2;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('learning')) db.createObjectStore('learning', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    let r: IDBRequest<T> | void;
    try { r = fn(t.objectStore(store)); }
    catch (e) { t.abort(); db.close(); reject(e); return; }
    t.oncomplete = () => { resolve(r ? (r.result as T) : (undefined as T)); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
    t.onabort = () => { reject(t.error); db.close(); };
  });
}

export const listProjects = () => tx<Project[]>('projects', 'readonly', (s) => s.getAll());
export const getProject = (id: string) => tx<Project | undefined>('projects', 'readonly', (s) => s.get(id));
export const saveProject = (p: Project) => tx<IDBValidKey>('projects', 'readwrite', (s) => s.put(structuredClone(p)));
export const putFile = (id: string, data: Blob) => tx<IDBValidKey>('files', 'readwrite', (s) => s.put(data, id));
export const getFile = (id: string) => tx<Blob | undefined>('files', 'readonly', (s) => s.get(id));
export const listLearnedPlans = () => tx<LearnedPlan[]>('learning', 'readonly', s => s.getAll());
export const getLearnedPlan = (key: string) => tx<LearnedPlan | undefined>('learning', 'readonly', s => s.get(key));
export const forgetLearnedPlan = (key: string) => tx('learning', 'readwrite', s => { s.delete(key); });
export const clearLearning = () => tx('learning', 'readwrite', s => { s.clear(); });
export async function saveLearnedPlan(plan: LearnedPlan) {
  const checked = parseLearning(JSON.stringify({ format: 'trust-planner-learning', version: 1, plans: [plan] }))[0];
  checkedGeometry(checked.geometry);
  if (new TextEncoder().encode(JSON.stringify(checked)).length + 81 > 5_000_000) throw new Error('Пример обучения больше 5 МБ.');
  await tx('learning', 'readwrite', s => {
    const request = s.getAll();
    request.onsuccess = () => {
      const existing = request.result as LearnedPlan[];
      if (existing.some(p => p.key === checked.key && p.savedAt > checked.savedAt)) return;
      const all = [...existing.filter(p => p.key !== checked.key), checked].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      let bytes = 80;
      const keep = new Set<string>();
      for (const p of all) {
        const size = new TextEncoder().encode(JSON.stringify(p)).length + 1;
        if (keep.size < 200 && bytes + size <= 5_000_000) { keep.add(p.key); bytes += size; }
      }
      for (const old of existing) if (!keep.has(old.key)) s.delete(old.key);
      if (keep.has(checked.key)) s.put(checked);
    };
    return request;
  });
}
export async function learningBackup(): Promise<Blob> {
  const data: LearningBackup = { format: 'trust-planner-learning', version: 1, plans: await listLearnedPlans() };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
export async function importLearning(text: string) {
  const plans = parseLearning(text); // Validate the complete batch before writing any examples.
  for (const plan of plans) checkedGeometry(plan.geometry);
  for (const plan of plans) await saveLearnedPlan(plan);
}

export async function deleteProject(p: Project) {
  await tx('projects', 'readwrite', (s) => { s.delete(p.id); });
  for (const d of p.documents) await tx('files', 'readwrite', (s) => { s.delete(d.id); });
}

interface ExportFile { format: 'trust-planner-project'; version: 1; exportedAt: string; project: Project; files: Record<string, { mime: string; base64: string }>; learning?: LearningBackup }

async function toBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** Полная резервная копия проекта (включая исходные файлы). */
export async function exportProject(p: Project): Promise<Blob> {
  const files: ExportFile['files'] = {};
  for (const d of p.documents) {
    const b = await getFile(d.id);
    if (b) files[d.id] = { mime: d.mime, base64: await toBase64(b) };
  }
  const allLearning = await listLearnedPlans();
  const hashes = allLearning.length ? await Promise.all(p.documents.map(async d => { const b = await getFile(d.id); return b ? fileFingerprint(b).catch(() => null) : null; })) : [];
  const plans = allLearning.filter(plan => hashes.includes(plan.key.split(':')[0]));
  const out: ExportFile = { format: 'trust-planner-project', version: 1, exportedAt: new Date().toISOString(), project: p, files, ...(plans.length ? { learning: { format: 'trust-planner-learning' as const, version: 1 as const, plans } } : {}) };
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importProject(text: string): Promise<Project> {
  const data = parseSafeJson(text) as ExportFile;
  if (!data || data.format !== 'trust-planner-project' || data.version !== 1) throw new Error('Это не поддерживаемый файл проекта планировщика');
  const project = checkedProject(data.project);
  const learning = data.learning ? parseLearning(JSON.stringify(data.learning)) : [];
  for (const plan of learning) checkedGeometry(plan.geometry);
  if (!data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('В резервной копии отсутствует список файлов.');
  const files = new Map<string, Blob>();
  for (const [id, f] of Object.entries(data.files)) {
    const doc = project.documents.find(d => d.id === id);
    if (!doc || !f || f.mime !== doc.mime || typeof f.base64 !== 'string' || f.base64.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 || f.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)) throw new Error('Некорректный файл в резервной копии.');
    const blob = fromBase64(f.base64, f.mime);
    if (blob.size !== doc.size) throw new Error('Размер исходника не соответствует резервной копии.');
    files.set(id, blob);
  }
  if (project.documents.some(d => !files.has(d.id))) throw new Error('Резервная копия не содержит всех исходных файлов.');
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['projects', 'files'], 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error('Импорт отменён: исходники используются другим проектом или хранилище недоступно.'));
      const existing = transaction.objectStore('projects').getAll();
      existing.onsuccess = () => {
        if ((existing.result as Project[]).some(p => p.id !== project.id && p.documents.some(d => files.has(d.id)))) { transaction.abort(); return; }
        for (const [id, blob] of files) transaction.objectStore('files').put(blob, id);
        transaction.objectStore('projects').put(project);
      };
    });
  } finally { db.close(); }
  for (const plan of learning) await saveLearnedPlan(plan);
  return project;
}

export async function fileFingerprint(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function planKey(blob: Blob, page: number): Promise<string> {
  if (!Number.isInteger(page) || page < 1) throw new Error('Некорректная страница.');
  return `${await fileFingerprint(blob)}:${page}`;
}
