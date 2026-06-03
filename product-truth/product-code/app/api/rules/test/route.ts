// /api/rules/test - 规则测试沙箱 API
// 接收合同文本，立即显示所有规则的匹配结果

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { executeRules } from '@/lib/rules/engine'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

const schema = z.object({
  text: z.string().min(10).max(50000),
})

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req)
    const body = await req.json()
    const result = schema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: '文本长度需在 10-50000 字符之间' }, { status: 400 })
    }
    const analysis = await executeRules(result.data.text)
    return NextResponse.json(analysis)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Rule test error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
