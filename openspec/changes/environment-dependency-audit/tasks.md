## 0. Baseline

- [ ] 0.1 Merge state: list what `hotfix/tc-hierarchy-x86` already fixed from the audit (LSP baseline target, installer
      architecture gate, tr-TR regexes, VoltLog/descriptor formats, TcXaeShell64 detection) so nothing is done twice.

## 1. Tests first (red)

- [ ] 1.1 Locale runs: a culture switch the test projects read at start (net10 and net48) and the LSP suite; CI runs them
      under tr-TR, ru-RU, de-DE; red where a culture bug remains.
- [ ] 1.2 Repo gate: no culture-sensitive case/compare/format op in product C#, TS or shipped Python (with the invariant
      replacements named in the failure); bitness/target gate on every shipped binary; no developer-tool-only component
      loaded by a shipped path.
- [ ] 1.3 A CLI test that runs with git absent from PATH (it must use the bundled git) and in a repo owned by another
      principal (safe.directory) and a path past MAX_PATH (core.longpaths).

## 2. Fix
n- [ ] 2.0 **Regression found by the 2026-10-13 e2e matrix (CODESYS SP18 3.5.18.30):** 212 of 218 failures are one message —
      `UNSUPPORTED: the library manager: the CODESYS member 'LibManObject.ParameterTable' could not be read` — so a member
      ABSENT from an older SP's object model fails nearly every op (lifecycle, whole project, refs), where two days earlier
      SP18 passed 164 tests and failed only LD/FBD writes. Rule: a member the version's object model does not have is not an
      unread value — nothing to spell (record per-SP member availability as a `vendor-facts` row); and a member that
      exists but cannot be read holds back THAT item with its reason (`unreadable`), never the op. Red test first (a FakeIde
      library manager without the member); then SP18 e2e: only the expected LD/FBD write refusals remain. Same check for
      every member bridge-one-to-one started reading (census which exist in SP18 / SP21 / SP22 / 32-bit 3.5.21.60).

- [ ] 2.1 Bundle MinGit (owner decision) in the FULL installer payload `bin\git\` only — NOT in the bridge-only packages
      PLCAssist distributes (owner: "git should only be bundled for the complete CLI"); a gate asserts the bridge packages
      carry no git. The CLI always runs it with safe.directory/longpaths per call;
      license + source pointer; installer and `test:install` assert it.
- [ ] 2.2 Elevation: detect and name an elevated IDE (TwinCAT ROT miss + process present; CODESYS pipe access denied);
      a measured PipeSecurity for the CODESYS pipe admitting the same user unelevated.
- [ ] 2.3 TwinCAT 64-bit shell: measure 4026's hierarchy read (install 4026 side by side if needed — owner allows) and make it
      work without Visual Studio; DIALECT row.
- [ ] 2.4 Localized TwinCAT build output: record German and Russian XAE output; language-neutral parse or state what is lost.
- [ ] 2.5 Non-ASCII `%TEMP%`/project paths handed to XAE: measure; fix or refuse by name.
- [ ] 2.6 CODESYS 32-bit: `ide.ps1` bitness selection, harness reports bitness, e2e on 32-bit SP18/21/22; DIALECT.
- [ ] 2.7 CODESYS activation hints per feature set and locale; the installer tolerates WMI being unavailable.

## 3. Release gate and VM checklist

- [ ] 3.1 `scripts/release-matrix` (name per scripts/README): e2e over every installed IDE variant, the matrix printed, a red
      cell fails; used by the release steps instead of hand-run e2e.
- [ ] 3.2 The VM checklist in `scripts/README.md` (TwinCAT-only 4024, tr-TR/ru-RU system locale, LTSC 2019, non-admin
      Cyrillic user, no git, no AVX2) — run once now, results recorded.

## 4. Close

- [ ] 4.1 Docs (installer README locations incl. bin\git, CLAUDE.md prerequisites, DIALECT V-rows); full suites; archive.
