## 1. Line-by-line audit of `Volt.iss` (431 lines)

Every directive and code path is classified: **verified** (has a purpose AND a log line proving it ran),
**fix**, or **delete**. Nothing is left as "probably harmless".

- [x] 1.1 `[Setup]` — read; `SetupLogging=yes`, `CloseApplications=no`, `UninstallDisplayIcon` through `current`. Verified.
- [x] 1.2 `[Tasks]` — three editor tasks gated on `EditorOnPath`. Log which editors were detected and which tasks were selected; today an install that silently skipped an editor is indistinguishable from one that had no editor.
- [x] 1.3 `[InstallDelete]` — DELETE. Four entries target `{app}\current\opencode-config\*`, but the section runs before `[Files]` and before the junction is repointed, so `current` still resolves to the outgoing version. The fifth targets the flat `{app}\opencode-config\node_modules`, which `RemoveFlatPayload` already removes. Upstream `CFG_NEVER_SHIP` prevents the payload from carrying these at all.
- [x] 1.4 `[Files]` — single entry into `{app}\app-{#AppVersion}`. Verified; log the destination and the resulting directory count.
- [x] 1.5 `[Run]` — FIX the comment block: it contains two contradictory paragraphs about whether the connector is launched here (it is not). Keep the winget + three extension entries; each already carries a `StatusMsg`, but none logs its outcome.
- [x] 1.6 `[UninstallDelete]` — DELETE the `{app}\opencode-config` entry: the versioned layout never creates that path, and `usPostUninstall` removes every `app-*` directory wholesale.
- [x] 1.7 `[UninstallRun]` — FIX the comment (it claims to revert env; that moved into `CurUninstallStepChanged`). Verify what `--uninstall` still does — login item, Start Menu shortcut, `Documents\Volt` scripts — and confirm the ordering against `usUninstall` from the log rather than from assumption.
- [x] 1.8 `EditorOnPath` / `ExtInstalled` / `WantExt` / `NotSilent` — verified logic; add one log line each recording the answer, since these silently decide whether a customer's editor gets the extension.
- [x] 1.9 `SetCurrentJunction` — logging added; confirm the `rmdir`/`mklink` exit codes appear.
- [x] 1.10 `RemoveFlatPayload` — logging added; assert the "no flat payload" path on a clean machine.
- [x] 1.11 `PublishEnv` — FIX `Pos(Lowercase(CurBin), Lowercase(PathVal))`: substring matching would accept `...\current\binx`. Compare entry-wise, the same way the uninstall side splits on `;`, so add and remove agree by construction.
- [x] 1.12 `CurStepChanged` — verified ordering (junction → flat removal → env → connector). Confirm from the log that the connector actually starts; the one live check so far was contaminated by a concurrent gate run.
- [x] 1.13 `PrepareToInstall` — hardcoded kill list. Log each image and whether it was running, so the next binary added under `{app}` shows up as an unkilled process rather than a silent rollback.
- [x] 1.14 `CurUninstallStepChanged` — logging added; verify the retry loop and the entry-wise PATH strip.
- [x] 1.15 `ULog` / `DeinitializeSetup` — FIXED: `'{localappdata}\\Volt\\logs'` was a literal doubled separator (Pascal has no escape sequences). Confirm both logs land in one directory.

## 2. Logging

- [x] 2.1 Give every action a stable `volt: <verb> …` marker; list them in `installer/README.md` as the support contract.
- [x] 2.2 Capture BOTH `Exec` results everywhere — whether the process started, and its exit code.
- [x] 2.3 Log both sides of every branch, so a skipped step is distinguishable from a step that correctly did nothing.
- [x] 2.4 Log a `WARNING` whenever a path that was just recorded does not exist on disk.
- [x] 2.5 Log the install context once at the top: version, `{app}`, silent vs interactive, and whether an existing install was found.

## 3. Prove it

- [x] 3.1 Teach `test-install-lifecycle.ts` the expected marker sequence for install and for uninstall.
- [x] 3.2 Prove the assertion RED first by removing one marker — a log assertion that has never failed is not known to work. (The invariant check in this same file was once silently never applied, and the gate certified a broken install.)
- [x] 3.3 Extend `build-installer.ts` to require every documented marker to be present in the `.iss` source.
- [x] 3.4 Run the full gate with editors open and `volt-lsp-iec.exe` running.
- [x] 3.5 Confirm from a real install log that the connector starts, and from a real uninstall log that the junction and every version directory are removed.

## 4. Document

- [x] 4.1 `installer/README.md`: the marker list, where the logs land, and how to read one when a customer sends it.
- [x] 4.2 State the rule that keeps this from rotting: an installer action without a log line is not finished.
