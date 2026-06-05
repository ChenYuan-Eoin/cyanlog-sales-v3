// 飞控健康检查（SpaceX FMEA 标准）
// 路径：/api/health/flight-ready
// 返回各子系统状态 + 总体 GO/NO-GO

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REQUIRED_TABLES = [
  'users',
  'auth_tokens',
  'quotes',
  'contracts',
  'rules',
  'user_organizations',
  'configs',
  'config_versions',
  'contract_analysis_jobs',
]

interface SubsystemStatus {
  name: string
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  latencyMs: number
  message?: string
}

async function checkSubsystem(
  name: string,
  check: () => Promise<void>
): Promise<SubsystemStatus> {
  const start = Date.now()
  try {
    await check()
    return { name, status: 'HEALTHY', latencyMs: Date.now() - start }
  } catch (err) {
    return {
      name,
      status: 'CRITICAL',
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkSubsystem('postgresql', async () => {
      const { error } = await supabaseAdmin.from('users').select('id').limit(1).single()
      if (error && error.code !== 'PGRST116') {
        throw new Error(error.message)
      }
    }),
    checkSubsystem('schema_required_tables', async () => {
      // 验证关键表存在（FMEA 关键节点）
      for (const table of REQUIRED_TABLES) {
        const { error } = await supabaseAdmin
          .from(table)
          .select('*', { count: 'exact', head: true })
        if (error) {
          throw new Error(`${table}: ${error.message}`)
        }
      }
    }),
    checkSubsystem('environment', async () => {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY 未设置')
      }
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL 未设置')
      }
    }),
  ])

  const criticalCount = checks.filter((c) => c.status === 'CRITICAL').length
  const degradedCount = checks.filter((c) => c.status === 'DEGRADED').length

  let overall: 'GO' | 'GO_WITH_WARNINGS' | 'NO_GO'
  if (criticalCount > 0) overall = 'NO_GO'
  else if (degradedCount > 0) overall = 'GO_WITH_WARNINGS'
  else overall = 'GO'

  return NextResponse.json(
    {
      mission: 'cyanlog-sales-v3',
      timestamp: new Date().toISOString(),
      overall,
      subsystems: checks,
    },
    { status: criticalCount > 0 ? 503 : 200 }
  )
}
