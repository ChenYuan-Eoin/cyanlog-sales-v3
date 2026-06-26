// REQ: F003 自主可控 + RBAC
// PURPOSE: 角色管理 API - 编辑角色权限
// 权限要求: config:write

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { hasPermission } from '@/lib/permissions'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

function canWriteRoles(userPerms: string[]) {
  return hasPermission(userPerms, 'config:write')
    || hasPermission(userPerms, 'admin:access')
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
})

// PATCH /api/roles/[id] - 修改角色（需 config:write 权限）
export async function PATCH(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const userPerms = (req.headers.get('x-user-permissions') ?? '').split(',').filter(Boolean)
  if (!canWriteRoles(userPerms)) {
    return errorResponse(createApiError('FORBIDDEN', 'Forbidden'))
  }

  const id = await resolveIdParam(params)

  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(createApiError('VALIDATION_ERROR', 'INVALID_BODY', {
      reason: parsed.error.issues[0]?.message,
    }))
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update role error:', error)
    return errorResponse(createApiError('DB_ERROR', '更新失败'))
  }

  return successResponse(data)
}
