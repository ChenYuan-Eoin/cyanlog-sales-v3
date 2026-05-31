# Cyanlog Platform — UI Kit

A clickable, React-based recreation of the Cyanlog sales-support platform. This kit demonstrates the **refreshed** design system in motion across four representative screens.

## Screens

| Screen | File | Purpose |
|---|---|---|
| Login | `screen-login.jsx` | Auth gate · split visual / form layout |
| Home dashboard | `screen-home.jsx` | Metric strip + dark dock + module tiles + queue table |
| Quote workspace | `screen-quote.jsx` | Left worksheet + right paper preview (serif document) |
| Approval center | `screen-approval.jsx` | Dark left queue + detail + node matrix + console |

## Components

`components.jsx` exports the shared primitives, all to `window.*` so cross-file Babel scripts can use them:

- `Shell`, `Rail`, `Sidebar`, `TopBar` — three-column navigation chrome
- `Card`, `CardHead`, `Stat` — content surfaces
- `Button`, `Pill`, `Field`, `Avatar`, `BrandMark` — primitives
- `Icon` — wraps the sprite at `../../assets/icons.svg`

## Run

Open `index.html` in a browser. The floating switcher at the bottom hops between screens. The sidebar and rail are interactive — clicking nav items also moves between screens.

## Style sources

- `../../colors_and_type.css` — design tokens
- `../../components.css` — button / input / pill / table primitives
- `./shell.css` — Cyanlog-specific page chrome (rail, sidebar, dark dock, paper, approval matrix)
