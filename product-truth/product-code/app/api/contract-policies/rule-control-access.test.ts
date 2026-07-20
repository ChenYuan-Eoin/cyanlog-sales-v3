import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Access = 'read' | 'write' | 'publish'

const routeContracts: Array<{
  path: string
  access: Access
  minimumChecks: number
}> = [
  { path: 'rule-categories/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rule-categories/route.ts', access: 'write', minimumChecks: 1 },
  { path: 'rule-categories/[id]/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rule-categories/[id]/route.ts', access: 'write', minimumChecks: 2 },
  { path: 'rule-sets/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rule-sets/route.ts', access: 'write', minimumChecks: 1 },
  { path: 'rule-sets/[id]/documents/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rule-sets/[id]/documents/route.ts', access: 'write', minimumChecks: 1 },
  { path: 'rule-sets/[id]/publish/route.ts', access: 'publish', minimumChecks: 1 },
  { path: 'rules/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rules/route.ts', access: 'write', minimumChecks: 1 },
  { path: 'rules/[id]/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rules/[id]/route.ts', access: 'write', minimumChecks: 2 },
  { path: 'rules/[id]/translate/route.ts', access: 'write', minimumChecks: 1 },
  { path: 'rules/[id]/versions/route.ts', access: 'read', minimumChecks: 1 },
  { path: 'rules/[id]/versions/[versionId]/publish/route.ts', access: 'publish', minimumChecks: 1 },
  { path: 'rules/[id]/versions/[versionId]/rollback/route.ts', access: 'publish', minimumChecks: 1 },
  { path: '../rules/test/route.ts', access: 'write', minimumChecks: 1 },
]

function source(path: string) {
  return readFileSync(join(process.cwd(), 'app/api/contract-policies', path), 'utf8')
}

describe('rule configuration route access contract', () => {
  it.each(routeContracts)(
    '$path requires fresh config:$access',
    ({ path, access, minimumChecks }) => {
      const content = source(path)
      const check = `userHasFreshOrgConfigAccess(user.id, orgId, '${access}')`

      expect(content).toContain("from '@/lib/configs/access'")
      expect(content.split(check)).toHaveLength(minimumChecks + 1)
      expect(content).toContain(`config:${access} 权限`)
    }
  )
})
