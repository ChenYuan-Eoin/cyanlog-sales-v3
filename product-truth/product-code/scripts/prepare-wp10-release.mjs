// REQ: WP10. Produce a review artifact only; never connect to a database.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repo = path.resolve(root, '../..')
const runtime = path.resolve(repo, execFileSync('git', ['rev-parse', '--git-path', 'codex-runtime'], { cwd: repo, encoding: 'utf8' }).trim())
const names = [
  '20260820000001_quote_opportunity_link.sql',
  '20260820000002_quote_downstream_derivations.sql',
  '20260820000003_quote_opportunity_context.sql',
  '20260820000004_product_line.sql',
  '20260910000001_close_contract_service_access.sql',
  '20260910000002_atomic_quote_derivations.sql',
]
const inputs = names.map(name => ({ name, sql: fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8') }))
// These six reviewed files contain only top-level BEGIN;/COMMIT; lines;
// the function body uses PL/pgSQL BEGIN without a semicolon.
const sql = '-- REVIEW REQUIRED: Production execution requires separate approval.\nBEGIN;\nSET LOCAL lock_timeout = \'5s\';\nSET LOCAL statement_timeout = \'30s\';\n'
  + inputs.map(({ name, sql }) => `\n-- Source: ${name}\n${sql.replace(/^(?:BEGIN;|COMMIT;)\s*$/gm, '')}`).join('\n')
  + '\nCOMMIT;\n'
const output = path.join(runtime, 'repair')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'production-candidate.sql'), sql, { mode: 0o600 })
const manifest = {
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  sources: inputs.map(({ name, sql }) => ({ name, sha256: crypto.createHash('sha256').update(sql).digest('hex') })),
  sha256: crypto.createHash('sha256').update(sql).digest('hex'),
  execution: 'not_executed; reconcile migration history and verify isolated instance before approval',
}
fs.writeFileSync(path.join(output, 'migration-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ output, sha256: manifest.sha256 }))
