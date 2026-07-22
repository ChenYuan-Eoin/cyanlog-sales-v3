import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import {
  createFrozenComparisonSourceTicket,
  loadFrozenComparisonSource,
  type ComparisonSourceRole,
} from '@/lib/contracts/comparison-snapshot-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const identitySchema = z.object({
  storage_path: z.string().min(1),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; role: string }> },
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id, role: roleParam } = await params
    if (roleParam !== 'old' && roleParam !== 'new') {
      return errorResponse(createApiError('VALIDATION_ERROR', '比对源文件角色必须是 old 或 new'))
    }
    const role = roleParam as ComparisonSourceRole
    let source
    try {
      source = await loadFrozenComparisonSource(id, role, orgId)
    } catch {
      return errorResponse(createApiError('CONFLICT', '冻结比对原文件快照完整性校验失败'), 409)
    }
    if (!source) {
      return errorResponse(createApiError('NOT_FOUND', '冻结比对原文件不存在或无权访问'))
    }

    const url = new URL(req.url)
    const requested = identitySchema.safeParse({
      storage_path: url.searchParams.get('storage_path'),
      source_hash: url.searchParams.get('source_hash'),
      source_text_hash: url.searchParams.get('source_text_hash'),
    })
    if (!requested.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '原文件读取必须携带完整冻结身份'))
    }
    if (
      requested.data.storage_path !== source.storage_path
      || requested.data.source_hash !== source.file_sha256
      || requested.data.source_text_hash !== source.text_sha256
    ) {
      return errorResponse(createApiError('CONFLICT', '请求的原文件身份与创建时快照不一致'), 409)
    }

    try {
      const downloadUrl = await createFrozenComparisonSourceTicket(source)
      const response = successResponse({
        download_url: downloadUrl,
        expires_in: 60,
      })
      response.headers.set('Cache-Control', 'private, no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('X-Comparison-Source-Role', role)
      response.headers.set('X-Source-Hash', source.file_sha256)
      response.headers.set('X-Source-Text-Hash', source.text_sha256)
      return response
    } catch {
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', '冻结原文件短期读取地址生成失败，请重试'))
    }
  })
}
