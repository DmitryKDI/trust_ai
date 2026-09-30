import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Каталог data/ (извлечённые страницы кейсов) лежит уровнем выше и не коммитится.
// В dev-режиме отдаём его по /cases/ для быстрой загрузки пилотных страниц.
const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5190, strictPort: true, fs: { allow: [root] } },
  resolve: { alias: { '@config': fileURLToPath(new URL('../config', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
