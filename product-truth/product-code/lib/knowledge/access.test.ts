import { describe, expect, it } from 'vitest'

import { canUseKnowledgePage } from './access'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'

function assignment(orgId: string, roleId: string): ScopedRoleAssignment {
  return {
    scopeType: 'org',
    scopeId: orgId,
    grantedAt: null,
    roleId,
    roleCode: 'LEGAL',
    roleName: '法务',
    permissions: [],
  }
}

describe('knowledge page exact organization role principals', () => {
  const page = { id: 'page-a', org_id: 'org-a', created_by: 'owner-a' }
  const permission = [{
    page_id: 'page-a',
    principal_type: 'role' as const,
    principal_id: 'legal-role',
    permission: 'edit' as const,
  }]

  it('其他组织的同一全局 role id 不能授权当前组织页面', () => {
    expect(canUseKnowledgePage(page, permission, {
      userId: 'user-b',
      orgId: 'org-a',
      assignments: [assignment('org-b', 'legal-role')],
    }, 'view')).toBe(false)
  })

  it('当前组织精确绑定的 role id 可以按页面授权访问', () => {
    expect(canUseKnowledgePage(page, permission, {
      userId: 'user-a',
      orgId: 'org-a',
      assignments: [assignment('org-a', 'legal-role')],
    }, 'edit')).toBe(true)
  })
})
