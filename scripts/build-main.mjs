// Bundle the Electron main and preload processes (renderer is built by Vite).
import { build } from 'esbuild'

const common = { bundle: true, platform: 'node', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'warning' }
await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', format: 'cjs' })
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js', format: 'cjs' })
