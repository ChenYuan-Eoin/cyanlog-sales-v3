import { supabaseAdmin } from '@/lib/supabase'

const refusal = {
  SELF_MEMBERSHIP_REMOVAL_FORBIDDEN: { status: 403, error: '不能将自己移出当前组织' },
  PROTECTED_ROLE_MUTATION_FORBIDDEN: { status: 403, error: '平台根管理员不能移出组织' },
  LAST_ADMIN_PROTECTED: { status: 409, error: '不能移除当前组织最后一名有效控制管理员' },
  INVITED_MEMBERSHIP_PROTECTED: { status: 409, error: '请先撤销待激活邀请' },
  DIRECTORY_MEMBERSHIP_MANAGED: { status: 409, error: '该成员由外部通讯录管理，可在 ICU 办理离职' },
  MEMBERSHIP_NOT_FOUND: { status: 404, error: '目标成员不存在、已离开或不在当前组织' },
  MEMBER_UPDATE_FAILED: { status: 500, error: '无法确认移出结果，请刷新成员状态后重试' },
}

type RefusalCode = keyof typeof refusal
type RemovalResult =
  | { user_id: string; ok: true }
  | { user_id: string; ok: false; code: RefusalCode; status: number; error: string }

function refused(user_id: string, code: RefusalCode): RemovalResult {
  return { user_id, ok: false, code, ...refusal[code] }
}

async function readRemovalEligibility(orgId: string, userIds: string[]) {
  const [memberships, sources] = await Promise.all([
    supabaseAdmin.from('user_organizations').select('user_id,status')
      .eq('org_id', orgId).in('user_id', userIds),
    supabaseAdmin.from('organization_sources').select('id')
      .eq('system_org_id', orgId).in('authority_scope->>directory', ['authoritative', 'true']),
  ])
  if (memberships.error || sources.error) throw memberships.error ?? sources.error
  const membershipStatus = new Map((memberships.data || []).map(member => [member.user_id, member.status]))
  const directoryUsers = new Set<string>()
  if (sources.data?.length) {
    const identities = await supabaseAdmin.from('external_identities').select('canonical_user_id')
      .eq('system_org_id', orgId).eq('match_status', 'matched')
      .in('source_id', sources.data.map(source => source.id)).in('canonical_user_id', userIds)
    if (identities.error) throw identities.error
    for (const identity of identities.data || []) directoryUsers.add(identity.canonical_user_id)
  }
  return { membershipStatus, directoryUsers }
}

type MemberRemoval = {
  actorId: string
  orgId: string
  userIds: string[]
  requestId: string | null
  reason?: string
}

export async function removeOrganizationMembers({
  actorId, orgId, userIds, requestId, reason = 'tenant administrator removed membership',
}: MemberRemoval): Promise<RemovalResult[]> {
  const otherUsers = userIds.filter(userId => userId !== actorId)
  if (!otherUsers.length) return userIds.map(userId => refused(userId, 'SELF_MEMBERSHIP_REMOVAL_FORBIDDEN'))
  const { membershipStatus, directoryUsers } = await readRemovalEligibility(orgId, otherUsers)
  const results: RemovalResult[] = []
  // The existing single-member command maintains the organization lock,
  // preserves history and independently audits every successful removal.
  const concurrency = 5
  for (let index = 0; index < userIds.length; index += concurrency) {
    const group = await Promise.all(userIds.slice(index, index + concurrency).map(async (userId): Promise<RemovalResult> => {
      if (userId === actorId) return refused(userId, 'SELF_MEMBERSHIP_REMOVAL_FORBIDDEN')
      const status = membershipStatus.get(userId)
      if (!status || status === 'ended') return refused(userId, 'MEMBERSHIP_NOT_FOUND')
      if (directoryUsers.has(userId)) return refused(userId, 'DIRECTORY_MEMBERSHIP_MANAGED')
      if (status === 'invited') return refused(userId, 'INVITED_MEMBERSHIP_PROTECTED')
      try {
        const { data, error } = await supabaseAdmin.rpc('admin_remove_tenant_membership_v1', {
          p_actor_id: actorId, p_org_id: orgId, p_user_id: userId,
          p_reason: reason, p_request_id: requestId,
        })
        if (error?.code === '42501') return refused(userId, 'PROTECTED_ROLE_MUTATION_FORBIDDEN')
        if (error?.code === '23514') return refused(userId, 'LAST_ADMIN_PROTECTED')
        if (error) throw error
        return data === true ? { user_id: userId, ok: true } : refused(userId, 'MEMBERSHIP_NOT_FOUND')
      } catch (error) {
        console.error('Remove tenant membership result unconfirmed:', error)
        return refused(userId, 'MEMBER_UPDATE_FAILED')
      }
    }))
    results.push(...group)
  }
  return results
}
