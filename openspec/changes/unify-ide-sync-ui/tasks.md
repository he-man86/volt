## 1. Resolve the design decisions (the Open Questions)

- [x] 1.1 Desktop seam → minimal-mount seam in `session.tsx` (no upstream hook); logic in fork-owned code
- [x] 1.2 Controls → Pull/Push/Build when IDE selected; health dot always visible by the dropdown
- [x] 1.3 Retire the separate tab / `⚡` view (replace, don't coexist)
- [x] 1.4 VS Code → full native `SourceControl` provider

## 2. Specs

- [x] 2.1 Add `editor-surface` requirement: co-located in the host's native changes UI
- [x] 2.2 Add `editor-surface` requirement: IDE-sync controls accompany the co-located view
- [x] 2.3 Modify `editor-surface` "git axis is delegated" to state the co-location relationship
- [x] 2.4 Updated `upstream-sync` spec + CLAUDE.md: the desktop dropdown seam **reduces** the surface 13→12 (`session.tsx` added; `session-side-panel.tsx` + `helpers.ts` reverted to upstream)

## 3. Implement — VS Code

- [x] 3.1 Register Volt as a `SourceControl` provider (group beside Git) — `views/scm.ts` + `extension.ts`
- [x] 3.2 Move incoming/outgoing drift + Pull/Push/Build into `scm/title`; retire the `⚡` activity-bar view; onboarding → status-bar `volt.setup` picker (CODESYS/TwinCAT, auto-detect dropped); health/merge/mismatch → status bar
- [x] 3.3 Command cleanup (removed `init`/`openCodesysVersion`/`selectTwincatProject`; fixed stale titles); `volt init` baseline commit (`volt-git`)
- [x] 3.4 Onboarding UX (final): per-vendor `scm` `viewsWelcome` — `[Initialize for TwinCAT/CODESYS]` shown only when that vendor's bridge is live (gated on `volt.twincatLive`/`volt.codesysLive` from the probe) + a "No PLC IDE connected" fallback. (Tried a TreeView state-machine, reverted as over-built; `enablement` doesn't grey welcome buttons → per-vendor show/hide.) (1.21.21)

## 3b. Pre-desktop cleanup (audit fallout)

- [x] Delete `connector.ts` dead cluster (`launchInstall`/`selectInstance` + `IdeInstall`/`Tc*`/`TcTargetSel` + `ConnectorBridge.installs?/instances?/target?`) — served the removed connector commands
- [x] Delete `volt-control` `mergeCmd` + `log` (+`LogEntry`) — zero consumers; fix `index.ts` comment + README (`merge`/`log` CLI verbs stay)
- [x] Wire `volt.acceptProjectRename` into the project-mismatch status item (was unreachable)
- [x] Menu group fix (`1_init@2` → `@1`); typecheck volt-control + volt-vscode clean
- [x] Consolidated the dual-port liveness probe into `volt-control.probeVendors` (shared by `refreshBridgeLive` + the `volt.setup` picker; the desktop onboarding will reuse it)

## 4. Implement — Desktop

- [x] 4.1 Provide the IDE diff list to the app: new `volt diff` verb (`outgoingDiffs` = working tree ↔ `volt/ide`, per-file unified diff → `VcsFileDiff[]` shape) → `volt-control.ideDiff` → IPC (`volt:diff` channel + handler + preload + `VoltBridge.diff`). Verified via CLI against the live bridge. (pull/push/build actions already on the IPC.)
- [x] 4.2 `session.tsx` mount (the seam): `ChangeMode` += `"ide"`, `voltDetected` resource + `ideQuery` (→ `window.volt.diff`), branches in `changesOptions`/`reviewDiffs`/`reviewReady`/label/empty. Renders IDE drift through the existing `SessionReview`. Typechecks.
- [x] 4.3 `VoltIdeHeader` (volt-app) — Pull/Push/Build + health strip above the diff when "IDE" is selected (slimmed from the old `VoltPanel`). Retired the Volt tab (both files back to upstream).

## 5. Verify

- [x] 5.1 `check-divergence`: `session.tsx` allowlisted; the two tab files removed (reverted to upstream); self-test updated (24 cases pass). Net surface 13→12.
- [x] 5.2 Verified in both hosts: VS Code (SCM group + welcome buttons) and Desktop (live `dev:desktop` — onboarding init, the "IDE" dropdown source, diff render, header controls, diff-invalidates-on-push). Fixed two live issues: `voltDetected` TDZ ordering + post-action diff invalidation.
