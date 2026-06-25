// REQ:F005 + AI Streaming with multi-level fault tolerance
// PURPOSE: Stream AI contract review with multi-level failover

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { reviewWithFailover } from '@/lib/ai/failover'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { UserProfileMemory } from '@/lib/memory/user-profile'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/ai-review'
  let contractId = ''

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    contractId = await resolveIdParam(params)
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId },
    })

    // 加载用户画像（影响路由策略）
    const userProfile = new UserProfileMemory(user.id)
    const profile = await userProfile.loadProfile()

    // 记录本次AI审核行为（更新画像）
    await userProfile.recordAction('ai_review', { contractId })

    // Fetch contract with owner verification
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('id, filename, parsed_text, created_by')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (error || !contract) {
      return NextResponse.json(
        { error: 'Contract not found or access denied' },
        { status: 404 }
      )
    }

    const contractText = contract.parsed_text || 'No text available for review'

    // 多级故障转移：本地 → 云端 → 规则引擎 → 人工标记
    // 高风险敏感度用户直接走云端（更严格审核）
    const preferredProvider = profile?.riskSensitivity && profile.riskSensitivity > 0.7
      ? 'sales_cloud_backup'
      : undefined
    const { stream, provider, degraded } = await reviewWithFailover(contractText, {
      orgId,
      preferredProvider,
    })

    // 添加响应头标识降级状态和用户画像信息
    const headers = new Headers()
    headers.set('X-AI-Provider', provider)
    headers.set('X-AI-Degraded', degraded ? 'true' : 'false')
    headers.set('X-User-Risk-Sensitivity', String(profile?.riskSensitivity || 0.5))

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId, riskSensitivity: profile?.riskSensitivity },
      },
      startedAt,
      {
        provider,
        degraded,
      }
    )

    return new NextResponse(stream, {
      headers,
      status: 200,
    })

  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    await logRouteFailure(
      req,
      {
        route,
        requestId,
        details: { contractId },
      },
      startedAt,
      error
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI review failed' },
      { status: 500 }
    )
  }
}
