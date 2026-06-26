# F027 Verification Result - 线上问题域闭环治理

**Date**: 2026-06-26
**Branch**: `codex/audit-remediation-61-issues`
**Deployed App HEAD**: `68a3d85`
**Production Deployment**: `dpl_FPSxxhbDhgxUbF1SqBp7YMC6pDR4`
**Production URL**: `https://sales.cyanlog.icu`

---

## 1. Current Baseline

| Check | Current Evidence | Result |
|---|---|---|
| Branch | `codex/audit-remediation-61-issues...origin/codex/audit-remediation-61-issues` | Pass |
| Uncommitted code | Only governance runtime state dirty: `governance/ai-behavior-准则/audit/behavior-log.jsonl`, `governance/runtime-state/feedback.json` | Pass with note |
| Production | Vercel production deployment `dpl_FPSxxhbDhgxUbF1SqBp7YMC6pDR4` => `READY`, alias `https://sales.cyanlog.icu` attached | Pass |
| Health | `GET /api/health` => `status=ok`, database ok, `x-vercel-id: hnd1::sin1`, database latency 368ms | Pass |
| Favicon | `GET /favicon.png` => `200`, `image/png`, 32x32, 683 bytes | Pass |
| Vercel env | Production has Supabase/Sentry/Descope; no `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu success blocked by env |

---

## 2. Command Verification

| Command | Result | Notes |
|---|---|---|
| `pnpm lint` | Pass, no ESLint warnings/errors | Script now uses ESLint CLI over app/components/lib/types and root runtime config files; Next 16 `next lint` deprecation noise removed |
| `pnpm exec tsc --noEmit` | Pass | No type errors |
| `pnpm test:run` | 55 files / 328 tests passed | `NODE_OPTIONS=--no-experimental-webstorage` removes the Node 24 `--localstorage-file` noise from the standard test command |
| `pnpm build` | Pass | Existing warning: Sentry/OpenTelemetry dynamic require; local `@next/swc-darwin-arm64` fallback warning cleared. Local webpack cache may also warn about serializing big strings. |
| Commit hook | 10/10 governance checks passed through `4bc49c6` | No `--no-verify` used |
| Vercel build | Ready | `sharp@0.34.5` install script now runs and completes; remaining build warnings are Sentry/OpenTelemetry dynamic require and webpack cache big string serialization |
| Supabase migrations | `supabase db push --linked --yes` applied `20260626062255_login_rpc_stage_timing.sql`, `20260626065920_org_admin_payload_rpc.sql`, `20260626071818_org_admin_active_members_only.sql`, and `20260626155732_org_admin_active_departments_only.sql` in this F027 performance/org-admin phase | Pass |
| Supabase remote lint | `supabase db lint --linked --fail-on error` failed before linting due Supabase temp role SASL auth/circuit breaker | Blocked by platform auth, not counted as schema validation |

---

## 3. Online API and Browser Evidence

| Domain | Evidence | Result |
|---|---|---|
| D01 Production availability | Production deployment `dpl_FPSxxhbDhgxUbF1SqBp7YMC6pDR4`, `READY`, alias `https://sales.cyanlog.icu` | Pass |
| D01 Function region | `vercel.json` now sets `"regions": ["sin1"]`; `vercel inspect` lists functions in `[sin1]`; `/api/health` returned `x-vercel-id: hnd1::sin1` and database latency 368ms. | Pass |
| D02 Login same-route prewarm | Production `/login` triggered `GET /api/auth/login` 200 in Chrome DevTools with no console warnings/errors. Header-gated `GET /api/auth/login` without `X-Login-Prewarm` returns 204 and does not touch DB; with header returns 200 and warms the same route bundle/Supabase path. | Pass |
| D02 Fast navigation resilience | Production browser on `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` rapidly navigated `/` -> `/configs?tab=role-access`; `fastNavigationConsoleMessages=[]`, so stale dashboard `Failed to fetch` noise no longer leaks during navigation. | Pass |
| D02 Error boundary regression | Browser visited `/contracts/44301b16-6551-4720-afa5-f1d80b1604de`; expected title visible; no `页面发生错误` | Pass |
| D02 404 | Browser visited a nonexistent route; displayed `页面未找到` | Pass |
| D03 Org role assignment | Production browser verification on `dpl_7LhA6QGMHaJVjHwEs3zMnZyt1Bb3`: org page loaded 11 departments / 25 members / 3 spaces; add temp admin changed 25=>26; stop kept member visible as `已停用`; enable restored `在职`; delete changed 26=>25 and removed row; temp user hard-cleaned | Pass |
| D03 Department leader and cache consistency | Production browser verification on `dpl_GA7vgxSXz3zLjLt8fUc7WhBdrh17`: temp department with leader `张雪丽` was visible in `/configs?tab=org-structure`; `/api/admin/org` POST returned `405` with `Allow: GET`; after hard cleanup, the same browser revalidated org cache and no longer showed the temp department; final org payload stayed 11 departments / 25 users; console warnings/errors 0 | Pass |
| D03 Latest admin role add/remove refresh | Production browser verification on `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA`: 25 users before test; temp user created via UI and became visible; assigned to Admin role with `role_codes=["ADMIN"]`; removed from Admin role and disappeared from assigned list with `role_codes=[]`; hard cleanup removed temp user; final count 25; console warnings/errors 0. | Pass |
| D03 Org payload timing | Production `dpl_FPSxxhbDhgxUbF1SqBp7YMC6pDR4` after real login: `/api/admin/org` returned 200, `X-Org-Payload-Source: rpc`, `X-Org-Timing: auth;dur=0.2, rpc_payload;dur=41.0, total;dur=41.4`, counts 25 users / 11 departments / 7 roles / 3 spaces. | Pass |
| D03 Admin user write validation | `/api/admin/users/[id]/departments`, `/login-enabled`, `/report-to` now reject invalid body/query values with `400 VALIDATION_ERROR` before Supabase is called; targeted route tests cover empty department list, missing department deletion ID, non-boolean login flag, and invalid report-to UUID. Production returned the same 400 errors for empty `department_ids`, string `login_enabled`, and invalid `report_to_user_id`. | Pass |
| D04 Feishu sync unconfigured | Vercel Production env lacks `FEISHU_APP_ID` / `FEISHU_APP_SECRET`; online `POST /api/access/feishu/sync` => `503`, code `FEISHU_NOT_CONFIGURED`, missing both variables, hint states current MVP only syncs departments and does not import members | Pass for unconfigured feedback; success blocked by env |
| D05 Contract rules | `GET /api/contract-policies/rules?is_active=true` => 15 active codes `R001-R015` | Pass |
| D05 Rule stats | `GET /api/rules/stats` => 18 total, 15 published, 3 archived legacy rows | Pass with debt |
| D06 Contract upload | Online API/UI upload flow created, uploaded, merged, submitted, analyzed and cleaned temporary contract | Pass |
| D06 Contract compare | Online POST compare created 6 diffs; GET returned same comparison; UI rendered compare page; temp contracts cleaned | Pass |
| D06 Risk review | Online `/admin/rule-review` executed contract text against rules and returned R015/R009/R012/R002 risks | Pass |
| D07 Mobile `/configs` | 390x844 and 820x1180 screenshots: no horizontal overflow, no error boundary, hamburger visible | Pass |
| D07 `/configs` bundle split | `c74ad23` lazy-loads config edit dialogs/forms. Current production build: `/configs` Size 18kB and First Load JS 159kB. Production logged-in `/configs` returned 200 and chunk `static/chunks/app/configs/page-d1d47a8244087e40.js` returned 61,052 bytes. | Pass |
| D07 `/admin/org` bundle split | `0d15f8c` lazy-loads the reused organization workbench; `4bc49c6` preserves the same route budget. Current production build: `/admin/org` Size 3.78kB and First Load JS 107kB, down from 73.2kB / 245kB. Production logged-in `/admin/org` returned 200 and chunk `static/chunks/app/admin/org/page-fbbc3729110b8ca8.js` returned 9,078 bytes. | Pass |
| D07 Mobile `/contracts` | 390x844 screenshot: no horizontal overflow, bottom actions visible; script text assertion was too narrow | Pass |
| D07 Favicon | `public/favicon.png`: PNG 32x32, 683 bytes; online `/favicon.png` 200 | Pass |
| D08 Knowledge create | Browser `/knowledge` -> `/knowledge/new` -> create -> `/knowledge?page={id}`; API readback; temp page deleted | Pass |
| D10 Deploy payload | Latest Vercel CLI production deploy uploaded 96.1KB from repo root with project rootDirectory `product-truth/product-code`; build output excludes `node_modules`, `.next`, `output`, trace/video/HAR artifacts | Pass |
| D10 Sharp build script | `7eded60` adds `pnpm.onlyBuiltDependencies=["sharp"]`; deployment `dpl_F8ZGdXqXQU3LDKU9YbatoZE9Yxhm` ran `sharp@0.34.5 install/check.js` and completed, and latest deployment `dpl_FPSxxhbDhgxUbF1SqBp7YMC6pDR4` no longer shows the ignored build scripts warning. | Pass |
| D10 Repo artifact cleanup | Removed 7 previously tracked `.playwright-mcp` log/snapshot files from Git and added root `.vercelignore` plus `.gitignore` coverage for `.playwright-cli/`, `.playwright-mcp/`, and `output/` | Pass |

