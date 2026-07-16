---
name: Calm Control (desktop)
source: Stitch project "MrClod Remote Agent UI" (projects/13231872836103487679)
colors:
  surface: '#131317'
  surface-dim: '#131317'
  surface-bright: '#39393d'
  surface-container-lowest: '#0e0e12'
  surface-container-low: '#1b1b1f'
  surface-container: '#1f1f23'
  surface-container-high: '#2a292e'
  surface-container-highest: '#353439'
  on-surface: '#e4e1e7'
  on-surface-variant: '#dbc1b8'
  inverse-surface: '#e4e1e7'
  inverse-on-surface: '#303034'
  outline: '#a38c84'
  outline-variant: '#55433c'
  surface-tint: '#ffb59a'
  primary: '#ffb59a'
  on-primary: '#5a1b00'
  primary-container: '#e8825a'
  on-primary-container: '#621e00'
  inverse-primary: '#994523'
  secondary: '#98d0d2'
  on-secondary: '#003738'
  secondary-container: '#0e4f51'
  on-secondary-container: '#87bfc1'
  tertiary: '#ffb3af'
  on-tertiary: '#68000e'
  tertiary-container: '#ff706e'
  on-tertiary-container: '#710010'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  background: '#131317'
  on-background: '#e4e1e7'
  surface-variant: '#353439'
typography:
  display-lg: { fontFamily: Hanken Grotesk, fontSize: 48px, fontWeight: 700, lineHeight: 56px, letterSpacing: -0.02em }
  headline-lg: { fontFamily: Hanken Grotesk, fontSize: 32px, fontWeight: 600, lineHeight: 40px, letterSpacing: -0.01em }
  headline-md: { fontFamily: Hanken Grotesk, fontSize: 24px, fontWeight: 600, lineHeight: 32px }
  body-lg: { fontFamily: Geist, fontSize: 18px, fontWeight: 400, lineHeight: 28px }
  body-md: { fontFamily: Geist, fontSize: 16px, fontWeight: 400, lineHeight: 24px }
  code-md: { fontFamily: JetBrains Mono, fontSize: 14px, fontWeight: 450, lineHeight: 20px }
  label-sm: { fontFamily: JetBrains Mono, fontSize: 12px, fontWeight: 500, lineHeight: 16px, letterSpacing: 0.05em }
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 24px
  gutter: 16px
  sidebar-width: 280px
---

## Brand & Style

"Calm Control Room" — deep near-black surfaces, warm coral accent, soft teal for
positive/status states. Glassmorphism panels (backdrop-blur + translucent fill)
over a fixed dark base. Generous rounded corners (16-28px on major containers),
tactile depth via soft diffused shadows and 1px light-catch borders.

## Colors

- Background: `#0E0E12` (surface-container-lowest), sidebar/header glass at
  `rgba(31,31,35,0.6)` with `backdrop-filter: blur(32px)`.
- Primary accent (coral): `#E8825A` → gradient to `#D66D45` (`coral-gradient`),
  text-on-primary `#FFB59A` for pill labels.
- Secondary (teal): `#7BB3B5` / `#98D0D2` — status dots, "Allow" actions, model
  badges.
- Error/Deny: `#FFB4AB` text on transparent with 30%-opacity error border.
- Borders: `rgba(255,255,255,0.05–0.1)` hairlines for structure without noise.

## Typography

- **Hanken Grotesk** — headlines (brand name, panel titles, display text).
- **Geist** — UI body text, chat messages.
- **JetBrains Mono** — code, commands, model/effort labels, metadata.

## Layout

- Fixed 280px sidebar, glass blur, logo + gradient "New Chat" CTA + nav list +
  footer account row.
- Header: 64px, glass blur, model-badge pill (teal, pulsing dot) + text-tab nav
  (Model Selector / Reasoning Effort / Permission Mode) + Pair Phone button.
- Chat column centered, max-width 900px, 40px vertical rhythm between turns.
  Each turn: 40x40 rounded-xl avatar (user: plain icon; assistant: coral
  gradient) + message column.
- Permission requests render as a `permission-card`: glass gradient panel,
  rounded-3xl, command block on near-black inset, Allow (teal fill) / Deny
  (error-outline ghost) button pair.
- Composer: glass panel pinned to bottom, rounded-2xl, mono placeholder text,
  bottom-right circular gradient send button, focus glow
  `box-shadow: 0 4px 20px -5px rgba(232,130,90,0.3)`.

## Shapes

Sidebar/panels 16-28px radius, buttons 12-16px (pill for chips/badges/status).

## Components

- **Buttons primary**: `coral-gradient` fill, dark text, active:scale-95.
- **Buttons secondary/ghost**: 1px white/10 border, hover bg white/5.
- **Allow**: solid `#7BB3B5` fill. **Deny**: transparent + error/30 border.
- **Badges**: pill, 10% tint background of accent color, full-opacity text.
- **Code/command blocks**: `surface-container-lowest` bg, mono, 1px white/5
  border, radius xl.
