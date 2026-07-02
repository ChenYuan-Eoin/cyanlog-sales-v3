// REQ:F006
// PURPOSE: Rule statistics API - hit rate, trends, performance metrics

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

export const dynamic = 'force-dynamic'

// GET /api/rules/stats - 获取规则统计总览
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { searchParams } = new URL(req.url)
    const days = parseInt(searchParams.get('days') || '30', 10)
    const ruleId = searchParams.get('rule_id')
    const includeArchived = searchParams.get('include_archived') === 'true'

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // 如果指定了规则ID，返回单规则统计
    if (ruleId) {
      return getSingleRuleStats(ruleId, orgId, startDate)
    }

    // 获取所有规则的统计摘要
    let rulesQuery = supabaseAdmin
      .from('contract_rules_v2')
      .select(`
        id,
        code,
        name,
        category,
        is_active,
        lifecycle_status,
        translation_status,
        published_at,
        priority
      `)
      .eq('org_id', orgId)
      .order('priority', { ascending: false })

    if (!includeArchived) {
      rulesQuery = rulesQuery.eq('is_active', true)
    }

    const { data: rules, error: rulesError } = await rulesQuery

    if (rulesError) {
      console.error('Get rules stats error:', rulesError)
      return NextResponse.json({ error: '查询失败' }, { status: 500 })
    }

    const ruleRows = rules || []
    const formallyPublishedRules = ruleRows.filter(isFormallyPublishedRule)
    const activeDraftRules = ruleRows.filter((r) => r.is_active && !isFormallyPublishedRule(r))

    // 计算汇总统计
    const summary = {
      total_rules: ruleRows.length,
      active_rules: ruleRows.filter((r) => r.is_active).length,
      published_rules: formallyPublishedRules.length,
      draft_rules: activeDraftRules.filter((r) => r.lifecycle_status !== 'published').length,
      translation_pending_rules: activeDraftRules.filter((r) => r.translation_status !== 'ready').length,
      avg_hit_rate: 0,
      structured_rules: ruleRows.filter(r => r.category !== 'text').length,
      semantic_rules: ruleRows.filter(r => r.category === 'text').length,
    }

    return NextResponse.json({
      summary,
      rules: ruleRows.map(r => ({
        id: r.id,
        name: r.name,
        rule_code: r.code,
        rule_type: r.category === 'text' ? 'semantic' : 'structured',
        level: r.category,
        hit_rate: 0,
        total_evaluations: 0,
        trigger_count: 0,
        status: getRuleRuntimeStatus(r),
        lifecycle_status: r.lifecycle_status || null,
        translation_status: r.translation_status || null,
        published_at: r.published_at || null,
      })),
      alerts: {
        low_hit_rate: [],
        high_hit_rate: [],
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    console.error('Get rules stats error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

type RuleStatsRow = {
  is_active?: boolean | null
  lifecycle_status?: string | null
  translation_status?: string | null
  published_at?: string | null
}

function isFormallyPublishedRule(rule: RuleStatsRow): boolean {
  return Boolean(
    rule.is_active &&
    rule.lifecycle_status === 'published' &&
    rule.translation_status === 'ready' &&
    rule.published_at
  )
}

function getRuleRuntimeStatus(rule: RuleStatsRow): 'published' | 'draft' | 'translation_pending' | 'archived' {
  if (!rule.is_active) return 'archived'
  if (isFormallyPublishedRule(rule)) return 'published'
  if (rule.translation_status !== 'ready') return 'translation_pending'
  return 'draft'
}

// 获取单规则统计详情
async function getSingleRuleStats(ruleId: string, orgId: string, startDate: Date) {
  // 检查规则
  const { data: rule, error: ruleError } = await supabaseAdmin
    .from('contract_rules_v2')
    .select('*')
    .eq('id', ruleId)
    .eq('org_id', orgId)
    .single()

  if (ruleError || !rule) {
    return NextResponse.json({ error: '规则不存在' }, { status: 404 })
  }

  // 获取历史趋势数据
  const { data: dailyStats, error: statsError } = await supabaseAdmin
    .from('contract_rule_stats')
    .select('*')
    .eq('rule_id', ruleId)
    .gte('stat_date', startDate.toISOString().split('T')[0])
    .order('stat_date', { ascending: true })

  if (statsError) {
    console.error('Get rule daily stats error:', statsError)
  }

  // 获取最近执行记录
  const { data: recentExecutions, error: execError } = await supabaseAdmin
    .from('contract_rule_execution_logs')
    .select(`
      id,
      contract_id,
      triggered,
      extracted_value,
      execution_time,
      created_at
    `)
    .eq('rule_id', ruleId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (execError) {
    console.error('Get recent executions error:', execError)
  }

  return NextResponse.json({
    rule: {
      id: rule.id,
      name: rule.name,
      rule_code: rule.code,
      rule_type: rule.category === 'text' ? 'semantic' : 'structured',
      level: rule.category,
      status: getRuleRuntimeStatus(rule),
      lifecycle_status: rule.lifecycle_status || null,
      translation_status: rule.translation_status || null,
      published_at: rule.published_at || null,
    },
    stats: {
      total_evaluations: 0,
      trigger_count: 0,
      hit_rate: 0,
    },
    trend: dailyStats?.map(s => ({
      date: s.stat_date,
      evaluations: s.total_evaluations,
      triggered: s.triggered_count,
      hit_rate: s.hit_rate,
      avg_execution_time: s.avg_execution_time,
      red_count: s.red_count,
      yellow_count: s.yellow_count,
      green_count: s.green_count,
    })) || [],
    recent_executions: recentExecutions?.map(e => ({
      id: e.id,
      contract_id: e.contract_id,
      triggered: e.triggered,
      extracted_value: e.extracted_value,
      execution_time: e.execution_time,
      created_at: e.created_at,
    })) || [],
  })
}
