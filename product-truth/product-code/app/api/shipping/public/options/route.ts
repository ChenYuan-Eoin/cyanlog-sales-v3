import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    { error: '寄件设置仅向已登录员工开放。', code: 'AUTHENTICATED_INTAKE_REQUIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}
