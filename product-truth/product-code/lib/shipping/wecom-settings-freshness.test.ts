// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseAdmin: createClient('https://wecom-test.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport.fetch },
  }) }
})
vi.mock('./connections', () => ({ encryptShippingSecret: vi.fn(), decryptShippingSecret: vi.fn() }))
vi.mock('./wecom-client', () => ({ inspectWecomApplication: vi.fn(), wecomDirectory: vi.fn() }))
import { readWecomSettings } from './wecom-settings'

let stamp: string
let remembered: string | undefined
let databaseReads: number
beforeEach(() => {
  stamp = '2026-10-12T00:00:00Z'; remembered = undefined; databaseReads = 0
  transport.fetch.mockReset().mockImplementation(async (_url: string, options?: RequestInit) => {
    // The RSC GET memoization persists for a render, including across an RPC.
    const fresh = Boolean(options?.signal)
    if (fresh || remembered === undefined) {
      databaseReads++
      const body = JSON.stringify({ org_id: 'org-a', directory_synced_at: stamp })
      if (!fresh) remembered = body
      return new Response(body, { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(remembered, { headers: { 'Content-Type': 'application/json' } })
  })
})

it('reads the persisted post-sync snapshot instead of the earlier render snapshot', async () => {
  const old = await readWecomSettings('org-a')
  stamp = '2026-10-16T09:54:20Z'
  expect((await readWecomSettings('org-a'))?.directory_synced_at).toBe(old?.directory_synced_at)
  expect((await readWecomSettings('org-a', { fresh: true }))?.directory_synced_at).toBe(stamp)
  expect(databaseReads).toBe(2)
  expect(transport.fetch.mock.calls.at(-1)?.[1]?.signal).toBeInstanceOf(AbortSignal)
})
