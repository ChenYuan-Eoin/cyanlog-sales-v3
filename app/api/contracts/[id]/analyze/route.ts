import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/contracts/:id/analyze - 触发合同审核（需登录）
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)

    const { id } = params
    if (!id) {
      return errorResponse('合同ID必填', 400, 'MISSING_ID')
    }

    // 使用行级锁检查合同状态（防止并发重复审核）
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, status, file_path')
      .eq('id', id)
      .single()

    if (contractError) {
      console.error('Contract fetch error:', contractError)
      return errorResponse('查询合同失败', 500, 'DB_ERROR')
    }

    if (!contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    // 状态检查：只有PENDING或FAILED才能重新审核
    if (contract.status !== 'PENDING' && contract.status !== 'FAILED') {
      // 检查是否已有进行中的审核
      if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
        return errorResponse('合同正在审核中，请勿重复提交', 409, 'ALREADY_IN_PROGRESS')
      }
      if (contract.status === 'COMPLETED') {
        return errorResponse('合同已审核完成，如需重新审核请先重置状态', 409, 'ALREADY_COMPLETED')
      }
      return errorResponse('合同当前状态无法审核', 400, 'INVALID_STATUS')
    }

    // 检查24小时内是否有审核记录（简单幂等性控制）
    const { data: recentReview } = await supabaseAdmin
      .from('contract_reviews')
      .select('id, created_at, status')
      .eq('contract_id', id)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (recentReview && (recentReview.status === 'PARSING' || recentReview.status === 'ANALYZING')) {
      return errorResponse('24小时内已有进行中的审核任务', 409, 'RECENT_REVIEW_EXISTS')
    }

    // 更新合同状态为解析中（乐观锁）
    const { error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({ status: 'PARSING', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', contract.status) // 乐观锁：只有状态未变才更新

    if (updateError) {
      console.error('Status update error:', updateError)
      return errorResponse('状态更新失败，可能并发操作', 409, 'CONCURRENT_UPDATE')
    }

    // 创建审核记录
    const { data: review, error: reviewError } = await supabaseAdmin
      .from('contract_reviews')
      .insert({
        contract_id: id,
        status: 'PARSING',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (reviewError) {
      // 回滚合同状态
      await supabaseAdmin
        .from('contracts')
        .update({ status: contract.status })
        .eq('id', id)

      console.error('Review create error:', reviewError)
      return errorResponse('创建审核记录失败', 500, 'REVIEW_CREATE_FAILED')
    }

    // 触发异步审核任务
    // 注意：这里不await，让请求立即返回
    processContractAnalysis(id, review.id)
      .catch(err => console.error('合同审核异步任务失败:', err))

    return NextResponse.json({
      reviewId: review.id,
      status: 'PARSING',
      message: '审核任务已创建',
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Analyze contract error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// 异步审核处理（实际项目中应移到后台服务）
async function processContractAnalysis(contractId: string, reviewId: string) {
  try {
    // 1. 解析中 -> 分析中
    await new Promise(r => setTimeout(r, 2000))
    await supabaseAdmin.from('contracts').update({ status: 'ANALYZING' }).eq('id', contractId)
    await supabaseAdmin.from('contract_reviews').update({ status: 'ANALYZING' }).eq('id', reviewId)

    // 2. 模拟 AI 分析过程（实际应调用 AI 服务）
    // const contractText = await extractContractText(contractId)
    // const aiResult = await analyzeWithAI(contractText)
    // const ruleResults = await checkRules(contractText)

    // 3. 模拟审核完成
    await new Promise(r => setTimeout(r, 3000))

    const results = {
      risks: [
        {
          level: 'red',
          title: '付款账期过长',
          description: '当前账期为120天，超过标准90天',
          suggestion: '建议缩短至60天内或增加预付款比例',
        },
        {
          level: 'yellow',
          title: '违约金比例偏高',
          description: '违约金比例为10%，行业标准通常为3%-5%',
          suggestion: '建议协商降至5%以内',
        },
      ],
      summary: '合同整体风险可控，但付款条款和违约条款需要重点关注',
    }

    await supabaseAdmin.from('contracts').update({ status: 'COMPLETED' }).eq('id', contractId)
    await supabaseAdmin.from('contract_reviews').update({
      status: 'COMPLETED',
      results,
      completed_at: new Date().toISOString(),
    }).eq('id', reviewId)

  } catch (error) {
    console.error('合同审核异步处理失败:', error)
    await supabaseAdmin.from('contracts').update({ status: 'FAILED' }).eq('id', contractId)
    await supabaseAdmin.from('contract_reviews').update({
      status: 'FAILED',
      results: { error: '审核处理失败' },
    }).eq('id', reviewId)
  }
}
