// 通过 Supabase Management API 执行 SQL（SUPABASE_ACCESS_TOKEN）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const REF = 'wfawwhphfqqwfwrrkogy'
const FILES = process.argv.slice(2)
if (!TOKEN || FILES.length === 0) { console.error('usage: node script.mjs <file1> [file2...]'); process.exit(1) }
for (const file of FILES) {
  const sql = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', file), 'utf-8')
  console.log(`▶️  ${file}`)
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  console.log(res.ok ? '   ✅ ok' : `   ❌ HTTP ${res.status}: ${text.slice(0, 500)}`)
}
console.log('🏁 done')
