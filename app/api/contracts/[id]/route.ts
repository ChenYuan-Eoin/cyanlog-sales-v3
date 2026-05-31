// REQ:F005
// FREEZE-SPEC:3.1

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { contractIdSchema } from '@/lib/validation'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/contracts/:id - 获取合同详情（需登录）
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(req)

    // Zod验证ID格式
    const idResult = contractIdSchema.safeParse({ id: params.id })
    if (!idResult.success) {
      return errorResponse('无效的合同ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('*, contract_reviews(*)')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Get contract error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    if (!contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    return NextResponse.json(contract)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get contract error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/contracts/:id - 删除合同（需登录）
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAuth(req)

    // Zod验证ID格式
    const idResult = contractIdSchema.safeParse({ id: params.id })
    if (!idResult.success) {
      return errorResponse('无效的合同ID', 400, 'INVALID_ID')
    }

    const { id } = idResult.data

    // 查询合同是否存在
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, storage_path')
      .eq('id', id)
      .single()

    if (fetchError || !contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    // 删除Storage中的文件（异步，不阻塞）
    if (contract.storage_path) {
      supabaseAdmin.storage.from('contracts').remove([contract.storage_path])
        .catch(err => console.error('Storage delete error:', err))
    }

    // 删除数据库记录
    const { error } = await supabaseAdmin
      .from('contracts')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete contract error:', error)
      return errorResponse('删除失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true, message: '合同已删除' })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete contract error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
