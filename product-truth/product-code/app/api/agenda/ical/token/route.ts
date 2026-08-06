// F018（WP11）：获取/创建当前用户的 iCal 订阅链接
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { createApiError } from '@/lib/api/errors'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { data: existing } = await supabaseAdmin
      .from('calendar_subscriptions')
      .select('token')
      .eq('user_id', user.id)
      .maybeSingle()

    let token = existing?.token as string | undefined
    if (!token) {
      const { data: inserted, error } = await supabaseAdmin
        .from('calendar_subscriptions')
        .insert({ user_id: user.id })
        .select('token')
        .single()
      if (error) {
        return NextResponse.json(
          { error: createApiError('DB_ERROR', '订阅创建失败') },
          { status: 500 }
        )
      }
      token = inserted.token as string
    }

    const origin = req.nextUrl.origin
    const path = `/api/agenda/ical?token=${encodeURIComponent(token)}`
    return NextResponse.json({
      success: true,
      data: {
        token,
        url: `${origin}${path}`,
        webcalUrl: `${origin.replace(/^https:/, 'webcal:')}${path}`,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: createApiError('UNAUTHORIZED') }, { status: 401 })
    }
    return NextResponse.json({ error: createApiError('INTERNAL_ERROR') }, { status: 500 })
  }
}
