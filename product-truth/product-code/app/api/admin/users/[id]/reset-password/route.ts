// REQ:F011 - 用户管理扩展：重置密码
// PURPOSE: 管理员帮用户重置密码，生成临时密码

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'

function generateTempPassword(): string {
  // 12位随机字母数字组合，包含大小写和数字
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 12; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length)
    result += chars[randomIndex]
  }
  return result
}

// POST /api/admin/users/:id/reset-password - 重置密码
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    // 不能重置自己的密码（安全考虑：应通过"改密"流程）
    if (id === currentUser.id) {
      return NextResponse.json({ error: '不能通过此接口重置自己的密码，请使用"修改密码"功能' }, { status: 400 })
    }

    // 检查用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 生成临时密码并哈希
    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, 12)

    // 更新用户密码，强制首次登录改密
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        password_hash: passwordHash,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (updateError) {
      console.error('Reset password error:', updateError)
      return NextResponse.json({ error: '重置密码失败' }, { status: 500 })
    }

    // ponytail: 不在这里发邮件，避免引入邮件服务依赖
    // 升级路径：接入邮件服务（如 SendGrid/Amazon SES）后，在此处调用邮件发送

    return NextResponse.json({
      success: true,
      data: {
        tempPassword,
        // 注意：实际生产环境应该通过邮件发送，不要把密码返回前端
        // 这里返回是为了MVP阶段的便利性，后续应移除
        userId: id,
        displayName: existing.display_name,
      },
      message: '密码已重置',
    })
  } catch (err) {
    console.error('POST reset-password error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
