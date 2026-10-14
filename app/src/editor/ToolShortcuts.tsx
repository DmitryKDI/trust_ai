export function ToolShortcuts({ tools }: { tools: readonly { key: string; label: string }[] }) {
  const common = [
    ['Пробел (удерживать)', 'Временно двигать план'],
    ['Enter', 'Завершить полилинию или контур комнаты'],
    ['Esc', 'Отменить начатое действие и снять выделение'],
    ['Shift + щелчок', 'Добавить или исключить объект из выделения'],
    ['Shift при рисовании', 'Горизонталь или вертикаль'],
    ['Alt при перемещении угла', 'Отключить привязку точки'],
    ['Delete / Backspace', 'Удалить выбранные объекты'],
    ['Ctrl + Z', 'Отменить изменение или последнюю точку'],
    ['Ctrl + Y / Ctrl + Shift + Z', 'Повторить отменённое изменение'],
  ];
  return <details className="shortcut-help">
    <summary>Горячие клавиши</summary>
    <p className="muted small">Работают в русской и английской раскладках. При вводе текста и чисел инструменты не переключаются.</p>
    <table aria-label="Горячие клавиши редактора"><thead><tr><th>Клавиша</th><th>Действие</th></tr></thead><tbody>
      {tools.map(t => <tr key={t.key}><td><kbd>{t.key}</kbd></td><td>{t.label}</td></tr>)}
      {common.map(([key, label]) => <tr key={key}><td><kbd>{key}</kbd></td><td>{label}</td></tr>)}
    </tbody></table>
    <p className="hint">Колесо мыши — масштаб. Средняя кнопка мыши — временно двигать план.</p>
  </details>;
}
