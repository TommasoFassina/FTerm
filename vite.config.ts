import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: 'esbuild',
            target: 'node20',
            sourcemap: false,
            rollupOptions: {
              external: [
                'electron',
                'node-pty',
                'canvas',
                'fluent-ffmpeg',
                'ffmpeg-static',
                '@ffprobe-installer/ffprobe',
                'ws',
                'bufferutil',
                'utf-8-validate',
              ],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: 'esbuild',
            target: 'chrome120',
            sourcemap: false,
            rollupOptions: { external: ['electron'] },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
    },
  },
  build: {
    target: 'chrome120',          // Electron 41 ships Chromium 134 — safe to target modern
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy vendor libs so Monaco / xterm don't bloat the entry chunk
          monaco: ['monaco-editor', '@monaco-editor/react'],
          xterm: [
            '@xterm/xterm',
            '@xterm/addon-canvas',
            '@xterm/addon-fit',
            '@xterm/addon-search',
            '@xterm/addon-unicode11',
            '@xterm/addon-web-links',
            '@xterm/addon-webgl',
          ],
          markdown: ['react-markdown', 'remark-gfm'],
          motion: ['motion'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
