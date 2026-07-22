# G5 Preview runtime fixture evidence — 2026-07-17

Observed through: `2026-07-17T20:42:00+08:00`  
Supabase project: `vsfropnfsmnonkotywsx` (isolated Free Preview)  
Quoted project cost: `0 USD/month`  
Production action: none

## Purpose and boundary

This fixture exercises the published-config → provider probe →
`model_invocations` → ReviewRun chain from a local application connected to the
isolated Preview database. Both Provider configs point to
`http://127.0.0.1:12345/v1`, so this proves local-executor plumbing, not hosted
Preview-to-local-model connectivity.

The current SkillBundle is intentionally `not_release_eligible` and contains no
released rule, rule-set, document, or template snapshots. The runs below prove
source identity, provider execution, token recording, ReviewRun linkage, and
browser rendering. They do not prove representative contract-review accuracy or
Production readiness.

No paid account was registered, no service was purchased, no new model was
downloaded, and no persistent paid dependency was introduced. Models were
loaded sequentially and both model processes and the local application were
stopped after verification.

## Persisted identities

- Qwen Provider config: `2842db31-7b65-4011-bdbe-a9ae5a59a0e3`
  - status: `PUBLISHED`
  - model: `qwen3.5-9b-local`
- Gemma Provider config: `ae050c8e-aff4-477d-a463-886bc7c0fdf5`
  - status: `PUBLISHED`
  - model: `gemma-4-e4b-local`
- Contract-review tool policy config: `43cb133d-6110-4181-a031-d378f7b2f69c`
  - status: `PUBLISHED`
- Model policy: `5f10d78f-fc1a-49c7-b0eb-d75794351531`
  - status: `published`
  - current: `true`
- Skill bundle: `17999c37-fb50-408e-a151-dc6e33bb1db7`
  - status: `published`
  - current: `true`
  - `release_meta.not_release_eligible`: `true`
  - rule, rule-set, document, and template snapshots: `0`

`published/current` above is a runtime-resolution state, not a release decision.

## Provider probes

Both loaded models passed the real `/api/configs/ai-probe` path with
`ok=true`, `evidence_saved=true`, `runtime_config_match=true`, and non-zero
tokens:

| Provider | Latency | Tokens (input/output/total) |
|---|---:|---:|
| `local-qwen35-9b` | 668 ms | 29 / 2 / 31 |
| `local-gemma4-e4b` | 410 ms | 28 / 2 / 30 |

## Controlled Word source

- Fixture: `output/evidence/g5/controlled-revisions-comments-proof.docx`
- Preview contract: `6603fd5c-8d6d-4267-9e66-bee8b1e0235f`
- Final immutable path:
  `6603fd5c-8d6d-4267-9e66-bee8b1e0235f/c984637d-9ab9-4c0f-9dcc-9f0cbf196bd7_controlled-revisions-comments-proof.docx`
- `source_hash`:
  `886988ba96e3fe2bef223930e623046e5cc279b6744923620ff96186f6bf9283`
- `source_text_hash`:
  `0c2ff7d1a0c62b6879e99c1b064a7ba236988983204aac38ad5bc3c8fddf4bd4`
- The real chunk-upload API returned create `201`, chunk `200`, and merge
  `200`; 53 current-body characters were persisted.
- Current text includes `30 天`, `12 个月`, and the SLA clause. Deleted tracked
  text `120 天` and `24 个月` is excluded from model input. Comments and macros
  are not executed or treated as current body text.

## Same-source dual ReviewRuns

| Model | ReviewRun / job | Result | Latency | Tokens | Exact-anchored risks |
|---|---|---|---:|---:|---:|
| Qwen3.5-9B | `c29bd4e1-5979-41b7-8f89-cde001667fa6` / `e2806491-2a2b-4c18-a1a1-7cfab7bd8912` | `COMPLETED`, `degraded=false` | 8,856 ms | 328 / 201 / 529 | 1 |
| Gemma-4-E4B | `bcfa78dd-6497-440e-8065-b0c3a3e657e9` / `390a5a81-89cb-40d3-9c1a-2ae73de8e546` | `COMPLETED`, `degraded=false` | 34,710 ms | 337 / 1,528 / 1,865 | 3 |

