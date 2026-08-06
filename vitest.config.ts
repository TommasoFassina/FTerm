import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Standalone config — deliberately does NOT reuse vite.config.ts, whose
// vite-plugin-electron entry would spawn an Electron process during test runs.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
    },
  },
})
