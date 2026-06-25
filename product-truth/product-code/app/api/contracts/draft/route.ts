// REQ:F005 - 合同起草 API
// PURPOSE: AI 智能起草、模板起草、上传合同起草

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'

// Zod schema for request validation
const DraftRequestSchema = z.object({
  mode: z.enum(['ai_generate', 'template', 'upload'], { message: '请指定有效的起草方式' }),
  purpose: z.string().min(1, '请填写合同签署目的'),
  party_a: z.string().min(1, '请填写甲方信息'),
  party_b: z.string().min(1, '请填写乙方信息'),
  contract_type: z.string().min(1, '请选择合同类型'),
  key_terms: z.string().optional(),
  template_id: z.string().optional(),
  source_contract_id: z.string().optional(),
  provider: z.string().optional(),
})

type DraftRequest = z.infer<typeof DraftRequestSchema>

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: DraftRequest | undefined = undefined

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// 从条款库生成合同
function buildContractFromLibrary(
  purpose: string,
  partyA: string,
  partyB: string,
  contractType: string,
  library: Array<{ id: string; name: string; category: string; template_text: string; legal_basis: string | null }>
): string {
  const now = new Date().toISOString().slice(0, 10)
  const contractNum = `HT-${now.replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`

  // 按类别分组
  const grouped: Record<string, typeof library> = {}
  for (const lib of library) {
    if (!grouped[lib.category]) grouped[lib.category] = []
    grouped[lib.category].push(lib)
  }

  const lines: string[] = []
  lines.push(`${contractType}合同`)
  lines.push(``)
  lines.push(`合同编号：${contractNum}`)
  lines.push(`签订日期：${now}`)
  lines.push(``)
  lines.push(`甲方：${partyA}`)
  lines.push(`乙方：${partyB}`)
  lines.push(``)
  lines.push(`鉴于：${purpose}`)
  lines.push(``)
  lines.push(`经甲乙双方友好协商，达成如下协议：`)
  lines.push(``)

  const categoryOrder = ['主体', '标的', 'payment', 'delivery', 'quality', 'breach', 'dispute', 'liability', 'ip', '其他']
  let articleNo = 1
  for (const cat of categoryOrder) {
    const items = grouped[cat]
    if (!items || items.length === 0) continue
    lines.push(`第${toChineseNumber(articleNo++)}条 ${catName(cat)}`)
    for (const item of items) {
      lines.push(`${item.template_text.replace(/乙方/g, partyB).replace(/甲方/g, partyA)}`)
      lines.push(``)
    }
  }

  lines.push(`【签署】`)
  lines.push(``)
  lines.push(`甲方（盖章）：${partyA}`)
  lines.push(`法定代表人/授权代表：________________`)
  lines.push(`日期：____年__月__日`)
  lines.push(``)
  lines.push(`乙方（盖章）：${partyB}`)
  lines.push(`法定代表人/授权代表：________________`)
  lines.push(`日期：____年__月__日`)
  lines.push(``)

  return lines.join('\n')
}

function toChineseNumber(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n < 10) return digits[n]
  if (n === 10) return '十'
  if (n < 20) return '十' + digits[n - 10]
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return digits[tens] + '十' + (ones > 0 ? digits[ones] : '')
  }
  return String(n)
}

function catName(cat: string): string {
  const map: Record<string, string> = {
    主体: '合同主体',
    标的: '合同标的',
    payment: '付款条款',
    delivery: '交付条款',
    quality: '质量保证',
    breach: '违约责任',
    dispute: '争议解决',
    liability: '责任限制',
    ip: '知识产权',
    其他: '其他条款',
  }
  return map[cat] || cat
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
2. 语言规范、严谨，符合中国合同法
3. 直接输出合同正文，不要任何解释`

      try {
        const aiResult = await reviewWithFailoverSync(prompt, { orgId })
        // 解析 AI 输出（取响应文本）
        generatedContent = aiResult.summary || ''
      } catch {
        // AI 失败时用条款库生成
        const { data: library } = await supabaseAdmin
          .from('clause_library')
          .select('id, name, category, template_text, legal_basis, stance')
          .or(`org_id.is.null,org_id.eq.${orgId}`)
          .order('category', { ascending: true })
          .limit(20)

        if (library && library.length > 0) {
          generatedContent = buildContractFromLibrary(
            body.purpose, body.party_a, body.party_b, body.contract_type, library
          )
        } else {
          return errorResponse('AI 起草失败，且条款库为空', 500, 'AI_AND_LIBRARY_FAILED')
        }
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
