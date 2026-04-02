import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/scripts': 'http://localhost:3001',
      '/script-content': 'http://localhost:3001',
      '/run': 'http://localhost:3001',
      '/stop': 'http://localhost:3001',
      '/status': 'http://localhost:3001',
    },
  },
});
