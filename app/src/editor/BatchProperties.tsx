import type { PlanGeometry } from '../model/types';
import { ROOM_TYPES } from '../learning/model';
import { WALL_KINDS } from './ops';
import { changeSelectionType, ELEMENT_KEYS, FIXED_TYPES, type ElementSelection } from './selection';

export function BatchProperties({ geometry, selection, onChange, onDelete }: { geometry: PlanGeometry; selection: ElementSelection[]; onChange: (fn: (g: PlanGeometry) => PlanGeometry) => void; onDelete: () => void }) {
  if (selection.length < 2) return null;
  const groups = [...new Set(selection.map(s => s.kind))].map(kind => ({ kind, selected: selection.filter(s => s.kind === kind) }));
  const labels = { wall: 'Стены', opening: 'Проёмы', room: 'Комнаты', fixed: 'Инженерные элементы', wet: 'Мокрые зоны' };
  return <div className="card" data-batch-selection={selection.length}>
    <h3>Выбрано элементов: {selection.length}</h3>
    {groups.map(({ kind, selected }) => {
      const options = kind === 'wall' ? WALL_KINDS : kind === 'room' ? ROOM_TYPES : kind === 'fixed' ? FIXED_TYPES : kind === 'opening' ? [['door', 'Дверь'], ['window', 'Окно']] : [];
      const values = selected.map(s => { const item = geometry[ELEMENT_KEYS[s.kind]].find(x => x.id === s.id); return item && ('type' in item ? item.type : 'kind' in item ? item.kind : ''); });
      const common = values.every(v => v === values[0]) ? values[0] ?? '' : '';
      return <div key={kind}><p className="small">{labels[kind]}: {selected.length}</p>{options.length > 0 && <label className="field">{groups.length === 1 ? 'Тип выбранных элементов' : `Тип: ${labels[kind].toLowerCase()}`}<select value={common} onChange={e => onChange(g => changeSelectionType(g, selected, e.target.value))}>
        <option value="" disabled>Разные типы</option>{options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
      </select></label>}</div>;
    })}
    <div className="actions"><button className="btn ghost sm" onClick={onDelete}>Удалить выбранные ({selection.length})</button></div>
    <p className="muted small">Shift + щелчок — добавить или исключить элемент. Изменение группы отменяется одним Ctrl+Z.</p>
  </div>;
}
