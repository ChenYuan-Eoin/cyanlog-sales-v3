// REQ:F006
// PURPOSE: Rule statistics API - hit rate, trends, performance metrics

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

// GET /api/rules/stats - 获取规则统计总览
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { searchParams } = new URL(req.url)
    const days = parseInt(searchParams.get('days') || '30', 10)
    const ruleId = searchParams.get('rule_id')

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // 如果指定了规则ID，返回单规则统计
    if (ruleId) {
      return getSingleRuleStats(ruleId, orgId, startDate)
    }

    // 获取所有规则的统计摘要
    const { data: rules, error: rulesError } = await supabaseAdmin
      .from('contract_rules')
      .select(`
        id,
        name,
        rule_code,
        rule_type,
        level,
        total_evaluations,
        trigger_count,
        hit_rate,
        status
      `)
      .eq('org_id', orgId)
      .order('hit_rate', { ascending: false })

    if (rulesError) {
      console.error('Get rules stats error:', rulesError)
      return NextResponse.json({ error: '查询失败' }, { status: 500 })
    }

    // 计算汇总统计
    const summary = {
      total_rules: rules?.length || 0,
      published_rules: rules?.filter(r => r.status === 'published').length || 0,
      avg_hit_rate: rules?.length > 0
        ? Math.round(rules.reduce((sum, r) => sum + (r.hit_rate || 0), 0) / rules.length)
        : 0,
      structured_rules: rules?.filter(r => r.rule_type === 'structured').length || 0,
      semantic_rules: rules?.filter(r => r.rule_type === 'semantic').length || 0,
    }

    // 识别低命中率规则（告警）
    const lowHitRateRules = rules?.filter(r =>
      r.hit_rate < 10 && r.total_evaluations > 50
    ) || []

    // 识别高命中率规则（可能过宽）
    const highHitRateRules = rules?.filter(r =>
      r.hit_rate > 80
    ) || []

    return NextResponse.json({
      summary,
      rules: rules?.map(r => ({
        id: r.id,
        name: r.name,
        rule_code: r.rule_code,
        rule_type: r.rule_type,
        level: r.level,
        hit_rate: r.hit_rate,
        total_evaluations: r.total_evaluations,
        trigger_count: r.trigger_count,
        status: r.status,
      })) || [],
      alerts: {
        low_hit_rate: lowHitRateRules.map(r => ({
          id: r.id,
          name: r.name,
          hit_rate: r.hit_rate,
          message: `规则 ${r.rule_code || r.name} 触发率仅 ${r.hit_rate}%，建议检查是否需要优化或删除`,
        })),
        high_hit_rate: highHitRateRules.map(r => ({
          id: r.id,
          name: r.name,
          hit_rate: r.hit_rate,
          message: `规则 ${r.rule_code || r.name} 触发率 ${r.hit_rate}%，可能条件过宽`,
        })),
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

// 获取单规则统计详情
async function getSingleRuleStats(ruleId: string, orgId: string, startDate: Date) {
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
      rule_code: rule.rule_code,
      rule_type: rule.rule_type,
      level: rule.level,
      status: rule.status,
    },
    stats: {
      total_evaluations: rule.total_evaluations,
      trigger_count: rule.trigger_count,
      hit_rate: rule.hit_rate,
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
