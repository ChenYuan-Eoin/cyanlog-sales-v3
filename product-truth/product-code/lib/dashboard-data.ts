import { supabaseAdmin } from '@/lib/supabase'
import type { AuthUser } from '@/lib/auth'
import { getFreshDefaultOrgId, listAccessibleSalesSpaces } from '@/lib/scoped-access'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'

type CustomerRow = {
  id: string
  name: string
  short_name: string | null
}

type OpportunityRow = {
  id: string
  space_id: string
  customer_id: string
  name: string
  amount: number
  status: string
  stage: string | null
  probability: number
  owner_id: string
  expected_close_date: string | null
  customer: CustomerRow | CustomerRow[] | null
}

type OpportunityPayload = Omit<OpportunityRow, 'customer'> & {
  customer?: CustomerRow
}

type MilestoneOpportunityLink = {
  name: string
  customer_id: string
}

type MilestoneRow = {
  id: string
  opportunity_id: string
  name: string
  type: string
  status: string
  priority: string
  due_date: string
  opportunity: MilestoneOpportunityLink | MilestoneOpportunityLink[] | null
}

type ReminderRow = {
  id: string
  type: string
  title: string
  description: string | null
  priority: string
  read_at: string | null
}

type AgendaRow = {
  id: string
  title: string
  description: string | null
  start_time: string | null
  end_time: string | null
  start_at: string | null
  end_at: string | null
  org_id: string
  user_id: string
  created_by: string | null
  assignee_id: string | null
}

type PersonalReminderRow = ReminderRow & { org_id: string; user_id: string }
type PersonalDashboardData = Pick<DashboardPayload, 'reminders' | 'agenda'>

type DashboardSpace = {
  id: string
  name: string
  description: string | null
  department_id: string
  owner_id: string | null
  active_opportunities: number | null
  pending_milestones: number | null
}

export type DashboardPayload = {
  spaces: DashboardSpace[]
  activeSpace: DashboardSpace | null
  opportunities: OpportunityPayload[]
  milestones: Array<Omit<MilestoneRow, 'opportunity'> & { opportunity?: MilestoneOpportunityLink }>
  reminders: ReminderRow[]
  agenda: Array<{
    id: string
    title: string
    description: string | null
    start_time: string
    end_time: string | null
  }>
}

export class DashboardDataError extends Error {
  status: number
  code: string

  constructor(message: string, code: string, status = 500) {
    super(message)
    this.name = 'DashboardDataError'
    this.status = status
    this.code = code
  }
}

const DASHBOARD_CACHE_TTL_MS = 10_000
const dashboardCache = new Map<string, { value: DashboardPayload; expiresAt: number }>()
const dashboardInflight = new Map<string, Promise<DashboardPayload>>()

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function cacheKey(user: AuthUser, requestedSpaceId?: string | null) {
  return `${user.id}:${user.org_id || ''}:${requestedSpaceId || ''}`
}

function normalizeDashboardPayload(value: unknown): DashboardPayload {
  const payload = (value || {}) as Partial<DashboardPayload>
  return {
    spaces: Array.isArray(payload.spaces) ? payload.spaces : [],
    activeSpace: payload.activeSpace || null,
    opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : [],
    milestones: Array.isArray(payload.milestones) ? payload.milestones : [],
    reminders: [],
    agenda: [],
  }
}

async function loadDashboardPayloadFromRpc(user: AuthUser, requestedSpaceId?: string | null): Promise<DashboardPayload | null> {
  const { data, error } = await supabaseAdmin.rpc('get_dashboard_payload_v1', {
    p_user_id: user.id,
    p_org_id: user.org_id || null,
    p_requested_space_id: requestedSpaceId || null,
  })

  if (error) {
    return null
  }

  return normalizeDashboardPayload(data)
}

