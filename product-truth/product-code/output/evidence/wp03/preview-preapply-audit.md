# WP03 Preview pre-apply audit — 2026-07-21

Scope: isolated Supabase Preview `vsfropnfsmnonkotywsx`. Production was not queried or written. The migration was deliberately **not applied** in this run; root/independent audit owns apply.

## Read-only data facts

- Eligible unconfirmed live rules: 15 (`R001`–`R015`, `rule_contract IS NULL`).
- Category-shaped legacy RuleSets: 13.
- Mixed active members in those sets: 0.
- Existing `STANDARD_SALES_CONTRACT_REVIEW` RuleSets: 0.
- Existing compiled bundles: 0; duplicate compiled identities: 0.
- Controlled canary identity was exact:
  - RuleSet code `F009_ACCEPT_29685647`, metadata `created_from=config_center_ruleset_api`, one active member, valid published current snapshot.
  - Rule code `MIN_COMMERCIAL_29685647`, live version 2, `ready_to_publish`.
- Empty legacy default identity was exact: code `default`, draft, active/default, no current/published pointer, empty metadata, 0 members, 0 documents.
- A second active default (`PAYMENT`) belongs to the 13 legacy category-shaped sets and is expected to be archived by the hierarchy transition. The new scenario set becomes the sole active default.

## Immutable pre-apply fingerprints

- `contract_skill_bundles`: 23 rows; immutable-column aggregate MD5 `b2cc53857c3af4de3c034ba13a1fe5c9`; 1 mutable current marker.
- `contract_rule_snapshots`: 71 rows; full-row aggregate MD5 `eb97d64df91b7a591f5afb8dd9090ede`.
- `contract_rule_set_snapshots`: 34 rows; full-row aggregate MD5 `095e71a51ff2b98eea0f140cff098638`.
- `contract_rule_test_runs`: 7 rows; full-row aggregate MD5 `4500a42fc96a9de16788ae2a871aa692`.
- Published `contract_rule_snapshots`: 39 rows; config/status/version aggregate MD5 `3fd7db24218000409e7f5a8090ee2034`.

The bundle fingerprint excludes only `is_current`, `updated_at`, and the new future-only identity-generation column. Migration is permitted to demote only current markers that explicitly bind quarantined rule/ruleset snapshots; all bundle content columns must retain this fingerprint.

## Local gates

- 6 Vitest files / 92 tests passed.
- `tsc --noEmit` passed.
- Target ESLint passed.
- `git diff --check` passed.
- SQL structural guards passed: balanced dollar quotes, no bare patch token, one persistence RPC definition, one publish RPC definition, one service-role grant.
- Docker/local Supabase was unavailable, so remote SQL parsing and transaction probes remain mandatory before acceptance.

## Required post-apply proof

1. Recompute all fingerprints above. Existing RuleSetSnapshots and test runs must match exactly; pre-existing RuleSnapshots excluding new `_draft_origin.work_package=WP03` drafts must match exactly; bundle immutable-column hash/count must match exactly.
2. Confirm one active `STANDARD_SALES_CONTRACT_REVIEW` set, 15 active member projections, 13 problem categories, 15 version-aligned WP03 draft snapshots, and zero confirmed `rule_contract` values.
3. Confirm all 13 legacy category-shaped sets, the exact canary, and the exact empty default are inactive/archived, while every historical snapshot/test run remains readable.
4. Confirm each affected org has exactly one active default.
5. Re-run the migration body or equivalent rollback probe and prove versions/draft counts do not change.
6. Run a rollback-isolated 15-rule canonical fixture: publish v1, corrupt/delete live test rows for 14 unchanged rules, change and retest only 1 rule, publish v2, and prove the 14 reuse the immutable current RuleSetSnapshot matrix while the changed rule uses its new accepted draft.
7. Run two concurrent identical compiled calls and two concurrent identical published calls. Each identity must resolve to one bundle row; published must end with exactly one current row.

## Product blocker (not a technical authorization request)

This repair intentionally does not invent R001–R015 business decisions. A real published/current product RuleSet still requires user-confirmed `rule_contract` for every rule: predefined properties (type/unit/required), deterministic decisions (conditions/thresholds/outcomes), missing-evidence outcome, and handling actions. An isolated canonical fixture can prove the control plane, but cannot be promoted or reported as confirmation of those 15 product rules.
