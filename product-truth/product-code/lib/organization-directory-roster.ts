import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'

const id = z.guid()
const sourceSchema = z.object({
  id,
  system_org_id: id,
  provider: z.string().min(1),
  status: z.literal('active'),
  last_successful_sync_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
})
const userSchema = z.object({
  id,
  display_name: z.string(),
  primary_dept_id: id.nullable(),
  department_ids: z.array(id),
  directory_identity_id: id.nullable(),
  directory_external_id: z.string().refine(value => value.trim().length > 0).nullable(),
  directory_source: z.string().nullable(),
  directory_status: z.enum(['active', 'suspended', 'ended']),
})
const payloadSchema = z.object({
  organization: z.object({ id }),
  users: z.array(userSchema),
})
const collator = new Intl.Collator('zh-CN')
export type DirectoryRosterMember = { id: string; displayName: string; departmentIds: string[] }

export type DirectoryRosterUnavailable = {
  status: 'unavailable'
  reason: 'DIRECTORY_UNCONFIRMED' | 'DIRECTORY_UNAVAILABLE' | 'DIRECTORY_CHANGED'
}
type DirectoryRosterSource = { status: 'confirmed'; sourceId: string; provider: string; asOf: string }
export type DirectoryRoster =
  | { status: 'ready'; asOf: string; members: DirectoryRosterMember[] }
  | DirectoryRosterUnavailable

async function loadAuthority(orgId: string) {
  // The v1 RPC joins every authoritative source, including disabled rows.
  // Count all authority markers before validating the single source's state.
  return supabaseAdmin.from('organization_sources').select('id,system_org_id,provider,status,last_successful_sync_at')
    .eq('system_org_id', orgId).in('authority_scope->>directory', ['authoritative', 'true']).limit(2)
}

function confirmedSource(rows: unknown, orgId: string) {
  const result = z.tuple([sourceSchema]).safeParse(rows)
  if (!result.success || result.data[0].system_org_id !== orgId) return null
  return result.data[0]
}

function projectMembers(
  users: z.infer<typeof userSchema>[],
  provider: string,
): DirectoryRosterMember[] | null {
  const byIdentity = new Map<string, { identityId: string; member: DirectoryRosterMember }>()
  const identityByMember = new Map<string, string>()
  const externalIdByIdentity = new Map<string, string>()

  for (const user of users) {
    if (user.directory_source !== provider) return null
    if (!user.directory_identity_id && !user.directory_external_id) continue
    if (!user.directory_identity_id || !user.directory_external_id) return null
    // The directory employment state is independent of first-login or current
    // account access. An active, matched invite is part of the roster.
    if (user.directory_status !== 'active') continue

    const previous = byIdentity.get(user.directory_external_id)
    const previousExternalId = identityByMember.get(user.id)
    const externalIdForIdentity = externalIdByIdentity.get(user.directory_identity_id)
    if ((previous && (previous.identityId !== user.directory_identity_id || previous.member.id !== user.id))
      || (previousExternalId && previousExternalId !== user.directory_external_id)
      || (externalIdForIdentity && externalIdForIdentity !== user.directory_external_id)) return null

    const departmentIds = [...user.department_ids]
    if (user.primary_dept_id) departmentIds.push(user.primary_dept_id)
    const member = {
      id: user.id,
      displayName: user.display_name,
      departmentIds: [...new Set([...(previous?.member.departmentIds ?? []), ...departmentIds])].sort(),
    }
    byIdentity.set(user.directory_external_id, { identityId: user.directory_identity_id, member })
    identityByMember.set(user.id, user.directory_external_id)
    externalIdByIdentity.set(user.directory_identity_id, user.directory_external_id)
  }

  return [...byIdentity.values()].map(value => value.member)
    .sort((left, right) => collator.compare(left.displayName, right.displayName) || left.id.localeCompare(right.id))
}

export async function readDirectoryRosterSource(orgId: string): Promise<DirectoryRosterSource | DirectoryRosterUnavailable> {
  try {
    const sources = await loadAuthority(orgId)
    if (sources.error) return { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
    const source = confirmedSource(sources.data, orgId)
    if (!source) return { status: 'unavailable', reason: 'DIRECTORY_UNCONFIRMED' }
    const asOf = source.last_successful_sync_at
    const run = await supabaseAdmin.from('organization_directory_cutover_runs').select('id')
      .eq('system_org_id', orgId).eq('target_source_id', source.id).eq('applied_at', asOf)
      .eq('status', 'applied').is('rolled_back_at', null).limit(2)
    if (run.error) return { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
    if (run.data?.length !== 1) return { status: 'unavailable', reason: 'DIRECTORY_UNCONFIRMED' }
    return { status: 'confirmed', sourceId: source.id, provider: source.provider, asOf }
  } catch {
    return { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
  }
}

export async function verifyDirectoryRoster(
  orgId: string, source: DirectoryRosterSource | DirectoryRosterUnavailable, value: unknown,
): Promise<DirectoryRoster> {
  if (source.status === 'unavailable') return source
  const payload = payloadSchema.safeParse(value)
  if (!payload.success || payload.data.organization.id !== orgId) {
    return { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
  }

  try {
    // Read the exact same applied source again after the directory payload,
    // so an intervening cutover does not label a different roster as current.
    const currentSources = await loadAuthority(orgId)
    if (currentSources.error) return { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
    const current = confirmedSource(currentSources.data, orgId)
    if (current?.id !== source.sourceId || current.provider !== source.provider || current.last_successful_sync_at !== source.asOf) {
      return { status: 'unavailable', reason: 'DIRECTORY_CHANGED' }
    }
    const members = projectMembers(payload.data.users, source.provider)
    return members
      ? { status: 'ready', asOf: source.asOf, members }
      : { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
  } catch {
    return { status: 'unavailable', reason: 'DIRECTORY_UNAVAILABLE' }
  }
}
