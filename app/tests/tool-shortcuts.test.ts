import { expect, it } from 'vitest';
import { toolShortcut } from '../src/editor/keyboard';
const base = { code: 'KeyH', key: 'р', ctrlKey: false, metaKey: false, altKey: false, repeat: false };
it('инструмент выбирается по физической клавише и поддерживает русскую раскладку без code', () => {
  expect(toolShortcut(base, 'H')).toBe(true);
  expect(toolShortcut({ ...base, code: 'KeyV', key: 'м' }, 'V')).toBe(true);
  expect(toolShortcut({ ...base, code: '', key: 'ц' }, 'W')).toBe(true);
  expect(toolShortcut({ ...base, code: 'KeyW', key: 'h' }, 'H')).toBe(false);
});
it('системные сочетания и удержание клавиши не переключают инструмент повторно', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'repeat'] as const) expect(toolShortcut({ ...base, [modifier]: true }, 'H')).toBe(false);
});
