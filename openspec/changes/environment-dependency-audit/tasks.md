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

- [x] 1.1 Locale runs: a culture switch the test projects read at start (net10 and net48) and the LSP suite; CI runs them
      under tr-TR, ru-RU, de-DE; red where a culture bug remains.
      **Built 2026-10-13:** `VOLT_TEST_CULTURE=<name>` — C#: `test/shared/TestCulture.cs`, a module initializer compiled
      into every test project by `test/Directory.Build.targets` (keyed on `IsTestProject`), sets the default + current
      thread culture when the assembly loads; a name the runtime does not LIST is refused (measured: net48 on Windows 11
      hands out a made-up `qq-QQ`). LSP: `test/support/culture.ts`, a second bunfig preload — JS has no default-locale
      setter and bun ignores `LANG`/`LC_ALL` on Windows (measured: stays nl-NL), so the preload supplies the locale to
      every `Intl` constructor and `localeCompare`/`toLocale*` call that names none. Each C# assembly and the LSP carry a
      sentinel (`TestCultureTests`, `culture.test.ts`) that fails a run whose threads/defaults did not switch, plus a
      "tr-TR is armed" check (`i` → `İ`). CI: job `cultures` (culture × {cli on windows, lsp on ubuntu}, 6 check runs;
      the TS cell is volt-control + the LSP sentinel since gate 1).
      **Measured — no culture failure:** tr-TR / ru-RU / de-DE — Cli 272, Engine 2529/1 skip, Connector 122, Ide.Twincat
      492, Ide.Codesys (net48) 370, Contracts 37, Repo.Gates 164 — 0 culture failures (one ru-RU Cli failure,
      `PipeServeThreadTests.Health_answers_while_the_thread_pool_is_saturated`, was load: it passes under ru-RU in
      isolation, twice). LSP full suite under tr-TR 10154 pass / 34 skip / 428 todo / 0 fail (780 s); `map.test.ts` +
      the sentinel under ru-RU and de-DE 23/0 each. The hotfix's regex fix is why tr-TR is green; what remains is in the
      1.2 gate (no test exercises those sites under a culture — the census values are ASCII digits/names).
- [x] 1.2 Repo gate: no culture-sensitive case/compare/format/parse op in product C#, TS or shipped Python — the number
      Parse/TryParse family included (0.1 baseline: 13 sites) — (with the invariant replacements named in the failure); bitness/target gate on every shipped binary; no developer-tool-only component
      loaded by a shipped path.
      **Built 2026-10-13 (`Volt.Repo.Gates`, reds as `ExpectRed` until 2.8 / 2.1):** `CultureInvariantOperationsTests` —
      text rules (balanced, string-aware call-argument scan; comments skipped; the scanner itself tested on 30 snippets):
      C# **29 red** (13 Parse family, 10 `Convert.To*` — the 8 Descriptors + `RotInstances.cs:31` + `TcSolutionExplorer.cs:249`
      —, 5 `ToString("fmt")` without a provider, 1 `StartsWith` `StatusWindow.cs:193`); TS **1** (`volt-control/src/diagnostics.ts:160`
      `localeCompare`); shipped Python **1** (`start_volt_codesys.py:122` `.lower()`; the shipped list is read from
      `build-cli.ps1`). What a text scan cannot type (`int.ToString()`, interpolation) is the compiler's: a red test asks
      for CA1304/CA1305/CA1309/CA1310/CA1311 as errors — measured with `-p:AnalysisLevel=latest -p:AnalysisModeGlobalization=All`:
      **28 CA1305 + 1 CA1310** in src (Connector 1+1, Engine 2, Ide.Codesys 8, Ide.Twincat 17 — 12 of them `long.ToString()`
      into `TcPlcOpenWriter` XML); the analyzer does NOT flag `int.TryParse(string, out int)` (none of the 13), hence the
      text rule. (`AnalysisLevel` must be set: without it the analyzers skip the netstandard2.0/net48 projects.)
      Bitness: `scripts/binary-targets.ts` reads every PE in the payload (in-proc CODESYS DLL AnyCPU, `VoltTwincatExplorer.exe`
      x86, the rest x64/AnyCPU), run by `build-payload.ts`'s self-check; on the local (stale, 2026-10-12) `dist/volt`
      227 binaries pass; the current Debug outputs read Explorer x86, CODESYS bundle AnyCPU, worker apphost x64.
      `ShippedBinaryTargetTests` holds the text the PE cannot say (LSP `bun-windows-x64-baseline`, `ArchitecturesAllowed`/
      `InstallIn64BitMode=x64compatible`, the check wired, the CODESYS csproj AnyCPU) — green.
      `NoDeveloperToolComponentTests`: a process started by bare name must be Windows' own — **3 red** (`Git.cs` `git`, until
      2.1), anything else by name fails now; no Visual Studio assembly referenced; msenvp reached via the IDE's manifest.
