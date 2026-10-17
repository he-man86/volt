## Why

Measured on 2026-10-17 by the owner's two edited fixture projects:

- **CODESYS, two devices** (each with an application holding the same item names): the pull succeeds, but every name exists
  once — `PLC_PRG`, `MainTask` and the `VltFixture*` POUs land under `Device_1`, and `Device`'s application keeps only its
  Library Manager. One device's code is silently missing; a push writes one of each pair.
- **TwinCAT, two system projects / four PLC projects**: the pull returns ONE PLC project (252 files); the other three are
  skipped without a word. No device appears.

Root cause: the wire keys an item by its full name (`name.kind`) only — never by the device/application/PLC project it
lives in — and the TwinCAT driver reads one PLC project.

Owner (2026-10-17): "since they both have multiple projects or devices everything needs to handle this right. refs should
just return 1 tree that has all info from both."

## What Changes

- `refs` returns ONE tree holding every device/application (CODESYS) and every system project/PLC project (TwinCAT) the IDE
  holds; nothing is skipped.
- **An item is identified by its PATH in that tree** (owner: "it should do this based on path"): fetch and push know which
  device/application/PLC project to read or edit from the path alone. So two `PLC_PRG.pou` in two applications are two items on the wire, in the
  version maps, in the workspace and in a push. The identity is derived in ONE place (`Versioning.VersionedItem.Identity`).
- fetch, push (set/delete/move), status, build and the LSP's scope follow that identity; the LSP resolves a name inside its
  own application.
- The two edited projects become committed fixtures (CODESYS per version; a TwinCAT solution), with e2e on both vendors.

## Impact

`packages/volt-cli` (both drivers' tree reads, the wire's item key, Versioning, Sync, CLI workspace layout), `volt-lsp-iec`
(per-application scope), `volt-control` / `volt-vscode` if they key by name. The path is the identity (owner decision);
design-first only for the census and how a move is told apart from delete+add.
