import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import { renderPdfPageToPng, sourceRenderMode } from '@/lib/documents/source-render'
import { renderContractSource } from '@/lib/documents/source-render-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sourceIdentitySchema = z.object({
  storage_path: z.string().min(1),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; page: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id, page: pageParam } = await params
    const page = Number(pageParam)
    if (!Number.isInteger(page) || page < 1) {
      return errorResponse(createApiError('VALIDATION_ERROR', '页码必须是正整数'))
    }
    const url = new URL(req.url)
    const requestedIdentity = sourceIdentitySchema.safeParse({
      storage_path: url.searchParams.get('storage_path'),
      source_hash: url.searchParams.get('source_hash'),
      source_text_hash: url.searchParams.get('source_text_hash'),
    })
    if (!requestedIdentity.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '页级预览必须携带页面加载时的完整源文件身份'))
    }

    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('id,filename,mime_type,storage_path,parsed_text')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (error || !contract?.storage_path) {
      return errorResponse(createApiError('NOT_FOUND', '合同源文件不存在或无权访问'))
    }
    const renderMode = sourceRenderMode(contract.filename, contract.mime_type)
    if (renderMode === 'unsupported') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '当前仅支持真实 PDF、DOC、DOCX、DOCM 页级预览'), 422)
    }
    if (renderMode !== 'pdf') {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        'Word 原文由浏览器直接安全渲染，不再调用服务器 Office 转换器'
      ), 422)
    }
    if (requestedIdentity.data.storage_path !== contract.storage_path) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件已变化，请刷新后查看'), 409)
    }

    try {
      const rendered = await renderContractSource({ ...contract, storage_path: contract.storage_path })
      if (
        rendered.pageMap.source_hash !== requestedIdentity.data.source_hash
        || rendered.pageMap.source_text_hash !== requestedIdentity.data.source_text_hash
      ) {
        return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件或解析文本已变化，请刷新后查看'), 409)
      }
      if (page > rendered.pageMap.page_count) {
        return errorResponse(createApiError('VALIDATION_ERROR', `页码超出范围，共 ${rendered.pageMap.page_count} 页`))
      }
      const png = await renderPdfPageToPng(rendered.pdf, page)
      return new NextResponse(new Blob([Uint8Array.from(png)], { type: 'image/png' }), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'private, max-age=300',
          'X-Source-Page': String(page),
          'X-Source-Page-Count': String(rendered.pageMap.page_count),
          'X-Source-Page-Locator': rendered.pageMap.locator,
          'X-Source-Hash': rendered.pageMap.source_hash,
          'X-Source-Text-Hash': rendered.pageMap.source_text_hash,
        },
      })
    } catch (renderError) {
      return errorResponse(createApiError(
        'INTERNAL_ERROR',
        renderError instanceof Error ? `源文件第 ${page} 页渲染失败：${renderError.message}` : '源文件页渲染失败'
      ), 503)
    }
  })
}
