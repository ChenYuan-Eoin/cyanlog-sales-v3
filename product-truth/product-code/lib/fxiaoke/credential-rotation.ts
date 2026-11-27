import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { OrganizationConnectionError } from '@/lib/organization-connections/errors'
import { loadFxiaokeRotationDraft, loadOrganizationConnection, readOrganizationDirectory } from '@/lib/organization-connections/service'
import type { Credentials } from './contracts'

const provider = 'fxiaoke'
type Directory = Awaited<ReturnType<typeof readOrganizationDirectory>>['directory']
type Trial = { id: string; memberId: string; expiresAt: string; verifiedAt: string | null }
export type FxiaokeRotationProof = { employees: Array<{ id: string; name: string }>; trial: Trial | null }
export type FxiaokeRotationContext = { id: string; sourceId: string; sourceUpdatedAt: string }
type RotationBinding = FxiaokeRotationContext & { orgId: string; revision: string }

const digest = (token: string) => createHash('sha256').update(token).digest('hex')

function unavailable() {
  return new OrganizationConnectionError('ROTATION_UNAVAILABLE', '纷享凭证验证暂不可用，请刷新后重试。', 503)
}

function stale() {
  return new OrganizationConnectionError('ROTATION_STALE', '纷享凭证验证已失效，请重新检查并发起。', 409)
}

function coverage(directory: Directory) {
  return JSON.stringify({
    departments: directory.departments.map(row => JSON.stringify([row.id, row.parentId, row.status])).sort(),
    employees: directory.employees.map(row => JSON.stringify([
      row.id, row.primaryDepartmentId, [...new Set(row.departmentIds)].sort(), row.status,
    ])).sort(),
  })
}

export function preservesDirectoryCoverage(current: Directory, draft: Directory) {
  return current.complete && draft.complete && current.departments.length > 0 && current.employees.length > 0
    && coverage(current) === coverage(draft)
}

export async function readFxiaokeCredentialRotation(orgId: string, actorId: string, sourceId: string) {
  const { data, error } = await supabaseAdmin.rpc('read_fxiaoke_credential_rotation_v1', {
    p_org_id: orgId, p_actor_id: actorId, p_source_id: sourceId,
  })
  if (error || !data) throw unavailable()
  return data as FxiaokeRotationProof
}

export async function prepareFxiaokeCredentialRotation(input: { orgId: string; actorId: string; revision: string; memberId: string }) {
  const connection = await loadOrganizationConnection(input.orgId, provider)
  if (!connection?.effectiveVerified || !connection.effectiveRevision || connection.revision !== input.revision
    || connection.effectiveRevision === input.revision || connection.draftCheckStatus !== 'preview_ready') throw stale()

  const settings = { orgId: input.orgId, provider, sourceId: connection.sourceId }
  // Read the two apps sequentially. The provider limits concurrent credential
  // requests, and both results must still describe the same saved connection.
  const current = await readOrganizationDirectory({
    ...settings, revision: connection.effectiveRevision, credentialSource: 'effective',
  })
  const draft = await readOrganizationDirectory({ ...settings, revision: input.revision })
  if (current.sourceUpdatedAt !== draft.sourceUpdatedAt
    || current.sourceConfigurationRevision !== draft.sourceConfigurationRevision
    || current.binding.externalTenantId !== draft.binding.externalTenantId) throw stale()
  if (!preservesDirectoryCoverage(current.directory, draft.directory)) {
    throw new OrganizationConnectionError('ROTATION_DIRECTORY_CHANGED', '草稿与生效连接读取的部门、人员或归属不同。请核对通讯录权限，再重新检查。', 409)
  }

  const token = randomBytes(24).toString('hex')
  const { data, error } = await supabaseAdmin.rpc('create_fxiaoke_credential_rotation_v1', {
    p_org_id: input.orgId, p_actor_id: input.actorId, p_source_id: connection.sourceId, p_member_id: input.memberId,
    p_draft_revision: input.revision, p_effective_revision: connection.effectiveRevision,
    p_source_updated_at: draft.sourceUpdatedAt, p_token_hash: digest(token),
  })
  if (error) throw unavailable()
  if (!data) throw stale()
  return { trial: data as Trial, trialPath: `/api/auth/fxiaoke/start?trial=${token}` }
}

export async function getFxiaokeRotationTrial(token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) throw stale()
  const { data, error } = await supabaseAdmin.rpc('resolve_fxiaoke_credential_rotation_v1', { p_token_hash: digest(token) })
  if (error) throw unavailable()
  if (!data) throw stale()
  const { id, orgId, sourceId, revision, sourceUpdatedAt } = data as RotationBinding
  const credentials = await loadFxiaokeTrialCredentials(orgId, revision, { id, sourceId, sourceUpdatedAt })
  return { orgId, revision, credentials, trial: { id, sourceId, sourceUpdatedAt } }
}

export async function loadFxiaokeTrialCredentials(orgId: string, revision: string, trial: FxiaokeRotationContext) {
  const credentials = await loadFxiaokeRotationDraft({ orgId, revision, sourceId: trial.sourceId, sourceUpdatedAt: trial.sourceUpdatedAt })
  return credentials as Credentials
}

export async function completeFxiaokeCredentialRotation(input: { orgId: string; trialId: string; revision: string; externalUserId: string }) {
  const { data, error } = await supabaseAdmin.rpc('complete_fxiaoke_credential_rotation_v1', {
    p_org_id: input.orgId, p_trial_id: input.trialId, p_draft_revision: input.revision, p_external_user_id: input.externalUserId,
  })
  if (error) throw unavailable()
  return data === true
}

export async function promoteFxiaokeCredentialRotation(input: { orgId: string; actorId: string; trialId: string; revision: string }) {
  const { data, error } = await supabaseAdmin.rpc('promote_fxiaoke_credential_rotation_v1', {
    p_org_id: input.orgId, p_actor_id: input.actorId, p_trial_id: input.trialId, p_draft_revision: input.revision,
  })
  if (error) throw unavailable()
  if (data !== true) throw stale()
}
