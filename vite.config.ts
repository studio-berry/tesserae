import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5181 },
  build: { chunkSizeWarningLimit: 1500 },
})
