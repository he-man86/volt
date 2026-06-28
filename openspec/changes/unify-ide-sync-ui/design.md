## Context

Volt models the live IDE as a git remote (`refs/remotes/volt/ide`, D11). That gives the user **two
git-like relationships**, surfaced in **two UIs**:

- **git axis** — working tree ↔ HEAD, history, merge — owned by the host's built-in git UI.
- **IDE axis** — working tree ↔ `volt/ide` (incoming/outgoing drift), pull/push/build — owned by Volt.

They're bidirectionally coupled (Volt `push` auto-commits; `pull` is `git merge`) yet shown in
separate places, which reads as two apps. The IDE axis cannot fold into git: a change the engineer
makes directly in CODESYS is invisible to git until `volt pull` brings it across — so Volt-specific
controls and an IDE-diff view must remain. The goal is to **co-locate** the IDE axis inside the
host's native changes UI, as a peer of git.

### What the code actually exposes (verified)

- Desktop changes dropdown: `packages/app/src/pages/session.tsx:819` `<Select options={changesOptions()}>`,
  options `["git","branch","turn"]` (lines 361–371). git/branch → `sdk().client.vcs.diff({ mode })`;
  turn → the AI turn's `summary.diffs`. `reviewDiffs()` (405–410) selects by `store.changes`; **all
  sources render through the one `SessionReview` pipeline.**
- Current desktop seam: hard-coded `<Tabs.Trigger value="volt">` + `<VoltPanel>` in
  `session-side-panel.tsx:278/345` (phase 2).
- VS Code: the SCM API is multi-provider (`vscode.scm.createSourceControl`) — a native, generic hook;
  Git is itself one provider.

## Goals / Non-Goals

**Goals:**
- One place per renderer: the IDE axis sits in the host's native changes UI, beside git.
- Keep all controls (Pull/Push/Build) and both diff directions (incoming/outgoing) + health.
- Stay easily mergeable with upstream — prefer a generic hook over a per-feature edit.

**Non-Goals:**
- Rebuilding git history/merge/staging inside Volt (rejected option [3]).
- Merging the two axes into one (the IDE axis is genuinely distinct).
- Making the bridge a real git remote-helper (option [0]) — out of scope here; it can't express
  Volt's push semantics (declarative set/delete, `ifVersion`, read-only refusal) or IDE-specific drift.

## Decisions

- **VS Code → native SCM provider group.** Register Volt's IDE-sync as a `SourceControl` so it renders
  beside Git in the one Source Control panel; retire the separate `⚡` activity-bar view. *Why:* the
  platform feature built for exactly this; zero git reinvention; one panel.
- **Desktop → "IDE" source in the changes dropdown.** Add a `ChangeMode` "ide" that renders IDE drift
  through the existing `SessionReview` pipeline. *Why:* reuses the native diff viewer; matches the
  user's mental model ("pick what changes to look at").
- **Controls ride with the view.** Selecting the IDE group/source exposes Pull/Push/Build + health —
  not a read-only diff. *Why:* the user must *control* `volt pull`/`push`, not just see drift.
- **Lean on git, don't wrap it.** git keeps owning history/merge/staging in both renderers.
- **VS Code uses the *full* `SourceControl` provider** (its own resource group + count badge + native gutters), not a lighter relocation — the genuinely native result.
- **Desktop is a minimal-mount seam, not an upstream hook.** opencode is **not** expected to accept a generic diff-source hook, so the "IDE" option is a *minimal mount* in `session.tsx`: all logic lives in fork-owned `volt-app`/`volt-control`; the upstream edit is the smallest insertions (append `"ide"` to the source list; early-return delegation in `reviewDiffs()`; controls + health from a Volt component). Registered in the seam ledger + `check-divergence` allowlist, reconciled by `merge-upstream` like any seam. It **relocates** the existing `session-side-panel.tsx` tab seam rather than adding a net-new one.
- **Controls:** Pull/Push/Build shown when "IDE" is the selected source; a bridge-health dot stays visible by the dropdown regardless of source.
- **Retire** the separate tab / `⚡` view; the co-located version replaces it.

## Risks / Trade-offs

