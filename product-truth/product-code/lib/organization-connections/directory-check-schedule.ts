import { supabaseAdmin } from '@/lib/supabase'
import { readFxiaokeDirectoryDifference } from './directory-cutover'
import { OrganizationConnectionError } from './errors'

export type DirectoryCheckInterval = 0 | 1 | 3 | 7

interface DirectoryCheckReport {
  checkedAt: string
  scopeVerified: boolean
  departmentsAdded: number
  departmentsUpdated: number
  departmentsToDeactivate: number
  membersAdded: number
  membersLinked: number
  membersMoved: number
  membersOffboarded: number
  identitiesUpdated: number
  conflicts: number
}

export interface DirectoryCheckSchedule {
  sourceId: string
  enabled: boolean
  intervalDays: DirectoryCheckInterval
  lastCheckAt: string | null
  lastAppliedAt: string | null
  nextCheckAt: string | null
  status: 'checking' | 'succeeded' | 'scope_unverified' | 'failed' | null
  errorCode: string | null
  latestReport: DirectoryCheckReport | null
  lastReliableReport: DirectoryCheckReport | null
}

interface ClaimedCheck {
  org_id: string
  source_id: string
  effective_revision: string
  attempt_id: string
}

interface CheckResult {
  status: 'succeeded' | 'scope_unverified' | 'failed'
  errorCode: string | null
  report: DirectoryCheckReport | null
}

function unavailable() {
  return new OrganizationConnectionError('DIRECTORY_CHECK_SCHEDULE_UNAVAILABLE', '目录检查暂不可用，请稍后重试。', 503)
}

export async function readDirectoryCheckSchedule(orgId: string, sourceId: string) {
  const { data, error } = await supabaseAdmin.rpc('read_fxiaoke_directory_check_schedule_v1', {
    p_org_id: orgId, p_source_id: sourceId,
  })
  if (error) throw unavailable()
  return data as DirectoryCheckSchedule | null
}

export async function setDirectoryCheckSchedule(orgId: string, sourceId: string, intervalDays: DirectoryCheckInterval) {
  const { data, error } = await supabaseAdmin.rpc('set_fxiaoke_directory_check_schedule_v1', {
    p_org_id: orgId, p_source_id: sourceId, p_interval_days: intervalDays,
  })
  if (error) throw unavailable()
  return data as DirectoryCheckSchedule | null
}

async function claimChecks(orgId: string | null, sourceId: string | null, limit: number) {
  const { data, error } = await supabaseAdmin.rpc('claim_fxiaoke_directory_checks_v1', {
    p_org_id: orgId, p_source_id: sourceId, p_limit: limit,
  })
  if (error || !Array.isArray(data)) throw unavailable()
  return data as ClaimedCheck[]
}

function safeCheckError(error: unknown) {
  return error instanceof OrganizationConnectionError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code : 'DIRECTORY_CHECK_FAILED'
}

async function checkDifference(claim: ClaimedCheck): Promise<CheckResult> {
  try {
    const difference = await readFxiaokeDirectoryDifference(claim.org_id)
    if (difference.organizationId !== claim.org_id || difference.targetProvider !== 'fxiaoke'
      || difference.targetSourceId !== claim.source_id || difference.connectionRevision !== claim.effective_revision) {
      return { status: 'failed', errorCode: 'CONFIG_CHANGED', report: null }
    }
    if (!difference.snapshot.complete || !difference.snapshot.connectionVerified) {
      return { status: 'failed', errorCode: 'DIRECTORY_READ_INCOMPLETE', report: null }
    }
    const scopeVerified = difference.snapshot.scopeVerified && Boolean(difference.snapshot.scopeEvidence?.trim())
    const summary = difference.summary
    return {
      status: scopeVerified ? 'succeeded' : 'scope_unverified',
      errorCode: null,
      report: {
        checkedAt: difference.snapshot.checkedAt,
        scopeVerified,
        departmentsAdded: summary.departmentsAdded,
        departmentsUpdated: summary.departmentsUpdated,
        departmentsToDeactivate: summary.departmentsToDeactivate,
        membersAdded: summary.membersAdded ?? 0,
        membersLinked: summary.membersLinked ?? 0,
        membersMoved: summary.membersMoved ?? 0,
        membersOffboarded: summary.membersOffboarded ?? 0,
        identitiesUpdated: summary.identitiesUpdated,
        conflicts: summary.conflicts,
      },
    }
  } catch (error) {
    return { status: 'failed', errorCode: safeCheckError(error), report: null }
  }
}

async function executeCheck(claim: ClaimedCheck) {
  const result = await checkDifference(claim)
  const { data, error } = await supabaseAdmin.rpc('finish_fxiaoke_directory_check_v1', {
    p_org_id: claim.org_id,
    p_source_id: claim.source_id,
    p_attempt_id: claim.attempt_id,
    p_effective_revision: claim.effective_revision,
    p_status: result.status,
    p_error_code: result.errorCode,
    p_report: result.report,
  })
  if (error) throw unavailable()
  return data === true ? result.status : 'failed'
}

export async function checkFxiaokeDirectoryNow(orgId: string, sourceId: string) {
  const [claim] = await claimChecks(orgId, sourceId, 1)
  if (claim) await executeCheck(claim)
  return readDirectoryCheckSchedule(orgId, sourceId)
}

export async function runDueFxiaokeDirectoryChecks() {
  const claims = await claimChecks(null, null, 4)
  const results = await Promise.allSettled(claims.map(executeCheck))
  return {
    checked: results.length,
    failed: results.filter(result => result.status === 'rejected' || result.value === 'failed').length,
  }
}
