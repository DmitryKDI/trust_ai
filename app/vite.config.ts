import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Serve only the app and imported rule configuration, never sibling documents or source plans.
const appRoot = fileURLToPath(new URL('.', import.meta.url));
const configRoot = fileURLToPath(new URL('../config', import.meta.url));
const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5190, strictPort: true, cors: false, allowedHosts: ['localhost'], headers, fs: { strict: true, allow: [appRoot, configRoot] } },
  preview: { host: '127.0.0.1', port: 5190, strictPort: true, cors: false, allowedHosts: ['localhost'], headers },
  resolve: { alias: { '@config': fileURLToPath(new URL('../config', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
