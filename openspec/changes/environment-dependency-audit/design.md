## 2.0 — An absent vendor member fails every op (SP18)

**Target.** On CODESYS 3.5.18.30 the library manager's archive does not name `ParameterTable`. `ArchivedObject` throws
`Unreadable` → `GetLibraryRefs` throws → `CodesysDriver.Tree.Walk` has no catch around the manager → the whole walk
fails → every op that walks (refs, fetch, pull, push, lifecycle) fails (212 of 218). Two facts are merged into one throw:
*the version's object model has no such member* and *the member is there but its read failed*. Same pattern at every
`ArchivedObject` / `NwlInterop.Declared` / `Has` site bridge-one-to-one added (Properties, Task, Libraries).

**Choice: a measured availability table, keyed by platform version, and per-item refusal.**
- `MemberAvailability` (Ide.Codesys): rows `(owner type, member, first platform version that has it)`, filled ONLY from
  the census below; the version is `CodesysPlatform`'s (DIALECT V1). A new DIALECT row (V7) is the vendor-fact record;
  a gate test holds the table and the row in step.
- The read asks the table first. **Absent, and the table says this version lacks it** → the fact the member would have
  carried does not exist here: nothing to spell, nothing reported (for `ParameterTable`: no parameter values to name).
- **Absent where the table says it exists, or on a version no census measured** → that ITEM is unreadable with its reason
  (`UnreadableObject`, the existing per-item path), never the op. **Present but the read throws** → same, per item.
- The library manager's read is caught in `Walk` like every other per-item refusal: the manager becomes one
  `UnreadableObject` (no `.library` file is removed — `Removal.IsUnreadable` already holds them), the rest of the walk runs.

**Rejected (one line each).**
- *Absent ⇒ empty (treat a missing member as "no values")* — a fallback: a member renamed on SP22 reads as "nothing
  there" and the loss is silent.
- *Refuse the version at start (V2-style capability)* — refuses all of SP18 for a fact about library parameters; that is
  the regression, made permanent.
