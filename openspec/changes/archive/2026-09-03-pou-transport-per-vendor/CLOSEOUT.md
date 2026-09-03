# Close-out — the architecture shipped; the last item is now a gate

Closed 2026-09-03. **The outcome this change argued for is the architecture the repo runs on.** Its task list
was never fully ticked because the work landed through other changes and through ordinary bridge work, so the
boxes and the tree drifted apart. Verified against the code rather than the checklist:

| Task | State |
|---|---|
| §2.1 `ICodeStore` speaks `ItemContent`, not XML | **shipped** — `ICodeStore.cs`: `ItemContent ReadContent(ItemRef)` / `void WriteContent(ItemRef, ItemContent)` |
| §2.2 the engine stops knowing what PLCopen is | **shipped** — no `Volt.Engine/PlcOpen` layer; the only `PlcOpen*` call left in the tree is TwinCAT's own `PlcOpenImport`, below the seam |
| §2.3 the neutral graphical intermediate stays in the engine | **shipped** — network text / `NetworkBody` live in `Volt.Engine/Format/Network` |
| §3.1 move the PLCopen layer into the CODESYS package | **overtaken** — the layer was DELETED rather than moved; content no longer travels as a document on either vendor |
| §3.3 `bun run check` fails if the engine references a vendor format again | **shipped today** — see below |
| §4.1/4.2 `BoxTree*` ⇄ `GraphModel` | **shipped** — both vendors ship an identical `NWLObject` model differing only in ACCESS (DIALECT N1) |

## §2.4 was decided the other way, deliberately

The plan said *"`DIALECT.md` moves out of the engine — a vendor-facts document inside the vendor-neutral package
is wrong."* It stayed at `src/Volt.Engine/Ide/DIALECT.md`, and that is now the documented arrangement: CLAUDE.md
cites it there as the census of "the load-bearing CODESYS↔Beckhoff asymmetries that must not be unified".

The reasoning that won: DIALECT.md exists to tell whoever is editing the *seam* which differences are real. Its
readers are in `Volt.Engine/Ide/`, beside the contract those asymmetries are expressed through. Filing it under a
vendor would have made it one vendor's document when its whole subject is the pair. A vendor-facts file next to
the vendor-neutral contract is not a category error — it is the census OF what the contract has to absorb.

This is recorded rather than silently dropped: an open task that was answered "no" reads, a year later, exactly
like an open task nobody got to.

## §3.3 — the one thing genuinely still missing, now closed

`EngineKnowsNoVendorFormatTests`, in `Volt.Repo.Gates`. It fails the build if `Volt.Engine` names a vendor's
serialization vocabulary in CODE — `PlcOpen`, `plcopenxml`, `tc6_020x`, `TcPlcObject`, `addData`, `NWLObject`,
`InterfaceAsPlainText`. Comments are exempt, as in the sibling vendor-parity guard: the engine legitimately
explains what each driver does with the neutral model it hands over.

**Why this needed to be a gate and not a note.** The engine held a PLCopen layer for most of this project's life,
and every data-loss bug the bridge has had lived at that seam. Reintroducing it would not look like a mistake
while it was happening — it looks like one shared implementation replacing two, which is the exact argument that
put it there originally, and the one this change's own `## Why` opens by quoting. A convention loses that
argument on the day someone makes it well. A failing build does not.

Mutation-checked: adding `addData` to `Materializer.cs` reddens it, naming file and line.

## What the plan got wrong

It scoped itself as *moving* PLCopen to the vendor that still needed it. What actually happened is better and
was not on the table when this was written: **neither vendor needs it as a content transport.** Each driver
reaches its own vendor's native form below the seam, so the document format stopped being a shared decision at
all. `pou-writes-via-plcopen` and `lossless-push`, both of which assumed PLCopen survives on one side or the
other, are archived alongside this for the same reason.
