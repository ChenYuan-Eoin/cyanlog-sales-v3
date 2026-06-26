# F027 API Validation Inventory

**Date**: 2026-06-26
**Scope**: `product-truth/product-code/app/api/**/route.ts`
**Purpose**: Record the route-level validation state for the F027 API/error-handling problem domain. This is a debt inventory, not a claim that every route already has complete business schema validation.

## Current Scan Summary

Scan rule: count only request body reads through `req/request.json()`, `req/request.formData()`, `req/request.text()`, or `req/request.arrayBuffer()`. Response calls such as `NextResponse.json(...)` are not counted as body reads.

| Class | Count | Meaning |
|---|---:|---|
| `schema+guard` | 62 | Route reads request body, catches parse failure, and has Zod/safeParse-style schema validation. |
| `guard-only` | 5 | Route reads request body with parse-failure protection, but validation is manual or implicit rather than centralized Zod schema. |
| `no-body` | 36 | Route does not read request body. |
| `unguarded-body` | 0 | No direct unguarded `req/request` body parser was found in the current scan. |
| `schema-only` | 0 | No route was found with body schema validation but no parse guard in the current scan. |

## Guard-Only Routes To Normalize

These routes are not immediate malformed-body crashers, because they already guard body parsing. The remaining issue is consistency: move them toward shared request schemas and common error envelopes when touching the owning domain.

| Route | Methods | Next Standard |
|---|---|---|
| `/api/contracts/[id]/merge-chunks` | `POST` | Add schema for merge metadata; keep chunk integrity checks close to upload domain. |
| `/api/contracts/[id]/upload` | `POST` | Keep multipart guard; add explicit file metadata schema where practical. |
| `/api/contracts/[id]/upload-chunk` | `POST` | Keep multipart guard; add explicit chunk index/name/total schema. |
| `/api/tenders/ocr` | `POST` | Keep multipart guard; add explicit OCR option schema. |
| `/api/upload` | `POST` | Keep multipart guard; add explicit upload intent/category schema. |

## Acceptance Standard For Closing This Debt

1. No route reintroduces unguarded request body parsing.
2. Each `guard-only` route either receives a named schema or is documented as intentionally body-free/empty-body.
3. Invalid body shape returns a consistent 400 validation envelope before avoidable Supabase, storage, model, OCR, or external-service work.
4. Each migrated route has at least one targeted malformed-body or invalid-shape test.
5. The inventory is refreshed after the migration so `guard-only` count moves down for the routes actually touched.

## Migration Notes

- `64839e2` moved `/api/contract-policies/rules/[id]/versions/[versionId]/publish` and `/rollback` from `guard-only` to `schema+guard` with targeted malformed JSON and invalid-shape tests.
- `9b8d765` moved `/api/rules/[id]/test`, `/api/rules/[id]/versions`, and `/api/rules/simulate` from `guard-only` to `schema+guard` with targeted malformed JSON and invalid-shape tests.
- `5e31674` moved `/api/rules/[id]/rollback` from `guard-only` to `schema+guard` with a positive-integer rollback version schema and targeted malformed JSON / invalid-shape tests.
- `614449c` reclassified `/api/asks/[askId]/responses` and `/api/contracts/[id]/asks/[askId]/responses` from `guard-only` to `schema+guard` after confirming both routes reuse the existing `submitAskResponse` Zod schema; targeted route tests cover malformed JSON and invalid `response_text` shape before contract access or Supabase work.
- `bb83afa` moved `/api/contracts/[id]/compare-standard` and `/api/contracts/[id]/clauses/[clauseId]` from `guard-only` to `schema+guard`; targeted tests cover malformed JSON, invalid field types, and invalid clause status before auth/org where applicable and before contract/Supabase work.
- `5ad61c4` moved `/api/admin/review-strategies`, `/api/admin/clause-library`, and `/api/admin/clause-library/[id]` from `guard-only` to `schema+guard`; targeted tests cover malformed JSON and invalid field shapes before Supabase work while keeping existing admin auth ordering and error codes.
- `8115000` moved `/api/knowledge/pages/[id]` and `/api/knowledge/pages/[id]/permissions` from `guard-only` to `schema+guard`; targeted tests cover malformed JSON, invalid page update fields, invalid permission fields, and invalid delete permission IDs before Supabase work.
- `a7969db` moved `/api/contracts/[id]/analyze` and `/api/tenders/[id]/workflow` from `guard-only` to `schema+guard`; targeted tests cover invalid analysis strategy options, invalid workflow direction, and invalid checkpoint data before avoidable Supabase or job-queue work.
