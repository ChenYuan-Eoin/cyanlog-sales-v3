// F016 技术文档库 - CRUD API

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { DOC_TYPES } from '@/lib/tech-documents/types'

export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().min(2).max(200),
  doc_type: z.enum(DOC_TYPES as [string, ...string[]]),
  version: z.string().regex(/^v\d+\.\d+\.\d+$/).optional(),
  content: z.string().max(50000).optional(),
  file_url: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(30)).max(20).optional(),
  is_published: z.boolean().optional(),
})

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  doc_type: z.enum(DOC_TYPES as [string, ...string[]]).optional(),
  search: z.string().optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)
    const { searchParams } = new URL(req.url)
    const q = listSchema.safeParse({
      page: searchParams.get('page') || 1,
      pageSize: searchParams.get('pageSize') || 20,
      doc_type: searchParams.get('doc_type') || undefined,
      search: searchParams.get('search') || undefined,
    })
    if (!q.success) return errorResponse('查询参数无效', 400, 'INVALID_QUERY')

    const { page, pageSize, doc_type, search } = q.data
    let query = supabaseAdmin
      .from('tech_documents')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })

    if (doc_type) query = query.eq('doc_type', doc_type)
    if (search) query = query.ilike('title', `%${search}%`)

    const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1)
    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')

    return NextResponse.json({ data, meta: { page, pageSize, total: count || 0 } })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const body = await req.json()
    const result = createSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const input = result.data
    const { data, error } = await supabaseAdmin
      .from('tech_documents')
      .insert({
        ...input,
        version: input.version || 'v1.0.0',
        tags: input.tags || [],
        is_published: input.is_published || false,
        view_count: 0,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) return errorResponse('创建失败', 500, 'DB_ERROR')
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
