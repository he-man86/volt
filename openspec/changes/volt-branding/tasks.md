# Tasks — volt-branding

Rebuild `packages/volt-www` to look like cursor.com with Volt brand/content. Design source of truth:
`design.md` + the committed skillui reference. Cross-links (`src/config.js`) are kept, not rewritten.

## 1. Land the design reference

- [x] 1.1 Copy the skillui extraction into `packages/volt-www/design-ref/` (DESIGN.md, token CSS/JSON, motion
      specs, `screenshots/homepage.png`). Delete extractor noise (KaTeX/Lato font-faces; keep the palette,
      spacing, motion, screenshot).
- [x] 1.2 Add a short `design-ref/README.md`: "reference only, never imported; re-run `skillui --url
      https://cursor.com --mode ultra` to refresh." Confirm nothing under `design-ref/` is importable by the build.

## 2. Tokens & fonts

- [x] 2.1 Rewrite `src/tokens/colors.css` to Cursor's palette: `--accent: #f54e00` (+hover), surface ladder
      (`#f7f7f4`/`#f2f1ed`→`#e1e0db`), text `#262626` / muted `#737373`, warm low-α borders (`#26251e` 6–33%),
      semantic success/danger/warning. Keep semantic aliases so components read `var(--…)`.
- [x] 2.2 Set `src/tokens/spacing.css` to the 4px baseline scale and `typography.css` to Cursor's type scale
      (H1 `clamp(3rem,7vw,5rem)/700`, tight display sans; serif family for in-mockup prose).
- [x] 2.3 Wire fonts self-hosted: Inter (display/UI) + JetBrains Mono (code) from existing `@fontsource` deps; add
      `@fontsource/eb-garamond` (in-mockup serif). No CDN/Google-Fonts request.

## 3. Motion primitive

- [x] 3.1 Add a tiny scroll-reveal hook (`IntersectionObserver` → `data-revealed`) + CSS stagger/fade-rise
      transitions; honor `prefers-reduced-motion`. Leave a runnable check that the observer fires (assert-based).

## 4. Chrome & shell

- [x] 4.1 `Nav`: Volt wordmark/mark (left) + centered links (Product/Pricing/FAQ/Changelog/Contact) + right-side
      `Sign in` text link, `Contact` pill-outline, `Download` black pill. CTAs call `window.VOLT.authUrl()` /
      `downloadUrl()`. Label the download "Download for Windows".
- [x] 4.2 `Footer`: multi-column links + legal, Volt brand.
- [x] 4.3 Keep `src/config.js`/`window.VOLT` and `src/shell.jsx` wiring intact; verify `authUrl()`/`downloadUrl()`
      still resolve and honor `VITE_CONSOLE_URL` / `VITE_INSTALLER_URL`.

## 5. Home page (the hero that sells it)

- [x] 5.1 `Hero`: big near-black grotesque headline + subhead + black-pill / gray-pill CTA pair, over a soft Volt
      backdrop (owned gradient/texture — not Cursor's image).
- [x] 5.2 `ProductMockup` (HTML/CSS, no screenshots): layered Volt app window — PLC project tree + ST/VG diff
      panel + a `volt` CLI overlay (`volt pull`, `volt status`). Serif accents inside, per Cursor's composition.
- [x] 5.3 `Features` + `SocialProof` sections with scroll-reveal; assemble into `src/pages/home.jsx`.

## 6. Remaining pages

- [x] 6.1 `pricing.jsx`, `faq.jsx`, `changelog.jsx`, `contact.jsx` in the Cursor-styled layout with Volt copy.
- [x] 6.2 `feature.jsx` detail template + the per-feature entries (volt-git, LSP/compiler intelligence, desktop &
      CLI, privacy/enterprise, …).
- [x] 6.3 Legal `privacy`/`terms` pages.
- [x] 6.4 Update root `index.html` + per-page HTML entry stubs to the new pages; remove archived-attempt leftovers.

## 7. Content pass (after the shell holds)

- [ ] 7.1 Replace draft copy with real Volt messaging across home hero/features/social-proof and every page.
- [ ] 7.2 Feature detail copy: volt-git, LSP/compiler intelligence, desktop & CLI, privacy/enterprise, project
      understanding, AI-native PLC languages.
- [ ] 7.3 Pricing tiers, FAQ answers, changelog entries, contact page — real content.

## 8. Verify

- [x] 8.1 `bun run build` on Windows → static `dist/`; `bun run preview` serves with no backend.
- [x] 8.2 Grep the built `dist/` for brand hygiene: no "Cursor" in user-facing text, no CursorGothic/Berkeley-Mono
      files, no external font/CDN network request.
- [x] 8.3 Click-through: nav CTAs hit `<console>/auth` and the installer release asset; env-var overrides work.
- [x] 8.4 `bun run lint` + `bun typecheck` clean for the package.
