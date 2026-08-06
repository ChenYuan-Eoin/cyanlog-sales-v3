// F018 日程管理 - CRUD API
// 包含 F019 提醒规则自动创建

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { AGENDA_TYPES, AGENDA_STATUSES, AGENDA_PRIORITIES } from '@/lib/agenda/types'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  agenda_type: z.enum(AGENDA_TYPES as [string, ...string[]]).default('TASK'),
  start_at: z.string().datetime(),
  end_at: z.string().datetime().optional(),
  all_day: z.boolean().default(false),
  priority: z.enum(AGENDA_PRIORITIES as [string, ...string[]]).default('NORMAL'),
  parent_id: z.string().uuid().nullable().optional(),
  depends_on: z.array(z.string().uuid()).max(50).optional(),
  related_type: z.string().max(50).optional(),
  related_id: z.string().uuid().optional(),
})

const listSchema = z.object({
  status: z.enum(AGENDA_STATUSES as [string, ...string[]]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

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
    if (!q.success) return errorResponse(createApiError('VALIDATION_ERROR', '查询参数无效'))

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
    if (error) return errorResponse(createApiError('DB_ERROR', '查询失败'))

    const items = data || []
    const ids = items.map((item: { id: string }) => item.id)
    if (ids.length === 0) return successResponse([])

    // 依赖边：agenda -> depends_on（用于关键路径自动计算）
    const { data: deps, error: depsError } = await supabaseAdmin
      .from('agenda_dependencies')
      .select('agenda_id, depends_on_id')
      .in('agenda_id', ids)
    if (depsError) return errorResponse(createApiError('DB_ERROR', '依赖查询失败'))

    const depsByAgenda = new Map<string, string[]>()
    for (const row of deps || []) {
      const list = depsByAgenda.get(row.agenda_id) || []
      list.push(row.depends_on_id)
      depsByAgenda.set(row.agenda_id, list)
    }
    const withDeps = items.map((item: { id: string }) => ({
      ...item,
      depends_on: depsByAgenda.get(item.id) || [],
    }))
    return successResponse(withDeps)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse(createApiError('UNAUTHORIZED'))
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const body = await req.json().catch(() => null)
    const result = createSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(createApiError('VALIDATION_ERROR', firstError.message))
    }

    const input = result.data
    const { depends_on: dependencyIds, ...insertFields } = input
    const { data, error } = await supabaseAdmin
      .from('agenda_items')
      .insert({
        ...insertFields,
        status: 'PENDING',
        all_day: input.all_day || false,
        assignee_id: user.id,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) return errorResponse(createApiError('DB_ERROR', '创建失败'))

    // F019: 自动应用提醒规则（提前 30 分钟 IN_APP 提醒）
    await applyDefaultReminders(data.id, input.start_at)

    // WP11: 依赖边（跳过自依赖；重复依赖由唯一约束兜底）
    const safeDeps = (dependencyIds || []).filter(
      (depId: string) => depId !== data.id && depId !== input.parent_id
    )
    if (safeDeps.length > 0) {
      await supabaseAdmin.from('agenda_dependencies').insert(
        safeDeps.map((depId: string) => ({
          agenda_id: data.id,
          depends_on_id: depId,
        }))
      )
    }

    return createdResponse(data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse(createApiError('UNAUTHORIZED'))
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

const patchSchema = z.object({
  status: z.enum(AGENDA_STATUSES as [string, ...string[]]).optional(),
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().nullable().optional(),
  priority: z.enum(AGENDA_PRIORITIES as [string, ...string[]]).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  depends_on: z.array(z.string().uuid()).max(50).optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return errorResponse(createApiError('VALIDATION_ERROR', '缺少日程 id'))

    const body = await req.json().catch(() => null)
    const result = patchSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(createApiError('VALIDATION_ERROR', firstError.message))
    }

    // 校验归属：只能修改自己的日程
    const { data: owned } = await supabaseAdmin
      .from('agenda_items')
      .select('id')
      .eq('id', id)
      .or(`assignee_id.eq.${user.id},created_by.eq.${user.id}`)
      .maybeSingle()
    if (!owned) return errorResponse(createApiError('NOT_FOUND', '日程不存在'))

    const { depends_on: dependencyIds, ...updateFields } = result.data
    const { data, error } = await supabaseAdmin
      .from('agenda_items')
      .update({ ...updateFields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) return errorResponse(createApiError('DB_ERROR', '更新失败'))

    if (dependencyIds) {
      await supabaseAdmin
        .from('agenda_dependencies')
        .delete()
        .eq('agenda_id', id)
      const safeDeps = dependencyIds.filter(
        (depId: string) => depId !== id && depId !== (updateFields.parent_id as string | undefined)
      )
      if (safeDeps.length > 0) {
        await supabaseAdmin.from('agenda_dependencies').insert(
          safeDeps.map((depId: string) => ({
            agenda_id: id,
            depends_on_id: depId,
          }))
        )
      }
    }

    return successResponse(data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse(createApiError('UNAUTHORIZED'))
    return errorResponse(createApiError('INTERNAL_ERROR'))
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
