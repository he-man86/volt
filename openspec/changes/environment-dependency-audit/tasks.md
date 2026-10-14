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
- [x] 2.0 **Regression found by the 2026-10-13 e2e matrix (CODESYS SP18 3.5.18.30):** 212 of 218 failures are one message —
      `UNSUPPORTED: the library manager: the CODESYS member 'LibManObject.ParameterTable' could not be read` — so a member
      ABSENT from an older SP's object model fails nearly every op (lifecycle, whole project, refs), where two days earlier
      SP18 passed 164 tests and failed only LD/FBD writes. Rule: a member the version's object model does not have is not an
      unread value — nothing to spell (record per-SP member availability as a `vendor-facts` row); and a member that
      exists but cannot be read holds back THAT item with its reason (`unreadable`), never the op. Red test first (a FakeIde
      library manager without the member); then SP18 e2e: only the expected LD/FBD write refusals remain. Same check for
      every member bridge-one-to-one started reading (census which exist in SP18 / SP21 / SP22 / 32-bit 3.5.21.60).
      **Built 2026-10-13 (design.md "Built (2.0)"):** census on 3.5.18.30 / 3.5.21.40 / 32-bit 3.5.21.60 / 3.5.22.40 —
      every object of 4 fixtures (63 owner-type instances on SP18, where `Pro2193` does not open; 513 on each other) + a
      fresh instance of each owner type (26 / 27 / 27 / 27) + 54 declared members and 8 methods per type. Found: archive
      lists constant per type within a platform; declared members identical on all four; the three later platforms identical;
      SP18 lacks exactly 3 members the bridge reads — `LibManObject.ParameterTable`, `TaskConfigObject.StackSize`,
      `TaskConfigObject.UseConfigurableStackSize` (the Task Configuration was ALSO named unreadable on SP18, holding back
      every task). → `MemberAvailability` (3 rows, 4 measured platforms) + DIALECT **V7**, held equal by
      `MemberAvailabilityTests`; `CodesysObjectModel.Archives` reads through it (absent-by-version → no fact; any other
      absence → item unreadable naming member/type/platform/why); `CodesysDriver.Walk` catches the manager per item
      (named unreadable, only its own folder unwalked). Found while doing it: an unreadable manager's libraries read as
      REMOVED flipped `librariesRefreshed` and would have dropped every signature file — `FetchService` no longer refreshes
      while a known `.library` is unseen (red first: `LibrariesRefreshedTests`). Red first: `CodesysMemberAvailabilityTests`
      (5 of 6 red with the field message before the fix; + 2 Task Configuration cases). WireVocabulary census
      Properties.cs 11 → 13 (UNSUPPORTED, item refused by name). Tests: Ide.Codesys 385/0, Engine 2531/1 skip, Cli 277/0,
      Repo.Gates 238/0. **SP18 e2e** (`codesysSP18.project`, 3.5.18.30): 169 pass / 72 skip / 108 fail (was 212 of 218
      failing on the ParameterTable message; 0 now). Of the 108: 106 in `graphical/*` (LD/FBD writes: "this CODESYS version
      cannot take an LD/FBD body", plus the tests that need them and 2 committed fixture POUs `VltFixtureCfc` /
      `VltFixtureMembers` the SP18 fixture does not hold); 2 outside: `refusals/behaviour` D27 (the same missing
      `VltFixtureCfc`) and `whole project` (Project Settings refused by name: "this CODESYS version cannot give Volt its
      Project Settings" — the compiler-warning API, a V2-style capability, not an archive member; not 2.0's).
      (`CodesysTestProject.project` opens READ-ONLY on SP18 — every push then hangs — so SP18 e2e serves the SP18 fixture.)
      **Gate 2a (2026-10-13) — review findings, both confirmed and fixed, red first:**
      1. *`unseenLibrary` ignored the library's folder* — any unwalked folder anywhere held the signature refresh, so a
         library removed from a manager the walk DID read stayed known with stale signatures (and an added one got none)
         for as long as that other folder stayed unreadable. Fix: "unseen" is now "not live and not removed by THE removal
         rule" (`Removal.Removed`, computed once and reused for `removed`): per folder, kind-aware unreadable. Red:
         `LibrariesRefreshedTests.A_library_removed_from_a_walked_manager_refreshes_although_another_folder_is_unwalked`.
      2. *SP18 does hold library parameter values* — per reference, as the item's archived `Params`
         (`AbstractLibManItem.ParametersToSerialize`, storage 3.4.0.0); from storage 3.5.19.0 the manager's `ParameterTable`
         holds them and `AfterDeserialize` moves each reference's `Params` there (`MoveParameterListFromItem`). Read from both
         `LibManObject.plugin.dll` (MetadataLoadContext + decompile). The census had read the references' declared members,
         not their archive. Fix: where the manager has no `ParameterTable` by version, `ParameterValues` counts each top-level
         reference's archived `Params`, in the same pull-report line ("sets N library parameter value(s) (…)"); a reference
         whose archive names no `Params` refuses the manager by name. Not `GetParameterValues()`: on SP18 it writes every
         default into the reference as it answers. DIALECT V7 + `MemberAvailability` doc corrected. Red:
         `CodesysMemberAvailabilityTests.On_a_platform_without_the_table_*` (2). Checked the other two rows the same way: the
         whole SP18 `TaskConfigObject.plugin.dll` has no stack setting under any name, so those are true version facts.
         Live on SP18 (`codesysSP18.project`): every reference archives `Params` (none set); no manager refusal.
      Numbers: Engine 2532/0/1 skip (+1), Cli 277/0, Ide.Codesys 387/0 (+2), Repo.Gates 238/0, Contracts 37/0,
      Connector 122/0, Ide.Twincat 492/0; typecheck green. SP18 e2e (3.5.18.30, `codesysSP18.project`): 169 pass /
      72 skip / 108 fail — unchanged from 2.0 (106 `graphical/*` + D27 + whole-project, the expected refusals).

- [x] 2.1 Bundle MinGit (owner decision) in the FULL installer payload `bin\git\` only — NOT in the bridge-only packages
      PLCAssist distributes (owner: "git should only be bundled for the complete CLI"); a gate asserts the bridge packages
      carry no git. The CLI always runs it with safe.directory/longpaths per call;
      license + source pointer; installer and `test:install` assert it. A git that cannot start or refuses is NAMED
      (gate 1 holds that for a broken repo; the `GitEnvironmentTests` marks pin git's own words), never "not a Volt workspace".
      **Built 2026-10-13 (design.md "2.1"):** MinGit 2.56.0.2 pinned + SHA-256 in `src/Volt.Cli/MinGit.targets` (fetched
      into git-ignored `.cache/mingit`, verified before unzip, copied as `git\` beside volt.exe in build and publish
      outputs; `VOLT-SOURCE.txt` beside MinGit's `LICENSE.txt`). `Git.cs` runs `git\cmd\git.exe` by path (absent → named,
      "reinstall Volt"), per call `core.longpaths=true` and, for `-C <root>`, `safe.directory=<root>` +
      `GIT_CEILING_DIRECTORIES` — NOT `*`: measured, a broken `.git` with `*` let git answer from a `C:\.git` above the
      workspace (red test first). The three `GitEnvironmentTests` marks and the `NoDeveloperToolComponentTests` mark
      removed (green); new: a volt.exe without its `git\` names it and never uses PATH (black box), the bundled git is the
      pin, licence+source present, `BundledGitGateTests` (only Volt.Cli bundles git; no bridge project's closure reaches
      it; build/payload/install refusals present; pin verified before unzip). `build-cli.ps1` (dist\Cli = volt.exe + git\;
      refuses git in dist\Connector|Codesys — ran green end to end, Cli 281/0 Release), `build-payload.ts` (bin/git,
      required files, bridge refusal), `binary-targets.ts` (MinGit's `getprocaddr32.exe` x86 — the one non-x64 PE of 187),
      `test-install.ts` (bin = git + the two exes; git reports the pin; licence/source; none under connector/codesys),
      installer README row, CI cache keyed by the pin. `test:install` itself not run here (it installs on this machine).
- [x] 2.2 Elevation: detect and name an elevated IDE (TwinCAT ROT miss + process present; CODESYS pipe access denied);
      a measured PipeSecurity for the CODESYS pipe admitting the same user unelevated.
      **Built 2026-10-13 (design.md "2.2"):** measured — default pipe SD `O:<user>D:(SY FA)(BA FA)(owner FA)(WD FR)(AN FR)`;
      an elevated same-user token (CODESYSControlSysTray, GatewaySysTray) has owner Administrators, High IL, and IS
      readable for `TokenElevation` from an unelevated process. `Volt.Wire/PipeAcl`: every bridge pipe instance
      `D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<TokenUser>)S:(ML;;NW;;;ME)`, remote clients rejected (read back on net10 and net48
      = that, kernel adds `S:AI`). Client: `PipeAccessDeniedException` (named) → CLI `BRIDGE_ACCESS_DENIED`; the resolver's
      project probe no longer reads a refusal as "not open". TwinCAT: no pipe + an elevated (or unreadable: another user)
      TcXaeShell[64] → `BridgeResolver.UnreachableXae` names it instead of "start the Volt Connector"; the fleet logs each
      such pid once (`ElevatedOutOfSight`). `Vendors.TwincatShellProcesses` is the one list. Tests: `PipeAccessTests`
      (shared, net10 + net48: the ACL; the elevated-default SD refuses the same user read-write and the client names it —
      red before), resolver ×4, fleet ×1. The ACL path keeps the managed constructor's name rules (empty, reserved
      "anonymous" → ArgumentException; `PipeTransportTests` bind-failure test green). Live, unelevated: CODESYS 3.5.21.40
      (`ide.ps1 -Instance environment-dependency-audit`) served `volt.bridge.codesys.<pid>` in-proc through the ACL; e2e
      `endpoints/fetch`, `endpoints/push-keeps-what-landed-cli`, `conflict-resolve` (the CLI on its bundled git) 10/0.
      **Not measured live:** an elevated CODESYS/XAE beside unelevated Volt — needs a
      UAC consent (an unattended attempt to get an elevated process was refused); added to 3.2's checklist.
- [x] **Gate 2b (2026-10-13) — review findings, each fixed with a failing test first:**
      1. *One refusing pipe stopped the whole resolve* — CONFIRMED and fixed: `ChooseBridgePipe` collects
         `BRIDGE_ACCESS_DENIED` per pipe and picks the match; a refusal is named only when no pipe matches. Red:
         `BridgeResolverTests.A_refusing_pipe_beside_the_matching_one_does_not_stop_the_resolve`, `…_is_named_when_no_pipe_matches`.
      2. *`UnreachableXae` dropped the connector advice* — CONFIRMED and fixed: this user's unelevated XAE(s) stay in the
         message with "start the Volt Connector" beside an elevated or foreign one. The 2.2 test pinned the drop
         (`DoesNotContain("4712")`) — wrong premise, assertion removed. Red: `An_unelevated_XAE_beside_an_unreachable_one_keeps_the_connector_advice`
         (elevated and foreign), plus `Only_unreachable_XAEs_say_nothing_about_the_connector`.
      3. *The UI never named a refused CODESYS pipe* — CONFIRMED and fixed end to end: `SourceScan.Refused` →
         `ConnectionManager.Refused` → `ConnectorView.Refused` (`{vendor, pipe, reason}`, always present) → volt-control
         `refusedIdes` → a no-action row ("An IDE Volt cannot reach — access denied" + the reason) in the VS Code Bridge
         view and the desktop panel, unbound and in the offline reconnect list. No invented project row (it has no name).
         Tests: PerPipeProjectSource ×2, ConnectionManager ×1, ControlServer wire shape ×1, volt-control ×1, vscode panel ×1,
         desktop snapshot ×1 + render ×1; the control e2e's exact-view expectation now includes `refused: []`.
      4. *Bundled git read the machine's system config; LFS answered per machine* — CONFIRMED and fixed: every call
         sets `GIT_CONFIG_NOSYSTEM=1` (MinGit's `etc/gitconfig` includes Git for Windows' system config) and
         `filter.lfs.{process,clean,smudge}=` + `required=true`, so a `filter=lfs` path is refused by git by name on every
         machine (measured: it was stored raw without the system config, and went through only where a git-lfs was on PATH).
         Red: `GitEnvironmentTests.Pull_reads_no_system_git_config` (an unparsable `GIT_CONFIG_SYSTEM`: "bad config line 1"),
         `A_path_under_an_lfs_filter_is_refused_by_name` (exited 0 before). Design 2.1 has the rejected alternatives.
      5. *An update mixed two MinGit trees* — CONFIRMED and fixed: `installer/Volt.iss` `[InstallDelete]` clears
         `{app}\bin\git` before `[Files]`; `test-install.ts` step 3 plants a file the old tree had and fails if it survives.
         Red: `BundledGitGateTests.An_update_clears_the_bundled_git_before_it_installs_the_new_one`. `test:install` itself not
         run here (it installs on this machine).
      **Numbers (gate 2b):** typecheck 5/5, lint 0 errors, `bun run check` 18/0; C# Engine 2532 pass/1 skip, Cli 295,
      Connector 127, Ide.Twincat 492, Ide.Codesys (net48) 390, Contracts 37, Repo.Gates 242 — 0 fail; volt-cli `test/unit`
      114/0; volt-control 139/0 (incl. control e2e 11/0); volt-desktop 33/0; volt-vscode 39/0; LSP full suite
      (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 10154 pass / 34 skip / 428 todo / 0 fail (362 files, 857 s) — a first
      run beside the C# suites failed `scripts/check-size.test.ts` once at 6.3 s (green alone in 2.5 s and in the unloaded
      rerun; no LSP file changed). Fixture map untouched (no fixture or transpiler change).
- [x] 2.3 **MOVED to `twincat-later` 1.x (owner 2026-10-14: "we will do more TC later").** TwinCAT 64-bit shell: measure 4026's hierarchy read (install 4026 side by side if needed — owner allows) and make it
      work without Visual Studio; DIALECT row.
      **Step 2c, 2026-10-13 — NOT DONE, blocked on an install the agent cannot make:** TwinCAT 3.1.4026 is downloadable only
      from Beckhoff's portal (myBeckhoff login; `winget search TwinCAT`/`Beckhoff` finds nothing) and installs elevated (a UAC
      consent no unattended step gives, as measured at 2.2). The only XAE here is TcXaeShell 15 (x86, 4024.74). Ready for it:
      `ide.ps1 -XaeBitness 32|64` (shell picked by its exe's PE machine), the release matrix makes a `twincat-64` cell of any
      registered x64 shell; the code path stays the C2t in-process read with the shell's own manifest, `IDE_UNSUPPORTED` by
      name without one. Owner: install 4026 side by side (or on a VM), then run `bun run release:matrix --only twincat-64`.
- [x] 2.4 Localized TwinCAT build output: record German and Russian XAE output; language-neutral parse or state what is lost.
      **Built 2026-10-13 (step 2c, DIALECT D42, design "2.3–2.7"):** measured on a German XAE (`ide.ps1 -XaeLanguage 1031`,
      new: passes `/LCID`, refuses a language the shell has no `Common7\IDE\<lcid>` for): `DTE.LocaleID` 1031; the compiler's
      diagnostics and progress lines stay ENGLISH, Visual Studio's chrome and the compile summary are German
      (`Kompilierung abgeschlossen -- 2 Fehler, 0 Warnungen`). Found: the continuation rule knew only English chrome, so an
      apostrophe message swallowed the German summary/separators. Fix: chrome by SHAPE (`TcObjectModel.LocalizedChrome`: six
      dashes, ten equals signs, `… -- N word, M word`), red first — `TcBuildOutputTests` +7 (the German pane verbatim; five
      localized summaries/separators, 5 red before; a quoted `--` source line still joined). **Russian:** TcXaeShell 15 ships no
      1049 UI and the 4024 PLC satellites have no `ru` — a Russian customer's pane is English; stated, nothing lost.
      Live: full TwinCAT e2e on the German XAE (Project14, worker with the fix) **296 pass / 70 skip / 0 fail**. Ide.Twincat 499/0.
- [x] 2.5 Non-ASCII `%TEMP%`/project paths handed to XAE: measure; fix or refuse by name.
      **Measured 2026-10-13 (step 2c, DIALECT D43) — nothing to fix in the product:** TEMP/TMP under `volt-Тест-Юникод`
      (not in code page 1252) for ide.ps1, XAE, worker and suite, so the fixture copy AND both hand-offs (`TcItemArchive`'s
      export/import zip, the PLCopen import file) were non-ASCII: full TwinCAT e2e **294 pass / 70 skip / 2 fail**, both
      harness-side — `tc-reopen.ts`'s `Add-Type` (csc cannot write to a non-ANSI folder) and the empty-push latency 699 ms with a
      CODESYS suite running beside it. Fixed the harness: `ide.ps1` `Get-CompileTemp` and `fixture-ide.ts` `compileTempEnv` compile
      in an ASCII folder (unit tests +2); no product C# compiles at run time. Once (first German+Cyrillic run) XAE crashed with
      C2i's signature during the first `volt init`; not reproduced (German/ASCII full 296/0, English/Cyrillic full, German/Cyrillic
      retry 15/15). A non-ASCII PROFILE is VM row 4.
- [x] 2.5b **One fixture project per CODESYS version (owner 2026-10-13: "you need to have 1 project for each CS version").**
      Export `test/fixtures/CodesysTestProject.project` from SP21 as PLCopen XML through CODESYS scripting (keeps the
      IDE-made CFC/SFC/LD/FBD bodies a Volt push cannot recreate), create an empty project in EACH installed version (SP18
      3.5.18.30, SP21 3.5.21.40, SP21 32-bit 3.5.21.60, SP22 3.5.22.40) and import it there through scripting, saved in that
      version's format as `test/fixtures/CodesysTestProject.<version>.project`. What a version cannot import is recorded
      with its reason and the e2e expects that refusal (not a failure). `ide.ps1` picks the fixture by `-CodesysVersion`
      (explicit `-Fixture` still wins); the e2e harness records the project and version it ran. Replace the hand-made
      `codesysSP18.project` by the generated one. Re-run the e2e matrix on every version with its own project.
      **Owner: "you can't reuse them"** — never a project opened from another version's file (an upgrade on open is not a
      native project). If importing the SP21 export into an older version is not valid either, build the content in that
      version through its own scripting, object by object, or record what that version cannot hold. The 2026-10-13 matrix
      results for SP22 and 32-bit 3.5.21.60 ran on the upgraded SP21 project — provisional until this re-run.
      **Built 2026-10-14 (design "2.5b"):** `scripts/author-version-fixture.py` (committed, scripts/README): `export` in
      3.5.21.40 - the application's 6 top-level objects as PLCopen XML (folder structure, declarations as plain text) +
      the tasks (PLCopen carries NO Task Configuration) + an inventory (path, type guid, device id, library references with
      resolution/redirection, task settings, a hash of every declaration/implementation text); `import` in each version -
      `projects.create`, that version's OWN `CODESYS Control Win V3 x64` (4096/`0000 0004` at the CODESYS version's number:
      the device repository is shared by all four installs, so "newest" would be SP22's), the XML imported into its
      application, the tasks built member for member, the source's placeholder redirections applied, SAVED, then built
      (0 messages on all four) and inventoried. `CodesysTestProject.{3.5.18.30,3.5.21.40,3.5.21.60,3.5.22.40}.project`
      committed; `codesysSP18.project` deleted (hand-made, and not native either: its device was SP22's x86 `0000 0001`
      3.5.22.40) with its references (release-matrix-cells, DIALECT V7 note).
      **Differences from the source (inventory + re-export diff), each with its reason:** 3.5.21.40 - none (the XML
      re-export differs only in library order). 3.5.22.40 / 3.5.21.60 - the device's own version; the device-resolved
      system libraries at that version (SP22: 3SLicense/CAA Device Diagnosis/IoStandard 3.5.22.0; 3.5.21.60: 3SLicense
      3.5.21.50) - what that version's template references. 3.5.18.30 - (1) the container is `TaskConfiguration`: SP18's
      `create_task_configuration` names it so and `rename("Task Configuration")` raises "Der Name ... ist fuer dieses
      Objekt nicht gueltig" (the e2e `task-writable` now READS the task folder from refs instead of spelling it - also right
      for a German template's `Taskkonfiguration`); (2) SP18's import drops the placeholder redirections (`StringUtils`/
      `Util` unresolved, `Standard` -> 3.5.22.0) - set with the reference's `set_redirection`, now equal to the source;
      (3) system libraries at SP18's (3SLicense/CAA DD 3.5.18.0, CAA DD not qualified-only, IecSfc 4.1.0.0); (4)
      `VltFixtureSfc` holds no `do_checks_for_implicit_code` interface attribute and the SFC bodies no `MetaSteps` -
      measured: a FRESH SFC POU made by SP18's scripting has neither, SP21's has both (MetaSteps = V7's
      `SFCProperty.SFCMetaSteps`, absent on SP18); nothing in Volt reads either; (5) SP18 archives library parameter
      DEFAULTS per reference (Analyzation 6, Util 1): measured on a project SP18's own scripting made from scratch
      (device + `add_placeholder` Analyzation -> 6 values), so it is SP18's, not the import's - the bridge names the
      Library Manager unreadable ("sets 7 library parameter value(s) ... no PARAMETER line spells them yet").
      **Finding for the owner:** on SP18 any project referencing a parameterized library has its Library Manager named
      unreadable; Volt cannot tell a stored default from a set value there. A build on SP18 writes those defaults too
      (V7's `GetParameterValues`), so the script saves BEFORE it builds.
      `ide.ps1` serves `CodesysTestProject.<-CodesysVersion>.project` when it exists (explicit `-Fixture` wins; otherwise a
      warning names the fallback); `vendor-facts.ts`/`completeness.ts` now NAME their fixture (their rows were measured on
      `CodesysTestProject`); the release matrix takes only `CodesysTestProject.<version>.project` and a run that served
      another project is red (`judge`; red first: 3 of `release-matrix.test.ts`; unit 144/0). The harness line names
      project + version + bitness (`[e2e] serving project: CodesysTestProject.3.5.18.30 - CODESYS 3.5.18.30, platform
      3.5.18.30, 64-bit`). **Per-version expectations** (`test/e2e/lib/platform.ts`, the only way a test knows the CODESYS
      version): a named gap passes a test only when it ENDS in that gap's refusal (in its error or a push answer it got -
      any other failure stays one): `codesys-3.5.18.30-no-ldfbd-write` (every graphical file's `it`, and
      `hidden-network-body`'s setup), `codesys-3.5.18.30-no-project-settings` and
      `codesys-3.5.18.30-library-parameter-defaults` (`whole-project`: exactly those items with exactly those reasons).
      Found by the SP18 run and fixed red first: refs named unreadable items in walk order, fetch sorted -
      `ProjectSnapshot.WireOrder` is now the one order (`UnclassifiableObjectTests` +1, red `["Zeta","Alpha"]`); Engine
      2533/0/1 skip.
      **e2e (`ide.ps1 -Instance env-fx`, each version on its own project, full CODESYS suite):** 3.5.18.30 64-bit
      **291 pass / 72 skip / 4 fail**, 110 expectations met (108 no-ldfbd-write incl. 4 not run after their setup met it,
      1 no-project-settings, 1 library-parameter-defaults); 3.5.21.40 64-bit **291 / 72 / 4**; 3.5.21.60 32-bit
      **291 / 72 / 4**; 3.5.22.40 64-bit **291 / 72 / 4**. The 4 on every version are `items/push-without-header-check`'s
      ENGLISH build-message oracle on this machine's GERMAN CODESYS (2.6; owner: record in English) - a language fact, not
      a version one. Before the expectations SP18 was 183 / 72 / 109. IDEs down after each run (`ide.ps1 down`). C#:
      Repo.Gates 243/0, Ide.Codesys 403/0, Cli 295/0, Connector 148/0.
      **Owner 2026-10-14 on SP18:** "SP18 is not fully supported .. just as long the app does not break on internal error."
      So SP18's gaps (LD/FBD writes, Project Settings, library parameter defaults on the Library Manager) stay REFUSED BY
      NAME with their reason — no spelling of SP18-only storage (that would split the wire per version). The guard: on
      SP18 every test passes only on its named refusal (`test/e2e/lib/platform.ts`), so an INTERNAL_ERROR there is red.
- [x] 2.6 CODESYS 32-bit: `ide.ps1` bitness selection, harness reports bitness, e2e on 32-bit SP18/21/22; DIALECT.
      **Landed 2026-10-14 (the owner's language-neutral close):** `items/push-without-header-check`'s build-error rows carry
      their code beside the recorded English message (`C0077` Unknown type, `C0032` Cannot convert, `C0046` not defined,
      `C0035` call target); on CODESYS an error is matched as item + code + the identifiers it quotes
      (`test/e2e/lib/build-error-key.ts`, unit `build-error-key.test.ts` 6/0, red before: module missing), on TwinCAT (no
      code, English compiler, D42) as the whole message as before. Live, `ide.ps1 -Instance environment-dependency-audit`,
      this machine's German CODESYS: the old file **7 pass / 4 fail** on 3.5.21.40; the new file **11/0** on 3.5.18.30,
      3.5.21.40, 32-bit 3.5.21.60 and 3.5.22.40. DIALECT V9 updated. TwinCAT not re-run (its expectation is unchanged text).
      **Owner 2026-10-14:** 32-bit SP18/SP22 MOVED to `twincat-later` 2.1. The English-message gap is closed differently: no
      English CODESYS install — the 4 `items/push-without-header-check` tests that compare English build-message TEXT become
      language-neutral (match on the message code / structure, not the words), red first under the German UI, then green on
      every version. Tick 2.6 when that lands.
      **Built 2026-10-13 (step 2d, DIALECT V9):** `ide.ps1 -CodesysBitness 32|64` (a version in both refused without it;
      an edition not installed refused by name); the harness prints and reports what it drove — `[e2e] serving project:
      CodesysTestProject — CODESYS 3.5.21.60, platform 3.5.21.60, 32-bit (…)`, bitness from the IDE process (`bitnessOf`:
      `wow64.dll`, unit +4), `VOLT_E2E_REPORT` JSON line. e2e on 32-bit 3.5.21.60 (3.5.21.40 fixture — provisional until 2.5b):
      **281 / 72 skip / 14 fail**, every failure a LANGUAGE fact: this machine's CODESYS answers in GERMAN (Windows UI override
      nl-NL, user language list `tr`; the 64-bit 3.5.21.40 too). Fixed, red first: `CodesysDriver.Refusal` read only English, so
      "Der Name 'Vlt__Log' ist für dieses Objekt nicht gültig." went out `INTERNAL_ERROR` (3 e2e) → `CodesysRefusalWording`, the
      vendor's resource formats in every shipped language, whole-message (`CodesysChildRefusalTests` +11, 11 red before; the old
      English substring also matched "Scope is not valid for this object."); the e2e build-diagnostic checks matched English
      sentences (7) → CODESYS diagnostics told by code (C0046/C0142/C0032). After: 32-bit 25/4 on the four files; 64-bit 3.5.21.40
      full **291 / 72 / 4** — the 4 are `items/push-without-header-check`'s exact ENGLISH build messages (the recorded oracle) on a
      German IDE. **Owner:** the oracle language is English — on this machine now CODESYS (and so `record:language`/`record:exec`)
      would write German; set the Windows display language back (or CODESYS's) before recording. 32-bit SP18/SP22 not installed —
      not run. Ide.Codesys 403/0.
      **Unticked at gate 2c+3 (review):** the task names e2e on 32-bit SP18/21/22 and only 32-bit 3.5.21.60 ran. Still owed:
      32-bit 3.5.18.30 and 3.5.22.40 (not installed here — owner installs, then `bun run release:matrix` makes their cells), and
      a LIVE run of the whole-message refusal classifier on an ENGLISH CODESYS (both live runs were German; the English kind
      refusal "Object … is not accepted by parent object …" is matched as a whole message from the resource string only).
- [x] 2.7 CODESYS activation hints per feature set and locale; the installer tolerates WMI being unavailable.
      **Built 2026-10-13 (step 2d, DIALECT V8):** activation hints — the connector's steps show CODESYS's menu in English and,
      beside it, in the Windows UI language (`GetUserDefaultUILanguage`) where CODESYS ships it: `CodesysMenuPath`, CODESYS's own
      strings from `Standard.opt.menu` + the ScriptEngine satellites (identical on SP21/SP21-32/SP22; SP18 German differs in one
      word), plus the command's category for an OEM-trimmed menu (Tools → Customize). Feature sets: the ScriptEngine plugin reads
      no feature setting — not gated. `CodesysMenuPathTests` 21/0. WMI: the installer no longer uses it — `installer/Processes.iss`
      (kernel32 `CreateToolhelp32Snapshot` + `QueryFullProcessImageNameW`; a failed snapshot RAISES, never an empty list),
      `Volt.iss` FindCli/StopOwn/ConnectorRunning on it; gate `InstallerNeedsNoWmiTests` (red on HEAD's WbemScripting). Measured: a
      probe setup including `Processes.iss` listed 464 processes and read an ELEVATED one's path; `Volt.iss` compiles (ISCC 6).
      **Not run:** `test:install` (installs on this machine) — promote.yml runs it on every release; WMI-disabled = VM row 8.
- [x] 2.8 Culture-invariant replacements at every site the 1.2 gate names (C# 39 = 29 + 10 default-comparer sorts since
      gate 1, TS 1; shipped Python 0 — IronPython's `str.lower()` is invariant, measured at gate 1), emptying the
      `CSharpCensus`/`TypeScriptCensus`, and the
      globalization analyzers (CA1304/CA1305/CA1309/CA1310/CA1311, `AnalysisLevel` set so netstandard2.0/net48 are
      analysed) as errors in the shipped projects, fixing the 29 typed sites they report; remove the `ExpectRed` marks.
      (Added by step 1: 1.1/1.2 are tests first and no fix task named these sites.)
      **Built 2026-10-14:** all 39 census sites + the 29 analyzer sites replaced: the Parse family with
      `NumberStyles.Integer, CultureInfo.InvariantCulture` (the style the old call used; ports, pids, git's numbers, TC build
      line/column), `Convert.To*`/`ToString(fmt)`/`int.ToString()`/`long.ToString()` with `CultureInfo.InvariantCulture` (the
      8 Descriptors, `RotInstances`, `TcSolutionExplorer`, the 12 `TcPlcOpenWriter` ids, `TcHierarchy`, `BeckhoffDriver.Tree`,
      `NetworkTextGate`, `Hasher`, `StatusWindow`), `StartsWith(…, Ordinal)`, every sort with its comparer (string keys
      `StringComparer.Ordinal`, int keys `Comparer<int>.Default`); TS: `volt-control` `byFileRank` (exported, ordinal path) —
      red first (`diagnostics.test.ts` "files rank … ordinally": `B` before `a`, 1 fail before, green after, also under tr-TR).
      Analyzers: `packages/volt-cli/src/.editorconfig` (CA1304/CA1305/CA1309/CA1310/CA1311 = error) + `src/Directory.Build.props`
      (imports the parent, `AnalysisLevel=latest`) — measured that it reaches the old targets: an `int.ToString()` +
      `"x".ToUpper()` planted in Volt.Ide.Codesys (net48), Volt.Ide.Twincat.Explorer (net472) and Volt.Wire (netstandard2.0)
      fails each build with CA1304/CA1305/CA1311 (removed). Gate: both censuses gone (empty → the ratchet was the
      no-offence test twice; removed with `AssertCensus`), the three `ExpectRed` marks removed, the analyzer test also
      requires `AnalysisLevel` in `src/Directory.Build.props`. Shipped Python: 0 sites (unchanged).
      **Numbers:** `dotnet build Volt.sln -c Debug` 0 errors; Repo.Gates 243/0 (and 243/0 under `VOLT_TEST_CULTURE=tr-TR`),
      Contracts 37/0, Engine 2532/0/1 skip, Cli 295/0, Connector 148/0, Ide.Twincat 502/0, Ide.Codesys (net48) 403/0,
      Relay 64/0; volt-control 140/0 (tr-TR 140/0), typecheck green; volt-cli `test/unit` 144/0; lint 0 errors; LSP full
      suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 10154 pass / 34 skip / 428 todo / 0 fail (362 files, 973 s) — a
      first run beside the headless CODESYS fixture runs timed out `interp — no iteration cap > FOR / REPEAT / WHILE` once
      at 5.3 s (1.3 s alone, green twice alone and in the unloaded full rerun; no LSP file changed).

## 3. Release gate and VM checklist

- [x] 3.1 `scripts/release-matrix` (name per scripts/README): e2e over every installed IDE variant, the matrix printed, a red
      cell fails; used by the release steps instead of hand-run e2e.
      **Built 2026-10-13 (step 3, design "3.1"):** `bun run release:matrix` (`scripts/release-matrix.ts`; decisions in
      `packages/volt-cli/scripts/release-matrix-cells.ts`, `test/unit/release-matrix.test.ts` 8/0): cells found from the installs,
      `ide.ps1 -Instance release-matrix` per cell on its own fixture, the whole e2e, the run's `VOLT_E2E_REPORT` checked against the
      cell, matrix printed, `dist/release-matrix/result.json` for a clean commit; `release.ts` refuses a build whose commit has no
      green result. This machine: `codesys-3.5.18.30-64` (codesysSP18), `codesys-3.5.21.40-64` (CodesysTestProject, made in 3.5.21.40),
      `codesys-3.5.21.60-32` and `codesys-3.5.22.40-64` RED before running (no native fixture — 2.5b), `twincat-32`.
      (Corrected at gate 2c+3: this note had listed `codesys-3.5.21.40-64` among the red ones; `codesysFixture` maps it to its
      own project and the partial run below was GREEN on it.) Proven partial
      (`--only codesys-3.5.21.40-64,codesys-3.5.21.60-32 --tests test/e2e/endpoints/refs.test.ts`): GREEN 3/0 with the report
      naming 3.5.21.40 64-bit; RED by name for the 32-bit cell. A full matrix is NOT green today: 2.5b's fixtures, the German
      CODESYS (2.6) and 3.5.18.30's expected LD/FBD refusals (2.0) each redden a cell.
- [x] 3.2 **VM cells MOVED to `twincat-later` 3.1 (owner 2026-10-14: "VMs are ok for now"); the checklist itself is written.** The VM checklist in `scripts/README.md` (TwinCAT-only 4024, tr-TR/ru-RU system locale, LTSC 2019, non-admin
      Cyrillic user, no git, no AVX2; CODESYS and XAE "as administrator" with Volt unelevated — 2.2's live check) — run once now, results recorded.
      **Step 3, 2026-10-13 — checklist WRITTEN (`scripts/README.md`, 8 rows incl. WMI-disabled), VM run NOT done:** this machine
      is Windows 11 Home (no Hyper-V), no VM image is here, and rows 4/7 need a second user and a UAC consent. What the dev
      machine stood in for, run here: row 2 partly (CODESYS answering in German — 2.6; a German XAE — 2.4; tr-TR/ru-RU/de-DE
      process cultures — 1.1); row 4 partly (Cyrillic TEMP + project path — 2.5); row 5 (`GitEnvironmentTests`, no git on PATH —
      2.1); row 1's VS-free proxy state (C2t, kept by the owner). Owed to VMs: rows 1, 3, 4 (profile), 6, 7, 8.
- [x] **Gate 2c+3 (2026-10-13) — review findings, each fixed with a failing test first, or answered:**
      1. *`promote.yml` never checked the matrix (the Actions door skipped it)* — CONFIRMED and fixed: one judgement,
         `proofRefusal` (`release-matrix-cells.ts`); `release.ts` attaches the result to the release as
         `release-matrix.json`; `promote.yml` downloads it and runs `release-matrix.ts --verify <file> <sha>` against the
         release's own commit — no attachment, another commit, a dirty run, a red cell or no cell is refused by name.
         Red: `release-matrix.test.ts` "matrix proof" ×4. CLAUDE.md, scripts/README, design 3.1 say so.
      2. *A vendor not installed was silently dropped* — CONFIRMED and fixed: no CODESYS is one red `codesys-none` cell,
         no registered XAE shell one red `twincat-none` cell; the Program Files folders come from `%ProgramW6432%` /
         `%ProgramFiles(x86)%` (refused by name when unset), not a hard-coded `C:\Program Files`. Red: "cells" +3.
      3. *Untracked files did not make the checkout dirty* — CONFIRMED and fixed: `dirtyPaths` over
         `git status --porcelain --untracked-files=all`, only `openspec/` (never built; other sessions keep proposals
         there) outside the build. Red: "dirty checkout" ×3.
      4. *An elevated Volt process now spun StopOwn 30 s and failed unannounced* — CONFIRMED (a behaviour change, the
         right one: the old stop was blind to it and walked into a locked file) and made explicit: `TerminatePid` returns
         the Windows error; on `ERROR_ACCESS_DENIED` StopOwn gives up at once and the setup/uninstaller names it ("…
         runs elevated … close it, or run the setup as administrator"). Red: `InstallerNeedsNoWmiTests.An_elevated_Volt_process_is_refused_by_name_at_once`.
         `Volt.iss` compiles (ISCC 6, full setup into scratch). installer/README + VM row 7 carry the check; not run live
         (needs a UAC consent).
      5. *`announceProject` aborted every e2e run when the IDE's modules were unreadable; `?`/null fallbacks* — CONFIRMED and
         fixed: an unreadable bitness is NAMED on the console line and the run goes on (`ideLine`); a run that must report
         (`VOLT_E2E_REPORT`, the matrix) refuses a missing fact or an unreadable bitness by name (`e2eReport`), never
         writes null. Red: `fixture-ide.test.ts` "e2e report" ×4.
      6. *The activation hint could name a menu the user does not see* — (1) and (3) fixed: German names the 3.5.18
         wording too ("… (CODESYS 3.5.18: Skript-Datei ausführen)"); the Customize entry is category AND command in one
         language (`CustomizeEntry`; the test-only `Category` deleted — `NoTestOnlyCodeInSrcTests`). Red: `CodesysMenuPathTests` +4/2 changed.
         (2) answered, not fixed: CODESYS's UI-language setting is unmeasured (V9: none found), so the Windows UI language
         stays a stated BET beside the always-shown English path (DIALECT V8, `CodesysActivation`); reading CODESYS's own
         setting is owed — not cheap (no setting known).
      7. *`LocalizedChrome` truncated a quoted banner line* — CONFIRMED and fixed: a separator is text BETWEEN two runs of
         dashes/equals signs, a bare run stays source; and a third continuation line no longer joins on `\n` instead of the
         pane's `\r\n` (found by the same test). Red: `TcBuildOutputTests.AQuotedBannerLineIsStillAContinuation` ×3. DIALECT D42.
      8. *Ticks claimed more than ran* — CONFIRMED: 2.6 UNTICKED with what is owed (32-bit SP18/SP22, a live English CODESYS
         for the whole-message classifier); the 3.1 note's red-before-running list corrected (`codesys-3.5.21.40-64` has its
         own fixture and ran GREEN).
      9. *The CODESYS C0046 check was weakened for English too* — CONFIRMED and fixed: the planted-child check holds the
         WHOLE sentence again, in a language it was measured in (English, German), so a truncated or rewritten message
         is red and any other language fails by name. Recorders: `record:language`'s target probe already reads a
         non-English CODESYS as `unknown` and refuses a `RECORD_ONLY` merge — its refusal and `check-recording.ts` now name
         the language; `record:exec` has no probe — owed (DIALECT V9). Not run live (no English CODESYS here, 2.6).
      10. *Single-backslash test paths; a real `%ProgramData%` folder made by a unit test* — CONFIRMED and fixed: real
         Windows path shapes (asserted), the replacement folder made under a scratch ProgramData and removed, + a refusal
         case. `fixture-ide.test.ts` "compile temp" ×3.
      **Numbers (gate 2c+3):** typecheck 5/5, lint 0 errors, `bun run check` 18/0; `Volt.sln` Debug build 0 warnings 0
      errors (the Release build could not overwrite `Volt.Cli\bin\Release` — locked by a running `volt.exe` this run did
      not start, left alone); C# Engine 2532 pass/1 skip, Cli 295, Connector 148, Ide.Twincat 502, Ide.Codesys (net48)
      403, Contracts 37, Repo.Gates 245 — 0 fail; volt-cli `test/unit` 143/0; volt-control 139/0; volt-desktop 33/0;
      volt-vscode 39/0; LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 10154 pass / 34 skip / 428 todo /
      0 fail (362 files, 988 s). Fixture map untouched (no fixture or transpiler change). Live e2e and `test:install` not
      run (they need the IDEs / install on this machine).

## 4. Close

- [ ] 4.1 Docs (installer README locations incl. bin\git, CLAUDE.md prerequisites, DIALECT V-rows); full suites; archive.
