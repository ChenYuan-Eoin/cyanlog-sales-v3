import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app/shipping/workbench.module.css'), 'utf8')

describe('shipping workbench responsive layout', () => {
  it('uses real three, two and one column breakpoints without a fixed fake canvas', () => {
    expect(css).not.toContain('min-width:1080px')
    expect(css).toContain('@media(min-width:900px) and (max-width:1439px)')
    expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(css).toContain('@media(max-width:899px)')
    expect(css).toContain('grid-template-columns:minmax(0,1fr)')
    expect(css).toContain('.intakeColumn[data-mobile-open=true]{display:flex}')
  })
})
