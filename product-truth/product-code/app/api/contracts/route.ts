import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, sanitizeFileName } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'
import { paginationSchema } from '@/lib/validation'
import { logError } from '@/lib/error-log'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

async function ensureContractsBucket() {
  const bucketId = 'contracts'
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets()

  if (listError) {
    throw listError
  }

  if ((buckets || []).some((bucket) => bucket.id === bucketId || bucket.name === bucketId)) {
    return
  }

  const { error: createError } = await supabaseAdmin.storage.createBucket(bucketId, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
  })

  if (createError && !/already exists/i.test(createError.message)) {
    throw createError
  }
}

// GET /api/contracts - 获取合同列表（需登录）
export async function GET(req: NextRequest) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts'

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    logRouteStart({
      route,
      requestId,
      userId: user.id,
    })

    const { searchParams } = new URL(req.url)

    // Zod验证分页参数
    const pagination = paginationSchema.safeParse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })

    if (!pagination.success) {
      return errorResponse('分页参数无效', 400, 'INVALID_PAGINATION')
    }

    const { page, pageSize } = pagination.data
    const status = searchParams.get('status')

    let query = supabaseAdmin
      .from('contracts')
      .select('*', { count: 'exact' })
      .in('created_by', accessibleUserIds)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query.range(
      (page - 1) * pageSize,
      page * pageSize - 1
    )

    if (error) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
        },
        startedAt,
        error,
        {
          phase: 'list_contracts',
        }
      )
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    const contractIds = data?.map((contract) => contract.id) ?? []
    let latestJobsByContractId = new Map<string, Record<string, unknown>>()

    if (contractIds.length > 0) {
      const { data: jobs, error: jobsError } = await supabaseAdmin
        .from('contract_analysis_jobs')
        .select('*')
        .in('contract_id', contractIds)
        .order('created_at', { ascending: false })

      if (jobsError) {
        await logError({
          req,
          source: 'api',
          userId: user.id,
          message: jobsError.message,
          error: jobsError,
          context: {
            route,
            requestId,
            phase: 'list_contract_jobs',
            contractCount: contractIds.length,
          },
        })
      } else {
        latestJobsByContractId = jobs.reduce((map, job) => {
          if (!map.has(job.contract_id)) {
            map.set(job.contract_id, job)
          }
          return map
        }, new Map<string, Record<string, unknown>>())
      }
    }

    const enrichedContracts = (data ?? []).map((contract) => ({
      ...contract,
      latest_analysis_job: latestJobsByContractId.get(contract.id) ?? null,
    }))

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
      },
      startedAt,
      {
        page,
        pageSize,
        count: enrichedContracts.length,
        total: count || 0,
      }
    )

    return NextResponse.json({
      data: enrichedContracts,
      meta: {
        page,
        pageSize,
        total: count || 0,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    await logRouteFailure(
      req,
      {
        route,
        requestId,
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/contracts - 上传合同（需登录）
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts'

  try {
    const user = await requireAuth(req)
    logRouteStart({
      route,
      requestId,
      userId: user.id,
    })

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return errorResponse('请选择文件', 400, 'MISSING_FILE')
    }

    // 校验文件格式
    const normalizedName = file.name.toLowerCase()
    const hasAllowedMime = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ].includes(file.type)
    const hasAllowedExtension = normalizedName.endsWith('.pdf') || normalizedName.endsWith('.docx') || normalizedName.endsWith('.doc')

    if (!hasAllowedMime && !hasAllowedExtension) {
      return errorResponse('仅支持 PDF 和 Word 文档', 400, 'INVALID_FILE_TYPE')
    }

    // 校验文件大小（50MB）
    const MAX_SIZE = 50 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return errorResponse('文件大小不能超过 50MB', 400, 'FILE_TOO_LARGE')
    }

    // 生成存储路径
    const fileId = uuidv4()
    const safeName = sanitizeFileName(file.name)
    const filePath = `contracts/${fileId}/${safeName}`

    await ensureContractsBucket()

    // 上传文件到 Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('contracts')
      .upload(filePath, file, {
        contentType: file.type || (normalizedName.endsWith('.pdf')
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        upsert: false,
      })

    if (uploadError) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
        },
        startedAt,
        uploadError,
        {
          phase: 'upload_contract_file',
          filePath,
        }
      )
      return errorResponse('文件上传失败', 500, 'UPLOAD_FAILED')
    }

    // 创建合同记录
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .insert({
        id: fileId,
        filename: safeName,
        storage_path: filePath,
        size: file.size,
        mime_type: file.type,
        status: 'PENDING',
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
        },
        startedAt,
        error,
        {
          phase: 'insert_contract_record',
          filePath,
        }
      )
      return errorResponse('创建合同记录失败', 500, 'DB_ERROR')
    }

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
      },
      startedAt,
      {
        contractId: contract.id,
        filePath,
      }
    )

    return NextResponse.json(contract, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    await logRouteFailure(
      req,
      {
        route,
        requestId,
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