---

## 4. Performance Baseline

| Area | Evidence | Conclusion |
|---|---|---|
| Page switching | DevTools trace showed route switching INP 26ms and CLS 0.00. | Page switching is not the current primary bottleneck. |
| Cold login | Earlier direct-submit sample on `dpl_DcsLG4sdNEDESWJiwF12SErXE8iA` was `X-Login-Timing total=1021.6ms`. After same-route prewarm plus `sin1` function region, explicit prewarm+POST samples on `dpl_GPh5F5bZDMwGsTAHuGewTDboEgUe` returned route totals 166.0ms, 120.0ms and 112.1ms. | The normal prewarmed submit path is now well below the 0.5s route target; first prewarm itself can still pay cold startup and remains a monitored risk. |
| External dependency wait | Supabase/GitHub TLS reset occurred during diagnostics; one core API stalled around 9s before 401, later returning to around 185-355ms after network recovery. | External dependencies are not automatically bad, but latency/error class must be separated from app code latency. |
| `/configs` bundle | Earlier reference sample showed `/configs` First Load JS around 281kB; prior current build was 166kB. After `c74ad23`, current production build shows `/configs` Size 18kB and First Load JS 159kB; production logged-in `/configs` returns 200 and its page chunk is 61,052 bytes. `/contracts` remains 144kB and `/tenders` 126kB in the same build. | Config center first entry is improved, but still remains heavier than adjacent modules and should stay under bundle watch. |
| `/admin/org` bundle | Before `0d15f8c`, local build showed `/admin/org` Size 73.2kB and First Load JS 245kB. After lazy-loading the reused organization workbench, production build shows 3.78kB and 107kB; logged-in `/admin/org` returns 200 and page chunk is 9,078 bytes. | Admin organization entry is no longer a large first-load outlier; interaction still depends on the deferred workbench chunk. |
| Login CLS | Historical trace showed login page CLS around 0.21. After `be7c882`, production Playwright samples showed desktop 1440x900 CLS 0 and mobile 390x844 CLS 0, with no horizontal overflow. | Current login-page layout stability is verified; keep as regression guard. |
| Org admin payload | Before RPC aggregation, browser `/api/admin/org` could take 4616ms and briefly showed false 0 counts. After `3670901` + `a590d45` + `e57c34c`, first org page paint uses loading `...`, then renders 11/25/3; direct RPC hot verification after cleanup returned 25 users / 11 departments / 7 roles / 3 spaces in 232ms. After `5db94bd` + `ad7844a`, inactive departments are filtered in RPC/fallback and org cache revalidates immediately for organization tabs. After `4bc49c6`, production `/api/admin/org` exposes `X-Org-Payload-Source` and `X-Org-Timing`; latest online sample is `rpc`, total 41.4ms. | The specific usability bug is closed; route-level latency is now classifiable by auth/RPC/fallback/total timing instead of being a black box. |
| Reverted optimization | Moving login prewarm from 1200ms to 350ms regressed a quick-submit sample to around 5s and was reverted. | No unverified performance tweak is counted as a fix. |

