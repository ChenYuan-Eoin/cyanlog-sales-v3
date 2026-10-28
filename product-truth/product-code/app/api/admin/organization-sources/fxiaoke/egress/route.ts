import { NextRequest, NextResponse } from 'next/server'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { authorizeWorker, workerClaim, workerComplete } from '@/lib/fxiaoke/egress/server'

export const runtime = 'nodejs'
export const maxDuration = 15
export async function POST(req: NextRequest) {
  try {
    // A user session, x-org-id, or request-supplied organization never authorizes this endpoint.
    const config = authorizeWorker(req.headers.get('authorization'))
    const reader = req.body?.getReader()
    const chunks: Uint8Array[] = []; let length = 0
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break
      length += part.value.byteLength
      if (length > 1500000) { await reader.cancel(); return NextResponse.json({ error: '请求过大。' }, { status: 413 }) }
      chunks.push(part.value)
    }
    let body: Record<string, unknown>
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new FxiaokeError('INVALID_INPUT', '无效请求。') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FxiaokeError('INVALID_INPUT', '无效请求。')
    const data = body.action === 'claim' ? await workerClaim(config, body.egressIp)
      : body.action === 'complete' ? await workerComplete(config, body) : null
    if (!data) throw new FxiaokeError('INVALID_ACTION', '无效操作。')
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const safe = err instanceof FxiaokeError ? err : new FxiaokeError('EGRESS_UNAVAILABLE', '网络接入服务暂不可用。', 503)
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