- [x] 1.3 A CLI test that runs with git absent from PATH (it must use the bundled git) and in a repo owned by another
      principal (safe.directory) and a path past MAX_PATH (core.longpaths).
      **Built 2026-10-13:** `Volt.Cli.Tests/commands/GitEnvironmentTests` spawns the real `volt.exe` (`pull --json`)
      with no global/system git config (`GIT_CONFIG_GLOBAL` empty, `GIT_CONFIG_NOSYSTEM`); a control test through the
      same harness pulls. **3 red until 2.1**, each for its own reason: no git on PATH and `GIT_TEST_ASSUME_DIFFERENT_OWNER=1`
      both exit 2 with **"not a Volt workspace — run `volt init` first"** — the CLI misreports a missing git and a refused
      repo as an unbound one (2.1 must name them); a 200-char project + 64-char item exits 1, `git merge … unable to
      create file … Filename too long`. Measured: the dev machine's git 2.37.1 honours `safe.directory` only from
      system/global config — NOT `-c safe.directory=…` nor `GIT_CONFIG_COUNT` — so the bundled MinGit must be one that
      does (2.1); `git init` itself refuses a directory past ~248 chars even with `-c core.longpaths=true`.
- [x] **Gate 1 (2026-10-13) — review findings, each fixed (failing test first) or answered:**
      1. *Python rule on an unmeasured fact* — CONFIRMED and fixed: reflection on CODESYS 3.5.21.40's IronPython 2.7.12
         under tr-TR: `StringOps.lower(".INI")` = `.ini` (105, not 305), `upper("ini")` = `INI`, `title`/`capitalize`/
         `swapcase` of `"iI iI"` hold no İ/ı; the .NET `".INI".ToLower()` in the same process gives `ı` (305). The Python
         rule is now the .NET `ToUpper()`/`ToLower()` a `str` also carries; `start_volt_codesys.py:122` `.lower()` is
         correct, the Python test is green (no mark), 2.8 has no Python site.
      2. *No ratchet under the reds* — fixed: `CSharpCensus`/`TypeScriptCensus` pin every site as `file  [rule] line`
         (no line number); `No_new_culture_sensitive_CSharp_call` / `…TypeScript_call` fail on a NEW site and on a pinned
         one that no longer offends. Checked: an `int.Parse(s)` appended to `Hasher.cs` fails it (reverted).
      3. *Interpolation "is the compiler's" — false* — CONFIRMED by a scratch project (net10.0 + netstandard2.0,
         `AnalysisLevel=latest`, `AnalysisModeGlobalization=All`): CA1305 reports `x.ToString()` only — not `$"v={x}"`, not
         `"n=" + n`; nothing reports `OrderBy(s => s)`, `list.Sort()`, `Array.Sort(a)`. But `a.CompareTo(b)` and
         `s.IndexOf(v)` on strings ARE reported (CA1310) and `char.ToUpper(c)` (CA1304) — the analyzer gate covers those once
         2.8 makes them errors. New text rules: `char.ToUpper/ToLower` without a culture, a sort by the default comparer
         (OrderBy/ThenBy[Descending] with no comparer, `.Sort()`, `Array.Sort(a)`) — **10 sites** on 9 lines (LogWindow:144,
         TrayContext:365, CodesysObjectModel.Task:253, TreeNav, PushService ×4, NetworkSpelling, StWriter), into the census.
         Interpolated/concatenated numbers: covered by NO gate — stated in the class doc, not claimed.
      4. *Swallowed git failure* — CONFIRMED and fixed at the root: `Config.ConfigExists` no longer catches (past
         `IsRepoRoot` a failing `rev-parse` is git failing); new `A_git_failure_is_named_not_reported_as_an_unbound_workspace`
         (a broken `.git/HEAD` — red before the fix with "not a Volt workspace", green after). `ExpectRed.Until(task,
         finding, because, body)` added (an assertion is the red only when its message holds `because`; tested in
         `ExpectRedTests`); the three marks now pin git's words: `start process 'git'`, `dubious ownership`,
         `Filename too long`. Class doc corrected.
      5. *TS locale runs cannot catch a product bug* — CONFIRMED: `Intl.|localeCompare|toLocale` finds nothing in the LSP's
         src. `volt-control` now preloads the same `culture.ts` (its `bunfig.toml`) with its own sentinel
         (`src/culture.test.ts`); the CI `cultures` TS cell runs volt-control's suite + the LSP's sentinel instead of three
         ~13-minute LSP runs (cell renamed `lsp` → `ts`; CLAUDE.md, the LSP test README). A new locale call in product TS is
         the repo gate's census, not the locale run's.
      6. *binary-targets on an installed {app}* — fixed: `unins000.exe` at the root is allowed x86 (Inno's uninstaller);
         every DLL under `codesys/` must be AnyCPU, not only the bridge (`allowed("codesys/Other.dll")` was x64|AnyCPU);
         `ShippedBinaryTargetTests` holds the new line; scripts/README updated. `dist/volt` still 227/227.
      7. *By-name starts the scan missed* — fixed: the scanner now reads `Process.Start("x", …)`, an identifier whose
         assignment yields a bare literal (`?? "volt"`, a ternary branch, a `const`), and `cmd.exe /c …` (a PATH lookup of
         what it runs); 7 + 7 scanner snippets. Found: `ConsoleServer.cs:327` `?? "volt"` — fixed (`Environment.ProcessPath`
         or a named refusal); `StatusWindow.cs:272` `cmd.exe /c` editor probe — a named `Deliberate` exemption (absent
         editor → empty row), which must still exist. `git` capped at the census's 3.
      **Numbers (gate 1):** typecheck 5/5, lint 0 errors, `bun run check` green; C# Engine 2530 pass/1 skip, Cli 277,
      Connector 122, Ide.Twincat 492, Ide.Codesys (net48) 370, Contracts 37, Repo.Gates 238 (with the census ratchets and
      the new scanner snippets) — 0 fail (Cli's
      `PipeServeThreadTests.Health_answers_while_the_thread_pool_is_saturated` failed once in the first full Cli run, as
      at 1.1 under load; green in isolation and in a second full run); Repo.Gates under tr-TR 238/0; volt-cli `test/unit`
      114/0; volt-control 123/0 (and under tr-TR); LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 10154 pass /
      34 skip / 428 todo / 0 fail (362 files, 1157 s). Fixture map untouched (no fixture or transpiler change).

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
      license + source pointer; installer and `test:install` assert it. A git that cannot start or refuses is NAMED
      (gate 1 holds that for a broken repo; the `GitEnvironmentTests` marks pin git's own words), never "not a Volt workspace".
- [ ] 2.2 Elevation: detect and name an elevated IDE (TwinCAT ROT miss + process present; CODESYS pipe access denied);
      a measured PipeSecurity for the CODESYS pipe admitting the same user unelevated.
- [ ] 2.3 TwinCAT 64-bit shell: measure 4026's hierarchy read (install 4026 side by side if needed — owner allows) and make it
      work without Visual Studio; DIALECT row.
- [ ] 2.4 Localized TwinCAT build output: record German and Russian XAE output; language-neutral parse or state what is lost.
- [ ] 2.5 Non-ASCII `%TEMP%`/project paths handed to XAE: measure; fix or refuse by name.
- [ ] 2.5b **One fixture project per CODESYS version (owner 2026-10-13: "you need to have 1 project for each CS version").**
      Export `test/fixtures/CodesysTestProject.project` from SP21 as PLCopen XML through CODESYS scripting (keeps the
      IDE-made CFC/SFC/LD/FBD bodies a Volt push cannot recreate), create an empty project in EACH installed version (SP18
      3.5.18.30, SP21 3.5.21.40, SP21 32-bit 3.5.21.60, SP22 3.5.22.40) and import it there through scripting, saved in that
      version's format as `test/fixtures/CodesysTestProject.<version>.project`. What a version cannot import is recorded
      with its reason and the e2e expects that refusal (not a failure). `ide.ps1` picks the fixture by `-CodesysVersion`
      (explicit `-Fixture` still wins); the e2e harness records the project and version it ran. Replace the hand-made
      `codesysSP18.project` by the generated one. Re-run the e2e matrix on every version with its own project.
- [ ] 2.6 CODESYS 32-bit: `ide.ps1` bitness selection, harness reports bitness, e2e on 32-bit SP18/21/22; DIALECT.
- [ ] 2.7 CODESYS activation hints per feature set and locale; the installer tolerates WMI being unavailable.
- [ ] 2.8 Culture-invariant replacements at every site the 1.2 gate names (C# 39 = 29 + 10 default-comparer sorts since
      gate 1, TS 1; shipped Python 0 — IronPython's `str.lower()` is invariant, measured at gate 1), emptying the
      `CSharpCensus`/`TypeScriptCensus`, and the
      globalization analyzers (CA1304/CA1305/CA1309/CA1310/CA1311, `AnalysisLevel` set so netstandard2.0/net48 are
      analysed) as errors in the shipped projects, fixing the 29 typed sites they report; remove the `ExpectRed` marks.
      (Added by step 1: 1.1/1.2 are tests first and no fix task named these sites.)

## 3. Release gate and VM checklist

- [ ] 3.1 `scripts/release-matrix` (name per scripts/README): e2e over every installed IDE variant, the matrix printed, a red
      cell fails; used by the release steps instead of hand-run e2e.
- [ ] 3.2 The VM checklist in `scripts/README.md` (TwinCAT-only 4024, tr-TR/ru-RU system locale, LTSC 2019, non-admin
      Cyrillic user, no git, no AVX2) — run once now, results recorded.

## 4. Close

- [ ] 4.1 Docs (installer README locations incl. bin\git, CLAUDE.md prerequisites, DIALECT V-rows); full suites; archive.
