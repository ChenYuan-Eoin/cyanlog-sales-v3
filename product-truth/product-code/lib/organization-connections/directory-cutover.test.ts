import { describe, expect, it } from 'vitest'
import {
  DIRECTORY_CUTOVER_CONTRACT,
  buildDirectoryCutoverPlan,
  canonicalDirectoryJson,
  type DirectoryCutoverInput,
  type DirectoryIdentityRow,
  type DirectorySourceRow,
} from './directory-cutover'

const org = '00000000-0000-4000-8000-000000000001'
const feishuSource = '00000000-0000-4000-8000-000000000010'
const fxiaokeSource = '00000000-0000-4000-8000-000000000020'
const fxiaokeRevision = '00000000-0000-4000-8000-000000000021'
const alice = '00000000-0000-4000-8000-000000000101'
const bob = '00000000-0000-4000-8000-000000000102'
const manualDepartment = '00000000-0000-4000-8000-000000000201'
const feishuDepartment = '00000000-0000-4000-8000-000000000202'

function source(overrides: Partial<DirectorySourceRow> = {}): DirectorySourceRow {
  return {
    id: feishuSource,
    systemOrgId: org,
    provider: 'feishu',
    externalTenantId: 'feishu-tenant',
    priority: 1,
    status: 'active',
    authorityScope: { directory: true },
    syncMode: 'authoritative',
    configurationRevision: '00000000-0000-4000-8000-000000000011',
    connectionState: 'verified',
    effectiveRevision: '00000000-0000-4000-8000-000000000011',
    draftCheckStatus: 'preview_ready',
    lastSuccessfulSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    updatedAt: '2026-11-03T07:00:00.000Z',
    ...overrides,
  }
}

function targetSource(overrides: Partial<DirectorySourceRow> = {}): DirectorySourceRow {
  return source({
    id: fxiaokeSource,
    provider: 'fxiaoke',
    externalTenantId: 'FSCID_target',
    priority: 2,
    status: 'draft',
    syncMode: 'read_only',
    configurationRevision: fxiaokeRevision,
    effectiveRevision: fxiaokeRevision,
    ...overrides,
  })
}

