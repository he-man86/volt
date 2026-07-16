# cursor DESIGN.md

> Auto-generated design system — reverse-engineered via static analysis by skillui.
> Frameworks: None detected
> Colors: 20 · Fonts: 3 · Components: 9
> Icon library: not detected · State: not detected
> Primary theme: light · Dark mode toggle: no · Motion: expressive

## Visual Reference

**Match this design exactly** — study colors, fonts, spacing, and component shapes before writing any UI code.

![cursor Homepage](../screenshots/homepage.png)

---

## 1. Visual Theme & Atmosphere

This is a **light-themed** interface with a warm, approachable feel. The light background emphasizes content clarity. Typography pairs **KaTeX_AMS** for display/headings with **KaTeX_Caligraphic** for body text, creating clear visual hierarchy through type contrast. Spacing follows a **4px base grid** (compact density), with scale: 2, 4, 6, 8, 10, 12, 14, 16px. The accent color **#f54e00** anchors interactive elements (buttons, links, focus rings). Motion is expressive — spring physics, layout animations, and staggered reveals are part of the visual language.

---

## 2. Color Palette & Roles

| Token | Hex | Role | Use |
|---|---|---|---|
| tw-ring-offset-color | `#ffffff` | background | Page background, darkest surface |
| theme-color | `#f7f7f4` | surface | Card and panel backgrounds |
| color-theme-card-03-hex | `#e6e5e0` | surface | Card and panel backgrounds |
| color-neutral-800 | `#262626` | text-primary | Headings and body text |
| color-neutral-500 | `#737373` | text-muted | Captions, placeholders, secondary info |
| color-theme-fg-02 | `#3c3935` | border | Dividers, card borders, outlines |
| color-theme-accent | `#f54e00` | accent | CTAs, links, focus rings, active states |
| color-theme-product-ansi-red | `#cf2d56` | danger | Error states, destructive actions |
| color-theme-product-ansi-green | `#1f8a65` | success | Success states, positive indicators |
| warning | `#c08532` | warning | Warning states, caution indicators |
| color-slate-200 | `#e2e8f0` | info | Informational highlights |
| color-black | `#000000` | unknown | Palette color |
| color-neutral-900 | `#171717` | unknown | Palette color |
| color-theme-fg-02 | `#d9d5cf` | unknown | Palette color |
| unknown | `#c9a227` | unknown | Palette color |
| unknown | `#1a7f37` | unknown | Palette color |
| unknown | `#3b82f6` | unknown | Palette color |
| unknown | `#4a443b` | unknown | Palette color |
| unknown | `#b6b9be` | unknown | Palette color |
| unknown | `#8bc4f8` | unknown | Palette color |

### CSS Variable Tokens

```css
--tw-border-style: solid;
--color-theme-card-hex: #f2f1ed;
--color-theme-accent: #f54e00;
--color-theme-card-01-hex: #f0efeb;
--color-theme-card-02-hex: #ebeae5;
--color-theme-card-03-hex: #e6e5e0;
--color-theme-card-04-hex: #e1e0db;
--color-theme-card-warm-hex: #f3ede6;
--color-theme-border-01: #26251e06;
--color-theme-border-01-5: #26251e0d;
--color-theme-border-02: #26251e1a;
--color-theme-border-02-5: #26251e33;
--color-theme-border-03: #26251e99;
--color-theme-border: var(--color-theme-border-01);
--color-theme-card-hover-hex: #ebeae5;
--color-theme-card-hover-light-hex: #f0efeb;
--color-theme-card-hover-border: var(--color-theme-border-02);
--color-theme-button-hover-border: var(--color-theme-fg-02);
--color-theme-button-sec-border: var(--color-theme-border-03);
--prose-code-border: var(--color-theme-border-01);
```


---

## 3. Typography Rules

**Font Stack:**
- **KaTeX_Caligraphic** — Heading 1, Heading 2, Heading 3
- **KaTeX_AMS** — Body, Caption
- **SFMono-Regular** — Code

**Font Sources:**

