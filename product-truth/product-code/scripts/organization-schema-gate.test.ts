// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogHash, migrationHashes, sha256, verifySnapshot } from './organization-schema-gate.mjs'

const baseline = JSON.parse(readFileSync('lib/organization-connections/schema-baseline/production.json', 'utf8'))
const head = 'a'.repeat(40)
function snapshot() {
  return {
    ...structuredClone(baseline), candidateSha: head, capturedAt: new Date().toISOString(),
    captureQuerySha256: sha256(readFileSync('lib/organization-connections/schema-baseline/capture.sql')),
    migrations: migrationHashes(),
  }
}

describe('organization release schema drift gate', () => {
  it('accepts a fresh exact candidate export and ignores only grant ordering', () => {
    const live = snapshot()
    live.catalog.tables[0].grants.reverse()
    expect(catalogHash(live.catalog)).toBe(catalogHash(baseline.catalog))
    expect(verifySnapshot(live, { head, baseline })).toMatchObject({ status: 'passed', candidateSha: head })
  })
  it.each(['project', 'candidate', 'stale', 'query', 'migration'])('rejects invalid provenance: %s', field => {
    const live = snapshot()
    if (field === 'project') live.projectId = 'another-project'
    if (field === 'candidate') live.candidateSha = 'b'.repeat(40)
    if (field === 'stale') live.capturedAt = '2000-01-01T00:00:00Z'
    if (field === 'query') live.captureQuerySha256 = 'b'.repeat(64)
    if (field === 'migration') live.migrations[Object.keys(live.migrations)[0]] = 'b'.repeat(64)
    expect(() => verifySnapshot(live, { head, baseline })).toThrow()
  })
  it.each(['constraint', 'default', 'trigger', 'grant', 'server'])('blocks production drift in %s', field => {
    const live = snapshot()
    if (field === 'constraint') live.catalog.tables.find((t: { name: string }) => t.name === 'user_organizations').columns.find((c: { name: string }) => c.name === 'membership_id').notNull = false
    if (field === 'default') live.catalog.tables.find((t: { name: string }) => t.name === 'user_organizations').columns.find((c: { name: string }) => c.name === 'membership_id').default = 'gen_random_uuid()'
    if (field === 'trigger') live.catalog.functions.find((f: { name: string }) => f.name === 'update_department_path').definition += '\n-- changed'
    if (field === 'grant') live.catalog.tables[0].grants.pop()
    if (field === 'server') live.catalog.serverVersion = '18.3'
    expect(() => verifySnapshot(live, { head, baseline })).toThrow('Production DDL drift')
  })
})
