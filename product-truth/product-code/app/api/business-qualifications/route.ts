// F017 商务资质库 - CRUD API

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { QUAL_TYPES } from '@/lib/business-qualifications/types'

export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().min(2).max(200),
  qual_type: z.enum(QUAL_TYPES as [string, ...string[]]),
  cert_no: z.string().max(100).optional(),
  issuer: z.string().max(200).optional(),
  issued_at: z.string().date().optional(),
  expires_at: z.string().date().nullable().optional(),
  file_url: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)
    const { searchParams } = new URL(req.url)
    const qualType = searchParams.get('qual_type')

    let q = supabaseAdmin.from('business_qualifications').select('*').order('expires_at', { ascending: true })
    if (qualType) q = q.eq('qual_type', qualType)

    const { data, error } = await q
    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')
    return NextResponse.json({ data: data || [] })
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

    const { data, error } = await supabaseAdmin
      .from('business_qualifications')
      .insert({ ...result.data, created_by: user.id })
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
