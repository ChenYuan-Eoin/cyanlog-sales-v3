// GET /api/health - 健康检查端点
// 不依赖外部服务，Vercel uptime monitoring 可用

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface HealthCheck {
  name: string
  status: 'ok' | 'degraded' | 'down'
  latencyMs: number
  message?: string
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const { error } = await supabaseAdmin
      .from('users')
      .select('id')
      .limit(1)
      .single()
    const latencyMs = Date.now() - start
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows (空表是正常的)
      return { name: 'database', status: 'down', latencyMs, message: error.message }
    }
    return { name: 'database', status: 'ok', latencyMs }
  } catch (err) {
    return {
      name: 'database',
      status: 'down',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkEnv(): Promise<HealthCheck> {
  const start = Date.now()
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const missing = required.filter((k) => !process.env[k])
  const latencyMs = Date.now() - start
  if (missing.length > 0) {
    return {
      name: 'environment',
      status: 'down',
      latencyMs,
      message: `缺失环境变量: ${missing.join(', ')}`,
    }
  }
  return { name: 'environment', status: 'ok', latencyMs }
}

export async function GET() {
  const start = Date.now()
  const [database, environment] = await Promise.all([checkDatabase(), checkEnv()])

  const allOk = [database, environment].every((c) => c.status === 'ok')
  const anyDown = [database, environment].some((c) => c.status === 'down')

  const status: 'ok' | 'degraded' | 'down' = allOk ? 'ok' : anyDown ? 'down' : 'degraded'

  const body = {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    totalLatencyMs: Date.now() - start,
    version: process.env.npm_package_version || 'unknown',
    checks: [database, environment],
  }

  const httpStatus = status === 'down' ? 503 : 200
  return NextResponse.json(body, { status: httpStatus })
}
