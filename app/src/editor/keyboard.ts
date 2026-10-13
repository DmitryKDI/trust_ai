/** Горячие клавиши не вмешиваются в ввод текста и другой редактор на той же странице. */
export function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function ownsShortcut(root: HTMLElement | null, event: KeyboardEvent, allowUnfocused = false): boolean {
  return !event.defaultPrevented && !isTextInput(event.target) && !!root && (root.contains(document.activeElement) || allowUnfocused && document.activeElement === document.body);
}

/** Use the physical letter; fallback supports synthetic events and Russian layouts. */
export function toolShortcut(event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>, letter: string): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  const key = letter.toUpperCase();
  if (/^Key[A-Z]$/.test(event.code)) return event.code === `Key${key}`;
  const russian: Record<string, string> = { V: 'м', H: 'р', C: 'с', P: 'з', W: 'ц', G: 'п', D: 'в', O: 'щ', S: 'ы', F: 'а', Z: 'я', R: 'к', N: 'т', A: 'ф', X: 'ч', M: 'ь' };
  return event.key.toUpperCase() === key || event.key.toLowerCase() === russian[key];
}

/** Physical keys work in Russian and English layouts. Text inputs keep native undo. */
export function historyShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'key'>): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.code === 'KeyZ' || ['z', 'я'].includes(event.key.toLowerCase())) return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' || ['y', 'н'].includes(event.key.toLowerCase())) return 'redo';
  return null;
}
