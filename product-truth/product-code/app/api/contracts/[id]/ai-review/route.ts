// REQ:F005 + AI Streaming
// PURPOSE: Stream AI contract review results via Chinese AI gateway (yiyongai)
// Note: 使用中转站（OpenAI 兼容）路由到 Claude 系列模型

import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export const runtime = 'edge'

// 中转站 OpenAI 兼容客户端
const gateway = createOpenAI({
  baseURL: process.env.AI_GATEWAY_URL || 'https://cloud.yiyongai.cn/v1',
  apiKey: process.env.AI_GATEWAY_API_KEY,
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    const contractId = params.id

    // Fetch contract with owner verification
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('id, filename, parsed_text, created_by')
      .eq('id', contractId)
      .eq('created_by', user.id)
      .single()

    if (error || !contract) {
      return NextResponse.json(
        { error: 'Contract not found or access denied' },
        { status: 404 }
      )
    }

    const contractText = contract.parsed_text || 'No text available for review'

    // Stream AI review via Chinese gateway
    const result = streamText({
      model: gateway(process.env.AI_MODEL || 'claude-sonnet-4-6'),
      messages: [
        {
          role: 'system',
          content: `你是一位专业的法务合同审核专家。请分析合同内容并识别风险。
请按以下 JSON 格式返回：
{
  "risks": [
    {
      "level": "red|yellow|green",
      "title": "风险标题（简短）",
      "description": "问题详细描述",
      "suggestion": "建议处理方式"
    }
  ],
  "summary": "总体评估摘要"
}`,
        },
        {
          role: 'user',
          content: `请审核以下合同：\n\n${contractText.substring(0, 8000)}`,
        },
      ],
      maxOutputTokens: 4000,
      temperature: 0.3,
    })

    return result.toTextStreamResponse()

  } catch (error) {
    console.error('[AI Review] Error:', error)

    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI review failed' },
      { status: 500 }
    )
  }
}
