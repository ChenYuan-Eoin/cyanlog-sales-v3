---
name: cyanlog-design
description: Use this skill to generate well-branded interfaces and assets for Cyanlog (青云销售) — a B2B sales-support platform for Chinese enterprise sales teams. Contains essential design guidelines, color and type tokens, fonts, the Lucide-backed icon set, a Cyanlog logo, and a React UI kit recreating the platform's core screens (login, home dashboard, quote workspace, approval center). Use for production work or throwaway prototypes / mocks / slide assets.
user-invocable: true
---

# Cyanlog Design

This skill is the design system for **Cyanlog**, a Chinese enterprise sales-support platform. It covers tokens, components, iconography, and a working UI kit.

## Start by reading

1. **`README.md`** — full brand context, content fundamentals, visual foundations, and an index of all files.
2. **`ICONOGRAPHY.md`** — iconography conventions (Lucide CDN is the primary source).
3. **`colors_and_type.css`** — every design token as CSS variables. Link this file first in any output.
4. **`components.css`** — button / input / pill / card / table primitives.

## Key files

| File | What it is |
|---|---|
| `colors_and_type.css` | All tokens (color, ink, spacing, radii, shadows, type) |
| `components.css` | Button / pill / input / card / table / avatar / toggle / kbd |
| `assets/icons.svg` | 19-icon line sprite (Lucide-geometry, self-hosted fallback) |
| `assets/illustrations/login-secure.svg` | The single brand illustration |
| `ui_kits/platform/` | React recreation of login + home + quote + approval |
| `ui_kits/platform/shell.css` | Cyanlog page chrome (rail, sidebar, dark dock, paper) |

## How to use

**For visual artifacts (slides, mocks, throwaway prototypes):**
- Copy `colors_and_type.css` and `components.css` into the output project.
- Pull `assets/icons.svg` and any needed illustration.
- Load fonts via the Google Fonts CDN: Geist (display + body), JetBrains Mono (numerics), Noto Serif SC (only on the paper/document surfaces inside quote, tender, contract).
- Match the writing rules in `README.md § Content fundamentals` — operational Chinese, imperative verbs, no emoji, exact numbers.

**For production code:**
- Read `colors_and_type.css` and use the CSS variables — don't hardcode hex.
- Reference Lucide via CDN per `ICONOGRAPHY.md`. Keep stroke 1.6.
- Card layout: 16 px radius, 24 px padding, soft single-layer shadow (`--shadow-1`). Don't stack shadows.
- Use `--accent` (cyan-600 #0D8EA4), not Tailwind blue. The product is named *Cyan*log.

## When invoked without specifics

Ask the user:

1. What surface do you want to design? (slide, screen, marketing page, full prototype …)
2. Which Cyanlog screen(s) should this fit into — or is this new?
3. Hi-fi recreation or a free riff on the brand?
4. Any specific data / copy to use? (Cyanlog leans on real-looking Chinese enterprise scenarios — 华润万家、省医疗云、连锁零售续约, etc.)

Then act as an expert designer who outputs HTML artifacts or production code per the conventions in `README.md`.

## Brand identity at a glance

- **Voice:** operational Chinese, imperative verbs, exact numbers, no emoji, no marketing fluff.
- **Color:** cyan-teal accent (`#0D8EA4`) on a true-graphite neutral ramp. Navigation shell is `#06080D`.
- **Type:** Geist for display + body, JetBrains Mono for tabular numerics, Noto Serif SC only inside document "paper" surfaces.
- **Radii:** controls 10 px · cards 16 px · hero 24 px.
- **Shadows:** one soft ramp, neutral ink, never tinted.
- **Iconography:** Lucide (stroke 1.6, outline only), no emoji.
- **Layout:** 72 px rail · 272 px sidebar · 64 px topbar · 28 px content padding.

## Anti-patterns to avoid

- Tailwind-blue `#2563eb` as primary — that was the v3 prototype's mistake. Always use cyan-600.
- Stacked colored shadows on accent buttons.
- Glassmorphism in workspace chrome (only allowed on the auth marketing pane).
- Emoji anywhere.
- Hand-rolled SVG quote marks / icons. Use Lucide.
- Left-border-accent cards (the "chat app" trope).
- "Get started"-style English-imported marketing copy. Cyanlog speaks 操作语言.
