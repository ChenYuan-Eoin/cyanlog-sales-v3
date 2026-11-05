# Organization database release baseline

`production.json` is a schema-only catalog export of project `wfawwhphfqqwfwrrkogy`, captured with `capture.sql`. It contains no business rows, credentials or connection values. The renderer uses this single source to create tables, defaults, constraints, indexes, triggers, the real organization read RPC, RLS policies and grants. Do not maintain a second handwritten test schema or edit the export to make tests pass.

The scope is the directory's 12 native tables and their foreign-key closure, plus the functions and policies those tables use. It is not a backup or drift check of unrelated business tables. The round-trip test recaptures the initialized test database and compares every captured object to Production.

`production.json` now captures the live definitions after the two approved migrations. `pre-cutover-20261105.json` preserves the actual captured predecessor: upgrade, old-defect reproduction and failed-migration rollback tests explicitly initialize from that historical version. Current-catalog and membership-constraint tests initialize from the current version. Both are immutable captures of real Production definitions, not independently handwritten test schemas.

Fast tests use PGlite (PostgreSQL 18.3). **The release lane requires native PostgreSQL 17.6**, matching the captured Production engine. CI uses the `postgres:17.6` service. The bootstrap superuser only builds/disposes isolated databases; migrations execute as Production's non-superuser `postgres` role, while the real plan/store/apply/read/rollback path executes as `service_role`. Browser roles must be denied. The unit lane normalizes its bootstrap role and engine version, plus PostgreSQL 18's duplicate `pg_constraint` representation of NOT NULL (after verifying it matches each captured column flag). The native release lane compares the catalog without these normalizations.

From `product-truth/product-code`, run:

```sh
ORGANIZATION_TEST_DATABASE_URL=postgres://wp92_bootstrap@127.0.0.1:54327/postgres ORGANIZATION_RELEASE_GATE=true VITEST_MAX_WORKERS=1 pnpm test:run scripts/organization-schema-gate.test.ts lib/organization-connections/schema-baseline/database.test.ts lib/organization-connections/unified-connection-migration.test.ts lib/organization-connections/organization-directory-cutover-migration.test.ts
node scripts/organization-schema-gate.mjs review
```

The local PostgreSQL server must be disposable, bound to localhost, and have a separate bootstrap superuser. The harness creates and removes one empty database per test. It rejects non-local targets and an incorrect native engine version.

## Four release gates

1. Read `capture.sql` against Production through the existing read-only database connector. Save `{format:1, projectId, capturedAt, catalog}` in this worktree's `codex-runtime`. Capture time must come from the actual read, not a copied baseline. `pack` binds that fresh export to the current committed SHA, query hash and migration hashes. `drift` rejects any difference, stale export (over one hour), wrong project, query or candidate.
2. Initialize native 17.6 from the appropriate captured version, execute both migrations from their predecessor, and test transactional migration failure. The same tests cover legacy encrypted draft import, preserved source/organization identity, the complete native directory and its repeat/rollback path.
3. Run missing/explicit membership-ID cases, the real composite membership FK, production unique identity mapping, old-trigger failure and repaired triggers under a hostile `search_path`, service-role RPCs and browser-role denial.
4. Review SQL and record the exact migration hashes in `sql-review.json`. Any later migration edit invalidates that review. Mechanical checks supplement this recorded review; they do not replace it.

Any failure blocks release and Production migration. A successful candidate CI run proves gates 2–4 only. Before release, dispatch `Organization database gates` with the fresh packed export and exact candidate ref; its additional step automatically compares Production DDL. Do not count a skipped drift step as a four-gate pass.

```sh
node scripts/organization-schema-gate.mjs pack /absolute/codex-runtime/fresh-production-schema.json /absolute/codex-runtime/schema-export.txt
```

**Trust boundary:** CI has no database catalog credential. The fresh export is supplied by the authenticated release operator through `workflow_dispatch`; CI validates its scope, freshness, candidate/migration binding and differences. CI does not independently prove that the operator performed the Production read. No additional Production write credential is introduced. The dispatch audit and connector read evidence must accompany release evidence. Once a release changes Production DDL, capture/review a new baseline before using this gate for another release.

Database rollback tests cover failed-migration transactional rollback and the shipped directory rollback RPC. Successful additive schema migration is retained when reverting website code; automatically dropping populated directory/audit tables or discarding imported encrypted settings is not a safe down-migration and is not authorized.
