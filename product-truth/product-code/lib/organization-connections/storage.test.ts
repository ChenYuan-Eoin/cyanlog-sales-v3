import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import {
  assertDirectoryCutoverStorage,
  detectConnectionStorageMode,
  detectDirectoryCutoverStorage,
  isMissingSchemaObject,
} from './storage'

function result(value: { error: unknown }) {
  mocks.from.mockReturnValueOnce({
    select: vi.fn(() => ({
      limit: vi.fn().mockResolvedValue(value),
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('organization connection storage compatibility', () => {
  it('detects the unified schema and the legacy Fxiaoke-only schema', async () => {
    result({ error: null })
    await expect(detectConnectionStorageMode()).resolves.toBe('unified')

    result({ error: { code: '42703', message: 'column organization_sources.configuration_revision does not exist' } })
    await expect(detectConnectionStorageMode()).resolves.toBe('legacy_fxiaoke_read_only')
  })

  it('does not downgrade transport or permission failures to compatibility mode', async () => {
    result({ error: { code: '42501', message: 'permission denied' } })
    await expect(detectConnectionStorageMode()).rejects.toMatchObject({
      code: 'CONNECTION_STORAGE_UNAVAILABLE',
      status: 503,
    })
  })

  it('requires both the unified source fields and the cutover tables', async () => {
    result({ error: null })
    result({ error: { code: 'PGRST205', message: "Could not find the table 'public.organization_directory_cutover_plans' in the schema cache" } })
    await expect(detectDirectoryCutoverStorage()).resolves.toBe(false)

    result({ error: null })
    result({ error: { code: 'PGRST205', message: "Could not find the table 'public.organization_directory_cutover_plans' in the schema cache" } })
    await expect(assertDirectoryCutoverStorage()).rejects.toMatchObject({
      code: 'DIRECTORY_MIGRATION_REQUIRED',
      status: 409,
    })
  })

  it('recognizes only explicit missing-column or missing-table errors', () => {
    expect(isMissingSchemaObject({ code: '42703' })).toBe(true)
    expect(isMissingSchemaObject({ code: 'PGRST205' })).toBe(true)
    expect(isMissingSchemaObject({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingSchemaObject(null)).toBe(false)
  })
})
