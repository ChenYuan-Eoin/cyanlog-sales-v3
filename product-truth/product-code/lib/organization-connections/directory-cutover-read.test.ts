// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const organizationSourceId = '00000000-0000-4000-8000-000000000020'
  const planRow = {
    id: '00000000-0000-4000-8000-000000000030',
    plan_hash: 'a'.repeat(64),
    plan_payload: {
      version: 'f003-directory-cutover-v1',
      organizationId: '00000000-0000-4000-8000-000000000001',
      targetProvider: 'fxiaoke',
      targetSourceId: organizationSourceId,
      targetExternalTenantId: 'FSCID_target',
      connectionRevision: '00000000-0000-4000-8000-000000000021',
      previousPrimarySourceId: null,
      sourceRevisions: [],
      snapshot: {
        checkedAt: '2026-11-03T08:00:00.000Z',
        complete: true,
        scopeVerified: false,
        scopeEvidence: null,
        directoryHash: 'b'.repeat(64),
        departmentCount: 0,
        employeeCount: 0,
        warnings: [],
      },
      summary: {},
      conflicts: [],
      notices: [],
      departmentChanges: [],
      staleTargetDepartmentIds: [],
      identityChanges: [],
      userDepartmentChanges: [],
      beforeState: { departments: [], sourceRows: [], users: [], identities: [], memberships: [] },
      preserved: {},
      applyable: false,
      planHash: 'a'.repeat(64),
    },
    status: 'planned',
    created_at: '2026-11-03T08:00:00.000Z',
    expires_at: '2099-11-03T08:30:00.000Z',
    applied_at: null,
    rolled_back_at: null,
  }
  const selectedSourceIds: string[] = []
  const from = vi.fn((table: string) => {
    if (table === 'organization_sources') {
      return {
        select: vi.fn((columns: string) => {
          if (columns !== 'configuration_revision') {
            throw new Error('must not guess the source by creation order')
          }
          return { limit: vi.fn().mockResolvedValue({ error: null }) }
        }),
      }
    }
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => {
        if (table === 'organization_directory_cutover_plans' && column === 'target_source_id') selectedSourceIds.push(value)
        return builder
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data: table === 'organization_directory_cutover_plans' ? planRow : null,
        error: null,
      })),
    }
    return builder
  })
  return {
    organizationSourceId,
    selectedSourceIds,
    loadOrganizationConnection: vi.fn(),
    from,
  }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('./service', () => ({
  loadOrganizationConnection: mocks.loadOrganizationConnection,
  loadVerifiedConnection: vi.fn(),
}))

import { loadLatestDirectoryCutoverPlan } from './directory-cutover'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.selectedSourceIds.length = 0
  mocks.loadOrganizationConnection.mockResolvedValue({ sourceId: mocks.organizationSourceId })
})

describe('latest directory cutover plan selection', () => {
  it('uses the same uniquely resolved connection as preview and apply', async () => {
    const result = await loadLatestDirectoryCutoverPlan(
      '00000000-0000-4000-8000-000000000001',
      'fxiaoke',
    )

    expect(mocks.loadOrganizationConnection).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'fxiaoke',
    )
    expect(mocks.selectedSourceIds).toEqual([mocks.organizationSourceId])
    expect(result).toMatchObject({ id: '00000000-0000-4000-8000-000000000030', status: 'planned' })
  })
})
