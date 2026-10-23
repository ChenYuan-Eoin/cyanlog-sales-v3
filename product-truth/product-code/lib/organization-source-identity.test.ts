import { describe, expect, it } from 'vitest'
import {
  buildIdentityIndex,
  resolveIdentityMatch,
  secondaryEnrichmentPatch,
} from './organization-source-identity'

describe('organization source identity matching', () => {
  it('matches only when all evidence resolves to one canonical account', () => {
    const index = buildIdentityIndex([
      {
        id: 'user-1',
        employeeId: 'E-1',
        email: 'One@Example.test',
        phone: '138 0000 0001',
      },
      { id: 'user-2', employeeId: 'E-2', email: 'two@example.test' },
    ])

    expect(resolveIdentityMatch(index, {
      employeeId: 'E-1',
      email: 'one@example.test',
      phone: '138-0000-0001',
    })).toEqual({ kind: 'unique', userId: 'user-1', method: 'employee_id' })
  })

  it('returns conflict when one identifier points at multiple accounts', () => {
    const index = buildIdentityIndex([
      { id: 'user-1', email: 'shared@example.test' },
      { id: 'user-2', email: 'shared@example.test' },
    ])

    expect(resolveIdentityMatch(index, { email: 'shared@example.test' })).toEqual({
      kind: 'conflict',
      candidateIds: ['user-1', 'user-2'],
    })
  })

  it('does not use a name as identity evidence', () => {
    const index = buildIdentityIndex([{ id: 'user-1', displayName: '张三' }])
    expect(resolveIdentityMatch(index, { email: null, phone: null })).toEqual({
      kind: 'none',
      candidateIds: [],
    })
  })

  it('secondary enrichment fills only absent safe profile fields', () => {
    expect(secondaryEnrichmentPatch(
      {
        id: 'user-1',
        email: 'authoritative@example.test',
        phone: null,
        title: null,
        avatarUrl: null,
      },
      {
        email: 'secondary@example.test',
        phone: '138-0000-0001',
        title: '销售经理',
        avatarUrl: 'https://example.test/avatar.png',
      },
    )).toEqual({
      phone: '13800000001',
      title: '销售经理',
      avatar_url: 'https://example.test/avatar.png',
    })
  })
})
