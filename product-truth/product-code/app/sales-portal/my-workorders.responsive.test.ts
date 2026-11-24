import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'app/sales-portal/sales-portal.module.css'), 'utf8')

const base = css.slice(0, css.indexOf('@container (max-width:340px)'))

describe('owner record panel rail layout', () => {
  it('keeps a stable three-column filter grid beside a fixed refresh control', () => {
    expect(base).toContain('.recordToolbar{display:grid;grid-template-columns:minmax(0,1fr) 34px')
    expect(base).toContain('.recordFilters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))')
    expect(base).toContain('.recordFilters button{width:100%')
    expect(base).not.toContain('.recordFilters{display:flex')
    expect(base).toContain('.refreshRecords{display:inline-flex;grid-column:2;grid-row:1')
  })

  it('shows the full waybill on wrapped lines beside its fixed copy control', () => {
    expect(css).toContain('.receiptOrderNo{')
    expect(css).toMatch(/\.receiptOrderNo\{[^}]*white-space:nowrap;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis/)
    expect(base).toContain('.receiptOrderGroup{display:grid;grid-template-columns:minmax(0,1fr) 24px')
    expect(base).toContain('.trackingNumberGroup{display:grid;grid-template-columns:minmax(0,1fr) 24px')
    expect(base).toMatch(/\.trackingBar \.trackingNumber\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/)
    expect(base).not.toMatch(/\.trackingBar \.trackingNumber\{[^}]*text-overflow:ellipsis/)
    expect(base).not.toContain('.records button{')
    expect(base).not.toContain('.records li strong,.records li span{display:block}')
  })

  it('keeps the rendered full waybill and copy action bound to the same value', () => {
    const source = readFileSync(join(process.cwd(), 'app/sales-portal/my-workorders.tsx'), 'utf8')
    expect(source).toContain('<strong className={styles.trackingNumber} title={order.waybill}>{order.waybill}</strong>')
    expect(source).toContain('<CopyControl value={order.waybill} label="顺丰单号"')
    expect(source).not.toMatch(/trackingNumber[^\n]*slice\(|trackingNumber[^\n]*substring\(|trackingNumber[^\n]*replace\(/)
  })

  it('keeps compact action buttons aligned to the content edge while expanded forms use the rail width', () => {
    expect(css).toContain('.receiptActions,.carrierActions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:7px;min-width:0;margin-left:auto}')
    expect(css).toContain('.receiptActions,.carrierActions{width:auto;max-width:100%;justify-content:flex-end}')
    expect(css).toContain('.receiptActions button,.carrierActions>button,.receiptActionBar>button{flex:0 0 auto}')
    expect(css).toContain('.carrierActions:has(form){width:100%}')
    expect(css).toContain('.carrierActions form button{width:100%}')
    expect(css).not.toContain('.receiptActions button,.carrierActions>button,.receiptActionBar>button{flex:1 1 auto}')
  })
})
