---
name: MrClod Companion
colors:
  surface: '#1a110e'
  surface-dim: '#1a110e'
  surface-bright: '#423733'
  surface-container-lowest: '#140c09'
  surface-container-low: '#231a16'
  surface-container: '#271e1a'
  surface-container-high: '#322824'
  surface-container-highest: '#3d322f'
  on-surface: '#f1dfd9'
  on-surface-variant: '#dbc1b8'
  inverse-surface: '#f1dfd9'
  inverse-on-surface: '#382e2b'
  outline: '#a38c84'
  outline-variant: '#55433c'
  surface-tint: '#ffb59a'
  primary: '#ffb59a'
  on-primary: '#5a1b00'
  primary-container: '#e8825a'
  on-primary-container: '#621e00'
  inverse-primary: '#994523'
  secondary: '#f4b9a3'
  on-secondary: '#4b2718'
  secondary-container: '#663c2c'
  on-secondary-container: '#e1a893'
  tertiary: '#54dace'
  on-tertiary: '#003733'
  tertiary-container: '#07b0a5'
  on-tertiary-container: '#003c38'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdbce'
  primary-fixed-dim: '#ffb59a'
  on-primary-fixed: '#380d00'
  on-primary-fixed-variant: '#7b2f0d'
  secondary-fixed: '#ffdbce'
  secondary-fixed-dim: '#f4b9a3'
  on-secondary-fixed: '#321206'
  on-secondary-fixed-variant: '#663c2c'
  tertiary-fixed: '#74f7eb'
  tertiary-fixed-dim: '#54dace'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#00504b'
  background: '#1a110e'
  on-background: '#f1dfd9'
  surface-variant: '#3d322f'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-margin: 20px
  gutter: 16px
---

## Brand & Style

The brand personality for the design system is characterized as a "Dark, Cozy Developer Companion." It balances the high-utility requirements of a coding tool with a warm, approachable aesthetic that reduces cognitive load during long development sessions. 

The design style is **Modern Corporate with Tactile accents**. It leverages a deep, obsidian-toned palette to minimize eye strain while using warm highlights and soft glows to create an inviting atmosphere. The interface should feel precise yet comfortable, avoiding the clinical coldness of traditional IDEs in favor of a "study-room" vibe. This is achieved through generous whitespace, subtle depth, and high-quality typography.

## Colors

The color palette is built on a foundation of deep, warm charcoals and off-whites. 

- **Primary Accent (#E8825A):** A warm coral used sparingly for call-to-actions and active states, providing a human touch to the technical interface.
- **Neutral Foundation:** The background (#0E0E12) and surface (#1A1A20) colors use a very low-chroma blue-tinted grey to ensure depth without feeling "pitch black."
- **Typography:** The main text (#F4F2ED) is an off-white that reduces contrast harshness against the dark background, while muted text (#8B8B96) handles secondary information.
- **Borders:** Subtle separation is maintained using #26262E, ensuring the UI remains structured but not boxed-in.

## Typography

This design system utilizes a dual-font strategy to distinguish between UI orchestration and technical content.

- **Inter:** Used for all interface elements, navigation, and primary communication. It provides a neutral, highly readable geometric base.
- **JetBrains Mono:** Reserved for code snippets, file paths, terminal outputs, and metadata. Its increased x-height and clear character distinctions make it ideal for developer-centric data.

Typography follows a strict hierarchy. Headlines use slight negative letter-spacing for a more compact, professional look. Code blocks should always utilize the specific line-heights defined to ensure readability in multi-line snippets.

## Layout & Spacing

The layout philosophy is **contextual and airy**, prioritizing focus. 

- **Grid:** On mobile, use a single-column fluid layout with 20px side margins. 
- **Rhythm:** A 4px baseline grid governs all spacing. Use 16px (md) for most internal padding within cards and 24px (lg) for vertical section spacing.
- **Breathing Room:** Content should never feel cramped. Code blocks and chat bubbles should include generous internal horizontal padding (16px) to maintain a premium feel.

## Elevation & Depth

Visual hierarchy is established through **Tonal Layers** and **Subtle Glows**.

- **Level 0 (Background):** #0E0E12.
- **Level 1 (Cards/Surfaces):** #1A1A20. Surfaces are distinguished by a 1px solid border (#26262E).
- **Interactive Depth:** Primary buttons and active state cards utilize a very soft, diffused drop shadow tinted with the primary coral color (e.g., `0px 4px 20px rgba(232, 130, 90, 0.15)`).
- **Modals:** Use a heavy backdrop blur (20px) to maintain the "Glassmorphism" feel while focusing the user on the task at hand.

## Shapes

The shape language is consistently rounded to reinforce the "cozy" brand personality.

- **Cards & Major Surfaces:** Use a 16px radius for a friendly, modern container feel.
- **Buttons:** Use a slightly tighter 14px radius to distinguish them from the larger containers they sit within.
- **Inputs & Small UI:** 12px radius ensures consistency across the interactive elements.
- **Chips/Status Tags:** Fully pill-shaped to denote they are clickable or represent discrete metadata.

## Components

### Buttons
- **Primary:** Background #E8825A, Text #0E0E12 (bold). 14px radius. 
- **Secondary:** Border #26262E, Text #F4F2ED. No background.
- **Ghost:** No border or background. Text #8B8B96.

### Cards
- Background #1A1A20, Border 1px #26262E. 16px padding. Used for chat messages, file lists, and stats.

### Inputs (Terminal/Search)
- Background #0E0E12 (recessed look), Border 1px #26262E. Text uses JetBrains Mono for a "coding" feel. Active state uses a 1px #E8825A border.

### Chips & Badges
- Used for file types (e.g., `.js`, `.py`) and status indicators. 
- Height: 24px. Radius: Pill. Font: JetBrains Mono (sm).

### Code Blocks
- Background #0E0E12. Subtle 1px border. Syntax highlighting should use a custom theme based on the Primary Coral and Success Green, with additional muted violets and blues.

### Progress Indicators
- Smooth, rounded bars. Background #26262E with a Primary Coral fill. For "Success" states (e.g., build passed), use #4ADE80.