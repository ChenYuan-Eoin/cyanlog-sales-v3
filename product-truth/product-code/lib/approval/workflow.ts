// REQ: F004/F043
// PURPOSE: Approval workflow engine
// F043：审批规则/链/节点全配置化——传入已发布配置时按规则解析，否则回退原三级默认（兼容旧调用）
import { supabaseAdmin } from '@/lib/supabase'
import {
  resolveApprovalRule,
  resolveApprovalPath,
  assertNoPersonNames,
  type QuoteApprovalContext,
} from './approval-resolver'
import type { ApprovalRuleValue, ApprovalChainValue, ApprovalNodeValue } from '@/lib/config-center/validation'

export interface ApprovalConfig {
  level: number
  maxDiscount: number
  approverRole: string
}

export interface ApprovalRecord {
  id: string
  quoteId: string
  level: number
  approverId: string | null
  status: 'pending' | 'approved' | 'rejected'
  comment: string | null
  createdAt: string
  completedAt: string | null
}

export interface ApprovalWorkflowOptions {
  scene?: QuoteApprovalContext['scene']
  rules?: ApprovalRuleValue[]
  chains?: ApprovalChainValue[]
  nodesByChain?: Record<string, ApprovalNodeValue[]>
}

// Default approval configuration（仅作无配置时的兜底，F043 后应被已发布规则取代）
const defaultConfigs: ApprovalConfig[] = [
  { level: 1, maxDiscount: 5, approverRole: '销售经理' },
  { level: 2, maxDiscount: 10, approverRole: '区域总监' },
  { level: 3, maxDiscount: 100, approverRole: '总经理' },
]

/** 纯函数：把解析出的审批路径映射为写库用的级别行（level/approverRole/status） */
export function buildApprovalLevels(
  nodes: ApprovalNodeValue[]
): Array<{ level: number; approverRole: string; status: 'pending' | 'waiting' }> {
  return nodes.map((node, index) => ({
    level: index + 1,
    approverRole: node.assignee_value,
    status: index === 0 ? 'pending' : 'waiting',
  }))
}

/** 折扣深度归一化：兼容小数（0-1）与百分数（0-100）两种入参 */
export function normalizeDiscountPercent(discountRate: number): number {
  return discountRate <= 1 ? discountRate * 100 : discountRate
}

/** 匹配审批规则（无规则命中返回 null，调用方走兜底） */
export function resolveApprovalForQuote(
  discountRate: number,
  options: ApprovalWorkflowOptions = {}
): { ruleCode: string | null; levels: Array<{ level: number; approverRole: string; status: 'pending' | 'waiting' }> } {
  if (!options.rules || options.rules.length === 0) {
    return { ruleCode: null, levels: [] }
  }
  const ctx: QuoteApprovalContext = {
    scene: options.scene ?? 'QUOTE_DISCOUNT',
    discountPercent: normalizeDiscountPercent(discountRate),
  }
  const rule = resolveApprovalRule(options.rules, ctx)
  const path = resolveApprovalPath(options.chains || [], options.nodesByChain || {}, rule)
  const problems = assertNoPersonNames(path.nodes)
  if (problems.length > 0) {
    console.error('[F043] 审批节点包含人名，拒绝使用：', problems)
    return { ruleCode: null, levels: [] }
  }
  return { ruleCode: path.matchedBy, levels: buildApprovalLevels(path.nodes) }
}

// Determine approval level based on discount rate（兼容旧调用；F043 建议传 options）
export function getApprovalLevel(discountRate: number, options?: ApprovalWorkflowOptions): number {
  const resolved = resolveApprovalForQuote(discountRate, options)
  if (resolved.levels.length > 0) {
    return resolved.levels.length
  }
  const percent = normalizeDiscountPercent(discountRate)
  for (const config of defaultConfigs) {
    if (percent <= config.maxDiscount) {
      return config.level
    }
  }
  return 3 // Default to highest level
}

// Create approval workflow for a quote
export async function createApprovalWorkflow(
  quoteId: string,
  discountRate: number,
  options: ApprovalWorkflowOptions = {}
): Promise<ApprovalRecord[]> {
  const levels = resolveApprovalForQuote(discountRate, options).levels
  const finalLevels = levels.length > 0
    ? levels
    : defaultConfigs.map((config, index) => ({
        level: config.level,
        approverRole: config.approverRole,
        status: (index === 0 ? 'pending' : 'waiting') as 'pending' | 'waiting',
      }))

  const approvals: ApprovalRecord[] = []
  for (const levelConfig of finalLevels) {
    const { data, error } = await supabaseAdmin
      .from('approvals')
      .insert({
        quote_id: quoteId,
        level: levelConfig.level,
        status: levelConfig.status,
        approver_role: levelConfig.approverRole,
      })
      .select()
      .single()

    if (error) {
      console.error(`Failed to create approval level ${levelConfig.level}:`, error)
      continue
    }

    approvals.push(data)
  }

  return approvals
}

