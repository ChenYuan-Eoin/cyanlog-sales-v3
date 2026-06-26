// PURPOSE: 通用文件上传接口 (Logo/Favicon 等)
// 自动创建存储桶，无需手动配置

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const BUCKET_NAME = 'workspace-assets'
const ALLOWED_FOLDERS = ['logos', 'favicons', 'avatars'] as const

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

function normalizeFolder(value: FormDataEntryValue | null): typeof ALLOWED_FOLDERS[number] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return ALLOWED_FOLDERS.includes(value as typeof ALLOWED_FOLDERS[number])
    ? value as typeof ALLOWED_FOLDERS[number]
    : undefined
}

const uploadFormSchema = z.object({
  file: z.custom<File>(isFile),
  folder: z.enum(ALLOWED_FOLDERS).optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({
    success: false,
    error: {
      code: code || 'UPLOAD_ERROR',
      message,
    },
  }, { status })
}

// 确保存储桶存在，不存在则自动创建
async function ensureBucketExists(): Promise<boolean> {
  try {
    // 先检查 bucket 是否存在
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets()

    if (listError) {
      console.error('List buckets error:', listError)
      return false
    }

    const bucketExists = buckets.some(b => b.name === BUCKET_NAME)

    if (bucketExists) {
      return true
    }

    // 创建公开 bucket
    const { error: createError } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: MAX_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    })

    if (createError) {
      console.error('Create bucket error:', createError)
      return false
    }

    return true
  } catch (error) {
    console.error('Ensure bucket error:', error)
    return false
  }
}

// POST /api/upload - 上传文件到 Supabase Storage
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const formData = await req.formData().catch(() => null)
    if (!formData) {
      return errorResponse('请求格式不是有效的表单数据', 400, 'INVALID_FORM')
    }

    const parsed = uploadFormSchema.safeParse({
      file: formData.get('file'),
      folder: normalizeFolder(formData.get('folder')),
    })
    if (!parsed.success) {
      return errorResponse('未找到文件', 400, 'NO_FILE')
    }

    const { file, folder } = parsed.data

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse(`仅支持 .png, .jpg, .svg, .webp 格式，当前: ${file.type}`, 400, 'INVALID_TYPE')
    }

    if (file.size > MAX_SIZE) {
      return errorResponse('文件大小不能超过 2MB', 400, 'FILE_TOO_LARGE')
    }

    const targetFolder = folder === 'favicons'
      ? 'favicons'
      : folder === 'avatars'
        ? 'avatars'
        : 'logos'
    const timestamp = Date.now()
    const extension = file.name.split('.').pop() || 'png'
    const fileName = `${targetFolder}/${user.id}_${timestamp}.${extension}`

    // 将 File 转换为 Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 第一次上传尝试
    let uploadResult = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType: file.type,
        cacheControl: '31536000', // 1 year cache
        upsert: false,
      })

    // 如果失败且可能是 bucket 不存在，自动创建并重试
    if (uploadResult.error) {
      const isBucketError = uploadResult.error.message?.toLowerCase().includes('bucket') ||
                           uploadResult.error.message?.toLowerCase().includes('not found') ||
                           uploadResult.error.message?.toLowerCase().includes('does not exist')

      if (isBucketError) {
        const created = await ensureBucketExists()

        if (created) {
          // 重试上传
          uploadResult = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(fileName, buffer, {
              contentType: file.type,
              cacheControl: '31536000',
              upsert: false,
            })
        }
      }
    }

    if (uploadResult.error) {
      console.error('Upload error:', uploadResult.error)
      return errorResponse('上传失败: ' + uploadResult.error.message, 500, 'UPLOAD_FAILED')
    }

    // 获取公开 URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName)

    return NextResponse.json({
      success: true,
      data: {
        url: publicUrl,
        fileName,
        size: file.size,
        type: file.type,
      },
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
