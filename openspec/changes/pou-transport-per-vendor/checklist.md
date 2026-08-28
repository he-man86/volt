# What a POU transport must do — the checklist, and both vendors scored against it

Every score below is **measured**, on the live IDEs, and cited. Where a cell is not measured it says so rather
than being filled in by inference — an unmeasured row is the thing that made the current transport look adequate
for months.

Legend: **✓** works · **✗** fails · **~** partial · **?** UNMEASURED

---

## A. Reading a POU

| # | Requirement | Why it matters | TC PLCopen *(today)* | TC `DocumentXml` | CS PLCopen *(today)* | CS `export_native` |
|---|---|---|---|---|---|---|
| R1 | **Declaration, verbatim** — alignment, blank lines, pragmas, per-variable comments, initial values | It is the engineer's source. A rendering is a diff against work nobody did | ✗ **0 of 2 live exports carry `InterfaceAsPlainText`; one declares 45 variables** | ✓ carries it | ✓ carries it (twice — A7) | ~ GUID-typed |
| R2 | **ST body, verbatim** | Same | ✓ measured byte-identical to native CDATA, 7,316 chars | ✓ native CDATA | ✓ | ~ |
| R3 | **FBD/LD body** faithfully enough to render AND splice back | The whole graphical feature | ~ graph; regeneration is lossy | ? **NWL tree — never converted** | ~ same graph, same losses | ~ |
| R4 | **CFC/SFC/IL detectable as unsupported** | Must never be mangled into ST | ✓ marker | ✓ | ✓ | ✓ |
| R5 | Members enumerated (method/action/property) | | ✓ | ✓ proved | ✓ | ~ |
| R6 | **Member declarations, verbatim** | | ✗ **`VAR_INPUT` appears NOWHERE in a probe FB's export** | ✓ proved | ✓ | ~ |
| R7 | Member bodies | | ✓ | ✓ proved | ✓ | ~ |
| R8 | **Accessor declarations + bodies** | | ~ bodies yes; declarations only in the LOSSY typed form | ? nested `<Get>` proved on write, read unmeasured | ✓ | ~ |
| R9 | Member folder placement | Otherwise a push duplicates members at the POU root | ✓ tree walk | ? | ✓ | ~ |
| R10 | **Network `Title` / `Label` / disabled** | A disabled network is running-program state | ✗ **none carried; a disabled network is OMITTED ENTIRELY** (`POU_PBD`: 2 native → 1 exported) | ✓ `OutCommented`, `Title`, `Label` | ✗ same PLCopen limit | ? |
| R11 | Identity across rename | | ✓ `objectid` | ✓ `Id` | ✓ flag-gated | ✓ GUID |
| R12 | Cost | ~1 read per POU per fetch | ~20 ms | **0.3–5 ms** | ~20 ms | ? |

## B. Writing a POU

| # | Requirement | TC PLCopen *(today)* | TC `DocumentXml` | CS PLCopen *(today)* |
|---|---|---|---|---|
| W1 | Declaration lands verbatim | ✗ *no block to write into* → **now solved off-transport, via the aspect** | ✓ | ✓ |
| W2 | ST body lands verbatim | ✓ | ✓ | ✓ |
| W3 | FBD/LD body lands without destroying what text cannot express | ~ carry + refuse (`lossless-push`) | ? | ~ same |
| W4 | Unsupported body never overwritten | ✓ refused | ? | ✓ |
| W5 | Members created / updated / removed | ✓ one document write | ✓ proved (spliced `<Method>` + `<Property>` landed) | ✓ |
| W6 | Member declarations land | ✗ *no block* → **solved via the aspect** | ✓ | ✓ |
| W7 | Member bodies land | ✓ | ✓ | ✓ |
| W8 | **Accessor declarations land** | ✗ **REFUSES** — `Declaration.Write` needs a block that does not exist | ✓ proved on write | ✓ |
| W9 | Member folders survive | ~ import FLATTENS them; Volt re-places from its own `%FOLDER` | ? | ~ |
| W10 | Network metadata survives | ✗ cannot carry what the read never had | ✓ | ✗ |
| W11 | **In-place replace** | ✗ **import always relocates to the PLC-project root**; Volt moves it back (D4g) | ✓ set on the item itself | ✓ |
| W12 | Atomic — refuse rather than half-apply | ✓ | ? | ✓ |
| W13 | Cost | ~20 ms export + import | **0.3–5 ms** | ~20 ms |
| W14 | **Untouched content not normalized** | ✗ **reorders `LineIds`, re-indents, ZEROES the POU `Id`, and REGENERATES the declaration from the typed interface** (`x : INT;` → `x: INT;`) | ? | ~ |

---

## What the scoring says

**TwinCAT's PLCopen export fails 7 requirements outright** (R1, R6, R10, W1, W6, W8, W11, W14) and every crisis
this month is one of those rows. `DocumentXml` passes the ones that are measured, is ~10× cheaper, and was
rejected for a reason that appears nowhere in this table:

> *"Two native converters, one of them GUID-mapped, replacing one shared implementation, is the opposite of the
> deduplication…"*

That is implementation economy, not capability. It optimised for one shared converter and paid in fidelity on
both of the rows that later broke — the declaration and the disabled network.

**CODESYS is the opposite case, and PLCopen wins there on merit.** Its export carries `InterfaceAsPlainText` and
member declarations; its native identifies types by **GUID**, which would need a map maintained across CODESYS
versions. So CODESYS keeps PLCopen because it is better *for CODESYS*, not because it is shared.

**The architecture already permits the split.** `CLAUDE.md`: the parity boundary is the **pipe wire**, not the
driver — both vendors must serve byte-identical *responses*, and only irreducible vendor glue lives in an IDE
host. A per-vendor transport is sanctioned; sharing one was a convenience.

## The cost argument was weaker than it was presented

Recorded in the same census that rejected it, then discounted:

> *the tree shape may be **closer** to Volt's network text (itself an expression tree) than PLCopen's graph is —
> `GraphReader` spends much of its length lowering that graph into a tree*

So the second converter may be **simpler** than the one in use. That was never tested, because the decision had
already been made on cost.

---

## The four experiments that decide it

Every remaining **?** in the TwinCAT column is closable, and until they are closed this is a strong indication
rather than a conclusion. In priority order:

1. **R3 — can NWL round-trip an FBD and an LD body?** The whole question. Read `DocumentXml` for a known FBD POU
   and a known LD POU, convert to network text, and compare against what PLCopen produces today for the same
   POUs. If the tree lowers more directly than the graph does, the cost argument inverts completely.
2. **W14 — does `set_DocumentXml` normalize?** Set a document back unchanged and diff it. PLCopen's importer
   rewrites `LineIds`, zeroes the POU `Id` and reformats declarations; if the native setter does not, that closes
   the single largest source of churn.
3. **W3/W12 — is a partial write refusable?** A transport that cannot refuse cleanly is not usable regardless of
   fidelity.
4. **R9 — do in-POU member folders survive?** PLCopen's importer flattens them and Volt re-places from its own
   `%FOLDER`. If the native document keeps them, that machinery disappears.

## What does NOT change

- **CODESYS stays on PLCopen.** Measured, on merit.
- **The wire does not change.** Both vendors keep serving byte-identical responses; this is entirely below the
  parity boundary.
- **CFC/SFC/IL stay unsupported.**
- **The `lossless-push` invariant still applies** — it is about not losing what a projection cannot express, and
  that is true of any transport. A better transport shrinks the non-expressible set; it does not remove the need
  to be honest about what remains.
