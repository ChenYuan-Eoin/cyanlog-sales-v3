# Cyanlog Design System

> A refreshed design system for **Cyanlog (青云销售)** — a B2B sales-support platform for Chinese enterprise sales teams.
> This system was distilled from a v3 HTML prototype (`uploads/样式原型.zip` → extracted to `src/`) and modernized along several axes: tighter type, calmer neutrals, a single confident cyan accent, larger radii, softer shadows, and more whitespace.

---

## What Cyanlog is

Cyanlog is a **销售支撑平台** (sales enablement / support platform) that walks an enterprise sales team through the full opportunity → quote → tender → contract → approval lifecycle. The original v3 prototype labels itself "Cyanlog Sales Platform V3" and surfaces 12+ pages organized into three groups:

| Group | Page | Purpose |
|---|---|---|
| 用户旅程 (Journey) | Login (`login.html`) | Workspace gate — no business data leaked pre-auth |
| | Home (`home-dashboard.html`) | Today's situation + queue + module switchboard |
| | Lead intake (`lead-intake.html`) | Capture customer touches |
| | Opportunity routing (`opportunity-routing.html`) | Route a lead onto a path |
| | Quote center (`quote-center.html`) | Left = pricing worksheet, right = formal quote paper |
| | Tender analysis (`tender-analysis.html`) | Read RFP doc + benchmark + risks side-by-side |
| 执行与协同 (Execution) | Tender schedule (`tender-schedule.html`) | Reverse-planned deadline engine |
| | Contract center (`contract-center.html`) | Generate from quote |
| | Contract review (`contract-review.html`) | Markup workspace |
| | Calendar (`calendar-overview.html`) | Team-wide |
| | Approval center (`approval-center.html`) | Dense ticket queue + node matrix |
| 系统支撑 (System) | Config center (`config-center.html`) | Settings |
| | Brand center (`brand-center.html`) | Theme + tokens + icon semantics |

The product is **fully Chinese**, enterprise-tier, with a confident dark navigation shell and a light document-style work surface.

### Sources

- **Uploaded prototype:** `uploads/prototype.zip` (originally `样式原型.zip` — renamed because the FS rejects the original filename) — full HTML/CSS in `src/`.
- **No Figma / no codebase** provided by the user.
- README in original zip: `src/README-zh.md` (delivery notes only).

---

## Index — what lives where

```
/
├── README.md                    ← you are here
├── SKILL.md                     ← agent-skill manifest
├── colors_and_type.css          ← all design tokens (CSS vars)
├── components.css               ← buttons, inputs, cards, pills, tables, …
├── assets/
│   ├── icons.svg                ← original 19-icon sprite (lucide-style)
│   └── illustrations/
│       └── login-secure.svg     ← original login hero illustration
├── preview/                     ← preview cards for the Design System tab
├── ui_kits/
│   └── platform/                ← React/JSX recreation of key Cyanlog screens
│       ├── index.html
│       ├── components.jsx       ← Shell, Sidebar, TopBar, Card, Pill, etc.
│       ├── screen-home.jsx
│       ├── screen-quote.jsx
│       ├── screen-approval.jsx
│       └── screen-login.jsx
└── src/                         ← original extracted v3 prototype (read-only reference)
```

---

## Content fundamentals

Cyanlog speaks in **direct, operational Chinese — no marketing fluff**. Copy is short. Verbs are imperative. Numbers are exact.

### Voice & tone

