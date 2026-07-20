# WP01 AI platform foundation evidence

Validated on 2026-07-20 against the isolated Supabase Preview project
`price-v3-p0-g5-preview-20260717` (`vsfropnfsmnonkotywsx`). Production was not
written or deployed.

## Six-object browser closure

The administrator UI created the complete control-plane graph in dependency
order: `provider_connection` -> two `model_catalog_entry` candidates ->
`ai_application` -> `route_policy`, plus a registered `business_use_point` and
its `application_binding`.

The local OpenAI-compatible probe used a temporary bearer credential and
returned `wp01/mock-primary` and `wp01/mock-fallback`. Both model entries passed
minimum generation. A Provider revision showed an empty secret input and then
successfully reused the stored credential only while its connection identity
was unchanged.

The first binding publish was intentionally rejected because the business use
point required structured output while the models and application declared only
text generation. After revising those published capabilities, the same binding
published. This demonstrates that publish validation follows the full business
dependency graph rather than accepting independent forms.

Preview read-back before cleanup showed one published object of every kind, an
ordered primary/fallback route, one archived Provider row without `api_key`, one
current Provider row with the credential, and zero sensitive keys in
`config_versions`. A separate draft was edited twice and rolled back from its
second saved value to version 1 through the real version-history UI. This test
also found and fixed a nested-dialog layering bug: version history now closes
before the confirmation portal opens, so the confirm action is clickable. All
63 run-tagged rows created across the acceptance run were deleted; residue is
zero and the six pre-existing Preview fixtures remain.

## Layout and browser acceptance

| Surface | Result |
| --- | --- |
| Desktop Chrome, 1440 x 900 | Five task views and four summary metrics fit without page overflow. Direct `view` and release-filter URLs hydrate without errors. Final clean console: 0 errors, 0 warnings. |
| iPad viewport, 1024 x 768 | Five task controls remain usable, document overflow is 0 px, and the Provider dialog header and footer both remain inside the viewport. Final clean console: 0 errors, 0 warnings. |
| Large Provider list | Actual product DOM with 50 temporary Provider assets remained a single intrinsic-height column on both viewports; ordering was monotonic and maximum inter-card gap was 11.25 px. |
| Release filter | Actual release view returned the expected 0, 1, 14 and 50 matches for four deterministic queries. |
| Negative publish | A bearer Provider without a credential and an initially incompatible business binding were both rejected with row-local feedback. |

Visual evidence:

- `desktop-config.png`
- `ipad-config.png`

Structured results are in `browser-results.json`; Preview migration and dynamic
bearer canary results are in `preview-security.json`.

## Engineering gates

- `pnpm test:run`: 182 files, 1255 tests passed.
- `pnpm lint`: passed.
- `pnpm exec tsc --noEmit`: passed.
- serial clean `pnpm build`: passed (75/75 static pages).
- independent API/security and UI re-audits: GO.

## Explicit boundary

This proves the WP01 configuration control plane. It does not claim business
runtime generation, token accounting, `model_invocations`, ReviewRun linkage,
failover consistency, or review accuracy; those remain WP02. Multi-row atomic
publication and Production release remain WP09.
