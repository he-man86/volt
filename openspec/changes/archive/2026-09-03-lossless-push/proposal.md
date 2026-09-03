> **SCOPE NARROWED — this is now a CODESYS-ONLY change.** `pou-transport-per-vendor` measured both vendors'
> transports and moves TwinCAT to its native document, where **nothing is regenerated**, so none of the losses
> below can occur there: a native body survives a write byte-for-byte (§W14), there are no contacts to demote
> (§NWL), and `FolderPath` is carried (§R9). CODESYS keeps PLCopen, keeps projecting a graph through network text
> and back, and therefore keeps every loss this change exists to stop — plus R10, the disabled network, which no
> CODESYS transport can fix.
>
> **Size it accordingly:** in a real customer project, 248 of 249 POUs have a textual implementation — **one
> graphical POU in 1,314 objects**. Read `pou-transport-per-vendor/checklist.md` first.

## Why

**The set of things a graphical push can destroy is open-ended, and it is discovered by whoever hits it.**

Today's safety rests on `BodySpliceGuard.SafeToDrop` — a hand-maintained list of twelve element names Volt has
decided it may discard — plus a `blind` list of structures somebody thought to guard. Both are **enumerations**.
An enumeration of what can go wrong is exactly as good as the imagination that wrote it, and when reality exceeds
it there is no error: the element is simply gone, and the push reports success.

That is not a hypothetical failure mode. It happened this week, twice:

- **A single new fixture exposed a thirteenth loss in minutes.** `POU_PBD` was recorded to evidence something
  else entirely (a disabled network). Its one network is `FALSE AND FALSE` into an AND block whose output is
  unconsumed, so network text — which is assignment-oriented — renders it as `NETWORK 1 FBD / END_NETWORK`, an
  empty network. Every element it contains (`block`, `inVariable`, `vendorElement`) happens to be in
  `SafeToDrop`, so **no guard fires**. Pull shows the engineer an empty network where the IDE holds an AND with
  two inputs. Nobody had listed this, and nobody was looking for it.
- **A marker's stated evidence was wrong.** U1 recorded "zero of the 9 recorded exports carry `executionOrderId`".
  Three of them do. All three are on `<block>` elements inside **CFC** bodies, so the FBD/LD guard still never
  fires — the conclusion survived, but only by luck, and the number in the file was false for months.

`splice-graphical-body` already found the right principle and wrote it down:

> **A round-trip test is a fixed-point test. It cannot see a loss that both sides of the round trip agree to
> drop. The only oracle that can is a comparison of the STORED vendor artifact to the PUSHED one.**

It then applied that oracle as a **test-time census** (`StoredVsPushedTests`) and shipped `Carry`, which stops an
UNCHANGED network from being regenerated at all. Both were right and both are load-bearing. Neither helps an
**edited** network, which is still regenerated from a lossy projection — and neither runs in production, where the
engineer's diagram actually is.

**Scale is what makes this urgent rather than tidy.** One engineer on two fixture projects finds a loss a week.
Thousands of engineers on thousands of projects find the entire tail, and they find it as missing diagrams.

## The invariant this change installs

> **The repo file is a projection. An edit to it may only change what the file can express.**

That is one rule with two instances. Network text is a projection of a graphical body; the canonical ST layout is
a projection of a declaration. Both discard things the vendor stored, and in both cases the discarded part is
precisely the part the engineer had no way to ask about.

Everything a stored body carries that has **no spelling in network text** — vendor `addData`, `fbdattributes`,
`position`, `executionOrderId`, comment geometry, `LineIds`, param-type payloads — cannot have been changed by
the engineer, *because they had no way to say so*. If the written document differs from the stored one in any
such element, that difference was invented by Volt. It is a loss, by definition, with no case analysis required.

This replaces "here is what we allow ourselves to destroy" with "here is what the engineer was able to ask for",
and the second is derivable from the text format rather than maintained by hand.

## The second instance: the DECLARATION is not lossless either

The graphical body is not the only projection. The canonical ST file separates a declaration from its body with a
BLANK LINE (`StWriter` appends two newlines), so whitespace at the declaration's boundaries is **ambiguous
with the separator** and cannot be expressed. `Materializer` therefore normalizes on read — `Trim()` on a POU root and on
every member, `TrimEnd()` on a DUT/GVL.

Measured consequence:

| case | today |
|---|---|
| pull, no edit | the file gets the TRIMMED declaration; the IDE keeps its own boundary whitespace |
| push, no edit | the guard compares `Trim()` to `Trim()`, they match, **nothing is written** — carried, correctly |
| push, AFTER a declaration edit | the file's version is written VERBATIM, and the IDE's boundary whitespace is **destroyed** |

