import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Standalone artifact installed on the dedicated worker. The server and worker
// compile the same provider identity checks and the same outbound allowlist.
export default defineConfig({
  publicDir: false,
  build: {
    target: 'node22',
    outDir: fileURLToPath(new URL('../../../node_modules/.cache/fxiaoke-egress/', import.meta.url)),
    lib: { entry: fileURLToPath(new URL('./worker.mjs', import.meta.url)), formats: ['es'], fileName: () => 'worker.mjs' },
    rolldownOptions: { external: ['@supabase/supabase-js', /^node:/] },
    minify: false,
  },
})
