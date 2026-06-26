# F027 API Validation Inventory

**Date**: 2026-06-26
**Scope**: `product-truth/product-code/app/api/**/route.ts`
**Purpose**: Record the route-level validation state for the F027 API/error-handling problem domain. This is a debt inventory, not a claim that every route already has complete business schema validation.

## Current Scan Summary

Scan rule: count only request body reads through `req/request.json()`, `req/request.formData()`, `req/request.text()`, or `req/request.arrayBuffer()`. Response calls such as `NextResponse.json(...)` are not counted as body reads.

| Class | Count | Meaning |
|---|---:|---|
| `schema+guard` | 51 | Route reads request body, catches parse failure, and has Zod/safeParse-style schema validation. |
| `guard-only` | 16 | Route reads request body with parse-failure protection, but validation is manual or implicit rather than centralized Zod schema. |
| `no-body` | 36 | Route does not read request body. |
| `unguarded-body` | 0 | No direct unguarded `req/request` body parser was found in the current scan. |
| `schema-only` | 0 | No route was found with body schema validation but no parse guard in the current scan. |

## Guard-Only Routes To Normalize

These routes are not immediate malformed-body crashers, because they already guard body parsing. The remaining issue is consistency: move them toward shared request schemas and common error envelopes when touching the owning domain.

| Route | Methods | Next Standard |
|---|---|---|
| `/api/admin/clause-library` | `GET,POST` | Add a named create/update schema for clause library writes. |
| `/api/admin/clause-library/[id]` | `PATCH,DELETE` | Add a named patch schema and keep delete body-free or explicitly validate delete parameters. |
| `/api/admin/review-strategies` | `GET,POST` | Replace manual strategy payload checks with a reusable review-strategy schema. |
| `/api/asks/[askId]/responses` | `POST` | Add response body schema for text/attachment fields. |
| `/api/contracts/[id]/analyze` | `POST` | Add schema for analysis options and idempotency controls. |
| `/api/contracts/[id]/asks/[askId]/responses` | `POST` | Align with the top-level ask response schema. |
| `/api/contracts/[id]/clauses/[clauseId]` | `PATCH` | Add a clause patch schema and reuse existing clause validation rules. |
| `/api/contracts/[id]/compare-standard` | `POST` | Add schema for standard comparison options. |
| `/api/contracts/[id]/merge-chunks` | `POST` | Add schema for merge metadata; keep chunk integrity checks close to upload domain. |
| `/api/contracts/[id]/upload` | `POST` | Keep multipart guard; add explicit file metadata schema where practical. |
| `/api/contracts/[id]/upload-chunk` | `POST` | Keep multipart guard; add explicit chunk index/name/total schema. |
| `/api/knowledge/pages/[id]` | `GET,PATCH,DELETE` | Promote existing manual page update checks into a shared page patch schema. |
| `/api/knowledge/pages/[id]/permissions` | `GET,POST,DELETE` | Promote permission mutation checks into a shared permission schema. |
| `/api/tenders/[id]/workflow` | `GET,POST,PATCH` | Add workflow transition schema and state constraints. |
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
