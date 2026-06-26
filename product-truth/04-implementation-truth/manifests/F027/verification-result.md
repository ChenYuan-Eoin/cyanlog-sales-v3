# F027 Verification Result - 线上问题域闭环治理

**Date**: 2026-06-26  
**Branch**: `codex/audit-remediation-61-issues`  
**HEAD**: `31f9a75370b4f2208ac7cd395545ae35d483bb4e`  
**Production Deployment**: `dpl_4xYjJXQLqwPn7fc7hJ3rdHzs9M7t`  
**Production URL**: `https://sales.cyanlog.icu`  

---

## 1. Current Baseline

| Check | Current Evidence | Result |
|---|---|---|
| Branch | `codex/audit-remediation-61-issues...origin/codex/audit-remediation-61-issues` | Pass |
| Uncommitted code | Only governance runtime state dirty: `governance/ai-behavior-准则/audit/behavior-log.jsonl`, `governance/runtime-state/feedback.json` | Pass with note |
| Production | `vercel inspect https://sales.cyanlog.icu` => `Ready`, alias attached | Pass |
| Health | `GET /api/health` => `status=ok`, database ok | Pass |
| Favicon | `GET /favicon.png` => `200`, `image/png`, 32x32, 683 bytes | Pass |
| Vercel env | Production has Supabase/Sentry/Descope; no `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu success blocked by env |

---

## 2. Command Verification

| Command | Result | Notes |
|---|---|---|
| `pnpm lint` | Pass, no ESLint warnings/errors | `next lint` deprecation warning remains from Next 15 tooling |
| `pnpm exec tsc --noEmit` | Pass | No type errors |
| `pnpm test:run` | 51 files / 318 tests passed | Vitest prints existing `--localstorage-file` warning |
| `pnpm build` | Pass | Existing warnings: Sentry/OpenTelemetry dynamic require; local missing `@next/swc-darwin-arm64` fallback |
| Commit hook | 10/10 governance checks passed on `31f9a75` | No `--no-verify` used |
| Vercel build | Ready | Vercel build warning: `sharp@0.34.5` scripts ignored |

---

## 3. Online API and Browser Evidence

| Domain | Evidence | Result |
|---|---|---|
| D01 Production availability | `vercel inspect`: `dpl_4xYjJXQLqwPn7fc7hJ3rdHzs9M7t`, `Ready`, alias `https://sales.cyanlog.icu` | Pass |
| D02 Error boundary regression | Browser visited `/contracts/44301b16-6551-4720-afa5-f1d80b1604de`; expected title visible; no `页面发生错误` | Pass |
| D02 404 | Browser visited a nonexistent route; displayed `页面未找到` | Pass |
| D03 Org role assignment | Production browser verification before doc-only deploy: ADMIN and SUPER_ADMIN add/remove temp users worked; temp users cleaned | Pass, no behavior change after doc-only deploy |
| D04 Feishu sync unconfigured | `POST /api/access/feishu/sync` => `503`, code `FEISHU_NOT_CONFIGURED` | Pass for unconfigured feedback; success not verified |
| D05 Contract rules | `GET /api/contract-policies/rules?is_active=true` => 15 active codes `R001-R015` | Pass |
| D05 Rule stats | `GET /api/rules/stats` => 18 total, 15 published, 3 archived legacy rows | Pass with debt |
| D06 Contract upload | Online API/UI upload flow created, uploaded, merged, submitted, analyzed and cleaned temporary contract | Pass |
| D06 Contract compare | Online POST compare created 6 diffs; GET returned same comparison; UI rendered compare page; temp contracts cleaned | Pass |
| D06 Risk review | Online `/admin/rule-review` executed contract text against rules and returned R015/R009/R012/R002 risks | Pass |
| D07 Mobile `/configs` | 390x844 and 820x1180 screenshots: no horizontal overflow, no error boundary, hamburger visible | Pass |
| D07 Mobile `/contracts` | 390x844 screenshot: no horizontal overflow, bottom actions visible; script text assertion was too narrow | Pass |
| D07 Favicon | `public/favicon.png`: PNG 32x32, 683 bytes; online `/favicon.png` 200 | Pass |
| D08 Knowledge create | Browser `/knowledge` -> `/knowledge/new` -> create -> `/knowledge?page={id}`; API readback; temp page deleted | Pass |
| D10 Deploy payload | Vercel CLI production deploy uploaded 18.2KB from repo root with project rootDirectory `product-truth/product-code` | Pass |

---

## 4. Performance Baseline

