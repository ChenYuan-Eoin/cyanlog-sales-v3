import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { getDefaultOrgId, listAccessibleSalesSpaces } from '@/lib/scoped-access'

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
}

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const searchParams = req.nextUrl.searchParams
    const requestedSpaceId = searchParams.get('spaceId')
    const orgId = user.org_id || await getDefaultOrgId(user.id)
    const { spaces } = await listAccessibleSalesSpaces(user.id, orgId)
    const normalizedSpaces = spaces
      .map((space) => ({
        id: space.id,
        name: space.name,
        description: space.description,
        department_id: space.department_id,
        owner_id: space.owner_id,
        active_opportunities: space.active_opportunities || 0,
        pending_milestones: space.pending_milestones || 0,
      }))

    if (normalizedSpaces.length === 0) {
      return NextResponse.json({
        spaces: [],
        activeSpace: null,
        opportunities: [],
        milestones: [],
        reminders: [],
        agenda: [],
      })
    }

    const activeSpace = normalizedSpaces.find((space) => space.id === requestedSpaceId) || normalizedSpaces[0]

    const today = new Date()
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const todayStr = today.toISOString().slice(0, 10)

    const [oppsResult, remindersResult, agendaResult] = await Promise.all([
      supabaseAdmin
        .from('opportunities')
        .select('id, space_id, customer_id, name, amount, status, stage, probability, owner_id, expected_close_date, customer:customers(id, name, short_name)')
        .eq('space_id', activeSpace.id)
        .order('expected_close_date', { ascending: true })
        .limit(20),
      supabaseAdmin
        .from('reminders')
        .select('id, type, title, description, priority, read_at')
        .eq('user_id', user.id)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('agenda_items')
        .select('id, title, description, start_time, end_time, start_at, end_at')
        .or(`user_id.eq.${user.id},assignee_id.eq.${user.id},created_by.eq.${user.id}`)
        .eq('agenda_date', todayStr)
        .order('start_at', { ascending: true })
        .limit(6),
    ])

    if (oppsResult.error) {
      return errorResponse('读取机会失败', 500, 'OPPORTUNITY_FETCH_FAILED')
    }
    if (remindersResult.error) {
      return errorResponse('读取提醒失败', 500, 'REMINDER_FETCH_FAILED')
    }
    if (agendaResult.error) {
      return errorResponse('读取日程失败', 500, 'AGENDA_FETCH_FAILED')
    }

    const opportunities = ((oppsResult.data || []) as OpportunityRow[]).map((row) => ({
      ...row,
      customer: unwrapOne(row.customer) || undefined,
    }))

    const opportunityIds = opportunities.map((row) => row.id)
    let milestones: Array<Omit<MilestoneRow, 'opportunity'> & { opportunity?: MilestoneOpportunityLink }> = []

    if (opportunityIds.length > 0) {
      const { data: milestoneRows, error: milestoneError } = await supabaseAdmin
        .from('milestones')
        .select('id, opportunity_id, name, type, status, priority, due_date, opportunity:opportunities(name, customer_id)')
        .in('opportunity_id', opportunityIds)
        .in('status', ['PENDING', 'IN_PROGRESS'])
        .lte('due_date', nextWeek.toISOString())
        .order('due_date', { ascending: true })
        .limit(10)

      if (milestoneError) {
        return errorResponse('读取硬节点失败', 500, 'MILESTONE_FETCH_FAILED')
      }

      milestones = ((milestoneRows || []) as MilestoneRow[]).map((row) => ({
        ...row,
        opportunity: unwrapOne(row.opportunity) || undefined,
      }))
    }

    const agenda = ((agendaResult.data || []) as AgendaRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      start_time: row.start_at || row.start_time || '',
      end_time: row.end_at || row.end_time,
    }))

    return NextResponse.json({
      spaces: normalizedSpaces,
      activeSpace,
      opportunities,
      milestones,
      reminders: (remindersResult.data || []) as ReminderRow[],
      agenda,
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
