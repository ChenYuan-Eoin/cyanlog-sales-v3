// REQ:F006
// PURPOSE: Rule test sandbox API - execute rule against test text

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { executeStructuredRules } from '@/lib/rules/structured-executor'
import type { Rule } from '@/lib/rules/types'
import { z } from 'zod'

interface Params {
  params: Promise<{ id: string }>
}

const ruleTestSchema = z.object({
  test_text: z.string().min(1, '请提供测试文本'),
  input_type: z.string().optional().default('text'),
})

// POST /api/rules/[id]/test - 测试规则
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(req)
    const { id: ruleId } = await params

    const parsed = ruleTestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: '请提供测试文本' }, { status: 400 })
    }
    const { test_text, input_type } = parsed.data

    const orgId = await getDefaultOrgId(user.id)

    // 获取规则
    const { data: rule, error: ruleError } = await supabaseAdmin
      .from('contract_rules')
      .select('*')
      .eq('id', ruleId)
      .eq('org_id', orgId)
      .single()

    if (ruleError || !rule) {
      return NextResponse.json({ error: '规则不存在' }, { status: 404 })
    }

    // 转换为新格式执行
    const newRule: Rule = {
      ...rule,
      rule_type: rule.rule_type as 'structured' | 'semantic',
      category: rule.category || 'legal',
      priority: rule.priority || 100,
      version: rule.version || 1,
    }

    const startTime = Date.now()

    // 执行规则
    let result
    if (rule.rule_type === 'structured') {
      const results = await executeStructuredRules(
        [newRule],
        test_text,
        {}
      )
      result = results[0]
    } else {
      // 语义规则简化测试（关键词匹配）
      const keywords = (rule.semantic_condition || rule.description || '')
        .split(/\s+/)
        .filter((w: string) => w.length > 2)

      const matchCount = keywords.filter((kw: string) =>
        test_text.toLowerCase().includes(kw.toLowerCase())
      ).length

      const matchRate = keywords.length > 0 ? matchCount / keywords.length : 0
      const triggered = matchRate > 0.3

      result = {
        ruleId: rule.id,
        ruleVersion: rule.version || 1,
        ruleType: 'semantic' as const,
        riskLevel: triggered ? rule.level as 'red' | 'yellow' | 'green' : 'green',
        title: rule.name,
        description: triggered
          ? `语义分析检测到相关性 (${Math.round(matchRate * 100)}% 匹配)`
          : '语义规则未触发',
        triggered,
        executionTime: Date.now() - startTime,
        details: `关键词匹配率: ${Math.round(matchRate * 100)}%`,
      }
    }

    // 记录测试执行（可选，用于统计）
    await supabaseAdmin
      .from('contract_rule_execution_logs')
      .insert({
        contract_id: 'test-sandbox',
        rule_id: ruleId,
        org_id: orgId,
        rule_version: rule.version || 1,
        triggered: result.triggered,
        extracted_value: result.evidence?.[0] || null,
        execution_time: result.executionTime,
        result_details: {
          test_text: test_text.substring(0, 500),
          input_type,
          test_mode: true,
        },
      })

    return NextResponse.json({
      success: true,
      data: {
        rule: {
          id: rule.id,
          name: rule.name,
          rule_type: rule.rule_type,
          level: rule.level,
          version: rule.version,
        },
        test_input: {
          text: test_text.substring(0, 200) + (test_text.length > 200 ? '...' : ''),
          input_type,
        },
        result: {
          triggered: result.triggered,
          risk_level: result.riskLevel,
          title: result.title,
          description: result.description,
          suggestion: result.suggestion,
          evidence: result.evidence,
          execution_time_ms: result.executionTime,
          details: result.details,
        },
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    console.error('Test rule error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