Required next instrumentation for cold login:

- `login_with_password_v1` RPC internal timing: done via `X-Login-Timing` fields prefixed with `rpc_`.
- token write timing: done via `rpc_token_write`.
- `initialDashboard` assembly timing: done via `rpc_initial_dashboard`.
- `initialCore` assembly timing: done via `rpc_initial_core`.
- auth context cookie signing timing: done via `auth_context_cookie`.

Production note: Vercel did not expose the application `Server-Timing` header in the login response, but the mirrored `X-Login-Timing` header is present and contains the full stage breakdown.

Latest production login timing samples:

| Sample | HTTP | Wall ms | Route total ms | `login_rpc` ms | `rpc_total` ms | `rpc_password_verify` ms | `rpc_initial_dashboard` ms | `rpc_initial_core` ms | `rpc_token_write` ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 200 | 1925 | 1108.0 | 1086.7 | 151.8 | 119.8 | 11.2 | 5.5 | 2.7 |
| 2 | 200 | 1699 | 848.0 | 845.8 | 83.4 | 76.6 | 2.5 | 1.9 | 1.1 |
| 3 | 200 | 896 | 348.6 | 346.6 | 82.4 | 75.7 | 2.2 | 1.8 | 1.5 |
| Final `dpl_Dcs` | 200 | n/a | 1021.6 | 997.1 | 106.7 | 78.3 | 10.4 | 6.7 | 1.8 |
| Prewarmed `dpl_7J1` #1 | 200 | 777 | 395.4 | 385.0 | 106.2 | 80.1 | 9.8 | 6.8 | 1.8 |
| Prewarmed `dpl_7J1` #2 | 200 | 709 | 339.3 | 335.0 | 78.2 | 73.0 | 2.0 | 1.7 | 0.3 |
| Prewarmed `dpl_7J1` #3 | 200 | 695 | 337.5 | 335.1 | 78.8 | 73.4 | 2.1 | 1.7 | 0.3 |
| `sin1` `dpl_GPh` #1 | 200 | 713 | 166.0 | 158.4 | 115.5 | 85.5 | 13.3 | 6.5 | 2.8 |
| `sin1` `dpl_GPh` #2 | 200 | 596 | 120.0 | 118.3 | 79.1 | 73.7 | 2.1 | 1.7 | 0.3 |
| `sin1` `dpl_GPh` #3 | 200 | 422 | 112.1 | 110.2 | 78.1 | 72.9 | 2.1 | 1.7 | 0.2 |

