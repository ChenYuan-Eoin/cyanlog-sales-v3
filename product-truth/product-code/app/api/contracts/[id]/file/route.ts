import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import {
  canAccessContractAction,
  listAccessibleUserIds,
} from '@/lib/scoped-access'

type ContractFileRow = {
  id: string
  filename: string | null
  storage_path: string | null
  mime_type: string | null
}

type ContractVersionFileRow = {
  storage_path: string | null
  mime_type: string | null
  version_number: number | null
}

function safeAsciiFilename(name: string) {
  const ext = name.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] || ''
  const base = name
    .replace(ext, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return `${base || 'contract-file'}${ext}`
}

function contentDispositionFilename(name: string) {
  const asciiName = safeAsciiFilename(name)
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function filenameForPath(path: string) {
  return decodeURIComponent(path.split('/').pop() || 'contract-file')
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const storagePath = new URL(req.url).searchParams.get('path')
    if (!storagePath) {
      return errorResponse(createApiError('VALIDATION_ERROR', '缺少文件路径'))
    }

    const { assignments, userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    if (!canAccessContractAction(assignments, orgId, 'view')) {
      return errorResponse(createApiError('FORBIDDEN', '没有查看合同文件的权限'))
    }
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, filename, storage_path, mime_type')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (contractError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }

    const { data: versions, error: versionsError } = await supabaseAdmin
      .from('contract_versions')
      .select('storage_path, mime_type, version_number')
      .eq('contract_id', id)

    if (versionsError) {
      return errorResponse(createApiError('DB_ERROR', '读取合同版本失败'))
    }

    const contractFile = contract as ContractFileRow
    const versionFiles = (versions || []) as ContractVersionFileRow[]
    const matchedVersion = versionFiles.find((version) => version.storage_path === storagePath)
    const isContractSource = contractFile.storage_path === storagePath

    if (!isContractSource && !matchedVersion) {
      return errorResponse(createApiError('FORBIDDEN', '文件不属于当前合同版本流'))
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from('contracts')
      .download(storagePath)

    if (downloadError || !fileBlob) {
      return errorResponse(createApiError('SERVICE_UNAVAILABLE', '读取合同文件失败'))
    }

    const mimeType = matchedVersion?.mime_type || contractFile.mime_type || 'application/octet-stream'
    const fallbackName = matchedVersion
      ? `${contractFile.filename || filenameForPath(storagePath)}-v${matchedVersion.version_number || ''}`
      : contractFile.filename || filenameForPath(storagePath)
    const contentDisposition = contentDispositionFilename(fallbackName)

    return new Response(fileBlob, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(fileBlob.size),
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'private, max-age=300',
      },
    })
  })
}
