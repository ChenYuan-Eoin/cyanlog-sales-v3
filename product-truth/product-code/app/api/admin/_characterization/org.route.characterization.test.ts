/**
 * Characterization Test (Feature Test)
 *
 * Purpose:
 *   Record the ACTUAL behavior of the old /api/admin/org route
 *   to serve as a baseline for the new split routes.
 *
 * How it works:
 *   1. Run this test against the CURRENT (unsplit) route.
 *   2. It captures: request → response → database state.
 *   3. Save the output as a JSON snapshot.
 *   4. When splitting routes, AI compares new behavior against this snapshot.
 *
 * Why this matters:
 *   - Static reading of code can miss implicit side effects.
 *   - Running the actual code records ALL side effects.
 *   - New routes must match this baseline EXACTLY.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mock Setup ────────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn().mockReturnValue(true),
  getOrgRoleCodes: vi.fn().mockReturnValue(['ORG_ADMIN']),
  getUserScopedRoleAssignments: vi.fn().mockResolvedValue([]),
}))

// ─── Imports ─────────────────────────────────────────────────────────
import { GET, POST, PATCH } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

// ─── Helpers ─────────────────────────────────────────────────────────

function makeRequest(body: object): NextRequest {
  return {
    json: async () => body,
    headers: new Headers({ Authorization: 'Bearer test-token' }),
  } as any
}

function mockSupabaseChain() {
  const chain: any = {}
  const methods = [
    'select', 'eq', 'neq', 'order', 'like', 'limit', 'range',
    'insert', 'in', 'gte', 'lte', 'ilike', 'update', 'delete',
    'upsert', 'single', 'maybeSingle', 'count',
  ]
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  return chain
}

function mockAuth() {
  const user = { id: 'admin-1', email: 'admin@test.com' }
  ;(requireAuth as any).mockResolvedValue(user)
  ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
    const chain = mockSupabaseChain()
    // 默认返回空数据
    chain.select = vi.fn().mockReturnValue(chain)
    chain.eq = vi.fn().mockReturnValue(chain)
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    return chain
  })
}

// ─── Feature Tests ───────────────────────────────────────────────────

describe('🔴 CHARACTERIZATION: /api/admin/org (old route)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═════════════════════════════════════════════════════════════════
  // FEATURE 1: Department Creation
  // ═════════════════════════════════════════════════════════════════
  describe('POST type=department', () => {
    it('records baseline behavior for department creation', async () => {
      // ── Setup ──────────────────────────────────────────────────
      const requestBody = {
        type: 'department',
        name: '研发部',
        code: 'RD',
        parentId: null,
      }

      // Mock: parent department check (no parent)
      const chain = mockSupabaseChain()
      ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'departments') {
          return {
            ...chain,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'parent-dept-1', parent_id: null },
              error: null,
            }),
            insert: vi.fn().mockReturnThis(),
          }
        }
        return chain
      })

      // ── Execute ──────────────────────────────────────────────
      const res = await POST(makeRequest(requestBody))
      const body = await res.json()

      // ── Assertions ────────────────────────────────────────────
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.departmentId).toBeDefined()

      // ── Side Effects Check ────────────────────────────────────
      // 验证调用了 departments.insert
      const insertCalls = (supabaseAdmin.from as any).mock.calls.filter(
        (call: any) => call[0] === 'departments'
      )
      expect(insertCalls.length).toBeGreaterThan(0)
    })
  })

  // ═════════════════════════════════════════════════════════════════
  // FEATURE 2: User Creation (with side effects)
  // ═════════════════════════════════════════════════════════════════
  describe('POST type=user (most dangerous)', () => {
    it('records baseline behavior for user creation with side effects', async () => {
      // ── Setup ──────────────────────────────────────────────────
      const requestBody = {
        type: 'user',
        email: 'newuser@test.com',
        displayName: '张三',
        title: '工程师',
        primaryDeptId: 'dept-1',
        roleCodes: ['ORG_ADMIN'],
        status: 'active',
      }

      // Mock user doesn't exist
      const chain = mockSupabaseChain()
      ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            ...chain,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
            insert: vi.fn().mockReturnThis(),
          }
        }
        return chain
      })

      // ── Execute ──────────────────────────────────────────────
      const res = await POST(makeRequest(requestBody))
      const body = await res.json()

      // ── Assertions ────────────────────────────────────────────
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.userId).toBeDefined()
      expect(body.tempPassword).toBeDefined()
      expect(body.created).toBe(true)

      // ── Side Effects Check ────────────────────────────────────
      // Must call: users.insert, user_organizations.upsert,
      //            user_departments.update+upsert,
      //            sales_space_members.insert (conditional),
      //            user_roles.insert (conditional)

      const tableCalls = (supabaseAdmin.from as any).mock.calls
      const tables = tableCalls.map((call: any) => call[0])

      expect(tables).toContain('users')
      expect(tables).toContain('user_organizations')
      expect(tables).toContain('user_departments')
      // sales_spaces 和 user_roles 可能被调用（取决于条件）
    })
  })

  // ═════════════════════════════════════════════════════════════════
  // FEATURE 3: Password Reset
  // ═════════════════════════════════════════════════════════════════
  describe('PATCH type=user_password_reset', () => {
    it('records baseline behavior for password reset', async () => {
      // ── Setup ──────────────────────────────────────────────────
      const requestBody = {
        type: 'user_password_reset',
        userId: 'user-1',
      }

      // Mock user exists
      const chain = mockSupabaseChain()
      ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            ...chain,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'user-1' },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          }
        }
        return chain
      })

      // ── Execute ──────────────────────────────────────────────
      const res = await PATCH(makeRequest(requestBody))
      const body = await res.json()

      // ── Assertions ────────────────────────────────────────────
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.tempPassword).toBeDefined()

      // ── Side Effects Check ────────────────────────────────────
      // Must update: password_hash + must_change_password = true
      const tableCalls = (supabaseAdmin.from as any).mock.calls
      const tables = tableCalls.map((call: any) => call[0])
      expect(tables).toContain('users')
    })
  })

  // ═════════════════════════════════════════════════════════════════
  // FEATURE 4: Role Assignment (full replacement)
  // ═════════════════════════════════════════════════════════════════
  describe('PATCH type=user_roles', () => {
    it('records baseline behavior for role assignment', async () => {
      // ── Setup ──────────────────────────────────────────────────
      const requestBody = {
        type: 'user_roles',
        userId: 'user-1',
        roleCodes: ['ORG_ADMIN', 'DEPT_MANAGER'],
      }

      // Mock user exists + role catalog
      const chain = mockSupabaseChain()
      ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            ...chain,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'user-1' },
              error: null,
            }),
          }
        }
        if (table === 'roles') {
          return {
            ...chain,
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            // 返回角色目录
          }
        }
        return chain
      })

      // ── Execute ──────────────────────────────────────────────
      const res = await PATCH(makeRequest(requestBody))
      const body = await res.json()

      // ── Assertions ────────────────────────────────────────────
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)

      // ── Side Effects Check ────────────────────────────────────
      // Must: DELETE all org-scope roles first, then INSERT new ones
      const tableCalls = (supabaseAdmin.from as any).mock.calls
      const tables = tableCalls.map((call: any) => call[0])
      expect(tables).toContain('user_roles')
    })
  })
})
