import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { sceneBackend } from './server/scene-plugin.ts'

export default defineConfig(({ mode }) => ({
  base: './',
  // the scene writer's key lives in .env on the machine that serves the page, never in the bundle:
  // the empty prefix reads every variable, VITE_-prefixed or not, and only the dev and preview
  // servers are handed them
  plugins: [react(), sceneBackend(loadEnv(mode, process.cwd(), ''))],
  server: { port: 5181 },
  // the background builder pulls its font in on demand, which makes it a code-split bundle, and
  // Vite's default iife worker format cannot split
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
}))
