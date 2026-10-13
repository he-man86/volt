## 0. Baseline

- [x] 0.1 Merge state: list what `hotfix/tc-hierarchy-x86` already fixed from the audit (LSP baseline target, installer
      architecture gate, tr-TR regexes, VoltLog/descriptor formats, TcXaeShell64 detection) so nothing is done twice.
      **Measured 2026-10-13 (git + grep on `dev` 1f162caa00, no product change):** the branch tip `ed92ed5c71` is an
      ancestor of `dev` — merged whole in `2122cdff68`, `git log dev..hotfix/tc-hierarchy-x86` empty, nothing reverted
      since. Its audit commits are `e388e24b6d` and `b8c4404b7b` (plus the x86 reader `0652d02ed9`/`066848d5f2`/`99f6f0585f`).
      **Done — do not redo:**
      - LSP baseline CPU target: `scripts/build-payload.ts:70` `--target=bun-windows-x64-baseline`. **No gate asserts it**
        (no test/script references `x64-baseline`) → stays in 1.2's bitness/target gate.
      - Installer architecture: `installer/Volt.iss:33-34` `ArchitecturesAllowed`/`ArchitecturesInstallIn64BitMode=x64compatible`.
        Also ungated (nothing references `ArchitecturesAllowed`) → 1.2.
      - tr-TR regexes: every `RegexOptions.IgnoreCase` in `packages/volt-cli/src` (14 sites) carries `CultureInvariant`,
        held by `Volt.Repo.Gates/CaseInsensitiveRegexIsCultureInvariantTests`; red tests `TurkishCultureVarOpenerTests`,
        `SignatureParseTests` (tr-TR). VarOpener's `VAR_IN_OUT` miss fixed with it.
      - VoltLog: invariant (Gregorian) file names and stamps, `VoltLogTests` (th-TH).
      - TcXaeShell64 detection: `XaeWindows.ProcessNames` (`XaeWindowsShellNamesTests`), ROT moniker
        `RotInstances.cs:90` (`TcRotMonikerTests`), `ide.ps1:259` + shell resolution from the `TcXaeShell*.DTE.*` ProgIDs.
        **Detection only — a live 64-bit XAE is unproven** (DIALECT C2t) → 2.3 stands.
      - Beyond the list: the x86 hierarchy reader `VoltTwincatExplorer.exe` targets net472 (LTSC 2019; gate
        `TwincatHierarchyReaderRuntimeTests`); a missing reader/proxy is `IDE_UNSUPPORTED`; and `67081dc626` (after the
        merge) makes `ide.ps1:601-609` resolve `Program Files (x86)` and refuse a version in both — 2.6's root resolution is
        done, its bitness reporting/e2e on 32-bit are not.
      **NOT done by the hotfix — still this change's:**
      - Descriptor formats: the hotfix touched no descriptor. `Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs` has
        **8** culture-sensitive `Convert.ToString(object)` (`:41,131,133,145,182,184,185,202`) — `:145` is ALSO the one
        `int.TryParse(Convert.ToString(id), …)` there without a culture, so that line is two sites (9 in the file). Product
        C# overall: those 8 are all the `Convert.ToString(` without Invariant; 1 `StartsWith("…")` without a
        `StringComparison` (`Connector/StatusWindow.cs:193`), 0 bare `ToUpper(`/`ToLower(`/`string.Compare(`. → 1.1/1.2.
      - Culture-sensitive number parsing (the Parse family — 1.2's gate covers it, not only case/compare/format):
        `git grep -nE "(int|long|double|uint|short|byte|decimal|float)\.(Try)?Parse\(" -- packages/volt-cli/src` → 15
        lines; 2 pass `NumberStyles.None` + `InvariantCulture` (`NetworkTextGate.cs:167`, `NetworkTextReader.cs:342`);
        **13 pass no culture**: `Descriptors.cs:145` (above) + 12 more — `Volt.Cli/Sync/Git.cs:359,447` (rename score,
        `cat-file` size), `Volt.Cli/Interface/ConsoleServer.cs:56`, `Volt.Cli/Program.cs:357`,
        `Connector.Core/ControlServer.cs:72`, `Connector.Core/TwincatXaeProbe.cs:74`, `Connector/StatusWindow.cs:253`,
        `Ide.Twincat/Ide/TcObjectModel.Build.cs:270,271` (build-message line/column), `Ide.Twincat/Program.cs:135,284`,
        `Ide.Twincat.Explorer/Program.cs:43`. Every value parsed today is non-negative ASCII digits → no wrong answer found
        now; the risk is a culture's sign symbols. `Version.TryParse` (`Updater.cs`, 5) is culture-invariant by contract and
        `Enum.Parse`/`XDocument.Parse` are not number parsing — outside the family. → 1.2 (expect 13 red, not 1).
        _(Gate 0, 2026-10-13: review findings — the census missed the Parse family and miscounted `:145`; both corrected
        here, doc-only, no test applies.)_
      **Gate 0 (2026-10-13, no product change):** typecheck 5/5 green; C# Engine 2527 pass/1 skip, Cli 270, Connector 120,
      Ide.Twincat 490, Ide.Codesys (net48) 368, Contracts 35, Repo.Gates 162 — 0 fail; volt-cli `test/unit` 114/0; LSP
      full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 10152 pass / 34 skip / 428 todo / 0 fail (361 files, 874 s).
      Fixture map untouched (no fixture or transpiler change).
      - Shipped Python: 1 `.lower()` (`start_volt_codesys.py:122`, IronPython — the culture of the IDE); TS: 1
        `localeCompare` (`volt-control/src/diagnostics.ts:160`). → 1.2.
      - Git: `Volt.Cli/Sync/Git.cs:60,397,418` still `ProcessStartInfo("git")`; 0 `safe.directory`/`core.longpaths`/MinGit
        anywhere → 1.3, 2.1.
      - Elevation: 0 `PipeSecurity`, no elevated-IDE detection (the 6 `elevat` hits are comments on the CLI's own
        elevation) → 2.2. Localized build output, non-ASCII `%TEMP%` (`TcItemArchive.cs:109`), activation hints, WMI → 2.4–2.7.
      - Locale runs: no test project/CI job runs under a switched culture (only the two single tr-TR tests above) → 1.1.

## 1. Tests first (red)

- [ ] 1.1 Locale runs: a culture switch the test projects read at start (net10 and net48) and the LSP suite; CI runs them
      under tr-TR, ru-RU, de-DE; red where a culture bug remains.
- [ ] 1.2 Repo gate: no culture-sensitive case/compare/format/parse op in product C#, TS or shipped Python — the number
      Parse/TryParse family included (0.1 baseline: 13 sites) — (with the invariant replacements named in the failure); bitness/target gate on every shipped binary; no developer-tool-only component
      loaded by a shipped path.
- [ ] 1.3 A CLI test that runs with git absent from PATH (it must use the bundled git) and in a repo owned by another
      principal (safe.directory) and a path past MAX_PATH (core.longpaths).

## 2. Fix
- [ ] 2.0 **Regression found by the 2026-10-13 e2e matrix (CODESYS SP18 3.5.18.30):** 212 of 218 failures are one message —
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
