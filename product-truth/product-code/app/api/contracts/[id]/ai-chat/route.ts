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
import { AIExecutionError, executeAIUsePoint } from '@/lib/ai/runtime-executor'
import { validateContractChatOutput } from '@/lib/ai/business-output-validation'
import { getAccessibleContract } from '@/lib/scoped-access'
import type { AuthUser } from '@/lib/auth'

export const runtime = 'nodejs'

// GET - 获取对话历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const { contract } = await getAccessibleContract(id, user.id, orgId, 'id')

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

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
  content: z.string().trim().min(1, '内容不能为空').max(4000, '问题不能超过 4000 字'),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.context && JSON.stringify(value.context).length > 10_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['context'],
      message: '上下文不能超过 10000 字节',
    })
  }
})

function executionEnvironment(): 'local' | 'hosted' {
  return process.env.VERCEL === '1' && Boolean(process.env.VERCEL_URL || process.env.VERCEL_REGION)
    ? 'hosted'
    : 'local'
}

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
        createApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message || '请求参数无效')
      )
    }

    const { contract } = await getAccessibleContract<{
      id: string
      parsed_text?: string | null
      filename?: string | null
    }>(contractId, user.id, orgId, 'id, parsed_text, filename')

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    const contractText = contract?.parsed_text || ''
    let execution: Awaited<ReturnType<typeof executeAIUsePoint<string>>>
    try {
      execution = await executeAIUsePoint({
        orgId,
        usePointId: 'contract.review.chat',
        executionEnvironment: executionEnvironment(),
        contractId,
        messages: [
          {
            role: 'system',
            content: [
              '你是合同审核工作台中的辅助问答助手。',
              '只能依据随请求提供的合同原文回答；找不到依据时必须明确说明。',
              '优先引用相关原文并给出简洁、可执行的处理建议。',
              '不要输出 JSON、Markdown 代码块、模型推理过程或虚构条款。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `用户问题：${parsed.data.content}\n\n合同原文：\n${contractText.slice(0, 20_000)}`,
          },
        ],
        maxTokens: 1600,
        temperature: 0.2,
        validateOutput: validateContractChatOutput,
        requestMeta: {
          contract_text_length: contractText.length,
          supplied_contract_text_length: Math.min(contractText.length, 20_000),
        },
      })
    } catch (error) {
      console.error('Contract AI chat runtime error:', error)
      if (error instanceof AIExecutionError) {
        return errorResponse(createApiError(
          'SERVICE_UNAVAILABLE',
          error.failureAction === 'manual_review'
            ? '可用模型均失败，请转人工处理。'
            : '可用模型均失败，运行已停止。',
          {
            code: error.failureAction === 'manual_review'
              ? 'AI_MANUAL_REVIEW_REQUIRED'
              : 'AI_RUNTIME_STOPPED',
          },
        ))
      }
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', 'AI 运行配置不可用，请联系管理员'))
    }

    // 用户问题与真实模型回复在同一条 INSERT 中落库，避免失败时留下
    // 一条看似待回复、实则没有模型证据的半成品消息。
    const runtimeEvidence = {
      provider: execution.provider,
      model: execution.model,
      degraded: execution.degraded,
      plan_snapshot_hash: execution.planSnapshotHash,
      invocation_ids: execution.invocationIds,
      usage: execution.usage,
    }
    const { data: messages, error: messageError } = await supabaseAdmin
      .from('contract_ai_chats')
      .insert([
        {
          contract_id: contractId,
          user_id: user.id,
          role: 'user',
          content: parsed.data.content,
          context: parsed.data.context || {},
        },
        {
          contract_id: contractId,
          user_id: user.id,
          role: 'assistant',
          content: execution.value,
          context: {
            ...(parsed.data.context || {}),
            ai_runtime: runtimeEvidence,
          },
        },
      ])
      .select()

    if (messageError || !messages || messages.length !== 2) {
      return errorResponse(createApiError('DB_ERROR', '保存对话失败'))
    }

    return successResponse({
      userMessage: messages[0],
      assistantMessage: messages[1],
      runtime: runtimeEvidence,
    })
  })
}
