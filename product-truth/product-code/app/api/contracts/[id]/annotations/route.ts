import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import { contractSourceFormatFromFilename } from '@/lib/documents/source-format'
import { ensureContractPageMap } from '@/lib/documents/source-render-server'

const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), page: z.number().int().min(1), point: pointSchema }),
  z.object({
    kind: z.literal('region'),
    page: z.number().int().min(1),
    region: pointSchema.extend({ width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) })
      .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, '批注区域超出页面范围'),
  }),
])

const createSchema = z.object({
  request_id: z.string().uuid(),
  comment: z.string().trim().min(1).max(4000),
  anchor: anchorSchema,
  source_identity: z.object({
    storage_path: z.string().min(1),
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
    source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})

const sourceIdentitySchema = createSchema.shape.source_identity

function readSourceIdentity(req: NextRequest) {
  const url = new URL(req.url)
  return sourceIdentitySchema.safeParse({
    storage_path: url.searchParams.get('storage_path'),
    source_hash: url.searchParams.get('source_hash'),
    source_text_hash: url.searchParams.get('source_text_hash'),
  })
}

async function loadContract(contractId: string, orgId: string) {
  return supabaseAdmin
    .from('contracts')
    .select('id,org_id,filename,mime_type,storage_path,parsed_text')
    .eq('id', contractId)
    .eq('org_id', orgId)
    .maybeSingle()
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const requestedIdentity = readSourceIdentity(req)
    if (!requestedIdentity.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '读取批注必须携带页面加载时的完整源文件身份'))
    }
    const { data: contract, error: contractError } = await loadContract(id, orgId)
    if (contractError || !contract) return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    if (!contract.storage_path || contractSourceFormatFromFilename(contract.filename) !== 'pdf') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '当前合同不是可添加页面批注的 PDF'), 422)
    }
    const pageMap = await ensureContractPageMap({
      id: contract.id,
      filename: contract.filename,
      mime_type: contract.mime_type,
      storage_path: contract.storage_path,
      parsed_text: contract.parsed_text,
    }).catch(() => null)
    if (!pageMap?.source_hash || !pageMap.source_text_hash) {
      return errorResponse(createApiError('INTERNAL_ERROR', '当前源文件缺少可审计身份，不能读取批注'), 503)
    }
    if (
      requestedIdentity.data.storage_path !== contract.storage_path
      || requestedIdentity.data.source_hash !== pageMap.source_hash
      || requestedIdentity.data.source_text_hash !== pageMap.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件已变化，请刷新后读取批注'), 409)
    }

    const { data, error } = await supabaseAdmin
      .from('contract_annotations')
      .select('id,comment,status,source_anchor,source_storage_path,source_hash,source_text_hash,created_at,updated_at')
      .eq('contract_id', id)
      .eq('source_storage_path', contract.storage_path)
      .eq('source_hash', pageMap.source_hash)
      .eq('source_text_hash', pageMap.source_text_hash)
      .not('source_anchor', 'is', null)
      .order('created_at', { ascending: true })
    if (error) return errorResponse(createApiError('DB_ERROR', '读取源文件批注失败'))
    return successResponse(data || [])
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join(', ')))
    }

    const { data: contract, error: contractError } = await loadContract(id, orgId)
    if (contractError || !contract?.storage_path) {
      return errorResponse(createApiError('NOT_FOUND', '合同源文件不存在或无权访问'))
    }
    if (contractSourceFormatFromFilename(contract.filename) !== 'pdf') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '页面点位/区域批注当前仅用于 PDF；Word 原生批注必须绑定原文文本'), 422)
    }

    const pageMap = await ensureContractPageMap({
      id: contract.id,
      filename: contract.filename,
      mime_type: contract.mime_type,
      storage_path: contract.storage_path,
      parsed_text: contract.parsed_text,
    }).catch(() => null)
    if (!pageMap?.source_hash || !pageMap.source_text_hash) return errorResponse(createApiError('INTERNAL_ERROR', '源文件页级身份尚未生成，不能保存可审计批注'), 503)
    if (
      parsed.data.source_identity.storage_path !== contract.storage_path
      || parsed.data.source_identity.source_hash !== pageMap.source_hash
      || parsed.data.source_identity.source_text_hash !== pageMap.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件已变化，请刷新后重新定位批注'), 409)
    }
    if (parsed.data.anchor.page > pageMap.page_count) {
      return errorResponse(createApiError('VALIDATION_ERROR', `批注页码超出范围，共 ${pageMap.page_count} 页`))
    }

    const { data: currentContract, error: currentContractError } = await loadContract(id, orgId)
    const currentPageMap = currentContract?.storage_path
      ? await ensureContractPageMap({
        id: currentContract.id,
        filename: currentContract.filename,
        mime_type: currentContract.mime_type,
        storage_path: currentContract.storage_path,
        parsed_text: currentContract.parsed_text,
      }, { forceSourceVerification: true }).catch(() => null)
      : null
    if (
      currentContractError
      || currentContract?.storage_path !== contract.storage_path
      || currentContract?.filename !== contract.filename
      || currentContract?.mime_type !== contract.mime_type
      || currentPageMap?.source_hash !== pageMap.source_hash
      || currentPageMap?.source_text_hash !== pageMap.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '保存期间合同源文件已变化，请刷新后重新定位'), 409)
    }

    const { data, error } = await supabaseAdmin
      .from('contract_annotations')
      .insert({
        contract_id: id,
        start_offset: 0,
        end_offset: 0,
        selected_text: null,
        comment: parsed.data.comment,
        category: 'issue',
        priority: 'normal',
        status: 'open',
        author_id: user.id,
        client_request_id: parsed.data.request_id,
        source_anchor: parsed.data.anchor,
        source_storage_path: contract.storage_path,
        source_hash: pageMap.source_hash,
        source_text_hash: pageMap.source_text_hash,
      })
      .select('id,comment,status,source_anchor,source_storage_path,source_hash,source_text_hash,created_at,updated_at')
      .single()
    if (error?.code === '23505') {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('contract_annotations')
        .select('id,comment,status,source_anchor,source_storage_path,source_hash,source_text_hash,created_at,updated_at')
        .eq('contract_id', id)
        .eq('author_id', user.id)
        .eq('client_request_id', parsed.data.request_id)
        .maybeSingle()
      if (!existingError && existing) return successResponse(existing)
    }
    if (error?.code === '23514' || error?.code === '55000') {
      return errorResponse(createApiError('CONFLICT', '保存期间源文件或审核状态已变化，请刷新后重新定位'), 409)
    }
    if (error || !data) return errorResponse(createApiError('DB_ERROR', '保存源文件批注失败'))
    return successResponse(data, undefined, 201)
  })
}
