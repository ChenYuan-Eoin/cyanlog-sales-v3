// POST /api/contracts/:id/ai-chat
// GET /api/contracts/:id/ai-chat
// AI 合同助理对话 - 接入真正 AI（TC-08）

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import type { AuthUser } from '@/lib/auth'

// GET - 获取对话历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    const { id } = await params

    const { data: chats, error } = await supabaseAdmin
      .from('contract_ai_chats')
      .select('*')
      .eq('contract_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取对话记录失败'))
    }

    return successResponse(chats || [])
  })
}

const chatSchema = z.object({
  content: z.string().min(1, '内容不能为空'),
  context: z.record(z.string(), z.unknown()).optional(),
})

// POST - 发送对话消息，接入 AI 生成回复
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id: contractId } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = chatSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', '内容不能为空')
      )
    }

    // 保存用户消息
    const { data: userMessage, error: userError } = await supabaseAdmin
      .from('contract_ai_chats')
      .insert({
        contract_id: contractId,
        user_id: user.id,
        role: 'user',
        content: parsed.data.content,
        context: parsed.data.context || {},
      })
      .select()
      .single()

    if (userError) {
      return errorResponse(createApiError('DB_ERROR', '保存消息失败'))
    }

    // 获取合同内容用于 AI 上下文
    const { data: contract } = await supabaseAdmin
      .from('contracts')
      .select('parsed_text, filename, id')
      .eq('id', contractId)
      .single()

    const contractText = contract?.parsed_text || ''

    // 调用 AI 生成回复
    let assistantContent: string
    try {
      // 使用故障容错链调用 AI
      const result = await reviewWithFailoverSync(
        `用户问题：${parsed.data.content}\n\n合同内容：${contractText.substring(0, 3000)}`,
        {
          orgId,
          contractId,
          tool: 'contract_review',
          capability: 'contract_chat',
          phase: 'contract_chat',
        }
      )

      // 生成针对用户问题的回复
      assistantContent = generateChatResponse(
        parsed.data.content,
        result.risks,
        result.summary
      )
    } catch {
      // AI 调用失败时的兜底回复
      assistantContent = `我收到了您的问题："${parsed.data.content}"

目前 AI 服务暂时不可用。您可以：
1. 查看页面上的风险卡片了解具体问题
2. 使用"一键修复"功能处理可修复项
3. 稍后重试或联系管理员`
    }

    // 保存 AI 回复
    const { data: assistantMessage, error: assistantError } = await supabaseAdmin
      .from('contract_ai_chats')
      .insert({
        contract_id: contractId,
        user_id: user.id,
        role: 'assistant',
        content: assistantContent,
        context: parsed.data.context || {},
      })
      .select()
      .single()

    if (assistantError) {
      return errorResponse(createApiError('DB_ERROR', '保存回复失败'))
    }

    return successResponse({
      userMessage,
      assistantMessage,
    })
  })
}

// 生成针对用户问题的聊天回复
function generateChatResponse(
  question: string,
  risks: Array<{ level: string; title: string; description: string; suggestion: string }>,
  summary: string
): string {
  const lowerQuestion = question.toLowerCase()

  // 根据问题类型生成针对性回复
  if (lowerQuestion.includes('风险') || lowerQuestion.includes('问题')) {
    const riskList = risks.map((r) => `• ${r.level === 'red' ? '🔴' : r.level === 'yellow' ? '🟡' : '🟢'} ${r.title}: ${r.description}`).join('\n')
    return `根据合同分析，发现以下风险：

${riskList || '未发现明显风险'}

总体评估：${summary}`
  }

  if (lowerQuestion.includes('建议') || lowerQuestion.includes('怎么办')) {
    const suggestions = risks
      .filter((r) => r.suggestion)
      .map((r) => `• ${r.title}: ${r.suggestion}`)
      .join('\n')
    return `针对合同中的问题，建议如下：

${suggestions || '暂无具体建议，建议人工复核'}

您还可以点击风险卡片上的「一键修复」按钮自动处理部分问题。`
  }

  if (lowerQuestion.includes('条款') || lowerQuestion.includes('内容')) {
    return `合同主要内容概述：

${summary}

如需查看具体条款，请切换到「表一·预览」标签页查看提取的条款列表和风险分析。`
  }

  // 默认回复
  return `感谢您的提问："${question}"

${summary}

如需了解更多细节，您可以：
1. 询问"有哪些风险"查看风险清单
2. 询问"有什么建议"查看处理建议
3. 切换到其他标签页查看详细分析`
}
