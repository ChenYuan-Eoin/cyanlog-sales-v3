import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PERMISSION_DEFINITIONS,
  buildPermissionCatalog,
  permissionDefinitionIsValid,
} from './permission-catalog'

describe('permission catalog', () => {
  it('keeps one canonical definition per executable family key', () => {
    const keys = BUILTIN_PERMISSION_DEFINITIONS.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual(expect.arrayContaining([
      'role:manage',
      'user:view',
      'contract:review',
      'shipping:operate',
    ]))
    expect(keys.every((key) => key === '*' || /^[a-z][a-z0-9_-]*:(?:[a-z][a-z0-9_-]*|\*)$/.test(key))).toBe(true)
  })

  it('ships only atomic permissions as tenant-facing items and separates unavailable drafts', () => {
    const published = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS)
    const all = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS, { includeUnavailable: true })
    const publishedKeys = published.flatMap((group) => group.items.map((item) => item.key))
    const allKeys = all.flatMap((group) => group.items.map((item) => item.key))

    expect(publishedKeys).toContain('config:read')
    expect(publishedKeys).not.toContain('report:finance')
    expect(publishedKeys).not.toContain('config:*')
    expect(allKeys).toContain('report:finance')
    expect(all.flatMap((group) => group.items).find((item) => item.key === 'report:finance'))
      .toMatchObject({ selectable: false, unavailableReason: expect.stringContaining('尚未接入') })
  })

  it('classifies actual actions independently of assignment scope and keeps unmapped rows readable', () => {
    const items = buildPermissionCatalog(BUILTIN_PERMISSION_DEFINITIONS, { includeUnavailable: true })
      .flatMap(group => group.items)
    const byKey = new Map(items.map(item => [item.key, item]))
    expect(byKey.get('shipping:owner_submit')).toMatchObject({
      moduleKey: 'shipping', capabilityLevel: 'L2', grantSubjectTypes: ['role'], scopeTypes: ['self'],
    })
    expect(byKey.get('shipping:ledger_view')).toMatchObject({
      moduleKey: 'shipping', capabilityLevel: 'L3', grantSubjectTypes: ['role', 'department'],
      scopeTypes: ['org', 'department'],
    })
    expect(byKey.get('shipping:record_return')).toMatchObject({
      moduleKey: 'shipping', capabilityLevel: 'L3', grantSubjectTypes: ['role'], scopeTypes: ['org', 'department'],
    })
    expect(byKey.get('shipping:intake_write')).toMatchObject({
      moduleKey: 'shipping-settings', capabilityLevel: 'L4', grantSubjectTypes: ['role'],
    })
    expect(byKey.get('user:manage_employment')).toMatchObject({
      moduleKey: 'config', capabilityLevel: 'L3', grantSubjectTypes: ['role'],
    })
    expect(byKey.get('org:source_apply')).toMatchObject({
      moduleKey: 'config', capabilityLevel: 'L4', grantSubjectTypes: ['role'],
    })
    expect(byKey.get('role:manage')).toMatchObject({
      moduleKey: 'config', capabilityLevel: 'L4', grantSubjectTypes: [], selectable: false,
    })
    expect(byKey.get('quote:view')).toMatchObject({ moduleKey: null, capabilityLevel: null, grantSubjectTypes: [] })
    expect(items.some(item => item.capabilityLevel === 'L1')).toBe(false)
  })

  it('rejects self, missing and cyclic dependencies before publication', () => {
    const base = BUILTIN_PERMISSION_DEFINITIONS[0]
    expect(permissionDefinitionIsValid({
      ...base,
      key: 'demo:read',
      resource: 'demo',
      action: 'read',
      kind: 'atomic',
      dependencies: ['demo:write'],
    }, [
      { ...base, key: 'demo:read', resource: 'demo', action: 'read', kind: 'atomic', dependencies: ['demo:write'] },
      { ...base, key: 'demo:write', resource: 'demo', action: 'write', kind: 'atomic', dependencies: ['demo:read'] },
    ])).toContain('权限依赖存在循环。')

    expect(permissionDefinitionIsValid({
      ...base,
      key: 'demo:read',
      resource: 'demo',
      action: 'read',
      kind: 'atomic',
      dependencies: ['missing:read'],
    }, BUILTIN_PERMISSION_DEFINITIONS)).toContain('依赖权限不可用：missing:read')

    expect(permissionDefinitionIsValid({
      ...base,
      key: 'demo:read',
      resource: 'demo',
      action: 'read',
      kind: 'atomic',
      dependencies: ['demo:read'],
    }, [])).toContain('权限不能依赖自身。')
  })
})
