import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721204000_wp04_contract_creation_idempotency.sql'),
  'utf8',
)
const aggregateMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721236000_wp04_contract_creation_aggregate.sql'),
  'utf8',
)
const payloadIdentityMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721242000_wp04_contract_creation_payload_identity.sql'
  ),
  'utf8',
)
const aggregateCanary = readFileSync(
  join(process.cwd(), 'lib/contracts/canaries/wp04-contract-creation-aggregate.sql'),
  'utf8',
)

describe('WP04 contract creation idempotency migration', () => {
  it('scopes an optional browser request identity to organization and requester', () => {
    expect(migration).toContain('add column if not exists client_request_id uuid')
    expect(migration).toContain('on public.contracts(org_id, created_by, client_request_id)')
    expect(migration).toContain('where client_request_id is not null')
  })

  it('serializes a replay and persists the contract head plus frozen quote item set in one RPC', () => {
    expect(aggregateMigration).toContain('create_contract_aggregate_idempotent')
    expect(aggregateMigration).toContain('pg_advisory_xact_lock')
    expect(aggregateMigration).toContain('for update')
    expect(aggregateMigration).toContain('creation_include_quote_items')
    expect(aggregateMigration).toContain('creation_quote_item_ids')
    expect(aggregateMigration).toContain("source_quote.status = 'CONFIRMED'")
    expect(aggregateMigration).toContain('source_quote.org_id = p_org_id')
    expect(aggregateMigration).toContain('insert into public.contracts')
    expect(aggregateMigration).toContain('insert into public.contract_items')
    expect(aggregateMigration).toContain('contract aggregate item set is incomplete')
  })

  it('rejects changed aggregate intent and copies item values only from server-owned quote_items', () => {
    expect(aggregateMigration).toContain(
      'v_contract.quote_id is distinct from v_requested_quote_id'
    )
    expect(aggregateMigration).toContain(
      'v_contract.creation_include_quote_items is distinct from v_copy_quote_items'
    )
    expect(aggregateMigration).toContain('from public.quote_items as source_item')
    expect(aggregateMigration).not.toContain("v_item ->> 'name'")
    expect(aggregateMigration).not.toContain('p_items jsonb')
  })

  it('keeps the RPC service-only and runs with caller privileges', () => {
    expect(aggregateMigration).toContain('security invoker')
    expect(aggregateMigration).toContain('from public, anon, authenticated')
    expect(aggregateMigration).toContain('to service_role')
    expect(aggregateMigration).not.toContain('security definer')
  })

  it('wraps DDL in a bounded transaction and tracks a rollback-only Preview canary', () => {
    expect(aggregateMigration.trimStart()).toContain('begin;')
    expect(aggregateMigration).toContain("set local lock_timeout = '5s'")
    expect(aggregateMigration.trimEnd().endsWith('commit;')).toBe(true)

    expect(aggregateCanary.trimStart()).toContain('begin;')
    expect(aggregateCanary).toContain('delete from public.contract_items')
    expect(aggregateCanary).toContain('not v_replayed.recovered')
    expect(aggregateCanary).toContain('when check_violation then null')
    expect(aggregateCanary).toContain('rollback;')
    expect(aggregateCanary).toContain("'fixture_rows_after_rollback', count(*)")
  })

  it('binds the request identity to every normalized business field', () => {
    expect(payloadIdentityMigration).toContain('creation_payload_fingerprint')
    expect(payloadIdentityMigration).toContain('extensions.digest')
    expect(payloadIdentityMigration).toContain(
      'client_request_id is already bound to another business payload'
    )
    for (const field of [
      'contract_no',
      'quote_id',
      'include_quote_items',
      'party_a_name',
      'party_b_name',
      'party_b_contact',
      'contract_amount',
      'tax_amount',
      'contract_date',
      'effective_date',
      'expiry_date',
      'payment_terms',
      'delivery_terms',
      'notes',
    ]) {
      expect(payloadIdentityMigration).toContain(`'${field}'`)
    }
    expect(aggregateCanary).toContain('changed business payload was accepted')
  })

  it('allocates automatic contract numbers under an organization/day transaction lock', () => {
    expect(payloadIdentityMigration).toContain("'contract-number:' || p_org_id::text")
    expect(payloadIdentityMigration).toContain('pg_advisory_xact_lock')
    expect(payloadIdentityMigration).toContain("v_number_prefix := 'CT-'")
    expect(payloadIdentityMigration).toContain('v_contract_no_explicit')
    expect(aggregateCanary).toContain("v_created.contract_no !~ '^CT-[0-9]{8}-[0-9]{3,}$'")
  })

  it('locks the confirmed quote and frozen source item rows through aggregate creation', () => {
    expect(payloadIdentityMigration).toContain('select source_quote.status')
    expect(payloadIdentityMigration).toContain('for share;')
    expect(payloadIdentityMigration).toContain('from public.quote_items as source_item')
    expect(payloadIdentityMigration).not.toContain('and source_quote.status =')
  })
})
