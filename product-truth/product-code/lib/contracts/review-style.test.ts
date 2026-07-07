import { describe, expect, it } from 'vitest'
import { reviewStyleLabel, reviewStyleOptions, reviewStyleStrategy } from './review-style'

describe('contract review style', () => {
  it('maps user-facing review styles to backend review strategy codes', () => {
    expect(reviewStyleStrategy('strict')).toBe('AGGRESSIVE')
    expect(reviewStyleStrategy('balanced')).toBe('BALANCED')
    expect(reviewStyleStrategy('business')).toBe('CONSERVATIVE')
  })

  it('keeps the three visible launch options explicit', () => {
    expect(reviewStyleOptions.map((option) => option.label)).toEqual(['严审', '均衡', '商务'])
    expect(reviewStyleLabel('strict')).toBe('严审')
    expect(reviewStyleLabel('balanced')).toBe('均衡')
    expect(reviewStyleLabel('business')).toBe('商务')
  })
})
