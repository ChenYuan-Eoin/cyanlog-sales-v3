// F003 / WP94. Resolve only pre-established stable identities to canonical users.
import { supabaseAdmin } from '@/lib/supabase'
import { FxiaokeError } from './contracts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORP_ID = /^FSCID_[A-Za-z0-9_-]{1,128}$/
const EXTERNAL_ID = /^[A-Za-z0-9_-]{1,255}$/

type ExternalIdentityMapping = {
  canonical_user_id: string | null
  match_status: 'unresolved' | 'matched' | 'conflict' | 'ignored'
}

type IdentitySource = {
  id: string
  status: string
  authority_scope: Record<string, unknown>
}

type UserRow = {
  id: string
  org_id: string | null
  status: string
  login_enabled: boolean
}

function storageUnavailable() {
  return new FxiaokeError('IDENTITY_STORE_UNAVAILABLE', '身份映射暂时不可用，请稍后重试。', 503)
}

export function normalizeIdentityPhone(value: string | null | undefined) {
  if (!value?.trim()) return null
  const digits = value.replace(/[^0-9]/g, '')
  if (/^1[3-9][0-9]{9}$/.test(digits)) return `+86${digits}`
  if (/^861[3-9][0-9]{9}$/.test(digits)) return `+${digits}`
  if (/^[1-9][0-9]{7,14}$/.test(digits)) return `+${digits}`
  return null
}

async function findIdentitySource(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .select('id,status,authority_scope')
    .eq('system_org_id', orgId)
    .eq('provider', 'fxiaoke')
    .limit(2)
  if (error) throw storageUnavailable()
  const rows = data || []
  if (rows.length > 1) {
    throw new FxiaokeError(
      'IDENTITY_SOURCE_CONFLICT',
      '当前企业存在多个纷享身份来源，已阻止自动登录。',
      409,
    )
  }
  const source = rows[0] as IdentitySource | undefined
  if (!source) return undefined
  if (
    source.status !== 'active'
    || !source.authority_scope
    || source.authority_scope.identity !== 'authoritative'
  ) {
    throw new FxiaokeError(
      'IDENTITY_SOURCE_INACTIVE',
      '当前纷享绑定源未启用身份裁决权，登录已拒绝。',
      403,
    )
  }
  return source.id
}

async function loadIdentityMapping(sourceId: string, orgId: string, externalSubject: string) {
  const { data, error } = await supabaseAdmin
    .from('external_identities')
    .select('canonical_user_id,match_status')
    .eq('source_id', sourceId)
    .eq('system_org_id', orgId)
    .eq('external_user_id', externalSubject)
    .maybeSingle()
  if (error) throw storageUnavailable()
  return data as ExternalIdentityMapping | null
}

async function loadActiveUser(userId: string, orgId: string) {
  const [{ data: user, error: userError }, { data: membership, error: membershipError }] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id,org_id,status,login_enabled')
      .eq('id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('user_organizations')
      .select('org_id,is_default,status')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .eq('status', 'active')
      .eq('is_default', true)
      .maybeSingle(),
  ])

  if (userError || membershipError) throw storageUnavailable()
  if (!user) {
    throw new FxiaokeError('IDENTITY_UNMAPPED', '当前纷享员工尚未绑定系统成员，登录已拒绝。', 403)
  }
  if (user.status !== 'active' || user.login_enabled !== true) {
    throw new FxiaokeError('IDENTITY_DISABLED', '当前系统成员已停用或禁止登录。', 403)
  }
  if ((user.org_id && user.org_id !== orgId) || membership?.org_id !== orgId || membership.is_default !== true) {
    throw new FxiaokeError('ORGANIZATION_MISMATCH', '当前纷享员工与目标系统企业不一致。', 403)
  }
  return user as UserRow
}

export async function resolveFxiaokeIdentity(input: {
  orgId: string
  corpId: string
  externalSubject: string
  phone?: string | null
  employeeNumber?: string | null
  displayName?: string
  providerStatus?: string
  lifeStatus?: string | null
  loginDisabled?: boolean | null
}) {
  if (
    !UUID.test(input.orgId)
    || !CORP_ID.test(input.corpId)
    || !EXTERNAL_ID.test(input.externalSubject)
  ) {
    throw new FxiaokeError('INVALID_IDENTITY', '纷享员工身份无效。', 403)
  }

  const sourceId = await findIdentitySource(input.orgId)
  if (!sourceId) {
    throw new FxiaokeError(
      'IDENTITY_BINDING_REQUIRED',
      '当前企业尚未建立纷享身份绑定，登录已拒绝。',
      403,
    )
  }

  const mapping = await loadIdentityMapping(sourceId, input.orgId, input.externalSubject)
  if (!mapping || mapping.match_status === 'unresolved') {
    throw new FxiaokeError(
      'IDENTITY_BINDING_REQUIRED',
      '当前纷享员工尚未建立受审计的系统身份绑定，登录已拒绝。',
      403,
    )
  }
  if (mapping.match_status === 'conflict') {
    throw new FxiaokeError('IDENTITY_CONFLICT', '当前纷享员工存在冲突的系统身份映射，请转人工审核。', 409)
  }
  if (mapping.match_status === 'ignored') {
    throw new FxiaokeError('IDENTITY_DISABLED', '当前纷享员工映射已停用。', 403)
  }
  if (!mapping.canonical_user_id) throw storageUnavailable()

  const resolved = await loadActiveUser(mapping.canonical_user_id, input.orgId)
  return { userId: resolved.id, orgId: input.orgId }
}
