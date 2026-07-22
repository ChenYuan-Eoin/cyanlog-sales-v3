// POST /api/contracts/[id]/upload
// The old direct-write path is intentionally retired. All source writes must
// use the resumable uploadId + whole-file SHA-256 + CAS finalization protocol.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { authenticationErrorResponse } from '@/lib/api/auth-wrapper'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(req)
    await params
    return NextResponse.json({
      error: '直传接口已停用，请使用分块上传协议',
      code: 'CHUNK_UPLOAD_REQUIRED',
    }, { status: 410 })
  } catch (error: unknown) {
    const authResponse = authenticationErrorResponse(error)
    if (authResponse) return authResponse
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
