import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app/sales-portal/sales-portal.module.css'), 'utf8')

const base = css.slice(0, css.indexOf('@container (max-width:340px)'))

describe('owner record panel rail layout', () => {
  it('keeps refresh beside a three-column filter grid instead of wrapping it onto its own row', () => {
    expect(base).toContain('.recordToolbar{display:grid;grid-template-columns:minmax(0,1fr) 36px')
    expect(base).toContain('.recordFilters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))')
    expect(base).toContain('.refreshRecords{display:inline-flex;grid-column:2;grid-row:1')
  })

  it('keeps long order numbers truncated beside their copy control', () => {
    expect(css).toContain('.receiptOrderNo{')
    expect(css).toMatch(/\.receiptOrderNo\{[^}]*white-space:nowrap;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis/)
    expect(base).toContain('.receiptOrderGroup{display:grid;grid-template-columns:minmax(0,1fr) 24px')
  })
})
