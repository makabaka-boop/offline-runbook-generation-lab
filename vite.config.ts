import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { generateServiceWorker } from './plugins/generate-service-worker';

export default defineConfig({
  plugins: [react(), generateServiceWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
