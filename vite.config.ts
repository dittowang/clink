import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so `npm run build` output runs from any static host or file path.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})