- **Operational, not promotional.** Headers describe what the page *does*, not why it's great: 「报价工作台」、「机会分流」、「审批中心」. No taglines, no slogans.
- **Imperative verbs.** Buttons: 「新建机会」、「录入客户接触」、「进入首页」. Never 「Get started」-style invitations.
- **Action-as-status.** Lists describe what's still owed: 「待补客户信息 3 条」、「待锁定节点 4 个项目」. Status pills carry the lifecycle stage in 1–3 chars: 「待审」、「已通过」、「高优」.
- **Number-led metrics.** Always `数字 + 单位 + 上下文`: 「27 活跃机会」、「+6 较上周」、「3210 万」、「平均停留 5h 28m」.
- **No emoji. No exclamations. No first/second person**, except for inviting a single action on the auth screen ("使用企业 SSO 登录"). Internal copy is third-person and impersonal ("张一鸣" appears as a data point, not a salutation).
- **English fragments are rare** — only as inline labels (SSO, ONES, MES, RFP). Display copy is Chinese.

### Casing & punctuation

- Chinese page titles use **no punctuation** at the end. Periods only appear inside descriptive paragraphs (use 「。」).
- English fragments inside Chinese use a single space on either side ("华润万家云平台二期 / Q3").
- Currency is shown without ¥ in the body, only with the unit in Chinese (「3210 万」、「128.4 万元」).

### Example copy snippets (lifted from the prototype)

| Page | Title | Description (page-description) |
|---|---|---|
| Home | 销售作战首页 | 首页展示队列、节点和业务入口。 |
| Tender | 标书工作台 | 边读原文边做对标与风险。 |
| Contract | 合同工作台 | 生成、审核、审批分层处理。 |
| Quote | 报价工作台 | 左侧录入与判断，右侧维护正式报价稿。 |

The pattern: **3–6 char title → 1-sentence purpose, ending with 「。」**. No second sentence on the header. Everything else is data.

### Microcopy patterns

- Empty states: 「暂无 + 名词」 (「暂无待审单据」). No illustration unless it's the login page.
- Confirmations: 「确认 + 动词」 (「确认提交」、「确认作废」).
- Destructive: 「作废」、「驳回」、「退回修改」 — never 「删除」 unless the data is genuinely destroyed.

---

## Visual foundations

