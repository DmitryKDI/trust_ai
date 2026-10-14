import type { Brief, FurnitureType, LayoutNeeds, RoomType } from '../model/types';
import { uid } from '../model/defaults';
import { CATALOG } from '../furniture/catalog';
import { ROOM_TYPES } from '../learning/model';
import { layoutNeeds } from './requirements';
import { SizeInput } from '../editor/SizeInput';

export function RequirementsEditor({ brief, onChange }: { brief: Brief; onChange: (needs: LayoutNeeds) => void }) {
  const needs = layoutNeeds(brief);
  const types = Object.keys(CATALOG) as FurnitureType[];
  const patch = (id: string, values: Partial<LayoutNeeds['required'][number]>) => onChange({ ...needs, required: needs.required.map(r => r.id === id ? { ...r, ...values, count: Math.min(values.count ?? r.count, Math.max(1, 24 - needs.required.filter(x => x.id !== id).reduce((s, x) => s + x.count, 0))) } : r) });
  return <section style={{ marginTop: 18 }}>
    <h2>Требования к подбору</h2>
    <p className="muted small">Выбранные требования проверяются в каждом варианте. Текстовые поля ниже остаются заметками для менеджера.</p>
    <label className="field">Рабочих мест для взрослых<input type="number" min={0} max={4} value={needs.workplaces} onChange={e => onChange({ ...needs, workplaces: Math.max(0, Math.min(4, Math.round(Number(e.target.value) || 0))) })} /></label>
    <div className="actions"><button className="btn secondary sm" onClick={() => onChange({ ...needs, workplaces: 2 })}>Два рабочих места</button>
      <button className="btn secondary sm" disabled={needs.required.filter(r => r.id !== 'own-bed').length >= 12 || needs.required.filter(r => r.id !== 'own-bed').reduce((s, r) => s + r.count, 0) >= 24} onClick={() => onChange({ ...needs, required: [...needs.required.filter(r => r.id !== 'own-bed'), { id: 'own-bed', type: 'bed-double', count: 1, roomType: 'bedroom', w: 1600, d: 2100 }] })}>Своя кровать с точными размерами</button></div>
    <h3>Обязательные предметы</h3>
    {needs.required.map(r => <div className="card" key={r.id} style={{ padding: 12, marginBottom: 10 }}>
      <div className="fields">
        <label className="field">Предмет<select value={r.type} onChange={e => patch(r.id, { type: e.target.value as FurnitureType })}>{types.map(t => <option key={t} value={t}>{CATALOG[t].name}</option>)}</select></label>
        <label className="field">Количество<input type="number" min={1} max={6} value={r.count} onChange={e => patch(r.id, { count: Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))) })} /></label>
        <label className="field">Где разместить<select value={r.roomType ?? ''} onChange={e => patch(r.id, { roomType: (e.target.value || null) as RoomType | null })}><option value="">Подходящее помещение</option>{ROOM_TYPES.map(([t, label]) => <option key={t} value={t}>{label}</option>)}</select></label>
        <label className="check-inline"><input type="checkbox" checked={r.w !== undefined && r.d !== undefined} onChange={e => patch(r.id, { w: e.target.checked ? CATALOG[r.type].w : undefined, d: e.target.checked ? CATALOG[r.type].d : undefined })} />Точные размеры</label>
        {r.w !== undefined && r.d !== undefined && <><SizeInput label="Ширина обязательного предмета, мм" value={r.w} onCommit={w => patch(r.id, { w })} /><SizeInput label="Глубина обязательного предмета, мм" value={r.d} onCommit={d => patch(r.id, { d })} /><span className="hint wide">Полный габарит, включая каркас, до поворота предмета.</span></>}
      </div>
      <button className="btn ghost sm" onClick={() => onChange({ ...needs, required: needs.required.filter(x => x.id !== r.id) })}>Убрать требование</button>
    </div>)}
    <button className="btn secondary sm" disabled={needs.required.length >= 12 || needs.required.reduce((s, r) => s + r.count, 0) >= 24} onClick={() => onChange({ ...needs, required: [...needs.required, { id: uid('need'), type: 'wardrobe', count: 1, roomType: null }] })}>Добавить обязательный предмет</button>
    <details style={{ marginTop: 14 }}><summary>Какие предметы исключить</summary><div className="fields">{types.map(type => <label className="check-inline" key={type}><input type="checkbox" checked={needs.forbidden.includes(type)} onChange={e => onChange({ ...needs, forbidden: e.target.checked ? [...needs.forbidden, type] : needs.forbidden.filter(t => t !== type) })} />{CATALOG[type].name}</label>)}</div></details>
    {needs.required.some(r => needs.forbidden.includes(r.type)) && <p className="notice err">Обязательный предмет одновременно запрещён. Уберите запрет или требование.</p>}
  </section>;
}