```css
@font-face {
  font-family: "KaTeX_AMS";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_AMS-Regular.0p1vbqd84i2~o.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Caligraphic";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Caligraphic-Bold.01-pzluls4zgb.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "KaTeX_Caligraphic";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Caligraphic-Regular.0rysu1t-ncjq8.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Fraktur";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Fraktur-Bold.0w23i72~hprpq.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "KaTeX_Fraktur";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Fraktur-Regular.0rekyoa-52fj_.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Main";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Main-Bold.16pfc63_du6mx.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "KaTeX_Main";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Main-Italic.06o5nq0_91v60.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Math";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Math-BoldItalic.0ja97dn.cpc87.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "KaTeX_Math";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Math-Italic.0zrha2c4sl2je.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_SansSerif";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_SansSerif-Bold.05a9.pc1j_zx9.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "KaTeX_SansSerif";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_SansSerif-Italic.0a0234dc3s62j.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Script";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Script-Regular.0c4.h-mer83d_.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Size1";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Size1-Regular.013x6a4ierotp.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Size2";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Size2-Regular.0d5inmyp-tyv3.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Size3";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Size3-Regular.0iukctyhw5j56.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Size4";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Size4-Regular.0w3.rb_c4stzk.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "KaTeX_Typewriter";
  src: url("https://cursor.com/marketing-static/_next/static/media/KaTeX_Typewriter-Regular.0c4zdxz~8frhm.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "CursorGothic";
  src: url("https://cursor.com/marketing-static/_next/static/media/CursorGothic_Regular-s.p.05-84umc_47y9.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "CursorGothic";
  src: url("https://cursor.com/marketing-static/_next/static/media/CursorGothic_Bold-s.p.15hkw~ebmtjvr.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "berkeleyMono";
  src: url("https://cursor.com/marketing-static/_next/static/media/BerkeleyMono_Regular.p.0x~g-6.~uijej.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "EB Garamond";
  src: url("https://cursor.com/marketing-static/_next/static/media/196d5f6118cb1c52.0rhpwbwwx4_6f.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "Lato";
  src: url("https://cursor.com/marketing-static/_next/static/media/5423f56a4e793434-s.0w5p5h~sjkasz.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 400;
}
@font-face {
  font-family: "Lato";
  src: url("https://cursor.com/marketing-static/_next/static/media/f0e3cf4bb5eec8ca-s.0p6mredkl8--3.woff2?dpl=dpl_H1n9WJ1keS64aZr6U4ipimSc6vhY");
  font-weight: 700;
}
@font-face {
  font-family: "CursorIcons16";
  src: url("https://cursor.com/marketing-static/fonts/cursor-icons-16.woff2") format("woff2");
  font-weight: 400;
}
```

| Role | Font | Size | Weight |
|---|---|---|---|
| Heading 1 | KaTeX_Caligraphic | clamp(3rem,7vw,5rem) | 700 |
| Heading 2 | KaTeX_Caligraphic | 28px | 700 |
| Heading 3 | KaTeX_Caligraphic | 1.5rem | 700 |
| Body | KaTeX_AMS | .75rem | 400 |
| Caption | KaTeX_AMS | .8rem | 400 |
| Code | SFMono-Regular | 14px | 400 |

**Typographic Rules:**
- Limit to 3 font families max per screen
- Use **KaTeX_Caligraphic** for body/UI text, **KaTeX_AMS** for display/headings
- Maintain consistent hierarchy: no more than 3-4 font sizes per screen
- Headings use bold (600-700), body uses regular (400)
- Line height: 1.5 for body text, 1.2 for headings
- Use color and opacity for secondary hierarchy, not additional font sizes


---

## 4. Component Stylings

### Layout (1)

**Footer** — `html`

### Navigation (1)

**Navigation** — `html`

### Data Display (2)

**Card** — `html`
- Variants: `-sub-nav`, `-flyout`, `03)]`, `03-hex`, `04-hex`

**Badge** — `html`

### Data Input (2)

**Button** — `html`
- Variants: `caret`, `caret--sm`, `-secondary`, `-sm`
- Animation: 

**Input** — `html`
- State: :focus, :placeholder

### Media (3)

**Image** — `html`

**Icon** — `html`

**Map/Canvas** — `html`



---

## 5. Layout Principles

- **Base spacing unit:** 4px
- **Spacing scale:** 2, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 26
- **Border radius:** inherit, .25rem, 1px, 1.5px, 2px, 3px, 4px, 5px, 6px, 10px, 12px, 14px, 16px, 18px, 19px, 20px, 22px, 23px, 28px, 40px, 99em, 100px, 999px
- **Max content width:** 1040px

**Spacing as Meaning:**
| Spacing | Use |
|---|---|
| 4-8px | Tight: related items within a group |
| 12-16px | Medium: between groups |
| 24-32px | Wide: between sections |
| 48px+ | Vast: major section breaks |


---

## 6. Depth & Elevation

### Flat — subtle depth hints

- `0 0 0 1px rgb(var(--mobile-interaction-accent-color)/.24)`
- `0 1px 2px #0000001a`
- `0 0 0 2px var(--color-warning)`

### Raised — cards, buttons, interactive elements

- `var(--visual-feedback-number-shadow)`
- `var(--visual-feedback-prompt-shadow)`
- `inset 0 0 0 1px rgb(var(--mobile-interaction-color)/.22),inset 0 0 8px rgb(var(--mobile-interaction-color)/.08)`

