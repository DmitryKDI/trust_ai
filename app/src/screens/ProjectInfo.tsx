import { useStore } from '../state/store';
import { exportProject } from '../storage/db';

export function ProjectScreen({ next }: { next: () => void }) {
  const { project, update } = useStore();
  const set = (k: 'alias' | 'city' | 'manager' | 'date', v: string) => update((p) => ({ ...p, [k]: v }));
  const backup = async () => {
    const url = URL.createObjectURL(await exportProject(project));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.alias || 'project'}.trust-plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="view">
      <div className="eyebrow">Шаг 1 · проект</div>
      <h1 className="heading">О проекте</h1>
      <p className="lead">Только рабочие данные. ФИО и адрес клиента не нужны — используйте псевдоним или номер.</p>
      <section className="card" style={{ maxWidth: 760 }}>
        <div className="fields">
          <label className="field">Псевдоним или номер клиента<input value={project.alias} onChange={(e) => set('alias', e.target.value)} /></label>
          <label className="field">Город<input value={project.city} onChange={(e) => set('city', e.target.value)} /></label>
          <label className="field">Менеджер<input value={project.manager} onChange={(e) => set('manager', e.target.value)} /></label>
          <label className="field">Дата<input type="date" value={project.date} onChange={(e) => set('date', e.target.value)} /></label>
        </div>
        <div className="actions">
          <button className="btn" onClick={next}>К загрузке плана</button>
          <button className="btn secondary" onClick={backup}>Резервная копия (JSON)</button>
        </div>
        <div className="notice">Проект сохраняется в этом браузере автоматически. Резервная копия содержит исходные файлы — не пересылайте её третьим лицам.</div>
      </section>
    </div>
  );
}
