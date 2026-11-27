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
    authorityScope: {},
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
    connectionVerified: true,
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
      { id: alice, orgId: org, employeeId: 'E001', email: 'alice@example.com', phone: null, displayName: '张三', title: null, avatarUrl: null, status: 'active', loginEnabled: true, primaryDepartmentId: feishuDepartment, updatedAt: '2026-11-01T00:00:00.000Z' },
      { id: bob, orgId: org, employeeId: 'E002', email: 'bob@example.com', phone: null, displayName: '李四', title: null, avatarUrl: null, status: 'active', loginEnabled: true, primaryDepartmentId: null, updatedAt: '2026-11-01T00:00:00.000Z' },
    ],
    identities: [{
      id: '00000000-0000-4000-8000-000000000303', sourceId: fxiaokeSource, systemOrgId: org,
      externalUserId: 'employee-1', externalUnionId: null, externalOpenId: null,
      canonicalUserId: alice, matchStatus: 'matched', matchMethod: 'employee_id', matchConfidence: 1,
      profileSnapshot: {}, observedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    }, {
      id: '00000000-0000-4000-8000-000000000301', sourceId: feishuSource, systemOrgId: org,
      externalUserId: 'fs-employee-1', externalUnionId: null, externalOpenId: null,
      canonicalUserId: alice, matchStatus: 'matched', matchMethod: 'employee_id', matchConfidence: 1,
      profileSnapshot: { displayName: '张三' }, observedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    }],
    organizationMemberships: [],
    memberships: [{
      userId: alice, departmentId: feishuDepartment, orgId: org, isPrimary: true,
      source: 'feishu', joinedAt: '2026-11-01T00:00:00.000Z',
    }],
    ...overrides,
  }
}

