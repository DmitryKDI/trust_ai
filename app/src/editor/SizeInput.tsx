import { useEffect, useState } from 'react';

/** Полный ввод размера: пустое поле во время набора не изменяет геометрию. */
export function SizeInput({ label, value, min = 100, max = 10000, onCommit }: {
  label: string; value: number; min?: number; max?: number; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(Math.round(value)));
  const [error, setError] = useState('');
  useEffect(() => { setText(String(Math.round(value))); setError(''); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n) || n < min || n > max) { setError(`Введите размер от ${min} до ${max} мм.`); return; }
    setError('');
    if (n !== value) onCommit(n);
  };
  return <label className="field">{label}
    <input type="number" inputMode="decimal" min={min} max={max} step="any" value={text}
      aria-invalid={!!error} onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
    {error && <span className="hint" role="alert">{error}</span>}
  </label>;
}
