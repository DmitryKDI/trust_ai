import type { FurnitureItem, FurnitureType } from '../model/types';
import { kitchenModules } from '../furniture/catalog';

export function changeFurnitureType(item: FurnitureItem, type: FurnitureType): FurnitureItem {
  return resizeFurniture({ ...item, type, modules: type === 'kitchen-run' ? item.type === 'kitchen-run' ? item.modules : kitchenModules(item.w, true) : undefined, seats: type === 'dining' ? item.seats ?? 4 : undefined }, item.w, item.d);
}

/** Пользовательский размер сохраняет центр, поворот и порядок модулей кухни. */
export function resizeFurniture(item: FurnitureItem, w: number, d: number): FurnitureItem {
  if (![w, d].every(n => Number.isFinite(n) && n >= 100 && n <= 10000)) throw new Error('Размер предмета должен быть от 100 до 10000 мм.');
  const total = item.modules?.reduce((sum, m) => sum + m.w, 0) ?? 0;
  return { ...item, w, d, movedByManager: true,
    ...(item.type === 'kitchen-run' && total > 0 ? { modules: item.modules!.map(m => ({ ...m, w: m.w * w / total })) } : {}),
  };
}
