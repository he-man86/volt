## 1. Audit — how every installed feature responds to the new layout

- [ ] 1.1 Enumerate every path Volt records **outside** `{app}`: `PATH`, `OPENCODE_CONFIG_DIR`, the Start Menu shortcut target, the login item command, the Add/Remove `UninstallString`/`DisplayIcon`, and anything `VoltEnv.cs`/`LoginItem.cs` writes. Record which ones today embed a path that would become version-scoped.
- [ ] 1.2 Confirm each of those resolves correctly through a junction (spawn `volt` from `PATH`, have opencode load the config dir, launch the shortcut) before changing any layout — a junction that breaks one of these fails the design, not the implementation.
- [ ] 1.3 Check the Electron desktop's resource resolution (it runs from inside the version directory) and the `.vsix` sideload source path in `[Run]`, which currently reads `{app}\volt-vscode.vsix`.
- [ ] 1.4 Check the connector's own self-reference: `Updater` reads its version, `AppContext.BaseDirectory` is used for `version.txt`, and `BridgeSupervisor` spawns workers by path — all become version-scoped, which is correct but must be deliberate.
- [ ] 1.5 Check `codesys-scriptcommands/` and the CODESYS activation path handed to the user (`start_volt_codesys.py`): the user pastes that path into their IDE, so if it is version-scoped it goes stale on every update. Decide whether it must come from `current`.

## 2. Installer layout

- [ ] 2.1 Point `[Files]` at `{app}\app-{#AppVersion}` and confirm the staged payload lands there in full.
- [ ] 2.2 Add junction management in `[Code]`: create/repoint `{app}\current` to the new version directory as the last step before `[Run]`, using `rmdir` + `mklink /J` (not a recursive delete — that would delete through the junction).
- [ ] 2.3 Detect a filesystem that cannot host a junction and fall back to the flat layout for that machine rather than failing the install.
- [ ] 2.4 Update `[Icons]`, `[Run]` and the uninstall entries to reference `{app}\current\...`.
- [ ] 2.5 Migrate an existing flat install: named `[InstallDelete]` entries removing the flat payload, never a wildcard wipe of `{app}` (Inno does not roll back deletions — an aborted upgrade would be left with nothing installed).
- [ ] 2.6 Make uninstall remove the junction with `rmdir` first, then every `app-*` directory, so nothing is deleted through the reparse point and `{app}` ends up gone.

## 3. Stable paths

- [ ] 3.1 Change `VoltEnv` to write `{app}\current\bin` to `PATH` and `{app}\current\opencode-config` to `OPENCODE_CONFIG_DIR`, and to migrate an existing version-free flat value to the `current` form exactly once.
- [ ] 3.2 Change `LoginItem` and the Start Menu shortcut to target `{app}\current\...`.
- [ ] 3.3 Assert the invariant that gives the design its value: no value written outside `{app}` may contain a version number. Add it to `installer/README.md` as a rule, not a note.

## 4. Pruning

- [ ] 4.1 On connector startup, delete every `{app}\app-*` directory except the one `current` resolves to, retaining at most 2.
- [ ] 4.2 Make it best-effort: a directory still holding an open file is logged and skipped, never fatal, and retried on a later start.
- [ ] 4.3 Add a connector test covering "prunes superseded", "keeps the active one", and "a locked directory does not throw".

## 5. Prove it

- [ ] 5.1 Extend `test-install-lifecycle.ts` to assert the layout itself: `current` exists and resolves to the expected version directory, at most 2 version directories survive, and no recorded environment value contains a version number.
- [ ] 5.2 Run the lifecycle gate **with editors open and `volt-lsp-iec.exe` running** — the exact condition that previously forced a rollback. Zero problems required.
- [ ] 5.3 Verify the failed-update guarantee directly: interrupt an install mid-copy, then confirm the previous version still launches and `volt` still resolves.
- [ ] 5.4 Ship one dev-channel release and confirm on a machine carrying a real flat install that the migration removes the flat payload and `volt` resolves to the new version.

## 6. Retire the stopgap

- [ ] 6.1 Remove the process termination from `PrepareToInstall` and `CurUninstallStepChanged`, including the hardcoded image list that started this (it omitted `volt-lsp-iec.exe`).
- [ ] 6.2 Re-run the lifecycle gate with editors open. If it still passes, the mitigation was redundant; if it does not, the layout is incomplete — do not restore the kill without recording why.
- [ ] 6.3 Update the `Volt.iss` header comments: `CloseApplications=no`, the `restartreplace` dead end (needs admin, per-user install), and why neither is needed any more.
