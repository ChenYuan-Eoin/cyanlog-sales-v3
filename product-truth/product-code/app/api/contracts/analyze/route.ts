// POST /api/contracts/analyze - 合同风险分析
// 转发到 /api/ai/analyze

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const token = req.headers.get('authorization')

    const res = await fetch(`${req.nextUrl.origin}/api/ai/analyze`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: token } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: body.contractText || body.text || '',
        pageCount: body.pageCount || 1,
        task: 'semantic',
      }),
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (_err) {
    return NextResponse.json({ error: '分析失败' }, { status: 500 })
  }
}