- **Deeper upstream seam (desktop).** Adding a `ChangeMode` edits `session.tsx`'s source list +
  `reviewDiffs()` — upstream machinery that changes often. opencode is not expected to accept a
  generic hook, so this stays a **tracked seam**. → *Mitigation:* keep it a **minimal mount** — all
  logic in fork-owned code, only one-line insertions upstream, crafted to merge cleanly (append, not
  insert; early-return delegation). It **relocates** the existing tab seam, so the seam *budget*
  doesn't grow. `check-divergence` allowlists it; `merge-upstream` reconciles it.
- **Dropdown shows one source at a time** (git *or* IDE), vs VS Code showing both groups at once →
  decide whether selecting "IDE" replaces or sits beside the git view in desktop.
- **The IDE diff data path differs from git's.** git/branch come from the server VCS endpoint; the IDE
  diff must come from `volt-control` (CLI/bridge via `window.volt`), shaped to the same diff type.

## Migration Plan

Land VS Code (self-contained, native hook) first; do the desktop dropdown second behind the
pluggable-source decision. Keep the old tab/view until the co-located version is proven, then retire.

## Implementation notes (VS Code slice)

- **Onboarding (final)**: the `⚡` activity-bar view + welcome are retired; connector auto-detect dropped;
  commands cleaned (removed `volt.init`, `openCodesysVersion`, `selectTwincatProject`). `volt.setup` is now a
  **live-bridge picker** — it probes the configured TwinCAT/CODESYS ports (`probeHealth`) and lists each
  *connected* IDE + its project (`healthLabel`) to bind to, so you can only init what's live and you see the
  project first. A status-bar `⚡ Set up Volt (N live)` item appears only when an unbound folder is open and
  ≥1 bridge is connected. `initTwincat`/`initCodesys` remain as explicit fallbacks.
- **State with no SCM "row":** the native SCM view has no health/merge/mismatch row, so those relocate to
  the status bar (`updateGlobalUi` gained a `project mismatch` state). Drift counts show on the SourceControl
  `count` badge + the status bar.
- **Dead config:** `viewsWelcome` still targets the removed `volt.scm` view (harmless — no host) pending a
  cleanup pass (task 3.3).

## Onboarding / status UX — SCM welcome with enabled/disabled buttons

Kept the simple Source Control **welcome buttons** (preferred over a richer view). **Finding:** VS Code's
`viewsWelcome` buttons **ignore command `enablement`** — a disabled command still renders a clickable button
(it fired `volt init` on a dead port). So "always visible but disabled" isn't possible there. The equivalent
outcome (no dead clicks + bridge feedback + always something shown) is **per-vendor show/hide + a no-bridge
message**: three `viewsWelcome` entries on the `scm` view, gated on per-vendor context keys —
`volt.twincatLive` → the TwinCAT button, `volt.codesysLive` → the CODESYS button, neither → "No PLC IDE
connected" instructions. A per-vendor probe (parallel, on activate + 10 s + window focus) sets the keys.
(`enablement` is left on the commands for the *command palette*, which does honour it.)

**Rejected:** a state-machine TreeView (spinner / live nodes with the dynamic project name) — over-built; and
relying on `enablement` to grey welcome buttons — doesn't work.

## Resolved Decisions

1. **Desktop seam** → minimal-mount seam in `session.tsx` (no upstream hook; opencode won't take one),
   logic in fork-owned code, tracked by `check-divergence` + `merge-upstream`. Relocates the existing tab seam.
2. **Controls placement** → Pull/Push/Build when "IDE" is selected; a bridge-health dot always visible by the dropdown.
3. **Replace or coexist** → retire the separate tab / `⚡` view; the co-located version replaces it.
4. **VS Code depth** → full native `SourceControl` provider.
5. **Layout coverage (v1 + v2)** → the seam lives in the **shared** `pages/session.tsx`. Both opencode
   layouts render the same `<Session/>` (legacy/v1 via `SessionRoute`, new/v2 via `TargetSessionPage`);
   the v1/v2 split is the home/shell/nav, not the session view. So **one seam covers both layouts** — no
   layout-specific work. (`pages/new-session.tsx` is the v2 compose-a-draft screen, no changes panel,
   out of scope.) Volt ships v1 by default — see the `pin-stable-ui-channel` change.
