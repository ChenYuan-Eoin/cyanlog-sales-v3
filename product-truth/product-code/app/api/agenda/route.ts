// F018 日程管理 - CRUD API
// 包含 F019 提醒规则自动创建

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { AGENDA_TYPES, AGENDA_STATUSES, AGENDA_PRIORITIES } from '@/lib/agenda/types'

export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  agenda_type: z.enum(AGENDA_TYPES as [string, ...string[]]).default('TASK'),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  all_day: z.boolean().default(false),
  priority: z.enum(AGENDA_PRIORITIES as [string, ...string[]]).default('NORMAL'),
  related_type: z.string().max(50).optional(),
  related_id: z.string().uuid().optional(),
})

const listSchema = z.object({
  status: z.enum(AGENDA_STATUSES as [string, ...string[]]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { searchParams } = new URL(req.url)
    const q = listSchema.safeParse({
      status: searchParams.get('status') || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      limit: searchParams.get('limit') || 50,
    })
    if (!q.success) return errorResponse('查询参数无效', 400, 'INVALID_QUERY')

    const { status, from, to, limit } = q.data
    let query = supabaseAdmin
      .from('agenda_items')
      .select('*')
      .order('start_at', { ascending: true })
      .limit(limit)

    if (status) query = query.eq('status', status)
    if (from) query = query.gte('start_at', from)
    if (to) query = query.lte('start_at', to)

    // 默认只显示当前用户的待办
    query = query.or(`assignee_id.eq.${user.id},created_by.eq.${user.id}`)

    const { data, error } = await query
    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')
    return NextResponse.json({ data: data || [] })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const body = await req.json().catch(() => null)
    const result = createSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const input = result.data
    const { data, error } = await supabaseAdmin
      .from('agenda_items')
      .insert({
        ...input,
        status: 'PENDING',
        all_day: input.all_day || false,
        assignee_id: user.id,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) return errorResponse('创建失败', 500, 'DB_ERROR')

    // F019: 自动应用提醒规则（提前 30 分钟 IN_APP 提醒）
    await applyDefaultReminders(data.id, input.start_at)

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// 应用默认提醒规则：提前 30 分钟 IN_APP 提醒
async function applyDefaultReminders(agendaId: string, startAt: string) {
  // 查找默认规则：30 分钟前
  const { data: rule } = await supabaseAdmin
    .from('reminder_rules')
    .select('id, trigger_offset_minutes')
    .eq('is_active', true)
    .order('trigger_offset_minutes', { ascending: true })
    .limit(1)
    .single()

  const offset = rule?.trigger_offset_minutes || 30
  const remindAt = new Date(new Date(startAt).getTime() - offset * 60 * 1000).toISOString()

  await supabaseAdmin.from('reminders').insert({
    agenda_id: agendaId,
    rule_id: rule?.id || null,
    remind_at: remindAt,
    status: 'PENDING',
  })
}
