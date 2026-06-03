// 测试 lib/approval/workflow.ts
// 重点：getApprovalLevel 纯函数 + 错误处理
// 集成路径：createApprovalWorkflow / processApproval 通过 mock supabase 测试

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getApprovalLevel, createApprovalWorkflow, processApproval } from './workflow'

describe('Approval Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getApprovalLevel - 纯函数', () => {
    it('折扣 0% → 1 级审批（销售经理）', () => {
      expect(getApprovalLevel(0)).toBe(1)
    })

    it('折扣 3% → 1 级审批', () => {
      expect(getApprovalLevel(3)).toBe(1)
    })

    it('折扣 5% → 1 级审批（边界）', () => {
      expect(getApprovalLevel(5)).toBe(1)
    })

    it('折扣 5.01% → 2 级审批（区域总监）', () => {
      expect(getApprovalLevel(5.01)).toBe(2)
    })

    it('折扣 7% → 2 级审批', () => {
      expect(getApprovalLevel(7)).toBe(2)
    })

    it('折扣 10% → 2 级审批（边界）', () => {
      expect(getApprovalLevel(10)).toBe(2)
    })

    it('折扣 10.5% → 3 级审批（总经理）', () => {
      expect(getApprovalLevel(10.5)).toBe(3)
    })

    it('折扣 50% → 3 级审批（最高）', () => {
      expect(getApprovalLevel(50)).toBe(3)
    })

    it('折扣 100% → 3 级审批（极端）', () => {
      expect(getApprovalLevel(100)).toBe(3)
    })
  })

  describe('createApprovalWorkflow', () => {
    it('折扣 < 5% 时创建 1 个审批记录', async () => {
      const mockChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'a1', quote_id: 'q1', level: 1, status: 'pending' },
          error: null,
        }),
      }
      ;(supabaseAdmin.from as any).mockReturnValue(mockChain)

      const approvals = await createApprovalWorkflow('q1', 3)
      expect(approvals).toHaveLength(1)
      expect(approvals[0].level).toBe(1)
    })

    it('折扣 7% 时创建 2 个审批记录（1 pending + 1 waiting）', async () => {
      const mockChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValueOnce({
            data: { id: 'a1', level: 1, status: 'pending' },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'a2', level: 2, status: 'waiting' },
            error: null,
          }),
      }
      ;(supabaseAdmin.from as any).mockReturnValue(mockChain)

      const approvals = await createApprovalWorkflow('q1', 7)
      expect(approvals).toHaveLength(2)
      expect(approvals[0].status).toBe('pending')
      expect(approvals[1].status).toBe('waiting')
    })

    it('折扣 20% 时创建 3 个审批记录', async () => {
      const mockChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'a', level: 1, status: 'pending' },
          error: null,
        }),
      }
      ;(supabaseAdmin.from as any).mockReturnValue(mockChain)

      const approvals = await createApprovalWorkflow('q1', 20)
      expect(approvals).toHaveLength(3)
    })

    it('数据库错误时不抛异常，返回部分结果', async () => {
      const mockChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValueOnce({ data: null, error: { message: 'DB error' } })
          .mockResolvedValueOnce({
            data: { id: 'a2', level: 2, status: 'waiting' },
            error: null,
          }),
      }
      ;(supabaseAdmin.from as any).mockReturnValue(mockChain)

      const approvals = await createApprovalWorkflow('q1', 7)
      expect(approvals).toHaveLength(1) // 第一条失败被跳过
    })
  })

  describe('processApproval - 拒绝', () => {
    it('拒绝时更新 quote 状态为 REJECTED', async () => {
      const fetchChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'a1', quote_id: 'q1', level: 1, status: 'pending' },
          error: null,
        }),
      }
      // updateChain.eq 第一次返回 chain 自身，第二次返回 resolved value
      // 用 mockImplementation 根据调用次数控制
      let updateEqCount = 0
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        get eq() {
          updateEqCount++
          if (updateEqCount === 1) {
            return vi.fn().mockReturnThis()
          }
          return vi.fn().mockResolvedValue({ error: null })
        },
      } as any

      // 第一次：fetch 审批；第二次：update；第三次：update quote
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        })

      const result = await processApproval('a1', 'reject', 'u1', '不通过')
      expect(result.success).toBe(true)
      expect(result.nextLevel).toBeUndefined()
    })
  })

  describe('processApproval - 异常情况', () => {
    it('审批记录不存在时返回错误', async () => {
      const fetchChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      }
      ;(supabaseAdmin.from as any).mockReturnValue(fetchChain)

      const result = await processApproval('a1', 'approve', 'u1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('审批记录不存在')
    })

    it('审批已处理时返回错误', async () => {
      const fetchChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'a1', status: 'approved' },
          error: null,
        }),
      }
      ;(supabaseAdmin.from as any).mockReturnValue(fetchChain)

      const result = await processApproval('a1', 'approve', 'u1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('该审批已处理')
    })
  })
})
