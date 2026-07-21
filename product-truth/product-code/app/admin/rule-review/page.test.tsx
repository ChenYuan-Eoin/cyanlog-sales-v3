import { describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ redirect }))

import RuleReviewPage from './page'

describe('/admin/rule-review', () => {
  it('redirects the obsolete text-only screen to formal contract review', () => {
    RuleReviewPage()

    expect(redirect).toHaveBeenCalledWith('/contracts')
  })
})
