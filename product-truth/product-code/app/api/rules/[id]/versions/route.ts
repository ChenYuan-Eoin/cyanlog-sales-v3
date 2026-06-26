// REQ:F006
// PURPOSE: Rule version management API - list, create, rollback versions

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/rules/[id]/versions - 获取规则版本历史
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id: ruleId } = await params

    // 先检查规则是否存在且属于当前组织
    const { data: rule, error: ruleError } = await supabaseAdmin
      .from('contract_rules')
      .select('id')
      .eq('id', ruleId)
      .eq('org_id', orgId)
      .single()

    if (ruleError || !rule) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 })
    }

    // 获取版本历史
    const { data: versions, error } = await supabaseAdmin
      .from('contract_rule_versions')
      .select(`
        id,
        version,
        content,
        change_type,
        change_summary,
        rollback_from_version,
        status,
        published_at,
        published_by,
        created_by,
        created_at
      `)
      .eq('rule_id', ruleId)
      .order('version', { ascending: false })

    if (error) {
      console.error('Get rule versions error:', error)
      return NextResponse.json({ error: '查询版本历史失败' }, { status: 500 })
    }

    return NextResponse.json({
      data: versions || [],
      count: versions?.length || 0,
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    console.error('Get rule versions error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

// POST /api/rules/[id]/versions - 创建新版本（发布）
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(req)
    const { id: ruleId } = await params
    const body = await req.json().catch(() => null) as { change_summary?: unknown } | null

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '请求参数无效' }, { status: 400 })
    }

    const changeSummary = typeof body.change_summary === 'string' ? body.change_summary : undefined
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

    // 创建新版本
    const newVersion = (rule.version || 1) + 1

    const { data: version, error } = await supabaseAdmin
      .from('contract_rule_versions')
      .insert({
        rule_id: ruleId,
        org_id: orgId,
        version: newVersion,
        content: {
          name: rule.name,
          rule_type: rule.rule_type,
          category: rule.category,
          condition_config: rule.condition_config,
          semantic_condition: rule.semantic_condition,
          message_config: rule.message_config,
          scope: rule.scope,
          contract_types: rule.contract_types,
          priority: rule.priority,
          group_id: rule.group_id,
          group_operator: rule.group_operator,
          level: rule.level,
        },
        change_type: 'update',
        change_summary: changeSummary || '规则更新',
        status: 'published',
        published_at: new Date().toISOString(),
        published_by: user.id,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Create rule version error:', error)
      return NextResponse.json({ error: '创建版本失败' }, { status: 500 })
    }

    // 更新主表的版本号
    await supabaseAdmin
      .from('contract_rules')
      .update({
        version: newVersion,
        published_at: new Date().toISOString(),
        published_by: user.id,
        status: 'published',
      })
      .eq('id', ruleId)

    return NextResponse.json(version, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    console.error('Create rule version error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