So the declaration is lossless right up until the engineer edits it, which is the one moment it matters. The fix
is the same invariant, applied to the same kind of gap: the engineer could not have asked to change boundary
whitespace, because the file cannot spell it — therefore it must be carried. Reapply the stored declaration's
leading and trailing whitespace around the edited content, rather than writing the trimmed form.

**What the declaration already gets right, and it is worth stating because it was in doubt.** Moving declarations
onto the IDE's aspect (`declaration-from-the-aspect`) made them a VERBATIM text channel, which closed a standing
`[UNMEASURED]` about pragmas, per-variable comments and initial values surviving the document path. Through the
aspect they survive by construction — there is no schema to fall out of. Alignment, irregular columns and blank
lines INSIDE the declaration are measured to round-trip exactly. Only the two boundaries are at risk.

**One functional gap remains, and it refuses rather than loses.** A property ACCESSOR's declaration is still
written into the document via `Declaration.Write`, which requires an `<InterfaceAsPlainText>` block this TwinCAT
install does not emit — so a non-empty accessor declaration REFUSES the push. Safe, but broken. Moving it to the
aspect crashed TcXaeShell (`0x800706BE`) on interface properties and was reverted; the crash is not understood.
That is tracked in `declaration-from-the-aspect` §7 and is a prerequisite for calling declarations lossless.

## What Changes

**1. Partition, don't enumerate.** Classify every stored element by whether network text can express it. The
partition is derived from the format — the same source `NetworkTextReader` and `GraphWriter` already agree on —
not from a list somebody keeps current. `SafeToDrop` is **deleted**, and so is `blind`: every entry in both
becomes a consequence of the invariant instead of a special case.

**2. Element-level carry.** `Carry` today is per-network: touch one network and its neighbours are kept
byte-for-byte. Extend it inside the edited network — regenerate the logic, then transplant every
non-expressible element from the stored network onto the regenerated one by `localId` correspondence. An element
whose anchor the engineer genuinely deleted goes with it; an element whose anchor survived must survive too.

**3. Verification in production, not just in tests.** After the splice, census stored vs written over the
non-expressible partition. Any difference the text diff cannot account for → **refuse the push, naming the
element**. This is the part that closes the open-ended tail: a vendor construct nobody has met yet fails the
check by construction, rather than being silently dropped and discovered later by a user.

Transplantation (2) is what makes the check pass in practice; verification (3) is what makes the design sound
even where transplantation is imperfect. Neither alone is sufficient — (2) without (3) is a better enumeration,
and (3) without (2) refuses nearly every FBD edit, because `fbdattributes` appears in 7 of 7 recorded FBD exports
on both vendors.

**4. `StoredVsPushedTests` inverts.** `KnownLoss` stops being a baseline of approved damage and becomes an
assertion that the loss set is **empty**. Its current thirteen entries are the work list.

## Impact

- `Volt.Engine/Source/Body/BodySpliceGuard.cs` — `SafeToDrop` and `blind` deleted; the invariant replaces them.
- `Volt.Engine/Source/Body/Network/NetworkSplice.cs` — carry gains element granularity.
- `Volt.Engine/Source/Body/BodyCodec.cs` — the verification runs on the write path.
- `test/Volt.Engine.Tests/StoredVsPushedTests.cs` — `KnownLoss` → must be empty.
- `Volt.Engine/Sync/Materializer.cs` + `PushService.cs` — the declaration's boundary whitespace is carried
  rather than trimmed away on an edit.
- `DIALECT.md` A13/A19, and `splice-graphical-body` §2.1/§2.2/§2.4, which are splice-dependent and close here.

## Non-goals

- **Adopting a native transport — SUPERSEDED, see the banner above.** This read "measured and rejected twice";
  `pou-transport-per-vendor` later measured properly and moved TwinCAT TO its native document. The sentence below
  is left as the record of what was believed (`declaration-from-the-aspect/transport-census.md`
  §3): TwinCAT's `DocumentXml` is a 3S object-archive tree against PLCopen's graph, and CODESYS's `export_native`
  is the same family in a different vocabulary with **GUID-identified types**. Two converters, one GUID-mapped,
  replacing one shared implementation.
- **Making CFC/SFC/IL editable.** They stay markers, refused on push, never flattened.
- **Changing the wire.** The parity boundary does not move.

## The cost, stated plainly

Some edits that succeed today will begin to refuse — that is the point, but it must be **measured, not assumed**.
The order in §2 of `tasks.md` exists for this reason: transplantation lands first and is measured against the
corpus, so the refusal rate is known before the default flips. A design that refuses every FBD edit is safe and
useless, and shipping that would be a worse outcome than today.