- *Infer per object at runtime (absent from this instance's `SerializableValueNames` ⇒ absent from the version)* —
  decided by one measurement: if the archive list can differ between two instances of one type (e.g. omits an empty
  member), absence is not a version fact. Census reads two instances per type (with and without the value); if they
  differ, the table is the only sound key; if constant per type, the table still holds, it just never disagrees.

**Census (the measurement 2.0 runs, decides the table's rows).** One probe per IDE — SP18 3.5.18.30, SP21 3.5.21.40,
SP22 if installed, 32-bit 3.5.21.60 — lists, for every owner type the bridge reads, the FULL `SerializableValueNames` and
the declared properties it reads by `Has`/`Declared`. Diffed per version, a rename shows as one name gone and one new
(never read as absence). Probe deleted after; the numbers live in V7.

**Stays refused by name.** A version not in the census with a member absent (e.g. 3.5.17.20 field) — per item, naming
member, type and version; V2 capabilities (start refusal) unchanged; a present member with an unmeasured value (the
`LibraryConstants`, text-list translations) unchanged; ParameterTable values on versions that HAVE it stay "unspelled".

**Migration.** Red first: a FakeIde library manager whose archive omits `ParameterTable` (absent-by-version → green
walk, no report line) and one on an uncensused version (→ manager unreadable, other items pulled); today both fail the
walk. Then census → table + V7 → route `ArchivedObject`/`Declared`/`LibMember`/`TaskMember` through it → catch in
`Walk`. Done when SP18 e2e fails only the expected LD/FBD write refusals.

**Built (2.0, 2026-10-13) — where reality changed the plan, and why.**
- *Three rows, not one.* The census (DIALECT V7: SP18 3.5.18.30, SP21 3.5.21.40, 32-bit SP21 3.5.21.60, SP22 3.5.22.40;
  every instance in four fixtures plus a fresh instance of each owner type) found 3.5.18.30 without
  `LibManObject.ParameterTable` AND without `TaskConfigObject.StackSize` / `UseConfigurableStackSize` — the Task
  Configuration's `ContainerRefusal` read them too, so on SP18 it was named unreadable and every task under it held back.
  The declared members/methods read by `Has`/`Declared`/`LibMember`/`TaskMember` are identical on all four, so those
  sites were NOT routed through the table (a missing one still refuses its item by name — no version fact to record);
  the table is read only by `Archives` (archive members). Within one platform every instance of a type archives the
  same list (with and without values), so the rejected per-object inference would never have disagreed — the table
  stays the key for the rename reason.
- *Which `.library` files are kept.* `Removal.IsUnreadable` holds items by bare name + kind, and the manager's libraries
  are not known by name when it is unreadable — so the manager is named with a known (container) kind and its OWN folder
  is unwalked (absence beside it still means deleted). That protects the `.library` manifests, not the signature files:
  a fetch whose live library set missed them read them as REMOVED, set `librariesRefreshed`, and the client would have
  dropped every signature file. `FetchService` now refuses to refresh while a known `.library` is unseen (under an
  unwalked folder, or walked and unreadable) — red test `LibrariesRefreshedTests.A_walk_that_could_not_read_the_library_folder…`.
- *The platform reaches the read.* `CodesysObjectModel` takes the platform version (the driver's, DIALECT V1); the
  archive readers became instance methods. A null platform (not read) is no measured one: every absence refuses.
- *Gate 2a: the library-refresh hold is per folder, and SP18 parameter values live on the references.* The hold above
  first fired on ANY unwalked folder; it now asks THE removal rule (`Removal.Removed`), so a library absent from a
  manager the walk read is removed and refreshes as before 2.0. And `ParameterTable`'s absence on 3.5.18.30 turned out
  to be a rename of WHERE, not WHETHER: each reference archives its own `Params` there (moved into the table by later
  versions on load), so on SP18 those are read and named. The rule this adds to the table: a row says the MEMBER is
  absent; the reading site must state where its fact lives instead, or show (from the vendor's own assembly) that it has
  none — as the stack settings, which SP18 does not have under any name.

## 2.1 — The CLI's own git (MinGit), full install only

**Choice.** MinGit 2.56.0.2 (Git for Windows' official redistributable, unmodified), pinned with its SHA-256 in ONE file,
`packages/volt-cli/src/Volt.Cli/MinGit.targets`, which fetches it once into `packages/volt-cli/.cache/mingit/<version>/`
(git-ignored; download → `VerifyFileHash` → unzip into a build-private folder → rename into place, so two builds at once
never see half a git) and copies it as `git\` beside volt.exe in every build output that runs the CLI (Volt.Cli, and
through the reference Volt.Cli.Tests) and beside the published single-file exe (`dist\Cli\git\` → `{app}\bin\git\`).
`Sync/Git.cs` runs `git\cmd\git.exe` in the executable's folder by its path — never a PATH lookup; absent, it is named
("Volt's bundled git is missing: … — reinstall Volt"). `VOLT-SOURCE.txt` beside MinGit's own `LICENSE.txt` names the
binary URL, its SHA-256 and the corresponding source tag (GPLv2).

**Per call, never in any config:** `-c core.longpaths=true` always; for a worktree op (`-C <root>`) `-c safe.directory=<root>`
and `GIT_CEILING_DIRECTORIES=<parent of root>`. Measured 2026-10-13: MinGit 2.56 honours `-c safe.directory` (2.37.1 did
not), case- and slash-insensitively; an explicit `--git-dir` is not ownership-checked (object-store ops need nothing).

**Rejected.**
- *`safe.directory=*`* — measured: a broken `<root>/.git` sent discovery up the path to a `C:\.git` on the dev machine
  owned by another principal, and with `*` git ANSWERED from it ("not a Volt workspace" for a bound project; under a bound
  ancestor it would have read the ancestor's binding). The named root alone refuses that repo; the ceiling stops the
  walk at the root (red test `BundledGitTests.A_broken_workspace_repo_never_resolves_to_the_repo_above_it`).
- *Git on PATH when present, MinGit otherwise* — a fallback: a 2.37 on PATH ignores `-c safe.directory`, so the answer
  would depend on what else the machine has.
- *Commit the zip / vendor it in the repo* — 40 MB of binary history per bump; the pin + hash is the same guarantee.
- *Bundle it in `connector\`/`codesys\` too* — owner: those are the bridge bundles PLCAssist ships, and a bridge never runs
  git. Held three ways: `BundledGitGateTests` (only Volt.Cli imports MinGit.targets; no bridge project's reference closure
  reaches it), `build-cli.ps1` and `build-payload.ts` refuse a bridge folder with a git, `test-install.ts` asserts none
  under `{app}\connector|codesys`.

*Gate 2b — the pinned git reads no system config, refuses LFS, and an update replaces its tree whole.* MinGit's own
`etc/gitconfig` INCLUDES `C:/Program Files[ (x86)]/Git/etc/gitconfig`, so an installed Git for Windows steered the pinned
git; every call now sets `GIT_CONFIG_NOSYSTEM=1` (nothing there is Volt's: line endings are the workspace's
`.gitattributes` `eol=lf`; the user's identity is global config, which stays read). The same system file set
`filter.lfs.required=true` and MinGit ships no git-lfs — measured: with it, `add` succeeded where a git-lfs happened to be
on PATH; without the system config, a `filter=lfs` path went in RAW. Per call, `filter.lfs.{process,clean,smudge}=` (empty,
overriding a global `git lfs install`) + `required=true`: such a path is refused by git, by name ("smudge/clean filter lfs
failed"), on every machine. Rejected: bundling git-lfs (no Volt workspace has asked for it; a PLC project under LFS is
niche) and `required=false` (stores raw content where the user's own git would write a pointer — a silent divergence).
The installer clears `{app}\bin\git` before `[Files]` (`[InstallDelete]`) — `[Files]` only adds and overwrites, so a
bumped pin would leave the old MinGit's extra files beside the new ones; test:install step 3 plants such a file.

`binary-targets.ts` allows one x86 file in it: `bin/git/usr/libexec/getprocaddr32.exe` (MinGit's helper for interrupting
a 32-bit child — measured: the only non-x64 PE of 187 in MinGit 2.56.0.2).

## 2.2 — Elevation: a pipe that admits its user; an XAE nobody can see, named

**Measured 2026-10-13 (unelevated; the elevated side read from elevated same-user processes already running).**
- A pipe created with no security attributes (.NET Framework 4.8 — the in-proc CODESYS runtime):
  `O:<user>D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<owner>)(A;;FR;;;WD)(A;;FR;;;AN)`, no label.
- The token of an elevated process of the same user (CODESYSControlSysTray, GatewaySysTray): `TokenElevation=1`, owner
  `S-1-5-32-544` (Administrators), integrity High (S-1-16-12288); this process: owner = the user, Medium. And an
  unelevated process CAN open such a token for `TOKEN_QUERY` (through `PROCESS_QUERY_LIMITED_INFORMATION`).
- Hence an elevated CODESYS's default pipe gives FA to Administrators only (deny-only in the user's unelevated token) and
  FR to Everyone: the unelevated CLI/connector/desktop opening it read-write is refused (access denied).

**Choice.** `Volt.Wire/PipeAcl`: every instance `PipeServer` creates is `CreateNamedPipeW` with
`D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<TokenUser SID>)S:(ML;;NW;;;ME)` — the user by SID (equal in both tokens, unlike the
owner), Medium no-write-up stated (not left to the label a High creator would get), no Everyone/Anonymous read, remote
clients rejected. Read back from the live pipe on net10 and net48 it is exactly that, the kernel adding `S:AI`.
A client refused anyway (another user's IDE, an elevated IDE on an older bridge) gets `PipeAccessDeniedException`, named,
→ CLI `BRIDGE_ACCESS_DENIED`; the resolver's per-pipe project probe no longer reads a refusal as "not open".
TwinCAT: an elevated XAE's ROT entries are invisible to an unelevated worker probe, so no pipe exists to be refused; the
CLI with no TwinCAT pipe reads the TcXaeShell[64] processes' elevation and names an elevated one (or one whose token it
cannot read: another user) instead of "start the Volt Connector"; the connector's fleet logs each such pid once.

**Rejected.** *`PipeOptions.CurrentUserOnly`* — not on net48, and on .NET it keys on the token OWNER, which elevation turns
into Administrators. *`System.IO.Pipes.AccessControl`* — a package dependency for the merged single-assembly CODESYS bridge,
for what one P/Invoke does on both runtimes. *Everyone read kept* — nothing reads a bridge pipe without writing.

*Gate 2b — a refusal never hides a match, and every remedy survives.* The resolver probes every pipe and COLLECTS
refusals: a refusing pipe beside the one holding the bound project no longer stops the resolve (it did — `projectsOf`
threw out of the `Where`); a refusal is named (`BRIDGE_ACCESS_DENIED`, each refusal's sentence) only when no pipe
matches. `UnreachableXae` keeps this user's unelevated XAE(s) in the message with "start the Volt Connector" beside the
elevated/foreign one (it dropped them, and the test pinned the drop). The connector carries a refused pipe as
`SourceScan.Refused` → `ConnectorView.Refused` (`{vendor, pipe, reason}`, always present) → volt-control `refusedIdes`
(label "An IDE Volt cannot reach", caption "access denied", the reason) → both shells draw it as a no-action row beside
the detected list (unbound onboarding and the offline reconnect list). No project row is invented for it: its `health`
never answered, so it has no name.

**Not measured live:** an elevated CODESYS serving through this ACL to an unelevated `volt`, and an elevated XAE beside an
unelevated connector — each needs one run "as administrator" (a UAC consent no unattended step gives). On 3.2's checklist.

## 2.3–2.7 — the environment, measured (step 2c/2d)

**2.3 (TcXaeShell64) — not measured: no 4026 can be installed unattended here.** TwinCAT 3.1.4026 comes only from
Beckhoff's portal (a myBeckhoff login; `winget search TwinCAT/Beckhoff` finds nothing) and installs elevated (a UAC
consent no unattended step gives; 2.2 measured that refusal). What stands without it: the reader for a 64-bit XAE is
the x64 worker in-process with the XAE's own `Common7\IDE\Automation\msenvp.dll.manifest`, refused by name
(`IDE_UNSUPPORTED`) when the shell carries none (DIALECT C2t; `TcHierarchySelectionTests`). Tooling ready for it:
`ide.ps1 -XaeBitness 64` picks a shell by its exe's PE machine, and the release matrix makes a `twincat-64` cell of
any registered x64 shell.

**2.4 (localized build output) — chrome by shape, not by an English list (DIALECT D42).** Measured on a German XAE
(`ide.ps1 -XaeLanguage 1031` → `/LCID 1031`): the compiler's diagnostics and progress lines stay English, Visual Studio's
lines and the compile summary are German. The one break was the continuation rule's English chrome list (an apostrophe
joined `Kompilierung abgeschlossen -- 1 Fehler, 0 Warnungen` to the message); chrome is now also a separator or a
`… -- N word, M word` summary in any language. *Rejected:* a German (and every other language's) word list — the shapes
hold for languages nobody measured; reading the pane by GUID — the pane was never the problem. TcXaeShell 15 ships no
Russian UI and the PLC's 4024 satellites none either: a Russian customer's pane is English (stated, not lost).

**2.5 (non-ASCII paths to XAE) — nothing to fix in the product (DIALECT D43).** The full TwinCAT suite with TEMP —
so the fixture copy and both temp hand-offs — under a Cyrillic folder: green but for two harness failures. The
refusal belongs to Windows PowerShell's `Add-Type` (csc cannot write to a non-ANSI folder), which only dev tooling uses:
`ide.ps1` and `tc-reopen.ts` compile in an ASCII folder. A non-ASCII *profile* is VM row 4.
