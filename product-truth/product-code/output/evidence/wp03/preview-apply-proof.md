# WP03 Preview apply and verification proof — 2026-07-21

## Scope and safety boundary

- Database scope: isolated Supabase Preview `vsfropnfsmnonkotywsx` only.
- Production was not queried, written, migrated, pushed, or deployed.
- No paid account, branch, provider, or recurring dependency was created.
- The protected dirty root snapshot was not reset, stashed, overwritten, or cleaned.

## Applied Preview migrations

| Remote version | Name | Result |
|---|---|---|
| `20260721051418` | `wp03_quarantine_unconfirmed_rule_translations` | Applied |
| `20260721053110` | `reconcile_wp03_quarantined_current_skill_bundles` | Applied |
| `20260721055245` | `archive_wp03_controlled_canary_category` | Applied |

Final local migration source hashes:

- `20260721041818...sql`: `f9fa9531774849bd99a17054927558d1e43cfbe81d11837bbf5987d5c6c2ce9f`
- `20260721051829...sql`: `dff9d35ffdfc68663a6c9bbe9c9ef94cf92d84e6e181d6cc4d46adba7d52aa41`
- `20260721054500...sql`: `3189c41f69c2257463f9560cf50c907f4cab6aa63aed2450bf228a78985de261`

The primary source was hardened after the first Preview apply to close NULL three-valued-logic gaps in conflict guards. Its final source was parsed and replayed inside a rolled-back Preview transaction. Replay returned the same `1` scenario / `15` members / `15` WP03 drafts / `0` active canary categories. The hardened branch did not alter this Preview result because the pre-apply audit proved there was no pre-existing scenario RuleSet and the legacy default identity was exact.

## Post-apply product data facts

- Active `STANDARD_SALES_CONTRACT_REVIEW` RuleSet: `1`; it is the sole active default for its organization.
- Active members: `15`, exact code range `R001`–`R015`.
- Version-aligned WP03 confirmation drafts: `15`.
- Confirmed canonical `rule_contract` values: `0` by design; no business rule was invented.
- Archived category-shaped legacy RuleSets: `13`.
- Archived controlled canary RuleSet: `1`; its single archived Rule and historical snapshots/tests remain readable.
- Active business problem categories: `13`.
- Active controlled-canary categories: `0`.
- Current SkillBundles consuming quarantined assets: `0`.
- `preview_candidate` channels: `0`.
- Organizations with an invalid active-default cardinality: `0`.

The canary-category migration was run again after apply. It was an idempotent no-op: the category remained inactive with one archived Rule reference, and the other 13 categories remained active. The migration obtains `SHARE ROW EXCLUSIVE` locks on RuleSet, Rule, and Category tables, then repeats the full identity check immediately before mutation.

## Immutable-history fingerprints

All pre-apply fingerprints matched exactly after all three migrations:

| Object | Count | Aggregate MD5 |
|---|---:|---|
| SkillBundle immutable columns | 23 | `b2cc53857c3af4de3c034ba13a1fe5c9` |
| Pre-existing RuleSnapshots, excluding the 15 new WP03 drafts | 71 | `eb97d64df91b7a591f5afb8dd9090ede` |
| RuleSetSnapshots | 34 | `095e71a51ff2b98eea0f140cff098638` |
| Rule test runs | 7 | `4500a42fc96a9de16788ae2a871aa692` |
| Published RuleSnapshots | 39 | `3fd7db24218000409e7f5a8090ee2034` |

Only mutable `is_current` pointers were demoted. No published RuleSnapshot, RuleSetSnapshot, test run, or immutable SkillBundle content was rewritten or deleted.

## Runtime and release-gate corrections

- A plan-bound ReviewRun is `latest_review_model_invocation_passed` only when the invocation is completed, non-degraded, OpenAI-compatible HTTP, provider-token-accounted, output-validated, and has an explicit risk-validation audit with zero warning and zero dropped risk.
- The runtime executor now persists provider kind, transport, validation item kind, warning list, dropped count, and usable count. Missing audit fields fail closed instead of defaulting to zero.
- Every named RuleSetDocument must exist exactly once, belong to the expected organization and RuleSet, and be published plus translation-ready. An omitted document remains valid because documents are optional reference material.
- Review workbench health uses a positive runtime-status allow-list. Missing or unknown statuses are degraded.
- Legacy single-rule APIs authenticate first and then return `410`; they cannot form a second publishing control plane.

## Browser verification

The RuleSet UI was exercised against deterministic API fixtures on a local production-code server; no Production data was used.

- Desktop `1200 × 818`: document/client width `1200/1200`, no horizontal overflow, no large fixed overlay, zero console errors/warnings.
- iPad `1024 × 768`: document/client width `1024/1024`, no horizontal overflow, no large fixed overlay, zero console errors/warnings.
- The UI now labels structural completeness as `结构完整 · 待发布验收`; it no longer claims `规则详情已确认` before business approval.
- Desktop screenshot SHA-256: `718d9d83919739cec698fe0f39f3b013f42f56917f0b9d2e2ca1be4a05d27ead`.
- iPad screenshot SHA-256: `dd4aa5b5931f2072730b7bbb7f7508b90e510e17ad92202e85f7d5fd23132303`.

## Engineering gates

- Full Vitest: `199` files passed, `2` live files skipped; `1411` tests passed, `5` live tests skipped.
- Target post-audit regression: `6` files / `106` tests passed.
- ESLint: passed.
- TypeScript `tsc --noEmit --incremental false`: passed.
- Next.js 15.5.19 production build: compiled, type/lint phase passed, `76/76` static pages generated.
- Harness selftest: passed.
- Document governance: passed.
- Harness strict doctor: `0` failures and `2` existing project-trust warnings; project-local hooks are not claimed loaded/effective.
- Scheduler validation: one active package, `WP03`, baseline active.
- `git diff --check`: passed.
- Independent final audit: original `2 × P1`, `2 × P2`, and canary concurrency finding closed; no new P0/P1.

## Honest remaining product gate

WP03 is technically ready for business-rule materialization, but it is not complete and must not publish yet:

- R001–R015 still contain `0` user-confirmed canonical rule contracts.
- Therefore there is intentionally no current canonical SkillBundle and no formal real-contract ReviewRun consuming the new rules.
- The full recommendation and exceptions are in `r001-r015-business-confirmation-candidates.md`, SHA-256 `bf3d23d997f4c696cf79aa7fe9ee3373727be7b052ac6debe079c4bf6b0051ea`.
- Recommended V1 decision: accept the common missing-evidence/manual-review boundary; split R006 into three rules and R010 into at least five; keep R003, R012, and R015 on mandatory specialist manual review until tax/privacy/legal owners confirm their dynamic thresholds; treat the remaining historical numbers as organization-configurable V1 defaults, not universal legal truth.

After that single product approval, the next executable batch is deterministic: materialize the approved contracts, create the complete test matrix, atomically publish the RuleSet, compile/publish one current SkillBundle, run a real contract through the existing WP02 route, and attach RuleSnapshot + RuleSetSnapshot + plan + model_invocations + token evidence. Accuracy remains separately blocked until an independent gold set exists.
