## Why

**The transport was chosen to be shared, not to be correct.** That decision is recorded, and its stated reason
contains no requirement:

> *"Two native converters, one of them GUID-mapped, replacing one shared implementation, is the opposite of the
> deduplication `splice-graphical-body` and `engine-layout` just did."*

Implementation economy. Not fidelity, not capability, not a checklist. `checklist.md` scores both vendors'
transports against what reading and writing a POU actually requires, and TwinCAT's PLCopen export **fails seven
requirements outright** — R1 declaration, R6 member declarations, R10 network metadata, W1/W6/W8 the write halves
of those, W11 in-place replace, W14 no-normalization.

Every crisis this month is one of those rows:

| what broke | which row |
|---|---|
| Every TwinCAT POU unreadable — `refs` returned no POUs at all | **R1** |
| `METHOD Compute : INT / VAR_INPUT …` materializing as bare `METHOD Compute` | **R6** |
| A disabled network omitted from the export entirely | **R10** |
| A non-empty accessor declaration refusing the push | **W8** |
| `x : INT;` coming back `x: INT;` on every write | **W14** |
| The importer relocating every item to the project root | **W11** |

`DocumentXml` passes every one of those, in one read, at **0.3–5 ms against ~20 ms**. It was measured a month ago
and rejected anyway.

### The architecture never asked for a shared transport

`CLAUDE.md` is explicit: the parity boundary is the **pipe wire**, not the driver — both vendors serve
byte-identical *responses*, and "only irreducible vendor glue lives in an IDE host". A per-vendor transport is
already sanctioned. Sharing one was a convenience that has now been paid for twice.

### And the cost argument was overstated in its own document

> *the tree shape may be **closer** to Volt's network text (itself an expression tree) than PLCopen's graph is —
> `GraphReader` spends much of its length lowering that graph into a tree*

The second converter may be **simpler** than the one in use. That was never tested, because the decision had
already been taken on cost grounds.

## What Changes

**Choose each vendor's transport on its own merits, against the checklist.**

- **TwinCAT → `ITcPlcPou.DocumentXml`**, pending the four experiments below.
- ~~**CODESYS → PLCopen, unchanged.**~~ **REVISED — CODESYS → the 3S NWL object model.** See `tasks.md` §1b and
  `nwl-object-model.md`. This is not the native *serialization* that §1 measured and rejected; it is the live
  object graph, reached through the member `CodesysObjectModel` already calls. Measured: typed read of FBD and
  LD bodies, and a committed typed write, with **no serialization in either direction**. It also carries the
  network metadata §1.4 concluded no CODESYS transport could supply.

The result is *not* symmetric, and that is the point — though it turns out to be symmetric one level up, which
nobody predicted: **both vendors are the same object model**, CODESYS live and TwinCAT serialized into its own
document. Symmetry of *transport* was the thing being optimised for and was never a requirement; byte-identical
responses on the wire is.

**PLCopen therefore leaves the product entirely** rather than moving into the CODESYS package. It ends with zero
consumers, which is a deletion, not a relocation.

## Do NOT decide this yet — four experiments first

Every remaining `?` in the checklist's TwinCAT column is closable, and until they are, this is a strong
indication rather than a conclusion. In priority order:

1. **Can NWL round-trip an FBD and an LD body?** (R3 — the whole question.) Convert `DocumentXml` for a known
   FBD POU and a known LD POU to network text and compare against what PLCopen yields today for the same POUs.
2. **Does `set_DocumentXml` normalize?** (W14.) Set a document back unchanged and diff it.
3. **Can a partial write be refused cleanly?** (W3/W12.) A transport that cannot refuse is unusable regardless of
   fidelity.
4. **Do in-POU member folders survive?** (R9.) PLCopen's importer flattens them and Volt re-places from its own
   `%FOLDER`; if the native document keeps them, that machinery disappears.

If (1) fails, the whole proposal fails and PLCopen stays for both — with the checklist's failures then standing as
*accepted, documented limits* rather than as bugs waiting to be rediscovered.

## Impact

- `Volt.Cli.Ide.Twincat` — a native document reader/writer, below the wire.
- `Volt.Cli.Ide.Codesys` — a typed NWL adapter, replacing the PLCopen read/write path.
- `Volt.Engine` — the contract CHANGES after all: `ICodeStore` demands a PLCopen document
  (`string ReadXml()`), which is precisely what stops either driver from using its own better route. That is
  §2, and it is the blocker rather than the cleanup. `GraphModel` also gains the four network fields both
  vendors carry.
- `Volt.Engine/PlcOpen/` — gathered into one folder, then deleted once both adapters land.
- `declaration-from-the-aspect` — the aspect is still the right source for declarations under either transport,
  because it is the object model rather than a serialization. The change stands.
- `lossless-push` — still applies. A better transport SHRINKS the set of things a projection cannot express; it
  does not remove the need to be honest about what remains.

## Non-goals

- **CODESYS's native SERIALIZATION** (`export_native`). Measured, GUID-typed, 90 KB of editor canvas geometry
  for one POU. Still rejected, still not revisited — and deliberately distinguished from CODESYS's object
  MODEL, which is now the chosen transport. Rejecting a vendor's file format is not evidence about its API, and
  this proposal conflated the two for a month.
- **Changing the wire.** Entirely below the parity boundary.
- **CFC/SFC/IL.** Still unsupported, still markers.

## What this supersedes

`declaration-from-the-aspect/transport-census.md` §3's conclusion — *"not one format, therefore not one
converter… PLCopen stays"* — was right that the two natives do not share an encoding, and wrong to conclude from
that that both vendors must therefore share PLCopen. The measurements in that section stand; the inference drawn
from them does not.
