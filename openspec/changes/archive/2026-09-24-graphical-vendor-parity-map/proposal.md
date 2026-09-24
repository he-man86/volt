# Map both graphical implementations against each other — and stop calling Volt's limits the vendor's

## Why

**The claim this change tests: the two vendors' graphical representation is the SAME, and every difference Volt
records is either a spelling of that representation or a limit of Volt's own HOST.**

It is not a hunch. `DIALECT.md` already says it twice, from two independent measurements:

- **N1** — the NWL object model is IDENTICAL on both vendors, member for member. TwinCAT ships `NWLObject.dll`
  3.5.13.0 + `NWLObject.plugin.dll`; CODESYS holds 4.6.0.0 of the same 3S assemblies.
- **N11** — a `.TcPOU` body IS that object graph serialized by the 3S serializer: `t=`/`cet=` are concrete class
  names (`BoxTreeAssign`, `BoxTreeOperand`, `BoxTreeTerminator`, `Operand`, `Flags`, `Network`), `n=` are the
  private backing fields with the hungarian prefix stripped. *"Not a Beckhoff format that happens to resemble
  CODESYS — it is the 3S object model written out by the 3S serializer."*

So the markup differs and the STRUCTURE does not. What actually differs is the **door**:

| | how a graphical body is CREATED | host |
|---|---|---|
| CODESYS | live NWL objects, public constructors, one `GetObjectToModify`/`SetObject` transaction (`NwlInterop`, `CodesysNetworkWriter`) | in-process |
| TwinCAT | **`PlcOpenImport` and nothing else** — D22: *"the only way to give TwinCAT a graphical body it does not have"* | separate process, COM ROT attach |

Every shape "TwinCAT refuses" is a shape PLCopen cannot state. The IDE holds all of them perfectly well: the
hand-drawn `execute-box.TcPOU` and `unconditional-jump.TcPOU` are both real TwinCAT bodies, both read by Volt,
both editable in place. **The refusal is Volt's host, and the message says "TwinCAT's importer".**

## The evidence that this is worth a change, all from 2026-09-22

One POU drawn by hand in XAE — an unconditional `JMP`, the shape Volt cannot create — produced two findings
within an hour. That rate is the argument.

**1. The refused shape is ONE ELEMENT away from creatable.** Diffed against a conditional jump Volt created on
the same live XAE, the only structural difference is the `RValue` element's type:

```
  <o n="RValue" t="BoxTreeOperand">      →   <o n="RValue" t="BoxTreeTerminator">
    <o n="Operand" t="Operand"> … </o>         <n n="Input" />
    <v n="Id">3L</v>                           <o n="Flags" t="Flags"> … 0 … </o>
  </o>                                         <v n="Id">6L</v>
                                             </o>
```

`WriteJump` already writes the jump bit in place, on both the item and the destination operand. What refuses the
edit is one line — `WriteNode`'s default arm, *"a 'BoxTreeOperand' item becomes a terminator"*. And the swap
needs **no invented id**, which is N11's wall: it can reuse the id of the element it replaces (ids are not
contiguous in real IDE output — the drawn fixture skips 9, 12 and 13).

**2. A pull silently drops a coil.** The drawn rung drives TWO outputs from one terminator: the jump destination
`owrods` (`Flags = 4`) and an ordinary coil `out` (`Flags = 0`). `NetworkTextWriter.Goto` renders
`"JMP " + a.Targets[0].Text` and drops every other target, so the pulled text is `JMP owrods;` and the coil is
absent from the engineer's file. The fixed point HIDES it — the text round-trips to itself, so every no-op push
is clean and nothing ever asks where `out` went. Worse than lossy if the engineer drew them the other way round:
`Targets[0]` would be the coil, and the file would read `JMP out;` — a jump to a label that does not exist.

Neither could have been found from a Volt-created body, **because Volt cannot create the shape**. That is the
whole gap in one sentence: the e2e tier can only push what the writer can already state, so the constructs the
writer cannot state are exactly the ones nothing tests.

## What this change does

1. **Maps the two implementations member for member** — reader, writer, model, refusals — and classifies every
   difference as SPELLING (the same structure, two serializations), HOST (Volt's door, fixable) or VENDOR (a
   real difference, measured). Today those three are written the same way in the messages and the docs.
2. **Re-costs the refusals against that map.** Four shapes are refused on TwinCAT (C20). Finding 1 says at least
   one of them is a small in-place edit rather than the in-proc host (N12), and N12's own "not built" decision
   is stale — it was taken when the only payoff was D25 grouping fidelity, which has since been fixed another
   way.
3. **Closes the e2e gap the findings came through.** Every construct in the format gets a body at a live IDE on
   BOTH vendors — and where Volt cannot create one, a HAND-DRAWN fixture stands in, the way `execute-box.TcPOU`
   and `unconditional-jump.TcPOU` now do.

## What this change is not

Not the in-proc TwinCAT host (N12). That may fall out of item 2 as a costed proposal, but building a VSIX in a
32-bit .NET Framework shell is its own change.

Not a unification. The load-bearing asymmetries in `DIALECT.md` stay asymmetric; this change makes the list
HONEST about which of them are Volt's, which is the opposite of flattening them.