### Floating — dropdowns, popovers, modals

- `inset 0 1px #ffffff9e,inset 0-1px 1px #ffffff1f,0 6px 16px #1f435b1f,0 1px 1px #0000000f`
- `inset 0 1px #ffffff21,inset 0-1px 1px #0000001f,0 5px 14px #00000024,0 1px 1px #0000001f`
- `inset 0 0 0 1px rgb(var(--mobile-interaction-color)/.52),inset 0 0 12px rgb(var(--mobile-interaction-color)/.24)`

### Overlay — full-screen overlays, top-level dialogs

- `inset 0 0 0 1000px #e8f0fe`

### Z-Index Scale

`0, 1, 2, 5, 6, 10, 15, 20, 25, 30, 40, 50, 51, 80, 100, 200, 300, 1000, 9999, 99999`



---

## 7. Animation & Motion

This project uses **expressive motion**. Animations are an integral part of the experience.

### CSS Animations

- `@keyframes navItemSlideIn`
- `@keyframes navItemSlideOut`
- `@keyframes navItemFade`
- `@keyframes shimmer`
- `@keyframes shimmer-slide`
- `@keyframes fade-in`
- `@keyframes mobile-chat-enter`
- `@keyframes mobile-interaction-pulse`

### Animated Components

- **Button**: 

### Motion Guidelines

- Duration: 150-300ms for micro-interactions, 300-500ms for page transitions
- Easing: `ease-out` for enters, `ease-in` for exits
- Always respect `prefers-reduced-motion`


---

## 8. Do's and Don'ts

### Do's

- Use `#f54e00` for interactive elements (buttons, links, focus rings)
- Use `#ffffff` as the primary page background
- Pair **KaTeX_Caligraphic** (body) with **KaTeX_AMS** (display) — these are the only allowed fonts
- Follow the **4px** spacing grid for all margins, padding, and gaps
- Use the defined shadow tokens for elevation — see Section 6
- Use border-radius from the scale: inherit, .25rem, 1px, 1.5px, 2px
- Reuse existing components from Section 4 before creating new ones

### Don'ts

- Don't introduce colors outside this palette — extend the design tokens first
- Don't introduce additional font families beyond KaTeX_Caligraphic and KaTeX_AMS and SFMono-Regular
- Don't use arbitrary spacing values — stick to multiples of 4px
- Don't create custom box-shadow values outside the system tokens
- Don't use arbitrary border-radius values — pick from the defined scale
- Don't duplicate component patterns — check Section 4 first
- Don't use backdrop-blur or blur effects

### Anti-Patterns (detected from codebase)

- No blur or backdrop-blur effects
- No zebra striping on tables/lists


---

## 9. Responsive Behavior

| Name | Value | Source |
|---|---|---|
| xs | 360px | css |
| xs | 420px | css |
| sm | 600px | css |
| sm | 630px | css |
| sm | 640px | css |
| md | 660px | css |
| md | 767px | css |
| md | 768px | css |
| lg | 900px | css |
| lg | 1024px | css |
| xl | 1139px | css |
| xl | 1140px | css |
| xl | 1180px | css |
| xl | 1279px | css |
| 2xl | 1380px | css |
| 2xl | 1470px | css |

**Approach:** Use `@media (min-width: ...)` queries matching the breakpoints above.


---

## 10. Agent Prompt Guide

Use these as starting points when building new UI:

### Build a Card

```
Background: #f7f7f4
Border: 1px solid #3c3935
Radius: 14px
Padding: 16px
Font: KaTeX_Caligraphic
Use shadow tokens from Section 6.
```

### Build a Button

```
Primary: bg #f54e00, text white
Ghost: bg transparent, border #3c3935
Padding: 8px 16px
Radius: 14px
Hover: opacity 0.9 or lighter shade
Focus: ring with #f54e00
```

### Build a Page Layout

```
Background: #ffffff
Max-width: 1040px, centered
Grid: 4px base
Responsive: mobile-first, breakpoints from Section 9
```

### Build a Stats Card

```
Surface: #f7f7f4
Label: #737373 (muted, 12px, uppercase)
Value: #262626 (primary, 24-32px, bold)
Status: use success/warning/danger from Section 2
```

### Build a Form

```
Input bg: #ffffff
Input border: 1px solid #3c3935
Focus: border-color #f54e00
Label: #737373 12px
Spacing: 16px between fields
Radius: 14px
```

### General Component

```
1. Read DESIGN.md Sections 2-6 for tokens
2. Colors: only from palette
3. Font: KaTeX_Caligraphic, type scale from Section 3
4. Spacing: 4px grid
5. Components: match patterns from Section 4
6. Elevation: shadow tokens
```
