import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'components/ui/dialog.tsx'), 'utf8')

describe('shared dialog viewport contract', () => {
  it('separates viewport positioning from popup content scrolling', () => {
    expect(source).toContain('data-slot="dialog-viewport"')
    expect(source).toContain('<DialogViewport>')
    expect(source).toContain('overflow-y-auto overscroll-contain p-4')
    expect(source).toContain('max-h-[calc(100dvh-2rem)]')
    expect(source).toContain('relative grid')
    expect(source).not.toContain('fixed top-1/2 left-1/2')
    expect(source).not.toContain('supports-backdrop-filter:backdrop-blur')
  })
})
