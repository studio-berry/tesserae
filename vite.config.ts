import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5181 },
  // the background builder pulls its font in on demand, which makes it a code-split bundle, and
  // Vite's default iife worker format cannot split
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
})