export async function getPersonalDashboardData(userId: string, orgId: string): Promise<PersonalDashboardData> {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const [reminders, agenda] = await Promise.all([
    supabaseAdmin.from('reminders')
      .select('id,type,title,description,priority,read_at,org_id,user_id')
      .eq('org_id', orgId).eq('user_id', userId).is('dismissed_at', null)
      .order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('agenda_items')
      .select('id,title,description,start_time,end_time,start_at,end_at,org_id,user_id,assignee_id,created_by')
      .eq('org_id', orgId)
      .or(`user_id.eq.${userId},assignee_id.eq.${userId},created_by.eq.${userId}`)
      .eq('agenda_date', today).order('start_at', { ascending: true }).limit(6),
  ])
  if (reminders.error) throw new DashboardDataError('读取提醒失败', 'REMINDER_FETCH_FAILED')
  if (agenda.error) throw new DashboardDataError('读取日程失败', 'AGENDA_FETCH_FAILED')

  return {
    reminders: ((reminders.data ?? []) as PersonalReminderRow[])
      .filter(row => row.org_id === orgId && row.user_id === userId)
      .map(({ id, type, title, description, priority, read_at }) => ({ id, type, title, description, priority, read_at })),
    agenda: ((agenda.data ?? []) as AgendaRow[])
      .filter(row => row.org_id === orgId && [row.user_id, row.assignee_id, row.created_by].includes(userId))
      .map(row => ({
        id: row.id, title: row.title, description: row.description,
        start_time: row.start_at || row.start_time || '', end_time: row.end_at || row.end_time,
      })),
  }
}

async function loadDashboardPayloadViaQueries(
  user: AuthUser,
  requestedSpaceId?: string | null,
  requireAvailableSpace = false,
): Promise<DashboardPayload> {
  const orgId = user.org_id || await getFreshDefaultOrgId(user.id)
  const { spaces } = await listAccessibleSalesSpaces(user.id, orgId)
  let availableSpaces = spaces
  if (requireAvailableSpace && spaces.length > 0) {
    const result = await supabaseAdmin.from('sales_spaces').select('id')
      .eq('org_id', orgId).eq('status', 'active').in('id', spaces.map(space => space.id))
    if (result.error) throw result.error
    const liveIds = new Set((result.data ?? []).map(space => space.id))
    availableSpaces = spaces.filter(space => liveIds.has(space.id))
  }
  const normalizedSpaces = availableSpaces
    .map((space) => ({
      id: space.id,
      name: space.name,
      description: space.description,
      department_id: space.department_id,
      owner_id: space.owner_id,
      active_opportunities: space.active_opportunities || 0,
      pending_milestones: space.pending_milestones || 0,
    }))

  const requestedSpace = normalizedSpaces.find(space => space.id === requestedSpaceId)
  if (requireAvailableSpace && requestedSpaceId != null && !requestedSpace) {
    throw new DashboardDataError('无权查看所选销售空间', 'DASHBOARD_SPACE_FORBIDDEN', 403)
  }
  if (normalizedSpaces.length === 0) {
    return {
      spaces: [],
      activeSpace: null,
      opportunities: [],
      milestones: [],
      reminders: [], agenda: [],
    }
  }

  const activeSpace = requestedSpace ?? normalizedSpaces[0]
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const oppsResult = await supabaseAdmin
      .from('opportunities')
      .select('id, space_id, customer_id, name, amount, status, stage, probability, owner_id, expected_close_date, customer:customers!inner(id, name, short_name)')
      .eq('org_id', orgId).eq('customer.org_id', orgId)
      .eq('space_id', activeSpace.id)
      .order('expected_close_date', { ascending: true })
      .limit(20)

  if (oppsResult.error) {
    throw new DashboardDataError('读取机会失败', 'OPPORTUNITY_FETCH_FAILED')
  }

  const opportunities = ((oppsResult.data || []) as OpportunityRow[]).map((row) => ({
    ...row,
    customer: unwrapOne(row.customer) || undefined,
  }))
  const opportunityIds = opportunities.map((row) => row.id)
  let milestones: DashboardPayload['milestones'] = []

  if (opportunityIds.length > 0) {
    const { data: milestoneRows, error: milestoneError } = await supabaseAdmin
      .from('milestones')
      .select('id, opportunity_id, name, type, status, priority, due_date, opportunity:opportunities!inner(name, customer_id)')
      .eq('org_id', orgId).eq('opportunity.org_id', orgId)
      .in('opportunity_id', opportunityIds)
      .in('status', ['PENDING', 'IN_PROGRESS'])
      .lte('due_date', nextWeek.toISOString())
      .order('due_date', { ascending: true })
      .limit(10)

    if (milestoneError) {
      throw new DashboardDataError('读取硬节点失败', 'MILESTONE_FETCH_FAILED')
    }

    milestones = ((milestoneRows || []) as MilestoneRow[]).map((row) => ({
      ...row,
      opportunity: unwrapOne(row.opportunity) || undefined,
    }))
  }

  return {
    spaces: normalizedSpaces,
    activeSpace,
    opportunities,
    milestones,
    reminders: [], agenda: [],
  }
}

