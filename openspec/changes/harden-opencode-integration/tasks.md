## 1. Channel → in-code prod default (Tier 0/2 — fix the plain-opencode base)
- [x] `packages/desktop/electron.vite.config.ts`: channel default `"dev"` → `"prod"`
- [x] `packages/app/vite.js`: channel default `"dev"` → `"prod"` (new 16th seam)
- [x] `volt-scripts/check-divergence.ts`: allowlist `packages/app/vite.js` as a seam
- [x] `CLAUDE.md`: add `packages/app/vite.js` to the seam list (→ 16); fix the "12 seams" vs "15 seams" inconsistency
- [x] `.env`: remove `OPENCODE_CHANNEL=prod` (decouple from secrets; `build-installer.ts` keeps forcing it as belt-and-suspenders)
- [x] Footgun proven fixed: bypass build (no env) now resolves `VITE_OPENCODE_CHANNEL="prod"`
- [ ] Build installer; confirm the desktop ships **V1** with no env set

## 2. Plugin → vendored (Tier 5)
- [ ] `dist.ts`: vendor `@opencode-ai/plugin` (+ its runtime deps) into `dist/volt/plugin/`
- [ ] `electron-builder.config.ts`: ship it in the install resources
- [ ] `opencode-config.ts`: copy the vendored plugin into `.opencode/node_modules` at init (drop the runtime PM install + `.opencode/package.json`)
- [ ] Test: `volt init` in a temp dir with NO bun/npm on PATH → the volt tool loads + chat works
- [ ] Build installer; confirm

## 3. Spinner (Tier 5) — confirm, no change
- [ ] Keep the value-reference + the `dist.ts` grep guard (audited sound)

## 4. Docs / cleanup
- [ ] CLAUDE.md: "outside those **12** seams" → 15 (consistency with the rest)
- [ ] CLAUDE.md: `deep-links.ts` is a **replacement** of `opencode://`→`volt://`, not "coexist" (only the two apps coexist)
- [ ] `.husky/pre-push`: delete the dead commented `# bun typecheck` line

## 5. session.tsx (Tier 4) — the ceiling
- [ ] Document `session.tsx` as the irreducible hot seam (315 commits/6mo, 8 interleaves)
- [ ] Draft an upstream `registerChangeSource({id,label,query,header})` proposal — collapses 8 conflict sites to 1