// Process approval action（复用现有 approvals 表，未改动）
export async function processApproval(
  approvalId: string,
  action: 'approve' | 'reject',
  approverId: string,
  comment?: string
): Promise<{ success: boolean; nextLevel?: number; error?: string }> {
  const { data: approval, error: fetchError } = await supabaseAdmin
    .from('approvals')
    .select('*')
    .eq('id', approvalId)
    .single()

  if (fetchError || !approval) {
    return { success: false, error: '审批记录不存在' }
  }

  if (approval.status !== 'pending') {
    return { success: false, error: '该审批已处理' }
  }

  const { error: updateError } = await supabaseAdmin
    .from('approvals')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      approver_id: approverId,
      comment: comment || null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', approvalId)

  if (updateError) {
    return { success: false, error: '更新审批记录失败' }
  }

  if (action === 'reject') {
    await supabaseAdmin
      .from('quotes')
      .update({ status: 'REJECTED' })
      .eq('id', approval.quote_id)

    return { success: true }
  }

  const { data: nextApproval } = await supabaseAdmin
    .from('approvals')
    .select('*')
    .eq('quote_id', approval.quote_id)
    .eq('status', 'waiting')
    .order('level', { ascending: true })
    .limit(1)
    .single()

  if (nextApproval) {
    await supabaseAdmin
      .from('approvals')
      .update({ status: 'pending' })
      .eq('id', nextApproval.id)

    return { success: true, nextLevel: nextApproval.level }
  }

  await supabaseAdmin
    .from('quotes')
    .update({ status: 'APPROVED' })
    .eq('id', approval.quote_id)

  return { success: true }
}

// Get approval history for a quote（未改动）
export async function getApprovalHistory(quoteId: string): Promise<ApprovalRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('approvals')
    .select('*, approver:approver_id(display_name)')
    .eq('quote_id', quoteId)
    .order('level', { ascending: true })

  if (error) {
    console.error('Failed to get approval history:', error)
    return []
  }

  return data || []
}

// ────────────────────────────────────────────────────────────────
// F043 配置读取：从配置中心加载已发布审批规则/链/节点
// ────────────────────────────────────────────────────────────────
export interface PublishedApprovalConfig {
  rules: ApprovalRuleValue[]
  chains: ApprovalChainValue[]
  nodesByChain: Record<string, ApprovalNodeValue[]>
}

export async function loadPublishedApprovalConfig(orgId: string): Promise<PublishedApprovalConfig | null> {
  const [rulesRes, chainsRes] = await Promise.all([
    supabaseAdmin.from('approval_rules').select('*').eq('org_id', orgId).eq('status', 'PUBLISHED').eq('enabled', true),
    supabaseAdmin.from('approval_chains').select('*').eq('org_id', orgId).eq('status', 'PUBLISHED'),
  ])

  if (rulesRes.error || chainsRes.error || !chainsRes.data) {
    return null
  }

  const chains = chainsRes.data
  const chainById = new Map(chains.map((c) => [c.id, c]))
  let nodesRes: { data: Array<Record<string, unknown>> | null } = { data: [] }
  if (chains.length > 0) {
    const res = await supabaseAdmin
      .from('approval_chain_nodes')
      .select('*')
      .in('chain_id', chains.map((c) => c.id))
      .order('ord', { ascending: true })
    nodesRes = { data: (res.data ?? []) as Array<Record<string, unknown>> }
  }

  const nodesByChain: Record<string, ApprovalNodeValue[]> = {}
  for (const node of nodesRes.data ?? []) {
    const chain = chainById.get(String(node.chain_id))
    if (!chain) continue
    const code = String(chain.code)
    nodesByChain[code] = [
      ...(nodesByChain[code] || []),
      {
        ord: Number(node.ord),
        assignee_type: node.assignee_type as ApprovalNodeValue['assignee_type'],
        assignee_value: String(node.assignee_value),
        condition: (node.condition ?? {}) as Record<string, unknown>,
        skip_on_unchanged: node.skip_on_unchanged !== false,
        timeout_hours: typeof node.timeout_hours === 'number' ? node.timeout_hours : undefined,
        escalation: (node.escalation ?? {}) as Record<string, unknown>,
      },
    ]
  }

  const rules: ApprovalRuleValue[] = (rulesRes.data ?? []).map((r) => ({
    code: String(r.code),
    scene: r.scene as ApprovalRuleValue['scene'],
    condition: (r.condition ?? {}) as Record<string, unknown>,
    chain_code: chainById.get(String(r.chain_id))?.code ? String(chainById.get(String(r.chain_id))?.code) : '',
    priority: Number(r.priority ?? 10),
    enabled: r.enabled !== false,
  })).filter((r) => r.chain_code !== '')

  return {
    rules,
    chains: chains.map((c) => ({ code: String(c.code), name: String(c.name), mode: c.mode as 'serial' | 'parallel', quorum: c.quorum as 'all' | 'any' })),
    nodesByChain,
  }
}
