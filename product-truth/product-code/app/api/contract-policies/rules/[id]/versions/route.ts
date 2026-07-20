// GET /api/contract-policies/rules/:id/versions
// 规则版本历史 API。发布与回退只能由完整规则集完成；单条规则版本
// 只展示不可变历史，并通过 RuleSet.current_snapshot_id 标识当前成员。

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'

// GET - 获取规则的版本历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

    const { id } = await params

    // 获取规则基本信息
    const { data: rule, error: ruleError } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (ruleError || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    // 获取版本历史
    const { data: versions, error: versionsError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('*')
      .eq('rule_id', id)
      .order('version', { ascending: false })

    if (versionsError) {
      return errorResponse(createApiError('DB_ERROR', '获取版本历史失败'))
    }

    let currentRuleSnapshotIds = new Set<string>()
    let currentRuleSetSnapshotId: string | null = null
    let currentBindingState: 'bound' | 'unpublished' | 'missing' | 'invalid' = 'unpublished'

    if (rule.rule_set_id) {
      const { data: ruleSet, error: ruleSetError } = await supabaseAdmin
        .from('contract_rule_sets')
        .select('id, current_snapshot_id, published_at')
        .eq('id', rule.rule_set_id)
        .eq('org_id', orgId)
        .single()

      if (ruleSetError || !ruleSet) {
        currentBindingState = 'invalid'
      } else {
        currentRuleSetSnapshotId = ruleSet.current_snapshot_id || null
      }
      if (ruleSet && currentRuleSetSnapshotId) {
        const { data: currentSnapshot } = await supabaseAdmin
          .from('contract_rule_set_snapshots')
          .select('id, org_id, rule_set_id, status, rule_snapshot_ids')
          .eq('id', currentRuleSetSnapshotId)
          .eq('org_id', orgId)
          .eq('rule_set_id', rule.rule_set_id)
          .eq('status', 'published')
          .single()

        if (currentSnapshot && Array.isArray(currentSnapshot.rule_snapshot_ids)) {
          currentRuleSnapshotIds = new Set(
            currentSnapshot.rule_snapshot_ids.filter((snapshotId: unknown): snapshotId is string => (
              typeof snapshotId === 'string' && snapshotId.length > 0
            ))
          )
          currentBindingState = 'bound'
        } else {
          currentBindingState = 'invalid'
        }
      } else if (ruleSet?.published_at && currentBindingState !== 'invalid') {
        currentBindingState = 'missing'
      }
    }

    const snapshots = versions && versions.length > 0
      ? versions
      : [{
          id: `current-${rule.id}`,
          rule_id: rule.id,
          version: rule.version || 1,
          config_snapshot: rule,
          released_by: rule.published_by || null,
          released_at: rule.published_at || rule.updated_at,
          release_note: rule.lifecycle_status === 'published' ? '缺少不可变历史快照的兼容记录' : '当前草稿版本',
          is_gray_release: false,
          gray_end_at: null,
          status: rule.lifecycle_status === 'published' ? 'published' : 'draft',
          created_at: rule.created_at,
        }]

    return successResponse({
      rule,
      current_rule_set_snapshot_id: currentRuleSetSnapshotId,
      current_binding_state: currentBindingState,
      versions: snapshots.map((v) => ({
        ...v,
        is_current: currentRuleSnapshotIds.has(v.id),
        impact_report: null,
      })),
    })
  })
}