describe('directory cutover plan', () => {
  it.each([[false, null], [true, '  ']])('keeps an unproven directory read preview-only (%s, %s)', (scopeVerified, scopeEvidence) => {
    const base = input()
    const plan = buildDirectoryCutoverPlan(input({
      snapshot: {
        ...base.snapshot,
        complete: true,
        scopeVerified,
        scopeEvidence,
      },
    }))

    expect(plan.snapshot).toMatchObject({ complete: true, scopeVerified, scopeEvidence })
    expect(plan.applyable).toBe(false)
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ kind: 'directory_scope_unverified' }))
  })

  it('creates a deterministic applyable plan with evidence matching and preserves manual and old-source data', () => {
    const first = buildDirectoryCutoverPlan(input())
    const second = buildDirectoryCutoverPlan(input())

    expect(first.version).toBe(DIRECTORY_CUTOVER_CONTRACT)
    expect(first.applyable).toBe(true)
    expect(first.conflicts).toEqual([])
    expect(first.identityChanges).toEqual([expect.objectContaining({
      externalUserId: 'employee-1', canonicalUserId: alice, matchMethod: 'provider_id',
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

  it.each([
    { status: 'ended', employmentStatus: 'ended' },
    { status: 'ended', employmentStatus: 'active' },
  ])('observes the external identity of an ended member without restoring the department ($employmentStatus)', (state) => {
    const base = input()
    const observed = base.snapshot.employees[0]
    const regular = { ...observed, id: 'employee-2', name: '李四', employeeNumber: 'E002' }
    const plan = buildDirectoryCutoverPlan(input({
      snapshot: { ...base.snapshot, employees: [observed, regular] },
      users: base.users.map(user => user.id === alice ? {
        ...user, status: 'inactive', loginEnabled: false, primaryDepartmentId: null,
      } : user),
      identities: [...base.identities, {
        ...base.identities[0], id: '00000000-0000-4000-8000-000000000304',
        canonicalUserId: bob, externalUserId: regular.id,
      }],
      memberships: [],
      organizationMemberships: [{
        userId: alice, orgId: org, primaryDepartmentId: null, isDefault: true,
        createdAt: '2026-11-01T00:00:00.000Z', ...state,
      }],
    }))

    expect(plan.applyable).toBe(true)
    expect(plan.identityChanges).toContainEqual(expect.objectContaining({
      canonicalUserId: alice, createsMember: false, externalUserId: observed.id,
      profileSnapshot: expect.objectContaining({ status: 'active', primaryDepartmentExternalId: 'dept-sales' }),
    }))
    expect(plan.userDepartmentChanges).toEqual([expect.objectContaining({ userId: bob, primaryDepartmentExternalId: 'dept-sales' })])
    expect(plan.beforeState.users.map(user => user.id)).toEqual([bob])
    expect(plan.beforeState.organizationMemberships).toEqual([])
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
      identities: [],
      users: [input().users[0]],
      snapshot: {
        ...base.snapshot,
        employees: [{ ...base.snapshot.employees[0], employeeNumber: null, email: null, phone: null }],
      },
    }))

    expect(plan.applyable).toBe(false)
    expect(plan.identityChanges).toEqual([])
    expect(plan.userDepartmentChanges).toEqual([])
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ kind: 'identity_requires_review' }))
  })

  it('keeps ambiguous account candidates unlinked without dropping the directory employee', () => {
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
    expect(plan.userDepartmentChanges).toEqual([])
    expect(plan.conflicts).toContainEqual(expect.objectContaining({
      kind: 'identity_requires_review', candidateUserIds: [alice, bob],
    }))
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

  it('isolates a disputed upstream personnel record without treating it as a departure or new member', () => {
    const base = input()
    const known = base.snapshot.employees[0]
    const plan = buildDirectoryCutoverPlan(input({
      sources: [targetSource({ authorityScope: { directory: 'authoritative' } })],
      organizationMemberships: [{ userId: alice, orgId: org, primaryDepartmentId: feishuDepartment,
        status: 'active', employmentStatus: 'active', isDefault: true, createdAt: base.users[0].updatedAt }],
      snapshot: {
        ...base.snapshot,
        departments: [...base.snapshot.departments, { id: 'dept-second', name: '第二部门', parentId: null, status: 'active' }],
        employees: [
          { ...known, departmentIds: ['dept-sales', 'dept-second'], primaryDepartmentId: null, status: 'inactive', sourceConflict: 'primary_department' },
          { ...known, id: 'independent-employee', name: '独立新人', employeeNumber: null, phone: '13800000100' },
        ],
      },
    }))

    expect(plan.applyable).toBe(true)
    expect(plan.conflicts).toEqual([])
    expect(plan.reviewConflicts).toContainEqual(expect.objectContaining({
      kind: 'employee_source_conflict', externalId: known.id,
    }))
    expect(plan.identityChanges.map(change => change.externalUserId)).toEqual(['independent-employee'])
    expect(plan.userDepartmentChanges.map(change => change.externalUserId)).toEqual(['independent-employee'])
    expect(plan.summary).toMatchObject({ membersAdded: 1, membersOffboarded: 0 })
  })

  it('links an existing owner and plans an ordinary move while isolating independent conflicts', () => {
    const base = input()
    const oldDepartment = '00000000-0000-4000-8000-000000000204'
    const secondaryDepartment = '00000000-0000-4000-8000-000000000205'
    const member = base.snapshot.employees[0]
    const existingOwner = { ...member, id: 'owner-a', phone: '+86 138-0000-0001' }
    const movingMember = { ...member, id: 'moving-b', employeeNumber: 'E002', name: '乙', phone: null }
    const blockedMember = { ...member, id: 'conflict-c', employeeNumber: null, name: '丙', phone: null }
    const dependent = { ...blockedMember, id: 'depends-on-parent', departmentIds: ['dept-orphan'], primaryDepartmentId: 'dept-orphan' }
    const newMember = { ...blockedMember, id: 'genuine-new', name: '新员工', phone: '13800000004' }
    const cases = input({
      sources: [source({ authorityScope: {}, syncMode: 'enrichment' }), targetSource({ authorityScope: { directory: 'authoritative' } })],
      departments: [
        ...base.departments,
        { ...base.departments[0], id: oldDepartment, source: 'fxiaoke', externalId: 'dept-old' },
        { ...base.departments[0], id: secondaryDepartment, source: 'fxiaoke', externalId: 'dept-secondary' },
      ],
      users: base.users.map(user => user.id === alice
        ? { ...user, phone: '13800000001', phoneVerified: true }
        : { ...user, primaryDepartmentId: oldDepartment }),
      identities: [{
        ...base.identities[0], externalUserId: movingMember.id, canonicalUserId: bob,
        profileSnapshot: { primaryDepartmentExternalId: 'dept-old' },
      }, base.identities[1]],
      organizationMemberships: base.users.map(user => ({
        userId: user.id, orgId: org, status: 'active', employmentStatus: 'active', isDefault: true,
        createdAt: user.updatedAt, primaryDepartmentId: user.id === bob ? oldDepartment : feishuDepartment,
      })),
      memberships: [
        ...base.memberships,
        { userId: bob, departmentId: oldDepartment, orgId: org, source: 'fxiaoke', isPrimary: true, joinedAt: base.users[0].updatedAt },
        { userId: bob, departmentId: secondaryDepartment, orgId: org, source: 'fxiaoke', isPrimary: false, joinedAt: base.users[0].updatedAt },
      ],
      snapshot: {
        ...base.snapshot,
        departments: [
          ...base.snapshot.departments,
          { id: 'dept-old', name: '旧部门', parentId: null, status: 'active' },
          { id: 'dept-secondary', name: '兼岗', parentId: null, status: 'active' },
          { id: 'dept-orphan', name: '待核对部门', parentId: 'dept-not-present', status: 'active' },
        ],
        employees: [existingOwner, movingMember, blockedMember, dependent, newMember],
      },
    })
    const plan = buildDirectoryCutoverPlan(cases)
    expect(plan.applyable).toBe(true)
    expect(plan.conflicts).toEqual([])
    expect(plan.reviewConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing_parent_department', externalId: 'dept-orphan' }),
      expect.objectContaining({ kind: 'identity_requires_review', externalId: blockedMember.id }),
      expect.objectContaining({ kind: 'employee_missing_department', externalId: dependent.id }),
    ]))
    expect(plan.identityChanges).toContainEqual(expect.objectContaining({
      externalUserId: existingOwner.id, canonicalUserId: alice, createsMember: false, matchMethod: 'phone',
    }))
    expect(plan.summary).toMatchObject({ membersAdded: 1, membersLinked: 1, membersMoved: 1, membersOffboarded: 0 })
    const historicalShipment = { orgId: org, createdBy: alice }
    const linkedOwner = plan.identityChanges.find(change => change.externalUserId === existingOwner.id)?.canonicalUserId
    expect(historicalShipment).toMatchObject({ orgId: plan.organizationId, createdBy: linkedOwner })
    expect(plan.userDepartmentChanges).toContainEqual(expect.objectContaining({
      userId: bob, primaryDepartmentExternalId: 'dept-sales', departmentExternalIds: ['dept-sales', 'dept-secondary'],
    }))
    expect(plan.userDepartmentChanges.map(change => change.externalUserId)).not.toContain(blockedMember.id)
    expect(plan.userDepartmentChanges.map(change => change.externalUserId)).not.toContain(dependent.id)
    expect(plan.userDepartmentChanges.map(change => change.externalUserId)).not.toContain(existingOwner.id)

    const narrowed = buildDirectoryCutoverPlan({
      ...cases,
      snapshot: { ...cases.snapshot, scopeVerified: false, scopeEvidence: null },
    })
    expect(narrowed.snapshot.employeeCount).toBe(plan.snapshot.employeeCount)
    expect(narrowed.applyable).toBe(false)
    expect(narrowed.summary.membersOffboarded).toBe(0)
    expect(narrowed.userDepartmentChanges.find(change => change.userId === bob)?.departmentExternalIds).toContain('dept-secondary')

    const recycled = buildDirectoryCutoverPlan({ ...cases, phoneHistory: [{ phone: '13800000001', userId: bob }] })
    expect(recycled.identityChanges.map(change => change.externalUserId)).not.toContain(existingOwner.id)
    expect(recycled.reviewConflicts).toContainEqual(expect.objectContaining({
      kind: 'identity_requires_review', externalId: existingOwner.id, candidateUserIds: [alice, bob],
    }))
    const identityReview = recycled.reviewConflicts?.find(item => item.externalId === existingOwner.id)?.identityReview
    expect(identityReview).toMatchObject({
      factsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      linkUserIds: [alice],
      canCreate: false,
      incoming: expect.objectContaining({ maskedPhone: '+86••••0001' }),
    })
    const choice = {
      externalUserId: existingOwner.id, factsHash: identityReview?.factsHash ?? '',
      choice: 'link_existing' as const, userId: alice,
    }
    const reviewedCases = { ...cases, phoneHistory: [{ phone: '13800000001', userId: bob }], identityDecisions: [choice] }
    const reviewed = buildDirectoryCutoverPlan(reviewedCases)
    expect(reviewed.identityChanges).toContainEqual(expect.objectContaining({
      externalUserId: existingOwner.id, canonicalUserId: alice, matchMethod: 'manual', createsMember: false,
    }))
    expect(reviewed.reviewConflicts?.some(row => row.kind === 'identity_requires_review' && row.externalId === existingOwner.id)).toBe(false)
    const blockedChoice = buildDirectoryCutoverPlan({ ...reviewedCases, identityDecisions: [{ ...choice, userId: bob }] })
    expect(blockedChoice.identityChanges.map(change => change.externalUserId)).not.toContain(existingOwner.id)
    const identityChanged = buildDirectoryCutoverPlan({
      ...reviewedCases,
      snapshot: { ...cases.snapshot, employees: cases.snapshot.employees.map(row => row.id === existingOwner.id
        ? { ...row, employeeNumber: 'new-evidence' } : row) },
    })
    expect(identityChanged.reviewConflicts).toContainEqual(expect.objectContaining({
      externalId: existingOwner.id, kind: 'identity_requires_review',
    }))

    const diverged = {
      ...cases,
      organizationMemberships: cases.organizationMemberships.map(row => row.userId === bob
        ? { ...row, primaryDepartmentId: manualDepartment }
        : row),
    }
    expect(buildDirectoryCutoverPlan(diverged).reviewConflicts).toContainEqual(expect.objectContaining({
      externalId: movingMember.id, kind: 'employee_primary_review',
      primaryReview: expect.objectContaining({ userId: bob, currentDepartmentId: manualDepartment, incomingDepartmentExternalId: 'dept-sales' }),
    }))
    const retained = { ...diverged, primaryDecisions: [{
      externalUserId: movingMember.id, userId: bob, currentDepartmentId: manualDepartment,
      incomingDepartmentExternalId: 'dept-sales', choice: 'keep_local' as const,
    }] }
    expect(buildDirectoryCutoverPlan(retained).reviewConflicts?.map(item => item.externalId)).not.toContain(movingMember.id)
    expect(buildDirectoryCutoverPlan(retained).userDepartmentChanges.map(change => change.userId)).not.toContain(bob)
    const incomingChanged = buildDirectoryCutoverPlan({
      ...retained,
      snapshot: { ...retained.snapshot, employees: retained.snapshot.employees.map(employee => employee.id === movingMember.id
        ? { ...employee, primaryDepartmentId: 'dept-secondary', departmentIds: ['dept-secondary'] }
        : employee) },
    })
    expect(incomingChanged.reviewConflicts).toContainEqual(expect.objectContaining({
      externalId: movingMember.id, kind: 'employee_primary_review',
      primaryReview: expect.objectContaining({ incomingDepartmentExternalId: 'dept-secondary' }),
    }))
  })
})
