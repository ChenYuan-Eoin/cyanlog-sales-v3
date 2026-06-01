// REQ:F004
// PURPOSE: Approval workflow engine - three-level approval process

import { supabaseAdmin } from '@/lib/supabase'

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

// Default approval configuration
const defaultConfigs: ApprovalConfig[] = [
  { level: 1, maxDiscount: 5, approverRole: '销售经理' },
  { level: 2, maxDiscount: 10, approverRole: '区域总监' },
  { level: 3, maxDiscount: 100, approverRole: '总经理' },
]

// Determine approval level based on discount rate
export function getApprovalLevel(discountRate: number): number {
  for (const config of defaultConfigs) {
    if (discountRate <= config.maxDiscount) {
      return config.level
    }
  }
  return 3 // Default to highest level
}

// Create approval workflow for a quote
export async function createApprovalWorkflow(quoteId: string, discountRate: number): Promise<ApprovalRecord[]> {
  const level = getApprovalLevel(discountRate)
  const approvals: ApprovalRecord[] = []

  for (let i = 1; i <= level; i++) {
    const config = defaultConfigs.find(c => c.level === i)
    if (!config) continue

    const { data, error } = await supabaseAdmin
      .from('approvals')
      .insert({
        quote_id: quoteId,
        level: i,
        status: i === 1 ? 'pending' : 'waiting', // First level pending, others waiting
        approver_role: config.approverRole,
      })
      .select()
      .single()

    if (error) {
      console.error(`Failed to create approval level ${i}:`, error)
      continue
    }

    approvals.push(data)
  }

  return approvals
}

// Process approval action
export async function processApproval(
  approvalId: string,
  action: 'approve' | 'reject',
  approverId: string,
  comment?: string
): Promise<{ success: boolean; nextLevel?: number; error?: string }> {
  // Get current approval record
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

  // Update current approval
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

  // If rejected, update quote status
  if (action === 'reject') {
    await supabaseAdmin
      .from('quotes')
      .update({ status: 'REJECTED' })
      .eq('id', approval.quote_id)

    return { success: true }
  }

  // If approved, check if there's next level
  const { data: nextApproval } = await supabaseAdmin
    .from('approvals')
    .select('*')
    .eq('quote_id', approval.quote_id)
    .eq('status', 'waiting')
    .order('level', { ascending: true })
    .limit(1)
    .single()

  if (nextApproval) {
    // Activate next level
    await supabaseAdmin
      .from('approvals')
      .update({ status: 'pending' })
      .eq('id', nextApproval.id)

    return { success: true, nextLevel: nextApproval.level }
  }

  // No more levels, quote fully approved
  await supabaseAdmin
    .from('quotes')
    .update({ status: 'APPROVED' })
    .eq('id', approval.quote_id)

  return { success: true }
}

// Get approval history for a quote
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
