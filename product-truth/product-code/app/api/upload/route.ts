// PURPOSE: 通用文件上传接口 (Logo/Favicon 等)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
const MAX_SIZE = 2 * 1024 * 1024 // 2MB

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/upload - 上传文件到 Supabase Storage
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const folder = formData.get('folder') as string | null // 'logos' | 'favicons'

    if (!file) {
      return errorResponse('未找到文件', 400, 'NO_FILE')
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse(`.png, .jpg, .svg, .webp 格式，当前: ${file.type}`, 400, 'INVALID_TYPE')
    }

    if (file.size > MAX_SIZE) {
      return errorResponse('文件大小不能超过 2MB', 400, 'FILE_TOO_LARGE')
    }

    const targetFolder = folder === 'favicons' ? 'favicons' : 'logos'
    const bucket = 'workspace-assets'
    const timestamp = Date.now()
    const extension = file.name.split('.').pop() || 'png'
    const fileName = `${targetFolder}/${user.id}_${timestamp}.${extension}`

    // 将 File 转换为 Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 上传到 Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: file.type,
        cacheControl: '31536000', // 1 year cache
        upsert: false,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)

      // 如果 bucket 不存在，尝试创建
      if (uploadError.message?.includes('bucket') || uploadError.message?.includes('Bucket')) {
        return errorResponse(
          '存储桶未创建，请运行: supabase storage create workspace-assets',
          500,
          'BUCKET_NOT_FOUND'
        )
      }

      return errorResponse('上传失败: ' + uploadError.message, 500, 'UPLOAD_FAILED')
    }

    // 获取公开 URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(fileName)

    return NextResponse.json({
      url: publicUrl,
      fileName,
      size: file.size,
      type: file.type,
    }, { status: 201 })

  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Upload error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
