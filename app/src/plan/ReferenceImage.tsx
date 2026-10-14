import { isDesktop } from '../desktop';
import { localImageUrl } from '../storage/validate';

export function ReferenceImage({ url, caption }: { url: string; caption: string }) {
  if (isDesktop && !localImageUrl(url)) return <div className="notice" role="status">Добавьте файл изображения для референса «{caption || 'Без названия'}».</div>;
  return <img src={url} alt={caption} referrerPolicy="no-referrer" />;
}
