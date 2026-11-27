import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const database = vi.hoisted(() => ({ rpc: vi.fn(), actor: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: database.rpc } }))
vi.mock('@/lib/auth', () => ({ requireAuth: database.actor }))
vi.mock('@/lib/admin/member-actions', () => ({ loadOrganizationPermissionAccess: database.access }))

import { GET, POST } from './route'

const org = '10000000-0000-4000-8000-000000000001'
const otherOrg = '10000000-0000-4000-8000-000000000002'
const actor = '10000000-0000-4000-8000-000000000003'
const department = '10000000-0000-4000-8000-000000000004'
const receiving = '10000000-0000-4000-8000-000000000005'
const member = '10000000-0000-4000-8000-000000000006'
const plan = '10000000-0000-4000-8000-000000000007'
const path = 'https://example.test/api/admin/departments/disposal'

function post(body: object, origin = 'https://example.test') {
  return POST(new NextRequest(path, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }))
}

function permissions(systemAdministrator = true, memberAccess = true) {
  return {
    orgId: org, systemAdministrator,
    decision: { 'dept:directory_view': true, 'dept:edit_structure': true, 'dept:delete_structure': true, 'user:view': memberAccess },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  database.actor.mockResolvedValue({ id: actor })
  database.access.mockResolvedValue(permissions())
  database.rpc.mockResolvedValue({ data: { planId: plan }, error: null })
})

describe('manual department disposal API', () => {
  it('loads archive history for the authenticated organization without sending roster data', async () => {
    database.access.mockResolvedValueOnce(permissions(false, false))
    const response = await GET(new NextRequest(path + '?query=Archive'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(database.rpc).toHaveBeenCalledWith('list_manual_department_archives_v1', {
      p_org_id: org, p_actor_id: actor, p_query: 'Archive',
    })
  })

  it('rejects a stale organization and a cross-site action before calling storage', async () => {
    const submission = { action: 'apply', expectedOrgId: otherOrg, planId: plan, planHash: 'a'.repeat(64) }
    expect((await post(submission)).status).toBe(409)
    expect((await post({ ...submission, expectedOrgId: org }, 'https://other.test')).status).toBe(403)
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('normalizes overlapping departments and sends the exact explicit action choices', async () => {
    const command = { transfers: [{ userId: member, departmentId: receiving }], archiveDepartmentIds: [department, department] }
    const body = {
      action: 'preview', expectedOrgId: org, departmentIds: [department, department], includeChildren: true,
      employmentFilter: 'all', command,
    }
    expect((await post(body)).status).toBe(200)
    expect(database.rpc).toHaveBeenCalledWith('preview_manual_department_disposal_v1', {
      p_org_id: org, p_actor_id: actor, p_department_ids: [department], p_include_children: true,
      p_employment_filter: 'all', p_command: { ...command, archiveDepartmentIds: [department] },
    })
  })

  it('keeps bulk commands behind effective system authority and preview behind member visibility', async () => {
    const body = { action: 'preview', expectedOrgId: org, departmentIds: [department], includeChildren: false, employmentFilter: 'active' }
    database.access.mockResolvedValueOnce(permissions(false))
    expect((await post(body)).status).toBe(403)
    database.access.mockResolvedValueOnce(permissions(true, false))
    expect((await post(body)).status).toBe(403)
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('submits immutable plan identifiers and restores only against a named active parent', async () => {
    expect((await post({ action: 'apply', expectedOrgId: org, planId: plan, planHash: 'b'.repeat(64) })).status).toBe(200)
    expect(database.rpc).toHaveBeenNthCalledWith(1, 'apply_manual_department_disposal_v1', {
      p_org_id: org, p_actor_id: actor, p_plan_id: plan, p_plan_hash: 'b'.repeat(64),
    })
    expect((await post({
      action: 'restore', expectedOrgId: org, departmentId: department, archiveId: plan, parentDepartmentId: null,
    })).status).toBe(400)
    expect((await post({
      action: 'restore', expectedOrgId: org, departmentId: department, archiveId: plan, parentDepartmentId: receiving,
    })).status).toBe(200)
    expect(database.rpc).toHaveBeenNthCalledWith(2, 'restore_manual_department_v1', {
      p_org_id: org, p_actor_id: actor, p_department_id: department,
      p_archive_id: plan, p_parent_department_id: receiving,
    })
  })
})