export async function getVerifiedLegacyDashboardPayload(user: AuthUser, orgId: string, requestedSpaceId: string | null): Promise<DashboardPayload> {
  // The historical payload RPC resolves role rows across all of the account's organizations.
  const [workspace, personal] = await Promise.all([
    loadDashboardPayloadViaQueries({ ...user, org_id: orgId }, requestedSpaceId, true),
    getPersonalDashboardData(user.id, orgId),
  ])
  return { ...workspace, ...personal }
}

async function loadDashboardPayload(user: AuthUser, requestedSpaceId?: string | null): Promise<DashboardPayload> {
  const rpcPayload = await loadDashboardPayloadFromRpc(user, requestedSpaceId)
  if (rpcPayload) return rpcPayload

  return loadDashboardPayloadViaQueries(user, requestedSpaceId)
}

export async function getDashboardPayload(user: AuthUser, requestedSpaceId?: string | null): Promise<DashboardPayload> {
  // Bind every request to the current default organization before considering
  // legacy RPC payloads or cached visible data.
  const orgId = await getFreshDefaultOrgId(user.id)
  const scopedUser = { ...user, org_id: orgId }
  const settings = await loadOrgRolePermissionSettings(orgId)
  if (settings !== null && (typeof settings !== 'object' || Array.isArray(settings))) {
    throw new Error('Invalid organization permission settings')
  }
  const overrides = settings && typeof settings === 'object'
    ? (settings as { role_permission_overrides?: unknown }).role_permission_overrides
    : undefined
  const key = cacheKey(scopedUser, requestedSpaceId)
  if (overrides !== undefined) {
    // Malformed overrides must also avoid the legacy template-based RPC.
    dashboardCache.delete(key)
    const [workspace, personal] = await Promise.all([
      loadDashboardPayloadViaQueries(scopedUser, requestedSpaceId), getPersonalDashboardData(user.id, orgId),
    ])
    return { ...workspace, ...personal }
  }
  const cached = dashboardCache.get(key)
  if (cached && cached.expiresAt >= Date.now()) {
    return { ...cached.value, ...await getPersonalDashboardData(user.id, orgId) }
  }
  if (cached) {
    dashboardCache.delete(key)
  }

  const inflight = dashboardInflight.get(key)
  if (inflight) {
    const [workspace, personal] = await Promise.all([inflight, getPersonalDashboardData(user.id, orgId)])
    return { ...workspace, ...personal }
  }

  const request = loadDashboardPayload(scopedUser, requestedSpaceId)
    .then((value) => {
      dashboardCache.set(key, {
        value,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      })
      return value
    })
    .finally(() => {
      dashboardInflight.delete(key)
    })

  dashboardInflight.set(key, request)
  const [workspace, personal] = await Promise.all([request, getPersonalDashboardData(user.id, orgId)])
  return { ...workspace, ...personal }
}

export function getCachedDashboardPayload(user: AuthUser, requestedSpaceId?: string | null): DashboardPayload | null {
  // Login cannot revalidate a synchronous cached authorization snapshot.
  // The dashboard page uses the async loader, which checks current overrides.
  void user
  void requestedSpaceId
  return null
}

export function cacheDashboardPayload(
  user: AuthUser,
  value: DashboardPayload,
  requestedSpaceId?: string | null
) {
  const key = cacheKey(user, requestedSpaceId)
  dashboardCache.set(key, {
    value: { ...value, reminders: [], agenda: [] },
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  })
}

export function primeDashboardPayload(user: AuthUser) {
  void getDashboardPayload(user).catch(() => {
    // Visible dashboard requests still handle errors.
  })
}
