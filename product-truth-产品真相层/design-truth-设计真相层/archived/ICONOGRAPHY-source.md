# Iconography — Cyanlog

**Primary source: [Lucide](https://lucide.dev/) — load via CDN.** The Cyanlog visual language uses Lucide's outline icons (stroke 1.6, 24-grid) as the canonical icon set. The hand-rolled `assets/icons.svg` sprite is retained as a self-hosted fallback for offline preview cards and PDF exports.

```html
<!-- Recommended: load Lucide via CDN -->
<script src="https://unpkg.com/lucide@0.456.0/dist/umd/lucide.min.js"></script>
<script>lucide.createIcons();</script>

<!-- Use directly in markup -->
<i data-lucide="receipt-text"></i>
<i data-lucide="settings"></i>
```

```css
[data-lucide] {
    width: 18px; height: 18px;
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
}
```

## Cyanlog → Lucide name mapping

The legacy sprite IDs (`i-quote`, `i-tender`, …) are kept for backwards compatibility with the original v3 prototype. New work should use the Lucide names on the right.

| Sprite ID | Lucide name | Use |
|---|---|---|
| `i-home` | `home` | Home / dashboard |
| `i-login` | `log-in` | Login button |
| `i-briefcase` | `briefcase` | Opportunities |
| `i-file-plus` | `file-plus` | Lead intake / new |
| `i-network` | `network` | Opportunity routing |
| `i-quote` | `receipt-text` | Quote center — 报价单 |
| `i-tender` | `file-text` | Tender — 标书 |
| `i-contract` | `file-signature` | Contracts — 合同 |
| `i-calendar` | `calendar` | Schedule |
| `i-clock` | `clock` | Time / deadline |
| `i-approval` | `check-square` | Approvals |
| `i-settings` | `settings` | Config |
| `i-search` | `search` | Search |
| `i-bell` | `bell` | Notifications |
| `i-user` | `user` | Account |
| `i-chart` | `bar-chart-3` | Analytics |
| `i-layer` | `layers` | Modules / structure |
| `i-arrow-right` | `arrow-right` | Forward / CTA |
| `i-download` | `download` | Export |
| `i-check-circle` | `check-circle-2` | Confirmed state |

## Two ways to render

**1 — Direct Lucide (preferred for new work):**

```html
<i data-lucide="settings" class="i"></i>
```

**2 — Sprite reference (legacy, for offline / sprite-only builds):**

```html
<svg class="i" aria-hidden="true"><use href="./assets/icons.svg#i-settings"></use></svg>
```

Both render the same Lucide path data — the sprite was refreshed to match Lucide geometry exactly so the two render paths produce visually identical icons.

## Style conventions

- **Stroke 1.6** (not Lucide's default 2.0 — slightly lighter for a more refined feel on Chinese-text pages)
- **Outline only.** Never use Lucide's filled variants (`*-square`, `*-filled`).
- **No swapping mid-flow.** Pick Lucide OR the sprite per page and stay consistent. Don't mix sources inside a single component.
- **Icon-chips** (`.icon-chip`, 36 × 36 / 10 px radius) hold a 22 px icon (`.i-lg`). They use `--ink-100` background by default, `--accent-soft` for the brand variant.

## Sizing

| Class | Size | Use |
|---|---|---|
| `.i-sm` | 14 px / stroke 1.8 | Inside pills, small buttons |
| `.i` | 18 px / stroke 1.6 | Default — inline body, table cells, buttons |
| `.i-lg` | 22 px / stroke 1.5 | Icon-chips, standalone affordances |

## Iconographic principles

- **No emoji in product chrome.** The v3 prototype contains zero emoji and we keep it that way. Status is communicated through pills with leading dots, not emoji.
- **No Unicode glyphs as icons** (no `▼`, `✓`, `★`). Always use Lucide.
- **Icons are decorative, never load-bearing.** Every icon has a text label adjacent — sidebar items, button labels, table headers. The product remains readable even if icons fail to load. This matters for offline screenshots and PDF exports.
- **Icon + label spacing is 8 px** (`--sp-2`).

## Illustration

The prototype includes **one** illustration:

- `assets/illustrations/login-secure.svg` — abstract "secure workspace" hero. Geometric, monochrome with cyan/blue accent. Used only on the login page.

This is the **only** illustration in the system. The product does **not** use spot illustrations for empty states, onboarding, or marketing surfaces — it relies on data density and typography for character. If new illustrations are commissioned, they should match the existing one: flat, geometric, single-accent, no characters/people, no gradients.

## Logos & wordmarks

The Cyanlog brand mark is currently a **typographic "CY" inside a rounded square** (no dedicated SVG file in the prototype — it's rendered as `<a class="rail-logo">CY</a>` with a cyan gradient background). For now we treat this as the canonical mark and reproduce it in `ui_kits/platform/components.jsx` as a `<BrandMark />` component.

> ⚠️ **Asset gap.** There is no standalone wordmark, no horizontal lockup, no print version of the Cyanlog logo in the materials provided. If the user has these, please attach them — we'll register them as cards in the Brand section.