Both ReviewRuns directly link to completed `semantic_review` invocation rows,
use the same `contract_id/source_hash/source_text_hash/skill_bundle_id`, and
match the source and source-text hashes above.

Qwen identified the high-impact SLA/no-compensation risk with exact quote
`SLA 承诺为 7x24 小时，不含赔付责任。` at positions `30–53`. Gemma identified
the same risk plus two plausible yellow risks with exact source ranges:
`付款周期为 30 天` (`7–17`) and `质保期为 12 个月。` (`18–29`). On this controlled
sample, Qwen was faster and more selective; Gemma was slower and more expansive.
This is a useful comparison, not an accuracy benchmark.

The same plumbing was previously exercised against a poorly parsed PDF:

- Qwen ReviewRun `20fca333-9a10-43f4-b68e-c91494150c29`:
  1,661 / 54 / 1,715 tokens, 7,899 ms, zero risks.
- Gemma ReviewRun `fe4045bb-936a-4833-afee-3393b7ef1b22`:
  1,666 / 379 / 2,045 tokens, 12,513 ms, zero risks.

Those zero-risk results are negative evidence for PDF text quality, not proof
that the models accepted the contract.

## Browser and source-map verification

The actual controlled Preview contract passed at desktop `1440×900` and iPad
`1180×820`:

- current Word text visible;
- 2 inserted and 2 deleted tracked-change elements visible;
- 1 existing classic comment visible, focusable, and click-expandable;
- Gemma's 3 risk cards and exact source content visible;
- no horizontal page overflow, alert, or console error.

Screenshots:

- `output/evidence/g5-v12/controlled-word-review-desktop-20260717.png`
- `output/evidence/g5-v12/controlled-word-review-ipad-20260717.png`

The actual `/contracts/upload` browser queue was then exercised with two copies
of the controlled DOCX under distinct filenames. It produced exactly two
`POST /api/contracts` responses (`201`), two chunk uploads (`200`), and two
merge responses (`200`). The queue used two independent contract IDs
`9cd9a50a-4e99-449a-9b5d-a997091beb67` and
`428bb5d0-4043-4bd7-b6e7-4a7feacef5ae`, persisted two non-empty `parsed_text`
rows, advanced once, stopped once, and redirected to the second contract's
review page. No third create/merge or browser console error occurred. The test
contracts and both formal/chunk Storage prefixes were deleted after evidence
capture; database and Storage residue are all zero. Redirect-state screenshot:
`output/evidence/g5-v12/two-file-upload-queue-desktop-20260717.png`.

Migration `20260717202000_fence_contract_page_map_source.sql` is recorded in
Preview migration history. Its trigger locks the current contract source and
rejects stale `storage_path` or `source_text_hash` page-map writes with SQLSTATE
`40001`. Transaction rollback tests passed correct insert, stale-text rejection,
stale-path rejection, and cleanup. A concurrent source replacement/page-map
upsert race completed without deadlock: the stale map write failed, retry still
failed, current-source upsert succeeded, and fixture residue was zero.

## Remaining release gates

The provider-plumbing prerequisite is now closed. G5 remains active because the
following product gates are still open:

1. complete the real DOCM and text/scanned-PDF SaaS upload → preview → anchor →
   native annotation export → desktop reader matrix, including unchanged DOCM
   VBA-part hashes;
2. run a representative 50-page / 10-risk-category accuracy and completeness
   comparison, not just the controlled sample;
3. repeat ReviewRuns with a release-eligible, evidence-backed rule/SkillBundle;
4. keep Production read-only until the user separately approves the audited
   Production migration and release verification. No push or deployment was
   performed.
