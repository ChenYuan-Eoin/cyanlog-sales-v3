// REQ:F005 - 合同起草 API
// PURPOSE: AI 智能起草、模板起草、上传合同起草

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { AIExecutionError, executeAIUsePoint } from '@/lib/ai/runtime-executor'
import { validateGeneratedContractOutput } from '@/lib/ai/business-output-validation'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'

export const runtime = 'nodejs'

// Zod schema for request validation
const DraftRequestSchema = z.object({
  mode: z.enum(['ai_generate', 'template', 'upload'], { message: '请指定有效的起草方式' }),
  purpose: z.string().trim().min(1, '请填写合同签署目的').max(4000, '签署目的不能超过 4000 字'),
  party_a: z.string().trim().min(1, '请填写甲方信息').max(500, '甲方信息不能超过 500 字'),
  party_b: z.string().trim().min(1, '请填写乙方信息').max(500, '乙方信息不能超过 500 字'),
  contract_type: z.string().trim().min(1, '请选择合同类型').max(200, '合同类型不能超过 200 字'),
  key_terms: z.string().max(10_000, '关键条款不能超过 10000 字').optional(),
  template_id: z.string().optional(),
  source_contract_id: z.string().optional(),
}).strict()

type DraftRequest = z.infer<typeof DraftRequestSchema>

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: DraftRequest | undefined = undefined

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function executionEnvironment(): 'local' | 'hosted' {
  return process.env.VERCEL === '1' && Boolean(process.env.VERCEL_URL || process.env.VERCEL_REGION)
    ? 'hosted'
    : 'local'
}

// POST /api/contracts/draft - 起草合同
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)

    // Zod validation
    const bodyResult = DraftRequestSchema.safeParse(await req.json().catch(() => ({})))
    if (!bodyResult.success) {
      const errorMsg = bodyResult.error.issues.map((e: { message: string }) => e.message).join(', ')
      return errorResponse(errorMsg, 400, 'VALIDATION_ERROR')
    }
    const body = bodyResult.data

    let generatedContent = ''
    let aiRuntime: Record<string, unknown> | null = null

    if (body.mode === 'ai_generate') {
      // AI 智能起草：调用 AI 生成
      const prompt = `请根据以下信息起草一份合同：

合同类型：${body.contract_type}
甲方：${body.party_a}
乙方：${body.party_b}
签署目的：${body.purpose}
${body.key_terms ? `关键条款要求：${body.key_terms}` : ''}

要求：
1. 结构完整，包含合同标的、价款、付款方式、履行期限、违约责任、争议解决等必备条款
2. 语言规范、严谨，符合《中华人民共和国民法典》等现行法律
3. 直接输出合同正文，不要任何解释`

      try {
        const aiResult = await executeAIUsePoint({
          orgId,
          usePointId: 'contract.draft.generate',
          executionEnvironment: executionEnvironment(),
          messages: [
            {
              role: 'system',
              content: [
                '你是企业合同起草助手。',
                '只根据用户提供的签约主体、目的与关键条款起草完整合同正文。',
                '遵循中华人民共和国现行民商事法律；不得引用已废止的合同法。',
                '不要输出解释、Markdown、JSON、审核风险清单或模型推理过程。',
              ].join('\n'),
            },
            { role: 'user', content: prompt },
          ],
          maxTokens: 8192,
          temperature: 0.2,
          validateOutput: (text) => validateGeneratedContractOutput(text, {
            partyA: body.party_a,
            partyB: body.party_b,
          }),
          requestMeta: {
            contract_type: body.contract_type,
            has_key_terms: Boolean(body.key_terms),
          },
        })
        generatedContent = aiResult.value
        aiRuntime = {
          provider: aiResult.provider,
          model: aiResult.model,
          degraded: aiResult.degraded,
          usage: aiResult.usage,
          plan_snapshot_hash: aiResult.planSnapshotHash,
          invocation_ids: aiResult.invocationIds,
        }
      } catch (error) {
        console.error('Contract draft AI runtime error:', error)
        if (error instanceof AIExecutionError) {
          return errorResponse(
            error.failureAction === 'manual_review'
              ? '可用模型均失败，请改用模板起草或人工起草。'
              : '可用模型均失败，起草运行已停止。',
            503,
            error.failureAction === 'manual_review'
              ? 'AI_MANUAL_REVIEW_REQUIRED'
              : 'AI_RUNTIME_STOPPED',
          )
        }
        return errorResponse('AI 运行配置不可用，请联系管理员', 503, 'AI_RUNTIME_UNAVAILABLE')
      }
    } else if (body.mode === 'template') {
      // 模板起草：基于现有合同模板
      if (!body.template_id && !body.source_contract_id) {
        return errorResponse('请提供模板ID', 400, 'MISSING_TEMPLATE')
      }
      // 从已有合同中获取解析后的文本作为模板
      let templateText = ''
      if (body.source_contract_id) {
        const { data: srcContract } = await supabaseAdmin
          .from('contracts')
          .select('parsed_text, filename')
          .eq('id', body.source_contract_id)
          .eq('org_id', orgId)
          .in('created_by', accessibleUserIds)
          .maybeSingle()
        if (!srcContract) {
          return errorResponse('源合同不存在或无权访问', 404, 'SOURCE_NOT_FOUND')
        }
        templateText = srcContract.parsed_text || ''
      }

      // 替换甲乙双方信息
      generatedContent = templateText
        .replace(/甲方[：:]\s*[\u4e00-\u9fa5（）()0-9A-Za-z·\s]+/g, `甲方：${body.party_a}`)
        .replace(/乙方[：:]\s*[\u4e00-\u9fa5（）()0-9A-Za-z·\s]+/g, `乙方：${body.party_b}`)
        .replace(/鉴于[：:][\s\S]{0,200}/g, `鉴于：${body.purpose}`)
    } else if (body.mode === 'upload') {
      // 上传合同起草：直接使用上传合同的解析文本
      if (!body.source_contract_id) {
        return errorResponse('请提供源合同ID', 400, 'MISSING_SOURCE')
      }
      const { data: srcContract } = await supabaseAdmin
        .from('contracts')
        .select('parsed_text, filename')
        .eq('id', body.source_contract_id)
        .eq('org_id', orgId)
        .in('created_by', accessibleUserIds)
        .maybeSingle()
      if (!srcContract) {
        return errorResponse('源合同不存在或无权访问', 404, 'SOURCE_NOT_FOUND')
      }
      generatedContent = srcContract.parsed_text || `合同文件: ${srcContract.filename}`
    } else {
      return errorResponse('不支持的起草方式', 400, 'INVALID_MODE')
    }

    if (!generatedContent || generatedContent.length < 10) {
      return errorResponse('生成内容为空', 500, 'EMPTY_CONTENT')
    }

    return NextResponse.json({
      success: true,
      data: {
        content: generatedContent,
        mode: body.mode,
        word_count: generatedContent.length,
        party_a: body.party_a,
        party_b: body.party_b,
        contract_type: body.contract_type,
        ...(aiRuntime ? { ai_runtime: aiRuntime } : {}),
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