The **refreshed** system (this skill's output). Differences from the v3 prototype are called out where they matter.

### Color

**Neutrals** keep the original v3 **slate ramp** (`--ink-50` → `--ink-950`) — a blue-shifted gray that pairs cleanly with the blue accent. Unchanged from the prototype.

| Token | Hex | Usage |
|---|---|---|
| `--bg-page` | `#eef3f8` | The working stage |
| `--bg-surface` | `#ffffff` | Cards, panels, the paper |
| `--bg-shell` | `#0b1220` | Navigation rail + sidebar |
| `--fg-1` | `#111827` | Primary text |
| `--fg-2` | `#334155` | Body text |
| `--fg-3` | `#64748b` | Meta / labels |
| `--border-1` | `#e2e8f0` | Default border |

**Accent** is the original v3 **Tailwind blue** — `--accent: #2563eb` (accent-600). **Cyan** (`#0891b2`) is kept as a *secondary* hue used for the brand mark gradient and a small set of chips/eyebrows. Full `--accent-50` → `--accent-900` and `--cyan-50` → `--cyan-900` ramps are in `colors_and_type.css`.

**Semantic** is the v3 set: success (`#15803d`), warning (`#b45309`), danger (`#dc2626`), info (same as accent blue). All paired with `-100` soft fills for backgrounds.

### Typography

**Display + body:** `Geist` (with `Inter Tight` and `PingFang SC` as fallbacks). Geist is a modern grotesk that reads well at both display sizes and 13px body, with great Latin/numeric proportions for a data-dense product. **PingFang SC** carries the Chinese.

> ⚠️ **Font substitution flag** — the v3 prototype declared `Inter` as the primary face. I substituted to **Geist** (Google Fonts) for a more contemporary feel that escapes the "every SaaS uses Inter" trap. If the user wants strict brand continuity, swap `--font-display` and `--font-sans` back to Inter in `colors_and_type.css`. No font files are bundled — Geist + JetBrains Mono are loaded from Google Fonts CDN at the top of every page.

**Mono:** `JetBrains Mono` for numerals, time codes (`5h 28m`), and `.num` (tabular-numeric) cells in tables. Numerics use `font-variant-numeric: tabular-nums` everywhere they appear in tables.

**Scale (12 / 13 / 15 / 17 / 20 / 26 / 34 / 44 / 56)** — a modular but not over-precise ramp. The v3 used 11 / 12 / 13 / 14 / 16 / 18 / 24 / 28 / 30 / 34 / 38 / 48 / 52, which is too many neighbors. Fewer steps = clearer hierarchy.

| Token | Px | Use |
|---|---|---|
| `--text-display-1` | 56 | Auth hero, marketing-style page header |
| `--text-h1` | 34 | Page titles |
| `--text-h2` | 26 | Workspace section titles |
| `--text-h3` | 20 | Card titles |
| `--text-h4` | 17 | Inline card titles |
| `--text-body` | 15 | Body copy |
| `--text-body-sm` | 13 | Table cells, dense lists |
| `--text-caption` | 12 | Meta |
| `--text-overline` | 11 | UPPERCASE labels, pills |

### Spacing

A 4-px base scale (4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 / 72). Use `--sp-1` through `--sp-10`. **Cards default to 24 px padding** (was 20 in v3).

### Page rhythm

Page-level vertical spacing is its own concern — sloppy section gaps make a workspace feel cramped no matter how clean the cards are. The system uses two values:

- **Header → first content section: 36 px.** The page title + description block gets a definite "this is done, content begins" gap.
- **Between content sections: 24 px.** Consistent across metric strips, split layouts, tables, and forms.

`.page` (the content wrapper inside `Shell`) sets `gap: 24px`; `.page-header` gets `margin-bottom: 12px` on top of that for the larger header break.

### Radii

Tighter, enterprise-feeling scale (v2 — pulled in after review feedback):

- `--radius-xs: 4px` — chips inside chips, mini-tags
- `--radius-sm: 8px` — icon-chips, sub-elements
- `--radius-md: 10px` — buttons, inputs, search shell (was 12 in v3)
- `--radius-lg: 16px` — cards
- `--radius-xl: 24px` — hero containers, modals, login auth card
- `--radius-pill: 999px` — pills, toggles

Controls at **10 px** read sharper and more credibly enterprise. Cards at **16 px** retain presence without feeling soft. The v3 prototype used 12 / 18 / 24; we keep cards slightly bigger than controls but pull both down.

### Shadows

Single ramp, **all soft and low-spread**. The v3 stacked two layers of blue-tinted shadow on accent buttons (`0 14px 26px rgba(37,99,235,0.2)`) which looked dated. The refresh keeps shadow opacity ≤ 18 % and uses a neutral ink color.

```css
--shadow-1: small (cards, buttons)
--shadow-2: hover, raised cards
--shadow-3: elevated panels, hero containers
--shadow-4: modals, popovers
--shadow-focus: 4px cyan ring (replaces the v3 blue ring)
```

### Backgrounds

- **No full-bleed photo backgrounds** anywhere in the product. The work surface is `#eef3f8` — unchanged from v3.
- **No repeating patterns or textures.** Surfaces are flat by default.
- **Gradients are restricted to two places:** (1) the navigation shell (`#0b1220` → `#111827`, vertical, very subtle) and (2) the home/auth hero ("dark dock" — an ink-to-blue diagonal). Everything else is flat.
- **No glassmorphism** in the production UI. The v3 used `backdrop-filter: blur(12px)` on top bars and login cards; the refresh drops it. Glass is fine on the auth marketing pane but not in workspace chrome.

### Animation

Calm and short.

- **Easings:** `--ease-out: cubic-bezier(0.22, 0.61, 0.36, 1)` for most things. `--ease-in-out` for slider-style transitions.
- **Durations:** 120 / 200 / 320 ms. No half-second hero animations.
- **No bounces. No springs.** This is a workspace, not a marketing site.
- **Hover = background change**, not transform. Cards never lift on hover unless they're a primary CTA tile (then `translateY(-2px)` + `--shadow-2`).
- **Press = no scale.** Buttons translate 0.5 px on `:active` for tactile feedback only.

### Hover / press states

- **Hover on neutral buttons:** background `--bg-surface` → `--ink-50`, border `--border-1` → `--border-3`.
- **Hover on primary buttons:** background `--accent` → `--accent-strong` (a one-step deeper cyan).
- **Hover on rows in a table:** `--ink-50` fill, no border change.
- **Hover on cards-as-links:** lift `translateY(-1px)`, `--shadow-2`, and the title color tints toward `--accent`.
- **Press:** translate(0, 0.5px). No scale transforms.
- **Focus:** `--shadow-focus` — a 4 px cyan ring at 16 % opacity. Always visible for keyboard users (`:focus-visible`).

### Borders

- 1 px solid `--border-1` is the default. `--border-2` for internal dividers. `--border-3` is hover.
- Dashed borders only for "this row repeats" dividers inside list cards (12 px dashed `--border-1`), never for boundaries.
- **No left-border-accent cards** (the chat-app trope). All emphasis comes from background tint + a leading icon-chip.

### Transparency & blur

- Avoid transparency in business chrome — it makes content harder to read against varying page backgrounds.
- Light transparency (8–12 %) is allowed in the **dark shell** to layer nested elements: e.g. the workspace name block uses `rgba(255,255,255,0.06)`.
- Backdrop-filter is **off** by default. Only enable on overlays that float above the document (popovers, command palette).

### Layout rules

- **Shell layout** = `[72 rail] [272 sidebar] [content]`. Sidebar is collapsible on tablet (< 1120 px).
- **Content max-width 1560 px**, centered, 28 px padding.
- **Cards are never edge-to-edge** — always inside the content padding.
- **Grids prefer 12 / 16 / 20 / 24 px gaps** (`--sp-3` / `--sp-4` / `--sp-5` / `--sp-6`). Pick one per page and stay consistent.
- **Documents (quote paper, tender paper, contract paper)** are rendered as a "paper" — white, 28 px corner radius shell wrapping a flat 20 px paper with 1 px `--ink-200` border. This is the **only** place we use a serif font (`--font-serif`).

### Cards in detail

```css
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-lg);       /* 20px */
    padding: var(--sp-6);                  /* 24px */
    box-shadow: var(--shadow-1);
}
```

No nested cards more than two deep. A card inside a card is allowed (a `card-flat` inside a `card`) but not three levels.

### Iconography

See `ICONOGRAPHY.md`.

---

## What was changed vs the v3 prototype

| | v3 | Refreshed |
|---|---|---|
| Accent | `#2563eb` (Tailwind blue) | **unchanged** — kept per design review |
| Neutral cast | Blue-shifted slate | **unchanged** — kept per design review |
| Default radius | 12 px | 10 px |
| Card radius | 18 px | 16 px |
| Card padding | 20 px | 24 px |
| Body font | Inter | Geist (substitution — see flag above) |
| Type scale | 13 ramp steps | 9 ramp steps |
| Shadows | Stacked, blue-tinted | Single soft neutral ramp (v3 hex preserved) |
| Backdrop blur | On topbar + cards | Off in workspace, kept on auth |
| Pill emphasis | Border + fill | Fill-only with leading dot |
| Hover lift | Cards lift everywhere | Only link-cards lift |

Nothing was removed from the IA — every screen and concept survives. The skin is what changed.

---

## How to use this system

1. Link `colors_and_type.css` + `components.css` in your page `<head>`.
2. Pull components from `ui_kits/platform/components.jsx`. The Shell + Sidebar + TopBar are pre-wired to the icon sprite.
3. Read `SKILL.md` for the agent-skill manifest.
4. The `preview/` folder contains 700×N px specimen cards used by the Design System tab.
