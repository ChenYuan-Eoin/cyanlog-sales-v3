import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import { sourceRenderMode } from '@/lib/documents/source-render'
import {
  runSourceDependency,
  SOURCE_DEPENDENCY_TIMEOUT_MS,
  SourceDependencyUnavailableError,
} from '@/lib/documents/source-ticket'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sourceIdentitySchema = z.object({
  storage_path: z.string().min(1),
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
})

function createNoStoreSourceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new Error('合同源文件服务未配置')
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}

async function createFreshStorageTicket(storagePath: string, timeoutMs: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new SourceDependencyUnavailableError('合同源文件服务未配置')

  const encodedPath = storagePath
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return await runSourceDependency(async (signal) => {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/contracts/${encodedPath}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 60 }),
      cache: 'no-store',
      signal,
    })
    const payload = await response.json().catch(() => null) as { signedURL?: string } | null
    if (!response.ok || !payload?.signedURL) throw new SourceDependencyUnavailableError('合同原文件短期读取地址生成失败')
    return new URL(`/storage/v1${payload.signedURL}`, supabaseUrl).toString()
  }, timeoutMs)
}

function remainingDependencyBudget(deadline: number) {
  return Math.max(1, deadline - Date.now())
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    let sourceClient: ReturnType<typeof createNoStoreSourceClient>
    try {
      sourceClient = createNoStoreSourceClient()
    } catch {
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', '合同源文件服务未配置，请重试'))
    }
    const dependencyDeadline = Date.now() + SOURCE_DEPENDENCY_TIMEOUT_MS
    const { id } = await params
    let contract: { id: string; filename: string; mime_type: string | null; storage_path: string | null } | null
    try {
      const { data, error } = await runSourceDependency((signal) => sourceClient
        .from('contracts')
        .select('id,filename,mime_type,storage_path')
        .eq('id', id)
        .eq('org_id', orgId)
        .abortSignal(signal)
        .maybeSingle(), remainingDependencyBudget(dependencyDeadline))
      if (error) throw new SourceDependencyUnavailableError('合同源文件查询失败')
      contract = data
    } catch {
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', '合同源文件服务暂时不可用，请重试'))
    }

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同源文件不存在或无权访问'))
    }
    if (!contract.storage_path) {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '合同缺少源文件，不能打开原文预览'), 422)
    }

    const mode = sourceRenderMode(contract.filename, contract.mime_type)
    if (mode === 'unsupported') {
      return errorResponse(createApiError('BUSINESS_RULE_VIOLATION', '当前仅支持真实 PDF、DOC、DOCX、DOCM 原文预览，不使用失真文本卡替代'), 422)
    }

    const url = new URL(req.url)
    const requestedIdentity = sourceIdentitySchema.safeParse({
      storage_path: url.searchParams.get('storage_path'),
      source_hash: url.searchParams.get('source_hash'),
      source_text_hash: url.searchParams.get('source_text_hash'),
    })
    if (!requestedIdentity.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '原文件读取必须携带页面加载时的完整源文件身份'))
    }
    if (requestedIdentity.data.storage_path !== contract.storage_path) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件已变化，请刷新后查看'), 409)
    }

    let pageMap: { storage_path: string; source_hash: string; source_text_hash: string; render_mode: string | null } | null
    try {
      const { data, error } = await runSourceDependency((signal) => sourceClient
        .from('contract_source_page_maps')
        .select('storage_path,source_hash,source_text_hash,render_mode')
        .eq('contract_id', contract.id)
        .eq('storage_path', contract.storage_path)
        .abortSignal(signal)
        .maybeSingle(), remainingDependencyBudget(dependencyDeadline))
      if (error) throw new SourceDependencyUnavailableError('源文件身份查询失败')
      pageMap = data
    } catch {
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', '源文件身份服务暂时不可用，请重试'))
    }
    if (!pageMap) {
      return errorResponse(createApiError('CONFLICT', '源文件身份尚未建立，请刷新审核任务后重试'), 409)
    }
    if (
      pageMap.source_hash !== requestedIdentity.data.source_hash
      || pageMap.source_text_hash !== requestedIdentity.data.source_text_hash
    ) {
      return errorResponse(createApiError('CONFLICT', '页面加载后合同源文件或解析文本已变化，请刷新后查看'), 409)
    }

    // Supabase's SDK uses the runtime-global fetch implementation. In a Next
    // process that can reuse a cached POST result, which leaves an expired
    // signed token in an otherwise fresh JSON response. Force this one-time
    // signing request through a no-store fetch instead.
    let signedUrl: string
    try {
      signedUrl = await createFreshStorageTicket(contract.storage_path, remainingDependencyBudget(dependencyDeadline))
    } catch {
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', '合同原文件短期读取地址生成失败，请重试'))
    }

    // Do not return an HTTP redirect here. Browsers may reuse a cached 307 for
    // the stable identity URL after its short-lived Storage token has expired.
    // A no-store JSON ticket makes every preview attempt obtain a fresh URL,
    // while the file itself still bypasses the Vercel response-size path.
    const response = successResponse({
      download_url: signedUrl,
      expires_in: 60,
    })
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Source-Render-Mode', pageMap.render_mode || (mode === 'pdf' ? 'native-pdf' : 'browser-ooxml'))
    response.headers.set('X-Source-Hash', pageMap.source_hash)
    response.headers.set('X-Source-Text-Hash', pageMap.source_text_hash)
    return response
  })
}
