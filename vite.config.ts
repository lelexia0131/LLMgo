import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: 'desktop', base: './', plugins: [react()],
  resolve: {alias: [
    {find: /^preact\/hooks$/, replacement: 'react'},
    {find: /^preact$/, replacement: path.resolve('desktop/src/board/preact-react.ts')}
  ]},
  build: {outDir: '../dist/renderer', emptyOutDir: true},
  server: {host: '127.0.0.1', port: 5173, strictPort: true}
})
