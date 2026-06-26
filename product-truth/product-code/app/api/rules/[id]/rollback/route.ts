// REQ:F006
// PURPOSE: Rule rollback API - rollback to a specific version

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/rules/[id]/rollback - 回滚到指定版本
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(req)
    const { id: ruleId } = await params

    const body = await req.json().catch(() => null) as { version?: unknown } | null
    const targetVersion = body?.version

    if (!targetVersion || typeof targetVersion !== 'number') {
      return NextResponse.json({ error: '请指定回滚目标版本' }, { status: 400 })
    }

    const orgId = await getDefaultOrgId(user.id)

    // 检查规则
    const { data: rule, error: ruleError } = await supabaseAdmin
      .from('contract_rules')
      .select('*')
      .eq('id', ruleId)
      .eq('org_id', orgId)
      .single()

    if (ruleError || !rule) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 })
    }

    // 获取目标版本
    const { data: targetVersionData, error: versionError } = await supabaseAdmin
      .from('contract_rule_versions')
      .select('*')
      .eq('rule_id', ruleId)
      .eq('version', targetVersion)
      .single()

    if (versionError || !targetVersionData) {
      return NextResponse.json({ error: '目标版本不存在' }, { status: 404 })
    }

    // 不能回滚到当前版本
    if (targetVersion === rule.version) {
      return NextResponse.json({ error: '不能回滚到当前版本' }, { status: 400 })
    }

    // 创建新版本（内容为回滚目标的内容）
    const newVersion = (rule.version || 1) + 1
    const content = targetVersionData.content as Record<string, unknown>

    // 开启事务：创建回滚版本 + 更新主表
    const { data: newVersionRecord, error: createError } = await supabaseAdmin
      .from('contract_rule_versions')
      .insert({
        rule_id: ruleId,
        org_id: orgId,
        version: newVersion,
        content,
        change_type: 'rollback',
        change_summary: `回滚到版本 ${targetVersion}`,
        rollback_from_version: targetVersion,
        status: 'published',
        published_at: new Date().toISOString(),
        published_by: user.id,
        created_by: user.id,
      })
      .select()
      .single()

    if (createError) {
      console.error('Create rollback version error:', createError)
      return NextResponse.json({ error: '创建回滚版本失败' }, { status: 500 })
    }

    // 更新主表数据
    const { error: updateError } = await supabaseAdmin
      .from('contract_rules')
      .update({
        name: content.name,
        rule_type: content.rule_type,
        category: content.category,
        condition_config: content.condition_config,
        semantic_condition: content.semantic_condition,
        message_config: content.message_config,
        scope: content.scope,
        contract_types: content.contract_types,
        priority: content.priority,
        group_id: content.group_id,
        group_operator: content.group_operator,
        level: content.level,
        version: newVersion,
        status: 'published',
        published_at: new Date().toISOString(),
        published_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)

    if (updateError) {
      console.error('Update rule after rollback error:', updateError)
      return NextResponse.json({ error: '更新规则失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `已成功回滚到版本 ${targetVersion}，新版本号为 ${newVersion}`,
      data: {
        newVersion: newVersionRecord,
        rollbackFrom: targetVersion,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    console.error('Rollback rule error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
