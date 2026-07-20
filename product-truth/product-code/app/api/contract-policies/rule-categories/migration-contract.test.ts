import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260720034604_add_rule_problem_categories_and_contract.sql'
)

describe('rule problem category migration contract', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('keeps legacy rule_contract values NULL and does not create a second SQL adapter', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS rule_contract JSONB;')
    expect(sql).not.toMatch(/rule_contract JSONB NOT NULL/i)
    expect(sql).not.toMatch(/SET\s+rule_contract\s*=/i)
    expect(sql).not.toContain('jsonb_build_array')
  })

  it('allows NULL legacy rows but rejects malformed non-null canonical payloads', () => {
    expect(sql).toMatch(/rule_contract IS NULL\s+OR COALESCE/i)
    expect(sql).toContain("rule_contract ->> 'schema_version' = '1.0'")
    expect(sql).toContain("jsonb_typeof(rule_contract -> 'properties') = 'array'")
    expect(sql).toContain("jsonb_typeof(rule_contract -> 'decisions') = 'array'")
    expect(sql).toContain("IN ('manual_review', 'block')")
  })

  it('still backfills only the business problem category relationship', () => {
    expect(sql).toContain('SET problem_category_id = problem_category.id')
    expect(sql).toContain("WHEN 'R001' THEN 'payment'")
    expect(sql).toContain("WHEN 'R015' THEN 'dispute'")
  })
})
