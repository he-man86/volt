# @opencode-ai/volt-bridges

> The C# bridges that expose one live PLC IDE (CODESYS / TwinCAT) to Volt over a small HTTP wire.

A bridge attaches to a single running PLC IDE and serves its project as text over a tiny HTTP wire that
`volt-git` drives. **`Volt.Bridge.Core` holds everything shareable; only irreducible vendor glue lives in a
per-vendor bridge** — the parity boundary is the wire, not the driver.

## Role in Volt

```
live PLC IDE (CODESYS / TwinCAT)  ──HTTP──  bridge (C#)  ──HTTP wire──  volt-git (TS)
```

The bridge is the C# half of the data path: it reaches into a live IDE through that vendor's native API and
serves the project as canonical text. Because the parity boundary is the **HTTP wire** (not the driver), both
vendors serve **byte-identical responses** for the same project even though they reach their IDEs in completely
different ways. The projects:

| Project | Target | Role |
|---|---|---|
| **Volt.Bridge.Core** | netstandard2.0 | shared engine — no vendor references |
| **Volt.Bridge.Codesys** | net48 (library) | CODESYS bridge — loaded **in-process** by the IDE |
| **Volt.Bridge.Beckhoff** | net8 (exe) | TwinCAT bridge — **standalone**, attaches over COM |
| **Volt.Bridge.Connector** | net8 (exe) | the single user-facing tray app that spawns + supervises the bridges |

## How it works

Core is a strict top-down stack — the contract first, vendor glue last:

```
Ide/        the contract           ◄── each vendor bridge implements this, and only this
Wire/       HTTP transport         ── serves the contract over HttpListener + JSON
Sync/       endpoint services      ── fetch / push / build / refs / raw
Workspace/  source materialize     ── item ⇄ canonical .st text
Graphical/  graphical materialize  ── PlcOpen XML ⇄ VG text
```

- **One contract.** A vendor bridge implements exactly one seam: `IIdeDriver` (session + project tree + code
  store). Everything above it is shared.
- **One declarative push wire.** Pushes are a flat list of `set` / `delete` ops keyed by item name; the bridge
  reconciles the IDE to match.
- **The item name is the identity.** The whole wire — `/refs`, `/fetch` `knownItems`, every push op,
  `structureVersion`, and the one-item-per-file layout — is keyed by bare item name. This is load-bearing across
  the bridge, `volt-git`, and `volt-vscode`. Same-name items collapse last-write-wins (fine for source items;
  IEC guarantees unique names). **Do not add a "duplicate name" guard that throws** — real projects legitimately
  repeat opaque names.
- **Graphical bodies become ST.** FBD/LD bodies are transpiled to editable **VG** text on fetch; CFC/SFC are
  surfaced read-only, so the rest of Volt analyzes a single source language.
- **Load-bearing CODESYS↔Beckhoff asymmetries.** In-proc reflection vs. standalone COM; in-memory vs. file-based
  PlcOpen round-trip; Beckhoff's `TcPouReader` (no CODESYS counterpart); Beckhoff's per-node `try/catch` walk.
  These are deliberate — **do not "unify" them.**

The full layer-by-layer breakdown lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md) — read it before touching
bridge code.

## Commands

The bridges are .NET — build and test with `dotnet`:

```bash
# from packages/volt-bridge
dotnet build src/Volt.Bridge.Codesys/Volt.Bridge.Codesys.csproj -c Release    # net48 in-proc CODESYS lib
dotnet build src/Volt.Bridge.Beckhoff/Volt.Bridge.Beckhoff.csproj -c Release  # net8 standalone TwinCAT exe
bun run build:all           # build both bridges
dotnet test test/Volt.Bridge.Tests/                                            # C# unit tests
bun test                    # the package's TS-side e2e tests (test/e2e/**)
```

Headless CODESYS dev/test loop (Windows / PowerShell) — runs against its own headless fixture copy, never your
live IDE:

```bash
pwsh volt-scripts/codesys-bridge.ps1 up|test|down|restart|status|logs
```

## Layout

| Path | What |
|---|---|
| `src/Volt.Bridge.Core/` | the shared engine (`Ide/` contract · `Wire/` HTTP · `Sync/` endpoints · `Workspace/` + `Workspace/SourceText/` ST · `Graphical/` + `Graphical/Vg/` VG) |
| `src/Volt.Bridge.Codesys/` | CODESYS bridge — `Driver/` (IIdeDriver impl) + `Ide/` (in-proc reflection object model) |
| `src/Volt.Bridge.Beckhoff/` | TwinCAT bridge — `Driver/` (IIdeDriver impl) + `Ide/` (COM/STA object model) |
| `src/Volt.Bridge.Connector/` | Windows tray supervisor — spawns + supervises every vendor bridge |
| `test/Volt.Bridge.Tests/` | C# unit tests (graphical round-trips, VG, push, hashing, resilience) |
| `test/e2e/` | TS-side end-to-end tests (endpoints · kinds · graphical · lifecycle) |
| `docs/` | `vg-language.md`, `vg-diagnostics.md` |
| `codesys-scriptcommands/` | IronPython scripts that launch the in-proc CODESYS bridge headless |
| `ITEM_KINDS.md` / `item-kinds.json` | the vendor-neutral item-type table |

## See also

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the deep dive; **read before touching bridge code**
- [`ITEM_KINDS.md`](./ITEM_KINDS.md) — TwinCAT/CODESYS item-kind coverage map
- [`docs/vg-language.md`](./docs/vg-language.md) — the VG language spec
- [`docs/vg-diagnostics.md`](./docs/vg-diagnostics.md) — VG format & diagnostics quick-reference
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — Volt design, roadmap, decision log
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance
