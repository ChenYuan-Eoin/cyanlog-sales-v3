import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import {
  downloadFrozenComparisonSource,
  loadFrozenComparisonSource,
  type ComparisonSourceRole,
} from '@/lib/contracts/comparison-snapshot-server'
import { renderPdfPageToPng } from '@/lib/documents/source-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const identitySchema = z.object({
  storage_path: z.string().min(1),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
})

const renderedPageCache = new Map<string, { png: Buffer; createdAt: number }>()
const renderedPageInflight = new Map<string, Promise<Buffer>>()
const RENDERED_PAGE_CACHE_TTL_MS = 5 * 60 * 1000
const RENDERED_PAGE_CACHE_MAX_ENTRIES = 24

function pruneRenderedPageCache(now = Date.now()) {
  for (const [key, cached] of renderedPageCache.entries()) {
    if (now - cached.createdAt >= RENDERED_PAGE_CACHE_TTL_MS) renderedPageCache.delete(key)
  }
  while (renderedPageCache.size > RENDERED_PAGE_CACHE_MAX_ENTRIES) {
    const oldest = renderedPageCache.keys().next().value as string | undefined
    if (!oldest) break
    renderedPageCache.delete(oldest)
  }
}

async function renderFrozenPdfPage(sourceHash: string, pdf: Buffer, page: number) {
  const key = `${sourceHash}:${page}`
  pruneRenderedPageCache()
  const cached = renderedPageCache.get(key)
  if (cached) return cached.png
  const existing = renderedPageInflight.get(key)
  if (existing) return existing
  const rendering = renderPdfPageToPng(pdf, page).then((png) => {
    const buffer = Buffer.from(png)
    renderedPageCache.set(key, { png: buffer, createdAt: Date.now() })
    pruneRenderedPageCache()
    return buffer
  }).finally(() => renderedPageInflight.delete(key))
  renderedPageInflight.set(key, rendering)
  return rendering
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; role: string; page: string }> },
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id, role: roleParam, page: pageParam } = await params
    if (roleParam !== 'old' && roleParam !== 'new') {
      return errorResponse(createApiError('VALIDATION_ERROR', '比对源文件角色必须是 old 或 new'))
    }
    const page = Number(pageParam)
    if (!Number.isInteger(page) || page < 1) {
      return errorResponse(createApiError('VALIDATION_ERROR', '页码必须是正整数'))
    }
    let source
    try {
      source = await loadFrozenComparisonSource(
        id,
        roleParam as ComparisonSourceRole,
        orgId,
      )
    } catch {
      return errorResponse(createApiError('CONFLICT', '冻结比对原文件快照完整性校验失败'), 409)
    }
    if (!source) {
      return errorResponse(createApiError('NOT_FOUND', '冻结比对原文件不存在或无权访问'))
    }
    if (source.render_mode !== 'native-pdf') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', 'Word 原文件由浏览器直接渲染，不调用 PDF 页图接口'), 422)
    }
    if (page > source.page_map.page_count) {
      return errorResponse(createApiError('VALIDATION_ERROR', `页码超出范围，共 ${source.page_map.page_count} 页`))
    }

    const url = new URL(req.url)
    const requested = identitySchema.safeParse({
      storage_path: url.searchParams.get('storage_path'),
      source_hash: url.searchParams.get('source_hash'),
      source_text_hash: url.searchParams.get('source_text_hash'),
    })
    if (!requested.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '页级预览必须携带完整冻结身份'))
    }
    if (
      requested.data.storage_path !== source.storage_path
      || requested.data.source_hash !== source.file_sha256
      || requested.data.source_text_hash !== source.text_sha256
    ) {
      return errorResponse(createApiError('CONFLICT', '请求的页级原文件身份与创建时快照不一致'), 409)
    }

    try {
      const pdf = await downloadFrozenComparisonSource(source)
      const png = await renderFrozenPdfPage(source.file_sha256, pdf, page)
      return new NextResponse(new Blob([Uint8Array.from(png)], { type: 'image/png' }), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=300',
          'X-Comparison-Source-Role': roleParam,
          'X-Source-Page': String(page),
          'X-Source-Page-Count': String(source.page_map.page_count),
          'X-Source-Hash': source.file_sha256,
          'X-Source-Text-Hash': source.text_sha256,
        },
      })
    } catch (error) {
      return errorResponse(createApiError(
        'INTERNAL_ERROR',
        error instanceof Error ? `冻结原文件第 ${page} 页渲染失败：${error.message}` : '冻结原文件页渲染失败',
      ), 503)
    }
  })
}
