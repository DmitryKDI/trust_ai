/** Горячие клавиши не вмешиваются в ввод текста и другой редактор на той же странице. */
export function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function ownsShortcut(root: HTMLElement | null, event: KeyboardEvent): boolean {
  return !event.defaultPrevented && !isTextInput(event.target) && !!root?.contains(document.activeElement);
}

/** Physical keys work in Russian and English layouts. Text inputs keep native undo. */
export function historyShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'key'>): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.code === 'KeyZ' || ['z', 'я'].includes(event.key.toLowerCase())) return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' || ['y', 'н'].includes(event.key.toLowerCase())) return 'redo';
  return null;
}
