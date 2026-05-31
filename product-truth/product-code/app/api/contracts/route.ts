import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, sanitizeFileName } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'
import { paginationSchema } from '@/lib/validation'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/contracts - 获取合同列表（需登录）
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)

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
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query.range(
      (page - 1) * pageSize,
      page * pageSize - 1
    )

    if (error) {
      console.error('Get contracts error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      data,
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
    console.error('Get contracts error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/contracts - 上传合同（需登录）
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return errorResponse('请选择文件', 400, 'MISSING_FILE')
    }

    // 校验文件格式
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
    if (!allowedTypes.includes(file.type)) {
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

    // 上传文件到 Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('contracts')
      .upload(filePath, file, {
        contentType: file.type,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
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
      console.error('Contract insert error:', error)
      return errorResponse('创建合同记录失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(contract, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create contract error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
