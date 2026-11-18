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

  it('keeps expanded operator forms inside the order column', () => {
    const style = document.createElement('style')
    style.textContent = css
    const container = document.createElement('div')
    container.innerHTML = '<div class="orderList"><article class="orderCard"><form class="returnForm"><div class="batchFields"><label>收件人<input value="测试收件人"></label><label>联系电话<input value="13800000000"></label></div><div class="formActions"><button>保存为新版本</button></div></form></article></div>'
    document.head.append(style)
    document.body.append(container)
    try {
      const computed = (selector: string) => getComputedStyle(container.querySelector(selector)!)
      expect(computed('.batchFields').display).toBe('grid')
      expect(computed('.formActions').display).toBe('flex')
      expect(computed('.orderList').gridTemplateColumns.replace(/\s/g, '')).toBe('minmax(0,1fr)')
      expect(computed('.orderCard').minWidth).toBe('0px')
      expect(computed('label').minWidth).toBe('0px')
      expect(computed('input').width).toBe('100%')
      expect(computed('input').minWidth).toBe('0px')
      expect(computed('input').boxSizing).toBe('border-box')
    } finally {
      style.remove()
      container.remove()
    }
  })
})
