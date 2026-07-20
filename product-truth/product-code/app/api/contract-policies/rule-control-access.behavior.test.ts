import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  configAccess: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (
    _req: unknown,
    handler: (user: { id: string }, orgId: string) => Promise<Response>
  ) => handler({ id: 'user-1' }, 'org-1'),
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import {
  DELETE as deleteCategory,
  GET as getCategory,
  PATCH as patchCategory,
} from './rule-categories/[id]/route'
import { GET as getRuleSets, POST as createRuleSet } from './rule-sets/route'
import {
  GET as getRuleSetDocuments,
  POST as createRuleSetDocument,
} from './rule-sets/[id]/documents/route'
import { GET as getRuleVersions } from './rules/[id]/versions/route'

function request(body: unknown = {}) {
  return {
    url: 'http://localhost/api/contract-policies/test',
    json: async () => body,
  } as unknown as NextRequest
}

const idParams = { params: Promise.resolve({ id: 'resource-1' }) }

async function expectForbidden(responsePromise: Promise<Response>, permission: string) {
  const response = await responsePromise
  const body = await response.json()
  expect(response.status).toBe(403)
  expect(body.error.message).toContain(permission)
}

describe('rule control routes fail closed before database access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(false)
  })

  it('protects problem-category detail read, edit and delete', async () => {
    await expectForbidden(getCategory(request(), idParams), 'config:read')
    await expectForbidden(patchCategory(request(), idParams), 'config:write')
    await expectForbidden(deleteCategory(request(), idParams), 'config:write')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('protects ruleset list and create', async () => {
    await expectForbidden(getRuleSets(request()), 'config:read')
    await expectForbidden(createRuleSet(request()), 'config:write')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('protects ruleset document read and create', async () => {
    await expectForbidden(getRuleSetDocuments(request(), idParams), 'config:read')
    await expectForbidden(createRuleSetDocument(request(), idParams), 'config:write')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('protects rule version history with fresh config:read', async () => {
    await expectForbidden(getRuleVersions(request(), idParams), 'config:read')
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
