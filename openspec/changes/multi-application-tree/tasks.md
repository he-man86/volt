## 1. Design

- [x] 1.1 (design-first) Census every place keyed by the bare/full name (wire, Versioning, Sync, CLI, LSP, control,
      vscode). The identity is the item's path in the tree (owner, 2026-10-17): fetch and push pick the
      device/application/PLC project from it. Write design.md with one example per vendor and how a move is told apart.

## 2. Fixtures and red tests

- [x] 2.1 Commit the owner's two edited projects as fixtures: `test/fixtures/CodesysTwoDevices.3.5.21.40.project` and a
      TwinCAT solution with two system projects / several PLC projects. Red e2e: pull holds every item of every
      application; an edit in each application round-trips to the right one.

## 3. Build

- [ ] 3.1 Both drivers return the whole tree in one refs (TwinCAT: every PLC project of every system project).
- [ ] 3.2 Identity carries the location end to end (wire, version maps, push ops, workspace layout).
- [ ] 3.3 LSP: names resolve within their own application.
- [ ] 3.4 Gates green on both vendors; docs (`items.html`, ARCHITECTURE "item name is the identity") updated.
