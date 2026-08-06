// F018（WP11）：iCal 订阅源（token 鉴权，供苹果/谷歌日历轮询）
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildIcs } from '@/lib/agenda/ical'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  if (!token) {
    return new Response('missing token', { status: 401 })
  }
  const { data: sub } = await supabaseAdmin
    .from('calendar_subscriptions')
    .select('user_id')
    .eq('token', token)
    .maybeSingle()
  if (!sub) {
    return new Response('invalid token', { status: 401 })
  }

  const { data: items, error } = await supabaseAdmin
    .from('agenda_items')
    .select('*')
    .or(`user_id.eq.${sub.user_id},assignee_id.eq.${sub.user_id},created_by.eq.${sub.user_id}`)
    .order('start_at', { ascending: true })
    .limit(200)
  if (error) {
    return new Response('server error', { status: 500 })
  }

  await supabaseAdmin
    .from('calendar_subscriptions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token', token)

  const ics = buildIcs(items || [], { calendarName: 'ONES 日程' })
  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="ones-schedule.ics"',
      'Cache-Control': 'no-store',
    },
  })
}
