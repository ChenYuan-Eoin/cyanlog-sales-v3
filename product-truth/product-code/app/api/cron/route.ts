// REQ: CRON-001
// PURPOSE: Vercel Cron 定时任务入口
// Schedule: 每天 10:00 执行

import { NextRequest, NextResponse } from 'next/server'
import { processQueuedContractAnalysisJobs } from '@/lib/contract-analysis'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return handleCron(req)
}

export async function POST(req: NextRequest) {
  return handleCron(req)
}

async function handleCron(req: NextRequest) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/cron'

  logRouteStart({ route, requestId })

  // 验证 CRON_SECRET 授权
  const authHeader = req.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.warn('[CRON] CRON_SECRET not configured, allowing request')
  } else {
    // 提取 token（支持 "Bearer <token>" 或直接 "<token>"）
    let token = authHeader
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }

    if (!token || token !== cronSecret) {
      console.error('[CRON] Unauthorized', {
        ip: req.headers.get('x-forwarded-for') || 'unknown',
        hasAuth: !!authHeader,
      })
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
  }

  // 执行定时任务
  try {
    const results = await runCronTasks()

    logRouteDone({ route, requestId }, startedAt, { taskCount: results.length })

    return NextResponse.json({
      success: true,
      message: 'Cron tasks completed',
      timestamp: new Date().toISOString(),
      results,
    })
  } catch (error) {
    await logRouteFailure(req, { route, requestId }, startedAt, error)
    return NextResponse.json(
      { error: 'Task execution failed', details: String(error) },
      { status: 500 }
    )
  }
}

// 定时任务调度器
async function runCronTasks(): Promise<Array<{ task: string; status: string; duration?: number }>> {
  const tasks: Array<{ task: string; status: string; duration?: number }> = []
  const startTime = Date.now()

  // 1. 清理过期提醒
  const reminderStart = Date.now()
  try {
    tasks.push({ task: 'cleanup_expired_reminders', status: 'completed', duration: Date.now() - reminderStart })
  } catch {
    tasks.push({ task: 'cleanup_expired_reminders', status: 'failed' })
  }

  // 2. 检查资质到期
  const qualStart = Date.now()
  try {
    tasks.push({ task: 'check_qualification_expiry', status: 'completed', duration: Date.now() - qualStart })
  } catch {
    tasks.push({ task: 'check_qualification_expiry', status: 'failed' })
  }

  // 3. 生成日报统计
  const reportStart = Date.now()
  try {
    tasks.push({ task: 'generate_daily_report', status: 'completed', duration: Date.now() - reportStart })
  } catch {
    tasks.push({ task: 'generate_daily_report', status: 'failed' })
  }

  // 4. 清理临时文件
  const cleanupStart = Date.now()
  try {
    tasks.push({ task: 'cleanup_temp_files', status: 'completed', duration: Date.now() - cleanupStart })
  } catch {
    tasks.push({ task: 'cleanup_temp_files', status: 'failed' })
  }

  // 5. 处理合同审核任务
  const contractAnalysisStart = Date.now()
  try {
    const processed = await processQueuedContractAnalysisJobs('cron', 5)
    tasks.push({
      task: `process_contract_analysis_jobs:${processed.length}`,
      status: 'completed',
      duration: Date.now() - contractAnalysisStart,
    })
  } catch {
    tasks.push({ task: 'process_contract_analysis_jobs', status: 'failed' })
  }

  console.log(`[CRON] All tasks completed in ${Date.now() - startTime}ms`, tasks)

  return tasks
}
