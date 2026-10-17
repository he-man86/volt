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
- [ ] 3.4 Gates green on both vendors; docs (`items.html`, ARCHITECTURE "item name is the identity") updated.
