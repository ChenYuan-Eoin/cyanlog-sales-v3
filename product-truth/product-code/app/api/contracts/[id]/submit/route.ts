// POST /api/contracts/[id]/submit - 提交合同进入审核队列

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { contractIdSchema } from '@/lib/validation'

type ContractForSubmit = {
  id: string
  status: string | null
  filename: string | null
  storage_path: string | null
  [key: string]: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id: routeId } = await params
    const idResult = contractIdSchema.safeParse({ id: routeId })

    if (!idResult.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '无效的合同ID'))
    }

    const { id } = idResult.data
    const {
      contract,
      userIds: accessibleUserIds,
    } = await getAccessibleContract<ContractForSubmit>(
      id,
      user.id,
      orgId,
      'id, status, filename, storage_path'
    )

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    if (!contract.filename || !contract.storage_path) {
      return errorResponse(createApiError('VALIDATION_ERROR', '请先上传合同文件'))
    }

    if (contract.status === 'PENDING') {
      return successResponse({
        contractId: id,
        status: 'PENDING',
        message: '合同已处于待审核状态',
        reviewUrl: `/contracts/${id}/review`,
      })
    }

    if (contract.status !== 'DRAFT' && contract.status !== 'FAILED') {
      return errorResponse(
        createApiError('VALIDATION_ERROR', `合同当前状态无法提交审核: ${contract.status || 'UNKNOWN'}`)
      )
    }

    const { data: updated, error } = await supabaseAdmin
      .from('contracts')
      .update({
        status: 'PENDING',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .select('id, status, filename')
      .single()

    if (error || !updated) {
      return errorResponse(createApiError('DB_ERROR', '提交审核失败'))
    }

    return successResponse({
      contractId: updated.id,
      status: updated.status,
      filename: updated.filename,
      message: '合同已提交审核',
      reviewUrl: `/contracts/${updated.id}/review`,
    })
  })
}
