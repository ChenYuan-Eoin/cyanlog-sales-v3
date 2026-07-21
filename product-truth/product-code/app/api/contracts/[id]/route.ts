// REQ:F005
// FREEZE-SPEC:3.1

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { contractIdSchema } from '@/lib/validation'
import { logError } from '@/lib/error-log'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import {
  canAccessContractAction,
  getDefaultOrgId,
  listAccessibleUserIds,
} from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/contracts/:id - 获取合同详情（需登录）
export async function GET(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]'
  let routeId = ''

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { assignments, userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    if (!canAccessContractAction(assignments, orgId, 'view')) {
      return errorResponse('没有查看合同的权限', 403, 'FORBIDDEN')
    }
    routeId = await resolveIdParam(params)
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId: routeId },
    })

    // Zod验证ID格式
    const idResult = contractIdSchema.safeParse({ id: routeId })
    if (!idResult.success) {
      return errorResponse('无效的合同ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('*, contract_reviews(*)')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (error) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id },
        },
        startedAt,
        error,
        {
          phase: 'get_contract',
        }
      )
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    if (Array.isArray(contract.contract_reviews)) {
      contract.contract_reviews = contract.contract_reviews.sort((
        a: { created_at: string },
        b: { created_at: string }
      ) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    }

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from('contract_analysis_jobs')
      .select('*')
      .eq('contract_id', id)
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
          contractId: id,
          phase: 'get_contract_jobs',
        },
      })
      contract.contract_analysis_jobs = []
    } else if (Array.isArray(jobs)) {
      contract.contract_analysis_jobs = jobs
    }

    contract.latest_analysis_job = contract.contract_analysis_jobs?.[0] ?? null

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId: id },
      },
      startedAt,
      {
        reviewCount: contract.contract_reviews?.length ?? 0,
        jobCount: contract.contract_analysis_jobs?.length ?? 0,
      }
    )

    return NextResponse.json(contract)
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
        details: { contractId: routeId },
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/contracts/:id - 删除合同（需登录，仅能删除自己的合同）
export async function DELETE(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]'
  let routeId = ''

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    routeId = await resolveIdParam(params)
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId: routeId, method: 'DELETE' },
    })

    // Zod验证ID格式
    const idResult = contractIdSchema.safeParse({ id: routeId })
    if (!idResult.success) {
      return errorResponse('无效的合同ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    // 查询合同是否存在（带 owner 校验）
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, storage_path, created_by')
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)
      .single()

    if (fetchError || !contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    // 删除Storage中的文件（异步，不阻塞）
    if (contract.storage_path) {
      supabaseAdmin.storage.from('contracts').remove([contract.storage_path])
        .catch(async (storageError) => {
          await logError({
            req,
            source: 'api',
            userId: user.id,
            message: storageError instanceof Error ? storageError.message : String(storageError),
            error: storageError,
            context: {
              route,
              requestId,
              contractId: id,
              phase: 'delete_contract_storage',
              storagePath: contract.storage_path,
            },
          })
        })
    }

    // 删除数据库记录（带 owner 校验）
    const { error } = await supabaseAdmin
      .from('contracts')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('created_by', user.id)

    if (error) {
      await logRouteFailure(
        req,
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id, method: 'DELETE' },
        },
        startedAt,
        error,
        {
          phase: 'delete_contract_record',
        }
      )
      return errorResponse('删除失败', 500, 'DB_ERROR')
    }

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId: id, method: 'DELETE' },
      },
      startedAt
    )

    return NextResponse.json({ success: true, message: '合同已删除' })
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
        details: { contractId: routeId, method: 'DELETE' },
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// PATCH /api/contracts/:id - 更新合同信息
export async function PATCH(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  try {
    const user = await requireAuth(req)
    const contractId = await resolveIdParam(params)

    // Zod验证ID格式
    const idResult = contractIdSchema.safeParse({ id: contractId })
    if (!idResult.success) {
      return errorResponse('无效的合同ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    // 获取更新数据。无效 JSON 在进入组织/数据库链路前返回 400。
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse('请求参数无效', 400, 'INVALID_DATA')
    }

    const allowedFields = [
      'contract_no',
      'party_a_name',
      'party_b_name',
      'party_b_contact',
      'contract_amount',
      'tax_amount',
      'contract_date',
      'effective_date',
      'expiry_date',
      'payment_terms',
      'delivery_terms',
      'notes',
    ]

    const updateData: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if ((body as Record<string, unknown>)[field] !== undefined) {
        updateData[field] = (body as Record<string, unknown>)[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return errorResponse('没有可更新的字段', 400, 'NO_FIELDS_TO_UPDATE')
    }

    const orgId = await getDefaultOrgId(user.id)

    // 检查合同是否存在且有权限
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, created_by, status')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (fetchError || !existing) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    // 只有合同创建者或管理员可以编辑
    if (existing.created_by !== user.id) {
      return errorResponse('无权限编辑此合同', 403, 'FORBIDDEN')
    }

    // 只有 DRAFT 状态可以编辑基本信息
    if (existing.status !== 'DRAFT') {
      return errorResponse('只有草稿状态的合同可以编辑', 400, 'NOT_EDITABLE')
    }

    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: error.message,
        error,
        context: {
          route: '/api/contracts/[id]',
          contractId: id,
          method: 'PATCH',
        },
      })
      return errorResponse('更新失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      success: true,
      data: contract,
      message: '合同已更新',
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
