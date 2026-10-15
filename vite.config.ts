import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    {
      // The dev server needs localhost in connect-src for hot reload; production builds must not allow it.
      name: 'strip-dev-csp',
      transformIndexHtml: (html, ctx) => (ctx.server ? html : html.replace(/ ws:\/\/localhost:5173 http:\/\/localhost:5173/, '')),
    },
  ],
  build: { outDir: '../../dist/renderer', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, strictPort: true },
})
