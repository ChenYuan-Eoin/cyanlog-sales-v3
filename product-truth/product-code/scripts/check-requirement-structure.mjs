// REQ: WP10. Narrow structural checks; does not claim business acceptance.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/** @param {string} content @param {(filePath: string) => boolean} [exists] */
export function checkRequirementStructure(content, exists = () => true) {
  const errors = []
  const statuses = new Set(['draft', 'confirmed', 'design_in_progress', 'design_confirmed', 'in_progress', 'completed', 'deprecated'])
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex(line => /^requirements:\s*$/.test(line))
  if (start < 0) return { count: 0, errors: ['Missing requirements mapping'] }
  const records = []
  const seen = new Set()
  let current
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z_][^:]*:/.test(line)) break
    const id = line.match(/^  (F\d{3}(?:v\d+)?):\s*$/)
    if (id) {
      if (seen.has(id[1])) errors.push(`Duplicate requirement: ${id[1]}`)
      seen.add(id[1]); current = { id: id[1] }; records.push(current); continue
    }
    if (/^  [A-Za-z0-9_]+:\s*$/.test(line)) errors.push(`Unsupported requirement key: ${line.trim()}`)
    const field = line.match(/^    (name|status|feature_packet):\s*(.+)$/)
    if (current && field) current[field[1]] = field[2].trim().replace(/^['"]|['"]$/g, '')
  }
  if (!records.length) errors.push('No requirement records found')
  for (const r of records) {
    if (!r.name) errors.push(`${r.id}: missing name`)
    if (!statuses.has(r.status)) errors.push(`${r.id}: invalid lifecycle status ${r.status}`)
    if (r.feature_packet && !exists(r.feature_packet)) errors.push(`${r.id}: missing Feature Packet ${r.feature_packet}`)
  }
  return { count: records.length, errors }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  const result = checkRequirementStructure(fs.readFileSync(path.join(root, 'product-truth/REQ_REGISTRY.yml'), 'utf8'), p => fs.existsSync(path.join(root, p)))
  console.log(JSON.stringify({ scope: 'IDs, lifecycle statuses, declared Feature Packet paths only', ...result }, null, 2))
  if (result.errors.length) process.exitCode = 1
}
