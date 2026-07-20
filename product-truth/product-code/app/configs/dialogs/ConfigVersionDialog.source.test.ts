import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/configs/dialogs/ConfigVersionDialog.tsx'), 'utf8')

describe('config version dialog source contract', () => {
  it('closes version history before opening the rollback confirmation portal', () => {
    const closeOffset = source.indexOf('onOpenChange(false)')
    const nextFrameOffset = source.indexOf('window.requestAnimationFrame')
    const rollbackOffset = source.indexOf('void onRollback(configId, version)')

    expect(closeOffset).toBeGreaterThan(-1)
    expect(nextFrameOffset).toBeGreaterThan(closeOffset)
    expect(rollbackOffset).toBeGreaterThan(nextFrameOffset)
    expect(source).toContain('requestRollback(versionConfigId, version.version)')
  })
})
