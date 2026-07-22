import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  resolve(process.cwd(), 'app/api/contracts/[id]/compare/route.ts'),
  'utf8',
)

function sourceIndex(fragment: string) {
  const index = routeSource.indexOf(fragment)
  expect(index, `missing route contract fragment: ${fragment}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('G6 comparison route contract', () => {
  it('scopes contract and comparison reads to the organization and only exposes v1 snapshots', () => {
    expect(routeSource.match(/\.eq\('org_id', orgId\)/g)?.length).toBeGreaterThanOrEqual(3)
    expect(routeSource).toContain(".from('contracts')")
    expect(routeSource).toContain(".from('contract_comparisons')")
    expect(routeSource).toContain(".eq('source_snapshot_version', 1)")
    expect(routeSource).toContain("loadFrozenComparisonSource(comparisonId, 'old', orgId)")
    expect(routeSource).toContain("loadFrozenComparisonSource(comparisonId, 'new', orgId)")

    const latestRead = sourceIndex(".eq('source_snapshot_version', 1)")
    expect(sourceIndex(".eq('org_id', orgId)\n      .eq('source_snapshot_version', 1)")).toBeLessThanOrEqual(latestRead)
  })

  it('creates old/new frozen sources and bilateral source positions through the atomic v1 RPC', () => {
    expect(routeSource).toContain("supabaseAdmin.rpc('create_contract_comparison_v1', {")

    const rpcStart = sourceIndex("supabaseAdmin.rpc('create_contract_comparison_v1', {")
    const rpcEnd = sourceIndex("if (createResult.error || typeof createResult.data !== 'string')")
    const rpcCall = routeSource.slice(rpcStart, rpcEnd)

    expect(rpcCall).toContain('p_org_id: orgId')
    expect(rpcCall).toContain('p_old_source: oldSource')
    expect(rpcCall).toContain('p_new_source: newSource')
    expect(rpcCall).toContain('p_diffs: diffRows')
    expect(routeSource).toContain('baseline_position: positionInPageMap({')
    expect(routeSource).toContain('compare_position: positionInPageMap({')
    expect(routeSource).toContain('page: page.page')
    expect(routeSource).toContain('start_offset_utf16: position.start_offset_utf16')
    expect(routeSource).toContain('end_offset_utf16: position.end_offset_utf16')
  })

  it('fails closed instead of returning a completed-looking success without complete evidence', () => {
    const rpcFailure = sourceIndex("if (createResult.error || typeof createResult.data !== 'string')")
    const payloadRead = sourceIndex('payload = await comparisonPayload(comparisonId, orgId)')
    const success = sourceIndex('return createdResponse(payload)')

    expect(rpcFailure).toBeLessThan(payloadRead)
    expect(payloadRead).toBeLessThan(success)
    expect(routeSource.slice(rpcFailure, payloadRead)).toContain("creationError?.stage === 'rpc' ? 'DB_ERROR' : 'INTERNAL_ERROR'")
    expect(routeSource.slice(payloadRead, success)).toContain("'CONFLICT'")

    const unreadableStart = sourceIndex('if (!readable) {')
    const unreadableEnd = payloadRead
    const unreadableBranch = routeSource.slice(unreadableStart, unreadableEnd)
    expect(unreadableBranch).toContain("status: 'failed'")
    expect(unreadableBranch).toContain('degraded: true')
    expect(unreadableBranch).not.toContain("status: 'completed'")
  })

  it('routes every post-materialization failure through verified unreferenced cleanup', () => {
    expect(routeSource).toContain('result.reason instanceof FrozenSourceMaterializationError')
    expect(routeSource).toContain('? [result.reason.storagePath]')
    expect(routeSource).toContain('cleanupUnreferencedFrozenSources(candidateCopies)')
    expect(routeSource).toContain("throw new ComparisonCreationError('冻结原文差异定位失败', 'diff', error)")
    expect(routeSource).toContain("throw new ComparisonCreationError('创建不可变文档比对失败', 'rpc', error)")

    const postMaterializeTry = sourceIndex('let readable = false')
    const postMaterializeCleanup = sourceIndex('const cleanup = await cleanupUnreferencedFrozenSources([\n        oldSource.storage_path')
    const payloadRead = sourceIndex('payload = await comparisonPayload(comparisonId, orgId)')
    expect(postMaterializeTry).toBeLessThan(postMaterializeCleanup)
    expect(postMaterializeCleanup).toBeLessThan(payloadRead)
    expect(routeSource).not.toContain("storage.from('contracts').remove")
  })

  it('returns a recoverable comparison_id when the RPC committed but payload readback fails', () => {
    const payloadRead = sourceIndex('payload = await comparisonPayload(comparisonId, orgId)')
    const success = sourceIndex('return createdResponse(payload)')
    const payloadFailure = routeSource.slice(payloadRead, success)

    expect(payloadFailure.match(/comparison_id: comparisonId/g)?.length).toBe(2)
    expect(payloadFailure.match(/createApiError\(\n\s*'CONFLICT'/g)?.length).toBe(2)
    expect(payloadFailure.match(/, 409\)/g)?.length).toBe(2)
  })
})
