import type { FurnitureItem } from '../model/types';

/** Пользовательский размер сохраняет центр, поворот и порядок модулей кухни. */
export function resizeFurniture(item: FurnitureItem, w: number, d: number): FurnitureItem {
  if (![w, d].every(n => Number.isFinite(n) && n >= 100 && n <= 10000)) throw new Error('Размер предмета должен быть от 100 до 10000 мм.');
  const total = item.modules?.reduce((sum, m) => sum + m.w, 0) ?? 0;
  return { ...item, w, d, movedByManager: true,
    ...(item.type === 'kitchen-run' && total > 0 ? { modules: item.modules!.map(m => ({ ...m, w: m.w * w / total })) } : {}),
  };
}
