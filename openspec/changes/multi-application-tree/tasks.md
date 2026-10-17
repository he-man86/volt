## 1. Design

- [x] 1.1 (design-first) Census every place keyed by the bare/full name (wire, Versioning, Sync, CLI, LSP, control,
      vscode). The identity is the item's path in the tree (owner, 2026-10-17): fetch and push pick the
      device/application/PLC project from it. Write design.md with one example per vendor and how a move is told apart.

## 2. Fixtures and red tests

- [x] 2.1 Commit the owner's two edited projects as fixtures: `test/fixtures/CodesysTwoDevices.3.5.21.40.project` and a
      TwinCAT solution with two system projects / several PLC projects. Red e2e: pull holds every item of every
      application; an edit in each application round-trips to the right one.

## 3. Build

- [x] 3.1 Both drivers return the whole tree in one refs (TwinCAT: every PLC project of every system project).
- [x] 3.2 Identity carries the location end to end (wire, version maps, push ops, workspace layout).
- [x] 3.3 LSP: names resolve within their own application.
      **Gate step 3a (2026-10-17).** Built 3.1–3.3 (design §9). Review findings, all four handled:
      (1) **taken, test-first**: a push `set`/`deleteItem` carrying a member the op does not have (`toFolder`, `toName`)
      is refused `BAD_REQUEST` naming it (`[JsonUnmappedMemberHandling(Disallow)]`; `PipeTransportTests`, 2 red → green).
      The live e2e harness, 51 e2e test files and the `completeness`/`vendor-facts` scripts now spell every item by path:
      `main-program.ts` moved to `volt-cli/test/e2e/lib` (the LSP recorders import it from there) and gained `pathIn`;
      `lib/workspace.ts` adds `at`, `pathOf`, `itemIn`, `existingOrAtRoot`, `projectRoot` (CODESYS tree root, TwinCAT PLC
      project) and `applicationRoot`. Premises changed by the design, not by the code: a move that started in the CODESYS
      POU pool now starts at the application root (§5: pool → application is a delete and a create); the refusals
      matrix masks the create root (`<root>/`) and no longer compares item versions across vendors (a version hashes the
      path, which carries each vendor's spine); `vendor-parity`'s fetch row has no `folder` and `refs` states
      `applications`. (2) **taken, test-first**: `refs`/`fetch` take `knownApplications` (the CLI sends its sidecar's):
      a known path under an unread device is placed by the baseline's applications, and with none a path in no
      application never pairs; `FakeIde` no longer states an application under a folder it cannot walk (3 red → green in
      `MultiApplicationTreeTests`). (3) and (4) **niche: accepted loss (0 occurrences in the corpora — each of the six is
      one application, so no pool document is compiled by two)**, recorded as known divergences (`test.failing` in
      `src/server/document-diagnostics.test.ts`: hover on a pool document's global answers one application's
      declaration; a pool POU only one application uses reports the other application's errors).
      **Found by the gate**: (a) live on TwinCAT, `push-return-sources` 8.4 — a rename names its new path, which the
      apply order read as a placement one folder deep, so it ran BEFORE a caller sent ahead of it, rewrote the caller
      (DIALECT C2p) and the caller's op was refused STALE. `PushService.Places`: a rename that keeps its folder places
      nothing (`RenameChangesOnlyNamedItemsTests` in a folder, red on the TwinCAT shape → green). (b)
      `workspace-store.ts` was 410 lines: the pool tables moved to `ApplicationScopes` (`tableOf`, `documentsOf`,
      `poolTables`).
      **Numbers**: typecheck clean (5 packages); `bun run lint` and the LSP lint (layering, size, dead exports,
      citations) clean; `bun run check` green. C# (Debug): `Volt.Engine.Tests` 2988 pass / 1 skip (+5),
      `Volt.Cli.Tests` 301 (+2), `Volt.Contracts.Tests` 42, `Volt.Repo.Gates` 243, `Volt.Ide.Twincat.Tests` 589,
      `Volt.Ide.Codesys.Tests` 457, `Volt.Connector.Tests` 146 — 0 fail; volt-cli unit 159 pass, 0 fail. LSP full suite
      (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) 10351 pass / 34 skip / 428 todo / 0 fail over 372 files (+6, two of
      them the known divergences above). Fixtures and the transpiler unchanged, so no `rate:fixtures`. Live e2e, own
      instance `multi-application-tree`: CODESYS (CodesysTestProject.3.5.21.40) 320 pass / 82 skip / 0 fail (graphical
      152/152); TwinCAT Project14 317 pass / 87 skip / 0 fail; `multi-application` 4/4 on CodesysTwoDevices and 4/4 on
      TwinCAT MultiProject. The skips are the suites that need another fixture (one-to-one, unicode, pro2193, the other
      vendor) or both IDEs at once (`vendor-parity`, the refusals parity half). The Release `Volt.Ide.Twincat` and
      `Volt.Cli` outputs were held by another session's processes, so the TwinCAT worker was built to the scratchpad and
      served with `ide.ps1 -BridgeDir`.
      Left for 3.4: `docs/wire.html` still spells `toName`/`toFolder`/`newFolders`; `items.html` and ARCHITECTURE.
- [x] 3.4 Gates green on both vendors; docs (`items.html`, ARCHITECTURE "item name is the identity") updated.
      **Gate step 3b (2026-10-17).** Docs: `wire.html`, `items.html`, `driver.html`, `relay-protocol.md`, the OpenRPC
      document and ARCHITECTURE spell the path identity and `to`. Review findings, five:
      (1) **taken, measured**: §8 had no recording. The e2e `multi-application` now records it on both vendors ("each
      application is its own scope"): a GVL with the same global in two applications plus an FB of the first named in
      the second builds with exactly one error, `C0077 Unknown type: 'VltE2EOnlyA'` on the second application's
      program (CODESYS SP21 and TwinCAT 4024, same name and message). The LSP test cites that and now asserts the code and
      message as the only diagnostic, not "contains".
      (2) **taken, measured**: the second explanation is the right one. A fault in a POU no task calls, in Untitled2 (no
      task error), is in no build on either vendor (new e2e "a POU no task calls is not compiled"). `compiled` and design
      §9 now say Untitled1's PLC_PRG is left out because nothing calls it, not because its build stops.
      (3) **taken, test-first**: `TcObjectModel` keys the cross-pane dedupe by `Path.GetFullPath` of the file, so one file
      spelled with `\` or `/` or a `..` is one diagnostic (`OneFileSpelledTwoWaysIsOneDiagnostic`, red → green). A line
      naming no file keeps its caption (its PLC project) in the key: each PLC project's own line is kept, as CODESYS keeps
      each build's.
      (4) **taken in part**: `doc.js` (`to` unset) and ARCHITECTURE's library-signature bullet (no `structureVersion`, no
      `verbose`; TwinCAT does extract, `TcLibrarySignatures`) are fixed, plus the round-trip bullet (`sourceText` at the same
      path, not `folder`/`name`). **CLAUDE.md is not edited**: a workflow step does not change CLAUDE.md. For the owner, a
      suggested "Protocol invariant" opening: "The wire is keyed by the item's PATH, `<folder>/<name>.<kind>`
      (`Device/Plc Logic/Application/PLC_PRG.pou`). This covers `refs`, `fetch` `knownItems`, every push op, `projectVersion`
      and the workspace layout. Below the vendor seam the driver looks up the BARE name inside the container the path names.
      The identity is derived in one place (`Versioning.VersionedItem.Identity`)."
      (5) **taken, measured, a real wire difference, fixed**: for a task that calls a program its application does not
      hold, CODESYS names the task (`…/Task Configuration/MainTask.task`, C0046 + C0035). TwinCAT gave no name. Its compiler
      writes the error on `…\Untitled1\PlcTask.TcTTO` (read from the Build pane), but `BeckhoffDriver.NameByPath` only
      considered source kinds, and four `PlcTask` made the engine's bare-name lookup ambiguous. It now considers every
      addressable item (`ItemKind.IsAddressableItem`), so TwinCAT names `…/PLC/Untitled1/PlcTask.task`. The new e2e "a task
      calling a program its application does not hold is an error on that task" (red on TwinCAT before: name null)
      compares path + message on both vendors, and `buildErrors` now carries names.
      **Numbers**: typecheck clean (5 packages); `bun run lint`, the LSP lint and `bun run check` (16/16) green. C# (Debug):
      `Volt.Engine.Tests` 2988 pass / 1 skip, `Volt.Cli.Tests` 301, `Volt.Contracts.Tests` 42, `Volt.Repo.Gates` 243,
      `Volt.Ide.Twincat.Tests` 591 (+2), `Volt.Ide.Codesys.Tests` 457, `Volt.Connector.Tests` 146, all 0 fail. volt-cli unit
      159 pass. LSP full suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) 10351 pass / 34 skip / 428 todo / 0 fail
      over 372 files. Fixtures and the transpiler are unchanged, so no `rate:fixtures`. Live e2e, own instance
      `multi-application-tree`, one vendor up at a time: CODESYS (CodesysTestProject.3.5.21.40) 320 pass / 92 skip /
      0 fail; TwinCAT Project14 317 pass / 97 skip / 0 fail; `multi-application` 12/12 on CodesysTwoDevices and 12/12 on TwinCAT MultiProject
      (+8). A first run with both IDEs up at once failed 34 / 23. Those failures were the cross-vendor halves (which run
      only when both are up) and `IDE_BUSY`: the two suites drove the TwinCAT IDE at the same time. It was not a product
      failure, and it was re-run one vendor at a time. The TwinCAT worker was again built to the scratchpad and served
      with `-BridgeDir`.
      **Open for this change, not this step (owner steering in CLAUDE.local.md, 2026-10-17)**: design §1 still drops the
      TwinCAT PLC project's inner node (`Untitled2 Project`) from the path. The owner calls that a review finding to fix
      in this change: every node is a path segment, and the task sits at `…/<plc>/<plc> Project/PlcTask.task`.
