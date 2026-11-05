import postcss, { type Root } from 'postcss'
import tailwindcss from 'tailwindcss'
import { beforeAll, describe, expect, it } from 'vitest'
import config from './tailwind.config'

// Keep this test outside the content globs: its assertions must not themselves
// supply the missing utility names to Tailwind and hide a production regression.
describe('shared confirmation styles in production CSS', () => {
  let css: Root

  beforeAll(async () => {
    const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', {
      from: undefined,
    })
    css = result.root
  }, 30_000)

  function declaration(selector: string, property: string) {
    let value: string | undefined
    css.walkRules(selector, rule => {
      rule.walkDecls(property, decl => { value = decl.value })
    })
    return value
  }

  it('emits an opaque background for both confirmation button variants', () => {
    expect(declaration('.bg-red-600', 'background-color')).toBe('rgb(220 38 38 / var(--tw-bg-opacity, 1))')
    expect(declaration('.bg-slate-900', 'background-color')).toBe('rgb(15 23 42 / var(--tw-bg-opacity, 1))')
    expect(declaration('.text-white', 'color')).toBe('rgb(255 255 255 / var(--tw-text-opacity, 1))')
  })

  it('emits the dimmed overlay above the application', () => {
    expect(declaration(String.raw`.bg-slate-950\/40`, 'background-color')).toBe('rgb(2 6 23 / 0.4)')
    expect(declaration(String.raw`.z-\[120\]`, 'z-index')).toBe('120')
    expect(declaration('.fixed', 'position')).toBe('fixed')
    expect(declaration('.inset-0', 'inset')).toBe('0px')
  })

  it('retains a visible shadow on the white dialog surface', () => {
    expect(declaration('.shadow-xl', '--tw-shadow')).toContain('0 20px 25px -5px')
    expect(declaration('.shadow-xl', 'box-shadow')).toContain('var(--tw-shadow)')
    expect(declaration('.bg-white', 'background-color')).toBe('rgb(255 255 255 / var(--tw-bg-opacity, 1))')
  })
})
