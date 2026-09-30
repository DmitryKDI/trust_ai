import { useStore } from '../state/store';
import { RULE_DEFS, type RuleKey } from '../rules/rules';

export function RulesModal({ onClose }: { onClose: () => void }) {
  const { project, update, rules } = useStore();
  const set = (k: RuleKey, v: string) => update((p) => {
    const o = { ...p.ruleOverrides };
    const n = Number(v);
    if (v === '' || !Number.isFinite(n) || n === RULE_DEFS[k].value) delete o[k];
    else o[k] = n;
    return { ...p, ruleOverrides: o };
  });
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Правила-допущения" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Правила-допущения</h2>
        <p className="muted small">Рабочие значения до ответа заказчика — не нормативы. Изменения действуют для этого проекта; значения по умолчанию — в <code>config/rules.default.json</code>. После правки пересоберите варианты.</p>
        <table className="rules">
          <thead><tr><th>Параметр</th><th>Значение</th><th>По умолчанию</th></tr></thead>
          <tbody>
            {(Object.keys(RULE_DEFS) as RuleKey[]).map((k) => (
              <tr key={k}>
                <td>{RULE_DEFS[k].note}<div className="muted" style={{ fontSize: 11 }}>{k} · {RULE_DEFS[k].status === 'assumption' ? 'допущение' : RULE_DEFS[k].status}</div></td>
                <td><input type="number" value={rules[k]} onChange={(e) => set(k, e.target.value)} aria-label={RULE_DEFS[k].note} /> {RULE_DEFS[k].unit}</td>
                <td className="muted">{RULE_DEFS[k].value}{project.ruleOverrides[k] !== undefined && ' · изменено'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions"><button className="btn" onClick={onClose}>Готово</button><button className="btn ghost" onClick={() => update((p) => ({ ...p, ruleOverrides: {} }))}>Сбросить к умолчаниям</button></div>
      </div>
    </div>
  );
}
