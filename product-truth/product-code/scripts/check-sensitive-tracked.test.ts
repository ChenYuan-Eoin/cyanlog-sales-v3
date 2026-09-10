// REQ: WP10. Detect root secrets even when CI starts inside the app directory.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
// Git hooks export GIT_DIR/GIT_INDEX_FILE; never forward them to fixture repositories.
const gitEnv: NodeJS.ProcessEnv = { ...process.env }
for (const key of Object.keys(gitEnv)) if (key.startsWith('GIT_')) delete gitEnv[key]
const checker = path.resolve(process.cwd(), 'scripts/check-sensitive-tracked.mjs')
describe('tracked environment gate', () => {
  it.each([['.env.local', 1], ['.env.example', 0]])('checks %s from a nested working directory', (name, expected) => {
    const root = mkdtempSync(path.join(tmpdir(), 'price-env-gate-'))
    try {
      mkdirSync(path.join(root, 'app'))
      execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnv })
      writeFileSync(path.join(root, name), 'DO_NOT_PRINT_FIXTURE_SECRET\n')
      execFileSync('git', ['add', name], { cwd: root, env: gitEnv })
      const result = spawnSync(process.execPath, [checker], { cwd: path.join(root, 'app'), env: gitEnv, encoding: 'utf8' })
      expect(result.status).toBe(expected)
      expect(result.stdout + result.stderr).not.toContain('DO_NOT_PRINT_FIXTURE_SECRET')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
