import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/contracts/:id/analyze - 触发合同审核
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // 检查合同状态
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', id)
      .single()

    if (contractError) {
      return NextResponse.json({ error: contractError.message }, { status: 500 })
    }

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    // 只有待审核或审核失败的合同才能重新审核
    if (contract.status !== 'PENDING' && contract.status !== 'FAILED') {
      return NextResponse.json(
        { error: 'Contract is not in a reviewable state' },
        { status: 400 }
      )
    }

    // 更新合同状态为解析中
    await supabase
      .from('contracts')
      .update({ status: 'PARSING' })
      .eq('id', id)

    // 创建审核记录
    const { data: review, error: reviewError } = await supabase
      .from('contract_reviews')
      .insert({
        contract_id: id,
        status: 'PARSING',
      })
      .select()
      .single()

    if (reviewError) {
      return NextResponse.json({ error: reviewError.message }, { status: 500 })
    }

    // 异步执行审核（简化版，实际应使用队列）
    // 这里返回审核任务ID，前端轮询状态
    setTimeout(async () => {
      // 模拟审核过程
      await supabase
        .from('contracts')
        .update({ status: 'ANALYZING' })
        .eq('id', id)

      await supabase
        .from('contract_reviews')
        .update({ status: 'ANALYZING' })
        .eq('contract_id', id)

      // 模拟审核完成
      setTimeout(async () => {
        await supabase
          .from('contracts')
          .update({ status: 'COMPLETED' })
          .eq('id', id)

        await supabase
          .from('contract_reviews')
          .update({
            status: 'COMPLETED',
            results: {
              risks: [
                {
                  level: 'red',
                  title: '付款账期过长',
                  description: '当前账期为120天，超过标准90天',
                  suggestion: '建议缩短至60天内或增加预付款比例',
                },
              ],
            },
            completed_at: new Date().toISOString(),
          })
          .eq('contract_id', id)
      }, 3000)
    }, 1000)

    return NextResponse.json({
      reviewId: review.id,
      status: 'PARSING',
    })
  } catch (error) {
    console.error('Analyze contract error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
