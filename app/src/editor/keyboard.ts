/** Горячие клавиши не вмешиваются в ввод текста и другой редактор на той же странице. */
export function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function ownsShortcut(root: HTMLElement | null, event: KeyboardEvent): boolean {
  return !event.defaultPrevented && !isTextInput(event.target) && !!root?.contains(document.activeElement);
}
