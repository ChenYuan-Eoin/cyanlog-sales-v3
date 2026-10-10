// REQ: WP10. Filename gate; no secret values are printed.
import { execFileSync } from 'node:child_process'
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const names = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const bad = names.filter(name => /(^|\/)\.env(?:\.|$)/.test(name) && !name.endsWith('/.env.example') && name !== '.env.example')
if (bad.length) {
  console.error('Private environment files must not be tracked:\n' + bad.join('\n'))
  process.exitCode = 1
} else console.log('No private environment files tracked (example templates allowed)')
