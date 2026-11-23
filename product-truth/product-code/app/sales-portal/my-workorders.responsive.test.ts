import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app/sales-portal/sales-portal.module.css'), 'utf8')

function extractBlock(source: string, marker: string) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }
  return ''
}

const narrow = extractBlock(css, '@container (max-width:340px)')

describe('owner record panel narrow container layout', () => {
  it('keeps refresh beside a three-column filter grid instead of wrapping it onto its own row', () => {
    expect(narrow).toContain('.recordToolbar{display:grid;grid-template-columns:minmax(0,1fr) 36px')
    expect(narrow).toContain('.recordFilters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))')
    expect(narrow).toContain('.refreshRecords{grid-column:2;grid-row:1')
  })

  it('keeps long order numbers truncated beside their copy control', () => {
    expect(css).toContain('.receiptOrderNo{')
    expect(css).toMatch(/\.receiptOrderNo\{[^}]*white-space:nowrap;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis/)
    expect(narrow).toContain('.receiptOrderGroup{display:grid;grid-template-columns:minmax(0,1fr) 24px')
  })
})
