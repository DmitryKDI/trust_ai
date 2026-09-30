import { useEffect, useState } from 'react';
import type { Project } from './model/types';
import { newProject } from './model/defaults';
import { deleteProject, exportProject, getProject, importProject, listProjects, saveProject } from './storage/db';
import { ProjectProvider, useStore } from './state/store';
import { UploadScreen } from './screens/Upload';
import { BriefScreen } from './screens/Brief';
import { MarkupScreen } from './screens/Markup';
import { VariantsScreen } from './screens/Variants';
import { ConceptScreen } from './screens/Concept';
import { ClientScreen } from './screens/Client';
import { ProjectScreen } from './screens/ProjectInfo';
import { RulesModal } from './screens/Rules';

export const STEPS = ['Проект', 'Загрузка', 'Бриф', 'Разметка', 'Варианты', 'Мини-концепция', 'Для клиента'] as const;
const LAST = 'trust-planner:last';

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(LAST); } catch { /* приватный режим */ }
    (id ? getProject(id) : Promise.resolve(undefined)).then((p) => { if (p) setProject(p); }).finally(() => setReady(true));
  }, []);

  const open = (p: Project | null) => {
    try { if (p) localStorage.setItem(LAST, p.id); else localStorage.removeItem(LAST); } catch { /* ignore */ }
    setProject(p);
  };

  if (!ready) return null;
  if (!project) return <Projects onOpen={open} />;
  return (
    <ProjectProvider key={project.id} initial={project}>
      <Workspace onClose={() => open(null)} />
    </ProjectProvider>
  );
}

function Workspace({ onClose }: { onClose: () => void }) {
  const { project, saving } = useStore();
  const [step, setStep] = useState(() => (project.variants.length ? 4 : project.documents.length ? 1 : 0));
  const [rulesOpen, setRulesOpen] = useState(false);
  const g = project.geometry;
  const approvedVariant = project.variants.find((v) => v.id === project.selectedVariantId && v.approved);
  const done = [true, project.documents.some((d) => d.role === 'plan'), !!project.brief.area || project.brief.adults > 0, g.approved, !!approvedVariant, !!approvedVariant, false];
  const go = (n: number) => { setStep(n); window.scrollTo(0, 0); };

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo"><span className="mark">Т</span><span>ТРАСТ РЕМОНТ<br /><small>планировщик</small></span></div>
        <nav className="nav" aria-label="Шаги">
          {STEPS.map((s, i) => (
            <button key={s} className={`${i === step ? 'active' : ''} ${done[i] && i !== step ? 'done' : ''}`} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
              <b>{i + 1}</b>{s}
            </button>
          ))}
        </nav>
        <div className="sidefoot">
          Предварительная концепция для первой встречи. Не является проектной документацией.
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => setRulesOpen(true)}>Правила</button>
            <button className="btn ghost sm" onClick={onClose}>Все проекты</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="top">
          <div><strong>{project.alias || 'Без названия'}</strong> · {STEPS[step]}</div>
          <div className="counts">
            <span className={`badge ${g.approved ? 'ok' : 'warn'}`}>{g.approved ? 'Геометрия утверждена' : 'Геометрия не утверждена'}</span>
            <span className="badge">{saving ? 'Сохранение…' : 'Сохранено в браузере'}</span>
            <button className="btn ghost sm no-print" onClick={() => setRulesOpen(true)}>Правила</button>
          </div>
        </div>
        {step === 0 && <ProjectScreen next={() => go(1)} />}
        {step === 1 && <UploadScreen next={() => go(2)} toVariants={() => go(4)} toMarkup={() => go(3)} />}
        {step === 2 && <BriefScreen next={() => go(3)} />}
        {step === 3 && <MarkupScreen next={() => go(4)} />}
        {step === 4 && <VariantsScreen next={() => go(5)} back={() => go(3)} />}
        {step === 5 && <ConceptScreen next={() => go(6)} />}
        {step === 6 && <ClientScreen back={() => go(4)} />}
      </main>
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

function Projects({ onOpen }: { onOpen: (p: Project) => void }) {
  const [list, setList] = useState<Project[]>([]);
  const [form, setForm] = useState({ alias: '', city: 'Москва', manager: '', date: new Date().toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => listProjects().then((l) => setList(l.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const p = newProject({ ...form, alias: form.alias.trim() || `Клиент ${list.length + 1}` });
    await saveProject(p);
    onOpen(p);
  };
  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try { onOpen(await importProject(await f.text())); } catch (e) { setMsg(String((e as Error).message)); }
  };
  const download = async (p: Project) => {
    const url = URL.createObjectURL(await exportProject(p));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.alias || 'project'}.trust-plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="main" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="logo" style={{ color: 'var(--ink)' }}><span className="mark">Т</span><span>ТРАСТ РЕМОНТ<br /><small style={{ color: 'var(--muted)' }}>планировщик</small></span></div>
      <div className="view">
        <div className="eyebrow">Предпродажная концепция</div>
        <h1 className="heading">Проекты</h1>
        <p className="lead">От плана квартиры до проверенных вариантов расстановки и аккуратной страницы для клиента. Проекты хранятся в этом браузере; сделайте резервную копию в JSON, чтобы перенести их.</p>
        <div className="grid2">
          <section className="card">
            <h2>Новый проект</h2>
            <div className="fields">
              <label className="field">Псевдоним или номер клиента<input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="Например, К-0412" /><span className="hint">ФИО и адрес не нужны</span></label>
              <label className="field">Город<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
              <label className="field">Менеджер<input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} /></label>
              <label className="field">Дата<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            </div>
            <div className="actions">
              <button className="btn" onClick={create}>Создать проект</button>
              <label className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
                Импорт из JSON<input type="file" accept=".json,application/json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
              </label>
            </div>
            {msg && <div className="notice err">{msg}</div>}
          </section>
          <section className="card">
            <h2>Сохранённые</h2>
            {!list.length && <p className="muted">Пока нет проектов.</p>}
            <div className="projects">
              {list.map((p) => (
                <div className="prow" key={p.id}>
                  <div><strong>{p.alias}</strong><div className="muted small">{p.city} · {p.manager || 'менеджер не указан'} · {new Date(p.updatedAt).toLocaleString('ru-RU')}</div></div>
                  <div className="actions" style={{ margin: 0 }}>
                    <button className="btn sm" onClick={() => onOpen(p)}>Открыть</button>
                    <button className="btn secondary sm" onClick={() => download(p)}>Резервная копия</button>
                    <button className="btn ghost sm" onClick={async () => { if (confirm(`Удалить проект «${p.alias}» из браузера?`)) { await deleteProject(p); refresh(); } }}>Удалить</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
