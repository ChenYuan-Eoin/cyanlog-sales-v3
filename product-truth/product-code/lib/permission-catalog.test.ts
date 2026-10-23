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