Final verification note: one Node/Playwright request context intermittently returned `ENOTFOUND` for `sales.cyanlog.icu` while `curl` and Chrome browser access succeeded. This is recorded as local/external resolver noise unless it reproduces in browser or health checks.

Prewarm verification note: the first explicit prewarm request on `dpl_GPh` took 2066ms, then submitted login returned `total=166.0ms`. This means the user-facing submit stage is improved when the login page has time to prewarm, but cold function/network startup has not disappeared.

---

## 5. Original Issue Mapping

| Original ID | Domain | Current Conclusion |
|---|---|---|
| A1 | D07 | Mobile `/configs` and `/contracts` verified without horizontal overflow; broad mobile regression remains future coverage. |
| A2 | D05 | R001-R015 active in production `contract_rules_v2` API. |
| A3 | D03 | Org/admin layout and role assignment path verified in production after fixes; add/stop/enable/delete count behavior now matches soft-delete semantics. |
| A4 | D03 | Dropdown menu portal behavior fixed and verified earlier in production. |
| A5 | D03/D04 | Super admin add/remove path verified with live temp admin; Feishu member import not in MVP and not configured. |
| A6 | D07 | Favicon file valid and online 200. |
| A7 | D07 | Theme card mobile action overflow fixed and verified after `30eef81`. |
| A8 | D06 | Contract upload API/UI flow verified online. |
| A9 | D05/D06 | Risk review page/API verified online. |
| A10 | D06 | Contract compare GET/POST/UI verified online. |
| B4 | D07 | iPad `/configs` verified without horizontal overflow. |
| B5 | D08 | Knowledge new route exists and works. |
| B6 | D08 | Knowledge create button click path works. |
| B7 | D05 | Rule API returns R001-R015 active. |
| B8 | D07 | Same as A6. |
| B9 | D03 | Super admin visibility/add/stop/enable/delete path verified; false 0 loading state removed. |
| B10 | D03 | Same as A4. |
| B11 | D03/D09 | Resolved by reusing `/admin/org` as true workbench and keeping config center as entry/control surface; legacy `/api/admin/org` POST/PATCH mutation surface now returns read-only 405 and active writes use `/api/admin/users` / `/api/admin/departments`. |
| B12 | D06 | Contract quick actions now route risk review to `/admin/rule-review` and compare to a completed contract or upload fallback. |
| B13 | D09 | Runtime search shows no `// ignore`; lint passes. |
| B14 | D09 | Runtime search shows no empty `catch {}` in app/components/lib; intentional boundary reporting catch remains documented. |
| B15 | D09 | Runtime search shows no `alert(` in app/components/lib. |
| B16 | D03/D09 | Role hardcoding reduced by F011 model; full published permissions model remains long-term. |
| B17 | D09 | API Zod coverage is now measured: 39/103 `app/api/**/route.ts` files use Zod after adding admin user departments/login-enabled/report-to schemas; 64 route files remain staged governance debt. |
| B18 | D09 | Runtime search shows no `window.location.reload`. |
| B19 | D09 | Runtime search shows no `console.log`; `console.error/warn` remain for server/client logging. |
| B20 | D09 | Production `app/components/lib` search excluding tests has 0 direct `any` matches; test/mocks still use `any` and remain separate test typing debt. |
| B21 | D02 | `app/not-found.tsx` exists and online 404 verified. |
| B22 | D02 | `LoadingState`/`app/loading.tsx` exist and key pages verified; complete visual consistency remains future design QA. |
| B23 | D02/D08 | `EmptyState` exists and knowledge/contracts empty states are usable; complete visual consistency remains future design QA. |
| C1 | D09 | Erroneous extra compare page was removed in prior fixes; current compare page is canonical route. |
| C2 | D07 | Favicon quality verified as 32x32 PNG; browser cache can still require user refresh. |
| C3 | D05 | Active rule API and migrations now align on `contract_rules_v2`; legacy archived rows remain as debt. |
| C4 | D09 | Temporary Ponytail-style doc additions are not part of current active truth; no new temp doc added. |
| C5 | D06 | Contract POST supports JSON/FormData; upload flow verified through chunk endpoints. |
| C6 | D09 | Lint passes. |
| C7 | D06 | Compare href routes to completed contract compare or upload fallback. |
| C8 | D05/D06 | Risk review href routes to `/admin/rule-review`. |
| D5 | D10 | 328 tests pass. |
| D6 | D10 | Latest commits used governance hook, no `--no-verify`. |
| D7-D9 | D09/D10 | Governance artifacts documented; ignored runtime state not staged. |
| E1 | D06 | Create contract endpoint supports JSON/FormData; upload page uses JSON + chunked upload. |
| E2 | D06/D09 | Upload flow errors are readable in UI; full API error envelope consistency remains long-term. |
| E3 | D06 | Contract list has pagination API/meta; infinite loading not implemented. |
| E4 | D06 | Analyze route has status checks and optimistic update; full concurrent upload throttling remains long-term. |
| E5 | D06 | Upload UI has busy/progress states in chunk flow; detailed byte progress remains UX improvement. |
| E6 | D06 | Drag/drop selected-file feedback verified in upload flow; richer drag hover feedback remains UX improvement. |
| E7 | D09 | Toast is used in repaired flows; full alert/toast unification not fully audited. |
| E8 | D03 | Same as A4. |
| E9 | D06/D07 | Contract cards are navigable; click-area affordance can still be improved. |
| E10 | D07 | Mobile key buttons visible and clickable in verified paths; global touch feedback remains future QA. |
| F1 | D10 | Build passes; compare syntax fixed. |
| F2 | D10 | Analyze unused error fixed; lint passes. |
| F3-F10 | D10 | Lint now reports no warnings; build still has non-lint dependency warnings. |
| G1 | D03/D09 | Config menu duplicate fixed in prior config center hardening. |

