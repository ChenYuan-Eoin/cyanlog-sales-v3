// REQ:F005
// PURPOSE: 生成合同 ASK 清单 - AI 规则扫描后生成

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

interface AskInput {
  clause_ref?: string
  risk_name: string
  level: 'red' | 'yellow' | 'green'
  type: string
  roles?: string[]
  question: string
  standard: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    const contractId = params.id
    const { asks } = await req.json() // 来自 AI 扫描结果

    // 批量插入 ASK
    const { data, error } = await supabaseAdmin
      .from('ask_items')
      .insert(
        asks.map((ask: AskInput, idx: number) => ({
          contract_id: contractId,
          ask_code: `ASK-${String(idx + 1).padStart(3, '0')}`,
          clause_ref: ask.clause_ref,
          risk_name: ask.risk_name,
          initial_level: ask.level, // red/yellow/green
          question_type: ask.type,
          required_roles: ask.roles || ['sales'],
          question_text: ask.question,
          qualified_std: ask.standard,
          status: 'pending',
          trigger_user_id: user.id,
        }))
      )
      .select()

    if (error) throw error

    // 更新合同状态
    await supabaseAdmin
      .from('contracts')
      .update({ status: 'ASK_GENERATED', asks_count: asks.length })
      .eq('id', contractId)

    return NextResponse.json({ success: true, data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '生成 ASK 失败'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
