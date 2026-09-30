// Хранение проектов и исходных файлов в IndexedDB браузера + резервная копия в JSON.
import type { Project } from '../model/types';

const DB = 'trust-planner';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
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

export async function deleteProject(p: Project) {
  await tx('projects', 'readwrite', (s) => { s.delete(p.id); });
  for (const d of p.documents) await tx('files', 'readwrite', (s) => { s.delete(d.id); });
}

interface ExportFile { format: 'trust-planner-project'; version: 1; exportedAt: string; project: Project; files: Record<string, { mime: string; base64: string }> }

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
  const out: ExportFile = { format: 'trust-planner-project', version: 1, exportedAt: new Date().toISOString(), project: p, files };
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importProject(text: string): Promise<Project> {
  const data = JSON.parse(text) as ExportFile;
  if (data.format !== 'trust-planner-project') throw new Error('Это не файл проекта планировщика');
  for (const [id, f] of Object.entries(data.files ?? {})) await putFile(id, fromBase64(f.base64, f.mime));
  await saveProject(data.project);
  return data.project;
}