---

## 6. Remaining Risks / Not Fully Closed

| Risk | Why Not Closed | Next Step |
|---|---|---|
| Feishu successful department sync | Production lacks `FEISHU_APP_ID` and `FEISHU_APP_SECRET`; current verified behavior is structured `FEISHU_NOT_CONFIGURED` with missing env list and scope hint. | Configure Feishu env in Vercel, redeploy, then run department sync success test and verify imported/updated/total plus database `source=feishu` rows. |
| Cold login < 0.5s target | Prewarmed submit path now returns route totals 112.1-166.0ms from `sin1`, but direct first-submit can still exceed 0.5s if same-route prewarm has not completed; the first prewarm request itself took 2066ms in one online sample. | Keep same-route prewarm and `sin1` region config; next optimization should target remaining cold startup and password verification cost. |
| Org-admin route latency variance | RPC hot path is down to 41.4-232ms in direct checks, and route responses now expose `X-Org-Payload-Source` plus `X-Org-Timing`. Samples can still vary because middleware/auth/default-org resolution and Supabase network waits are outside the single SQL function. | Keep collecting `X-Org-Timing` in future admin add/remove refresh tests to separate backend latency from front-end state refresh bugs. |
| `/configs` first-load JS | Current build after `c74ad23` shows `/configs` First Load JS 159kB, compared with `/contracts` 144kB and `/tenders` 126kB; earlier diagnostic samples were 281kB and 166kB. | Keep bundle budget watch; next target is shared chunk if user-perceived first entry remains slow. |
| Historical design archive size | `product-truth/03-design-truth/archived/Cyanlog-UI-Kit-source.html` is tracked at about 9.5MB. It is explicitly documented as historical reference, not active design truth or deployed app code. | Do not delete blindly; if clone/push size becomes a product concern, replace with an external artifact pointer or compressed release asset after user approval. |
| Full API Zod coverage | 39/103 `app/api/**/route.ts` files use Zod; 64 route files remain. | Add route-by-route validation debt list and migrate by shared API schema utilities. |
| Test/mock `any` cleanup | Production searched paths have 0 direct `any` matches; tests and mocks still use `any` heavily for Supabase chain mocks. | Separate test mock typings from production typings; enforce stricter no-explicit-any only after shared mock builders exist. |
| Legacy rule rows | `/api/rules/stats` includes 3 archived legacy `RULE-01-*` rows. | Keep archived for compatibility or add legacy cleanup migration after confirming no consumers. |
| Build warnings | Sentry/OpenTelemetry dynamic require warning remains; local/Vercel webpack cache can warn about serializing big strings. Local SWC fallback warning was cleared, and the Vercel `sharp` ignored build scripts warning is now cleared by `pnpm.onlyBuiltDependencies`. | Evaluate Sentry config tree-shaking and cache warning source. |
