## ADDED Requirements

### Requirement: The authenticated console wears Volt's brand via the token layer

The vendored console's authenticated app SHALL present Volt's brand — Volt palette, Volt type (Inter + JetBrains
Mono), Volt logo — sourced from the Volt Design System. This SHALL be achieved by rewriting the **values** of the
existing CSS custom-property tokens (`app/src/style/token/color.css`, `font.css`), preserving opencode's variable
**names** so every `var(--…)` reference in the vendored routes still resolves. The design system's token file SHALL
NOT be copied over the console's verbatim (that renames variables and breaks references). Fonts SHALL be
self-hosted, not loaded from a third-party CDN.

#### Scenario: The whole authenticated app reskins from the token edit alone
- **WHEN** the token values are remapped to Volt's palette and type, with no vendored route file touched
- **THEN** every authenticated surface (workspace, billing, settings, user-menu) renders in Volt colors and Inter
  in both light and dark, with no opencode-blue or mono-only leftovers

#### Scenario: A subsequent opencode bump still merges cleanly
- **WHEN** opencode releases a bugfix and the console is re-pulled to a new pinned tag
- **THEN** the reskin is confined to two allowlisted token files, so non-token opencode changes merge without
  conflict, and an upstream **rename** of a token variable trips the divergence gate (surfacing that the value
  remap must be re-applied)

### Requirement: The rebrand keeps the console-divergence gate honest

The reskin SHALL remain compatible with `check-console-divergence.ts`. The branded token files SHALL be added to
the gate's `ALLOW` list (kept in the diff, not excluded, so structural drift is still detected) and documented in
`DIVERGENCE.md`; the `ALLOW` list and `DIVERGENCE.md` SHALL agree. Brand image assets SHALL be handled per the
established "branding is Volt's to own" precedent.

#### Scenario: The gate passes on intended branding divergence and still catches accidents
- **WHEN** `bun volt-scripts/check-console-divergence.ts` runs after the reskin
- **THEN** it exits 0 reporting only the intended branded files, and any *unlisted* edit to a vendored source file
  still fails the gate

### Requirement: Volt's marketing site is a separate surface from the vendored console

Volt's public landing pages SHALL be built from the Volt Design System's `ui_kits/website/*` as a separate
Volt-owned surface (`packages/volt-www`), not by forking-and-editing opencode's vendored marketing routes. Because
that surface is separate, opencode's marketing routes and dead infra-proxies SHALL be deleted from the console
(recorded in the divergence allowlist + `DIVERGENCE.md`), leaving the vendored tree as the app + gateway + API; the
console's `/` SHALL redirect to the app. The landing and the console SHALL share one design system (the Phase-1
tokens) so their palette and type match. The landing's sign-in SHALL link into the console's existing OpenAuth flow
rather than re-implementing authentication.

#### Scenario: The public face is Volt, and no opencode branding remains
- **WHEN** a visitor reaches any public URL of the deployment
- **THEN** they see Volt's landing (hero, features, pricing, FAQ) with Volt branding, and no route renders
  opencode's marketing pages or brand

#### Scenario: Signing up funnels into the existing backend
- **WHEN** the visitor clicks "Start Free" / sign-in on the landing
- **THEN** they enter the console's existing OpenAuth flow and reach the already-live Go subscription funnel — no
  auth or billing logic is duplicated on the landing
