// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const organizationSourceId = '00000000-0000-4000-8000-000000000020'
  const planRow = {
    id: '00000000-0000-4000-8000-000000000030',
    plan_hash: 'a'.repeat(64),
    plan_payload: {
      version: 'f003-directory-cutover-v2',
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
        connectionVerified: true,
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
  const getPlan = vi.fn((): Record<string, unknown> => planRow)
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
        data: table === 'organization_directory_cutover_plans' ? getPlan() : null,
        error: null,
      })),
    }
    return builder
  })
  return {
    organizationSourceId,
    planRow,
    getPlan,
    selectedSourceIds,
    loadOrganizationConnection: vi.fn(),
    readOrganizationDirectory: vi.fn(),
    loadVerifiedConnection: vi.fn(),
    rpc: vi.fn(),
    from,
  }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('./service', () => ({
  loadOrganizationConnection: mocks.loadOrganizationConnection,
  readOrganizationDirectory: mocks.readOrganizationDirectory,
  loadVerifiedConnection: mocks.loadVerifiedConnection,
}))
vi.mock('./storage', () => ({ assertDirectoryCutoverStorage: vi.fn() }))

import { applyDirectoryCutoverPlan, loadLatestDirectoryCutoverPlan, prepareDirectoryCutoverPlan, rollbackDirectoryCutover } from './directory-cutover'
import { OrganizationConnectionError } from './errors'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.selectedSourceIds.length = 0
  mocks.loadOrganizationConnection.mockResolvedValue({ sourceId: mocks.organizationSourceId, revision: 'revision-1', effectiveRevision: 'revision-1', effectiveVerified: true })
})

describe('latest directory cutover plan selection', () => {
  it('requires explicit effective configuration before reading a directory for synchronization', async () => {
    mocks.loadOrganizationConnection.mockResolvedValue({ sourceId: mocks.organizationSourceId, revision: 'draft', effectiveRevision: null, effectiveVerified: false })
    await expect(prepareDirectoryCutoverPlan({ orgId: 'org-1', actorId: 'admin-1', provider: 'fxiaoke' }))
      .rejects.toMatchObject({ code: 'DIRECTORY_CONNECTION_REQUIRED' })
    expect(mocks.readOrganizationDirectory).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects an old planned apply when its connection is disabled, before the data transaction', async () => {
    mocks.loadVerifiedConnection.mockRejectedValue(new OrganizationConnectionError('SOURCE_DISABLED', '已停用', 409))
    await expect(applyDirectoryCutoverPlan({
      orgId: 'org-1', actorId: 'admin-1', planId: '00000000-0000-4000-8000-000000000030',
      planHash: 'a'.repeat(64), connectionRevision: '00000000-0000-4000-8000-000000000021',
      sourceRevisions: [{}] as never,
    })).rejects.toMatchObject({ code: 'SOURCE_DISABLED' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('requires replanning an older pending plan that would restore an ended member’s department links', async () => {
    const { planRow } = mocks
    const ended = '00000000-0000-4000-8000-000000000101'
    mocks.getPlan.mockReturnValueOnce({ ...planRow, plan_payload: {
      ...planRow.plan_payload,
      userDepartmentChanges: [{ userId: ended }],
      beforeState: { ...planRow.plan_payload.beforeState, organizationMemberships: [
        { userId: ended, status: 'ended', employmentStatus: 'active' },
      ] },
    } })
    await expect(applyDirectoryCutoverPlan({
      orgId: 'org-1', actorId: 'admin-1', planId: planRow.id, planHash: planRow.plan_hash,
      connectionRevision: planRow.plan_payload.connectionRevision, sourceRevisions: [{}] as never,
    })).rejects.toMatchObject({ code: 'PLAN_STALE', status: 409, message: expect.stringContaining('请重新读取目录差异') })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['apply', () => applyDirectoryCutoverPlan({
      orgId: 'org-1', actorId: 'admin-1', planId: '00000000-0000-4000-8000-000000000030',
      planHash: 'a'.repeat(64), connectionRevision: '00000000-0000-4000-8000-000000000021',
      sourceRevisions: [{}] as never,
    })],
    ['rollback', () => rollbackDirectoryCutover({
      orgId: 'org-1', actorId: 'admin-1', planId: '00000000-0000-4000-8000-000000000030',
    })],
  ])('explains when %s would disable the last effective super administrator', async (_operation, activate) => {
    mocks.loadVerifiedConnection.mockResolvedValueOnce({ revision: '00000000-0000-4000-8000-000000000021' })
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', details: 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED', message: 'constraint conflict' },
    })
    await expect(activate()).rejects.toMatchObject({
      status: 409, code: 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED', message: expect.stringContaining('先任命另一名'),
    })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('keeps the previous plan readable and performs no writes when source reads are unavailable', async () => {
    const unavailable = new OrganizationConnectionError('DIRECTORY_SOURCE_UNAVAILABLE', '来源暂不可用，请重试。', 503)
    mocks.readOrganizationDirectory.mockRejectedValue(unavailable)
    await expect(prepareDirectoryCutoverPlan({ orgId: 'org-1', actorId: 'admin-1', provider: 'fxiaoke' }))
      .rejects.toBe(unavailable)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    await expect(loadLatestDirectoryCutoverPlan('org-1', 'fxiaoke'))
      .resolves.toMatchObject({ id: '00000000-0000-4000-8000-000000000030', status: 'planned' })
  })
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
