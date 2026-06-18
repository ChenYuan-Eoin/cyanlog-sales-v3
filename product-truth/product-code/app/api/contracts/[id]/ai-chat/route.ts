// POST /api/contracts/:id/ai-chat
// GET /api/contracts/:id/ai-chat
// AI 合同助理对话

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// GET - 获取对话历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    const { id } = await params

    // 获取对话历史
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

// POST - 发送对话消息
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    const { id } = await params
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
        contract_id: id,
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

    // TODO: 调用 AI 生成回复（Phase 5）
    // 现在返回一个占位回复
    const { data: assistantMessage, error: assistantError } = await supabaseAdmin
      .from('contract_ai_chats')
      .insert({
        contract_id: id,
        user_id: user.id,
        role: 'assistant',
        content: `我收到了您的问题："${parsed.data.content}"

在 Phase 5 中将接入真正的 AI 对话能力。目前您可以：
1. 查看风险卡片了解具体问题
2. 使用"一键修复"功能处理可修复项
3. 查看摘要了解合同整体情况`,
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
