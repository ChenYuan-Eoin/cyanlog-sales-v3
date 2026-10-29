import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { discoverEnterprise } from '@/lib/fxiaoke/client'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'
import { loadOAuthCredentials } from '@/lib/fxiaoke/settings'
import {
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
  getOrgAuthorizationRoleCodes,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

const bindingSchema = z.object({
  external_subject: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const actor = await requireAuth(request)
    const orgId = await getFreshDefaultOrgId(actor.id)
    const assignments = await getFreshUserScopedRoleAssignments(actor.id)
    if (
      !canMutateOrgUsers(assignments, orgId)
      || !getOrgAuthorizationRoleCodes(assignments, orgId).includes('SUPER_ADMIN')
    ) {
      return NextResponse.json(
        { error: '仅当前组织超级管理员可以绑定外部身份', code: 'SUPER_ADMIN_REQUIRED' },
        { status: 403 },
      )
    }

    const parsed = bindingSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: '纷享员工 openUserId 格式不正确', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    const credentials = await loadOAuthCredentials(orgId)
    const enterprise = await discoverEnterprise(
      credentials,
      transportForOrganization(orgId),
    )
    const { data, error } = await supabaseAdmin.rpc('admin_bind_fxiaoke_identity_v1', {
      p_actor_id: actor.id,
      p_org_id: orgId,
      p_user_id: id,
      p_external_tenant_id: enterprise.corpId,
      p_external_subject: parsed.data.external_subject,
      p_request_id: request.headers.get('x-request-id'),
    })

    if (error) {
      const conflict = error.code === '23505' || error.code === '23514'
      return NextResponse.json(
        {
          error: conflict
            ? '该成员或纷享身份已有冲突绑定，请先人工核对'
            : '身份绑定失败',
          code: conflict ? 'IDENTITY_CONFLICT' : 'IDENTITY_BINDING_FAILED',
        },
        { status: conflict ? 409 : 500 },
      )
    }
    if (!data || typeof data !== 'object') {
      return NextResponse.json(
        { error: '身份绑定未返回有效结果', code: 'IDENTITY_BINDING_FAILED' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (error instanceof Error && error.name === 'AuthError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (
      error instanceof FxiaokeError
      || /CREDENTIALS|CONFIGURATION|PROVIDER|TENANT|EGRESS/i.test(message)
    ) {
      return NextResponse.json(
        { error: '纷享企业身份暂时无法核验，请检查连接配置', code: 'FXIAOKE_IDENTITY_UNAVAILABLE' },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
