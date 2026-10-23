import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Supabase migration manifest', () => {
  it('uses one unique numeric version prefix per migration', () => {
    const files = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort()
    const versions = files.map((file) => {
      const match = /^(\d+)_[A-Za-z0-9_]+\.sql$/.exec(file)
      expect(match, `invalid migration filename: ${file}`).not.toBeNull()
      return match![1]
    })
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index)
    expect(duplicates).toEqual([])
  })
})
