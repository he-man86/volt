# `volt-cli` docs

## The bridge — start here

**[`bridge/index.html`](bridge/index.html)** — the clickable reference for both layers: every wire op with its
request and response fields, every schema, the error codes, and the driver interface below the pipe. Open it in
a browser; it needs no build step and no server.

**[`bridge/volt-bridge.openrpc.json`](bridge/volt-bridge.openrpc.json)** — the same thing as a machine-readable
[OpenRPC](https://open-rpc.org) document. This is the artefact to hand to another project.

> **Why OpenRPC.** The wire is `{op, body}` answered with a result or a coded error — JSON-RPC in all but
> framing — so the JSON-RPC description standard fits without inventing anything. OpenAPI describes HTTP and
> there is no HTTP here; AsyncAPI fits too, but models message *channels*, which is heavier than a
> request/response wire needs. Validated against the official schema, so the ordinary tooling works on it:
>
> ```
> npx @open-rpc/generator          # a typed client in the language you want
> https://inspector.open-rpc.org   # browse and call it interactively
> ```

**The document is generated, not written.** `test/Volt.Contracts.Tests/BridgeSpecTests.cs` reflects the real
`Volt.Contracts` types — the same ones the host serializes — and the build **fails** if the committed file and
the code disagree. A hand-written spec is a second source of truth, and the one that drifts is always the one
nobody runs.

```bash
# after changing a contract type
VOLT_WRITE_SPEC=1 dotnet test test/Volt.Contracts.Tests
```

## The two layers, and which one you want

| You want | Use |
|---|---|
| a PLC project as text, from a running IDE | the **wire** — 8 ops over `volt.bridge.<vendor>.<pid>` |
| to drive an IDE from your own code | the **driver interface** — `IIdeDriver` = `IIdeSession` + `IProjectTree` + `ICodeStore` |

Both are documented in the page above. The rule that makes the second one reusable: **`ICodeStore` speaks
`ItemContent` and nothing above the vendor seam knows a vendor's own representation** — a graphical body
crosses as network text, and the driver converts.

## The formats a body travels in

- **[`network-text.md`](network-text.md)** — the FBD/LD source form. Graphical bodies round-trip PLCopen ⇄ this
  text; CFC, SFC and IL are unsupported and materialize as a marker. The largest and most-cited document here.
- **[`network-text-diagnostics.md`](network-text-diagnostics.md)** — the diagnostic codes that format raises.
- **[`ITEM_KINDS.md`](ITEM_KINDS.md)** — the vendor-neutral item-type table. `Volt.Engine/Item/ItemKind` is the
  source of truth; this is the prose beside it.

## Working on a bridge

- **[`debugging-a-bridge-session.md`](debugging-a-bridge-session.md)** — logs, pipes, and what to look at when
  a session misbehaves.
- `../ARCHITECTURE.md` — the layer stack, the vendor seam, and the asymmetries that must **not** be unified.
- `../src/Volt.Engine/Ide/DIALECT.md` — the measured vendor facts. Every row is dated and says how it was
  measured; several record an earlier conclusion being wrong.
