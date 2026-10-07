export function checkedRasterSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 32000000) {
    throw new Error('Изображение страницы слишком большое. Уменьшите разрешение или извлеките нужный фрагмент плана.');
  }
}