| Area | Evidence | Conclusion |
|---|---|---|
| Page switching | DevTools trace showed route switching INP 26ms and CLS 0.00. | Page switching is not the current primary bottleneck. |
| Cold login | Latest reference sample: `/api/auth/login` 1173ms, overall login 1590ms. Current server timing sample also showed `total=504.3ms`, `login_rpc=495.1ms`. | Cold login remains the highest-priority performance issue and is not closed by prefetch/cache work. |
| External dependency wait | Supabase/GitHub TLS reset occurred during diagnostics; one core API stalled around 9s before 401, later returning to around 185-355ms after network recovery. | External dependencies are not automatically bad, but latency/error class must be separated from app code latency. |
| `/configs` bundle | Build showed `/configs` First Load JS around 281kB, higher than `/contracts` around 144kB and `/tenders` around 125kB. | Config center first entry still has chunk-splitting potential. |
| Login CLS | Login page trace previously showed CLS around 0.21; switching trace showed no CLS. | CLS belongs to login page layout stability, not the three-page switching path. |
| Reverted optimization | Moving login prewarm from 1200ms to 350ms regressed a quick-submit sample to around 5s and was reverted. | No unverified performance tweak is counted as a fix. |

Required next instrumentation for cold login:

- `login_with_password_v1` RPC internal timing.
- token write timing.
- `initialDashboard` assembly timing.
- `initialCore` assembly timing.
- auth context cookie signing timing.

---

## 5. Original Issue Mapping

| Original ID | Domain | Current Conclusion |
|---|---|---|
| A1 | D07 | Mobile `/configs` and `/contracts` verified without horizontal overflow; broad mobile regression remains future coverage. |
| A2 | D05 | R001-R015 active in production `contract_rules_v2` API. |
| A3 | D03 | Org/admin layout and role assignment path verified in production after fixes; no current error boundary. |
| A4 | D03 | Dropdown menu portal behavior fixed and verified earlier in production. |
| A5 | D03/D04 | Super admin add/remove path verified; Feishu member import not in MVP and not configured. |
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
| B9 | D03 | Super admin visibility/add-remove path verified. |
| B10 | D03 | Same as A4. |
| B11 | D03/D09 | Resolved by reusing `/admin/org` as true workbench and keeping config center as entry/control surface; no destructive deletion. |
| B12 | D06 | Contract quick actions now route risk review to `/admin/rule-review` and compare to a completed contract or upload fallback. |
| B13 | D09 | Runtime search shows no `// ignore`; lint passes. |
| B14 | D09 | Runtime search shows no empty `catch {}` in app/components/lib; intentional boundary reporting catch remains documented. |
| B15 | D09 | Runtime search shows no `alert(` in app/components/lib. |
| B16 | D03/D09 | Role hardcoding reduced by F011 model; full published permissions model remains long-term. |
| B17 | D09 | Many APIs now use Zod, but full API parameter Zod coverage is not complete; tracked as long-term governance. |
| B18 | D09 | Runtime search shows no `window.location.reload`. |
| B19 | D09 | Runtime search shows no `console.log`; `console.error/warn` remain for server/client logging. |
| B20 | D09 | `any` remains mostly in tests/mocks; production `any` cleanup is not fully complete. |
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
| D5 | D10 | 318 tests pass. |
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
| Feishu successful department sync | Production lacks `FEISHU_APP_ID` and `FEISHU_APP_SECRET`; current verified behavior is structured `FEISHU_NOT_CONFIGURED`. | Configure Feishu env in Vercel, then run department sync success test and verify database rows. |
| Cold login < 0.5s target | Latest reference sample: `/api/auth/login` 1173ms and overall login 1590ms; current server timing sample also showed `total=504.3ms`, `login_rpc=495.1ms`; target is still tight and RPC/DB-bound. | Split DB timing inside `login_with_password_v1` and add stage timing for token write, initial data assembly and cookie signing. |
| `/configs` first-load JS | `/configs` First Load JS around 281kB, larger than nearby core modules. | Split heavy tab panes/client-only tools by tab and remeasure bundle output. |
| Login CLS | Login page CLS around 0.21 was observed separately from page switching. | Fix stable dimensions for login brand/media/form areas and rerun trace. |
| Full API Zod coverage | Some APIs have Zod; project-wide coverage is not complete. | Add route-by-route validation debt list and migrate by shared API schema utilities. |
| Full `any` cleanup | `any` remains mostly in tests; production false positives exist in search. | Separate test mock typings from production typings; enforce no-explicit-any only for production paths first. |
| Legacy rule rows | `/api/rules/stats` includes 3 archived legacy `RULE-01-*` rows. | Keep archived for compatibility or add legacy cleanup migration after confirming no consumers. |
| Build warnings | `sharp` build scripts ignored on Vercel; Sentry/OpenTelemetry dynamic require warning; local SWC fallback. | Approve/build sharp if image optimization requires it; evaluate Sentry config tree-shaking; reinstall local SWC package. |