function input(overrides: Partial<DirectoryCutoverInput> = {}): DirectoryCutoverInput {
  return {
    organizationId: org,
    targetSourceId: fxiaokeSource,
    connectionRevision: fxiaokeRevision,
    snapshot: {
      checkedAt: '2026-11-03T08:00:00.000Z',
      provider: 'fxiaoke',
      externalTenantId: 'FSCID_target',
      complete: true,
      scopeVerified: true,
      scopeEvidence: 'provider-admin-scope-proof:73-departments:405-employees',
      departments: [{ id: 'dept-sales', name: '销售部', parentId: null, status: 'active' }],
      employees: [{
        id: 'employee-1', name: '张三', departmentIds: ['dept-sales'], primaryDepartmentId: 'dept-sales', status: 'active',
        loginDisabled: false, employeeNumber: 'E001', email: null, phone: null,
      }],
      warnings: [],
      applied: false,
    },
    sources: [source(), targetSource()],
    departments: [
      {
        id: manualDepartment, orgId: org, parentId: null, name: '手工部门', code: null, path: null, depth: 0,
        externalId: null, source: 'manual', status: 'active', sortOrder: 0, memberCount: 1, updatedAt: '2026-11-01T00:00:00.000Z',
      },
      {
        id: feishuDepartment, orgId: org, parentId: null, name: '飞书销售部', code: null, path: null, depth: 0,
        externalId: 'fs-sales', source: 'feishu', status: 'active', sortOrder: 1, memberCount: 1, updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    users: [
      { id: alice, orgId: org, employeeId: 'E001', email: 'alice@example.com', phone: null, displayName: '张三', title: null, avatarUrl: null, status: 'active', primaryDepartmentId: feishuDepartment, updatedAt: '2026-11-01T00:00:00.000Z' },
      { id: bob, orgId: org, employeeId: 'E002', email: 'bob@example.com', phone: null, displayName: '李四', title: null, avatarUrl: null, status: 'active', primaryDepartmentId: null, updatedAt: '2026-11-01T00:00:00.000Z' },
    ],
    identities: [{
      id: '00000000-0000-4000-8000-000000000301', sourceId: feishuSource, systemOrgId: org,
      externalUserId: 'fs-employee-1', externalUnionId: null, externalOpenId: null,
      canonicalUserId: alice, matchStatus: 'matched', matchMethod: 'employee_id', matchConfidence: 1,
      profileSnapshot: { displayName: '张三' }, observedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    }],
    memberships: [{
      userId: alice, departmentId: feishuDepartment, orgId: org, isPrimary: true,
      source: 'feishu', joinedAt: '2026-11-01T00:00:00.000Z',
    }],
    ...overrides,
  }
}

describe('directory cutover plan', () => {
  it('treats structural completeness as separate from company-wide scope proof', () => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      snapshot: {
        ...base.snapshot,
        complete: true,
        scopeVerified: false,
        scopeEvidence: null,
      },
    }))

    expect(plan.snapshot).toMatchObject({ complete: true, scopeVerified: false, scopeEvidence: null })
    expect(plan.applyable).toBe(false)
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'scope_unverified' }),
    ]))
  })

  it('creates a deterministic applyable plan with evidence matching and preserves manual and old-source data', () => {
    const first = buildDirectoryCutoverPlan(input())
    const second = buildDirectoryCutoverPlan(input())

    expect(first.version).toBe(DIRECTORY_CUTOVER_CONTRACT)
    expect(first.applyable).toBe(true)
    expect(first.conflicts).toEqual([])
    expect(first.identityChanges).toEqual([expect.objectContaining({
      externalUserId: 'employee-1', canonicalUserId: alice, matchMethod: 'employee_id',
    })])
    expect(first.userDepartmentChanges).toEqual([expect.objectContaining({
      userId: alice, primaryDepartmentExternalId: 'dept-sales', active: true,
    })])
    expect(first.preserved).toMatchObject({
      manualDepartmentCount: 1,
      previousPrimaryDepartmentsRetained: 1,
      previousPrimaryIdentitiesRetained: 1,
    })
    expect(first.beforeState.users[0]).toMatchObject({
      id: alice,
      primaryDepartmentId: feishuDepartment,
      status: 'active',
      updatedAt: '2026-11-01T00:00:00.000Z',
    })
    expect(first.planHash).toBe(second.planHash)
    expect(canonicalDirectoryJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('blocks an incomplete provider snapshot as a whole', () => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      snapshot: { ...base.snapshot, complete: false, warnings: ['employee page 2 failed'] },
    }))

    expect(plan.applyable).toBe(false)
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'incomplete_snapshot' }),
    ]))
  })

  it('requires an explicit primary department instead of using department array order', () => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      snapshot: {
        ...base.snapshot,
        departments: [
          ...base.snapshot.departments,
          { id: 'dept-consulting', name: '咨询部', parentId: null, status: 'active' },
        ],
        employees: [{
          ...base.snapshot.employees[0],
          departmentIds: ['dept-sales', 'dept-consulting'],
          primaryDepartmentId: null,
        }],
      },
    }))

    expect(plan.applyable).toBe(false)
    expect(plan.userDepartmentChanges).toEqual([])
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'employee_without_primary_department', externalId: 'employee-1' }),
    ]))
  })

  it('uses the provider-declared primary department even when it is not first', () => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      snapshot: {
        ...base.snapshot,
        departments: [
          ...base.snapshot.departments,
          { id: 'dept-consulting', name: '咨询部', parentId: null, status: 'active' },
        ],
        employees: [{
          ...base.snapshot.employees[0],
          departmentIds: ['dept-sales', 'dept-consulting'],
          primaryDepartmentId: 'dept-consulting',
        }],
      },
    }))

    expect(plan.userDepartmentChanges).toEqual([
      expect.objectContaining({ primaryDepartmentExternalId: 'dept-consulting' }),
    ])
  })

  it('uses Fxiaoke wire statuses for cutover and blocks unknown lifecycle values', () => {
    const base = input()
    const mapped = buildDirectoryCutoverPlan(input({
      snapshot: {
        ...base.snapshot,
        departments: [{ ...base.snapshot.departments[0], status: '0' }],
        employees: [{ ...base.snapshot.employees[0], status: '0' }],
      },
    }))
    expect(mapped.applyable).toBe(true)
    expect(mapped.departmentChanges[0]).toMatchObject({ status: 'active' })
    expect(mapped.identityChanges[0]).toMatchObject({ active: true })

    const unknown = buildDirectoryCutoverPlan(input({
      snapshot: {
        ...base.snapshot,
        departments: [{ ...base.snapshot.departments[0], status: 'changed' }],
        employees: [{ ...base.snapshot.employees[0], status: 'changed' }],
      },
    }))
    expect(unknown.applyable).toBe(false)
    expect(unknown.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unknown_department_status' }),
      expect.objectContaining({ kind: 'unknown_employee_status', externalId: 'employee-1' }),
    ]))
  })

  it('never matches by display name and never creates a missing member', () => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      users: [input().users[0]],
      snapshot: {
        ...base.snapshot,
        employees: [{ ...base.snapshot.employees[0], employeeNumber: null, email: null, phone: null }],
      },
    }))

    expect(plan.applyable).toBe(false)
    expect(plan.identityChanges).toEqual([])
    expect(plan.userDepartmentChanges).toEqual([])
    expect(plan.conflicts).toEqual([expect.objectContaining({ kind: 'identity_unresolved' })])
  })

  it('blocks ambiguous identity evidence instead of choosing a member', () => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      users: [input().users[0], { ...input().users[1], employeeId: 'E001' }],
      snapshot: {
        ...base.snapshot,
        employees: [{ ...base.snapshot.employees[0], name: '同名员工', id: 'employee-duplicate' }],
      },
    }))

    expect(plan.applyable).toBe(false)
    expect(plan.identityChanges).toEqual([])
    expect(plan.conflicts).toEqual([expect.objectContaining({ kind: 'identity_ambiguous' })])
  })

  it('preserves an explicit manual identity binding until trusted evidence conflicts with it', () => {
    const manualIdentity: DirectoryIdentityRow = {
      id: '00000000-0000-4000-8000-000000000302', sourceId: fxiaokeSource, systemOrgId: org,
      externalUserId: 'employee-1', externalUnionId: null, externalOpenId: null,
      canonicalUserId: bob, matchStatus: 'matched', matchMethod: 'manual', matchConfidence: 1,
      profileSnapshot: { displayName: '旧显示名' }, observedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    }
    const base = input()
    const stable = buildDirectoryCutoverPlan(input({
      identities: [...base.identities, manualIdentity],
      snapshot: {
        ...base.snapshot,
        employees: [{ ...base.snapshot.employees[0], employeeNumber: null, email: null, phone: null }],
      },
    }))
    expect(stable.applyable).toBe(true)
    expect(stable.identityChanges[0]).toMatchObject({ canonicalUserId: bob, matchMethod: 'manual' })

    const conflicting = buildDirectoryCutoverPlan(input({
      identities: [...input().identities, manualIdentity],
      snapshot: {
        ...input().snapshot,
        employees: [{ ...input().snapshot.employees[0], employeeNumber: 'E001' }],
      },
    }))
    expect(conflicting.applyable).toBe(false)
    expect(conflicting.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'identity_mapping_changed', candidateUserIds: [bob, alice] }),
    ]))
  })

  it('rejects multiple active primary sources before any switch can occur', () => {
    const plan = buildDirectoryCutoverPlan(input({
      sources: [source(), source({ id: '00000000-0000-4000-8000-000000000030', provider: 'wecom' }), targetSource()],
    }))

    expect(plan.applyable).toBe(false)
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ambiguous_primary_source' }),
    ]))
  })
})
