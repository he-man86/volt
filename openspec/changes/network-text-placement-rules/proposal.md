# Network text: the LSP must enforce WHERE a label, title and comment may appear

Status: **proposed** — not started. Raised 2026-08-31 while closing the CODESYS/TwinCAT graphical diff.

## The problem

Network text's grammar and its MODEL disagree about labels and comments, and the grammar is the looser of the
two. `docs/network-text.md` §4:

```ebnf
network        = network-header , { statement } , "END_NETWORK" ;
network-header = "NETWORK" , integer , language , [ string ] , [ "DISABLED" ] ;
statement      = wire-def | sink | fb-call | en-eno-if | execute-box | control-flow | comment ;
control-flow   = label | jump | return ;
label          = name , ":" ;
comment        = "//" , text ;
```

So a label or a comment is an ordinary STATEMENT: the grammar admits any number of them, anywhere in a network.

The model does not. `Network` carries exactly one `Label`, one `Title` and one `Comment`, and both vendors store
them the same way — as per-network metadata on `INetwork` (`Label` / `Title` / `Comment`), not as items in the
statement list. That is measured, not incidental: it is why `Network.Label` is what `checkLabels` resolves a
`JMP` against.

**The consequence is text that PARSES and cannot ROUND-TRIP.** All of these are accepted today:

- two labels in one network — only one can survive the write; the other is silently dropped
- a label in the middle of a network — its position is not represented, so it moves to the network head on the
  next pull
- several comments, or a comment between statements — all collapse into the single `Network.Comment`
- a title given both in the header string and as something else

None of it is refused, and none of it is diagnosed. An engineer writes something reasonable, pushes, pulls, and
gets back a body that is not what they wrote — the exact class of silent reshaping the graphical work has spent
this week removing everywhere else.

## What the LSP already does

`packages/volt-lsp-iec/src/network/network-analysis.ts` handles the SEMANTIC half of labels well:

- `checkLabels` collects every label across the whole body (including through EN/ENO boxes)
- `checkJumps` reports `network-undefined-label` for a `JMP` naming no label

What is missing is the PLACEMENT half — nothing checks how many labels a network has, or where in the network a
label or comment sits.

## Proposed

New diagnostics in the network-text analysis, each naming the round-trip consequence rather than the grammar:

| code | condition | severity |
|---|---|---|
| `network-duplicate-label` | more than one label in one network | error — only one survives the write |
| `network-label-not-first` | a label appears after a statement | warning — it moves to the head on the next pull |
| `network-duplicate-comment` | more than one comment in one network | warning — they collapse into one |
| `network-comment-not-first` | a comment appears after a statement | warning — position is not represented |

Open question to settle before implementing: whether the write path should REFUSE these outright (the
`NetworkTextGate` already refuses bodies it cannot represent) or accept-and-normalise with the LSP warning
first. Refusing is consistent with how every other unrepresentable shape is handled; normalising is friendlier
but silently edits the engineer's file. **Check what `NetworkTextGate` does with each shape above before
choosing** — it may already refuse some, in which case the LSP is simply reporting earlier and better.

## Why it matters now

The graphical path just gained labels, titles, comments, modifiers and jumps as first-class round-tripping
content on both vendors. Every one of those is metadata with exactly one slot per network, and the text format
lets an engineer write them as though they had positions. The LSP is the only layer that can say so before the
push.

## Not in scope

The `EXECUTE … END_EXECUTE` block and `LET` wire definitions are genuine statements with real positions; they
are not affected. This is only about the three per-network metadata fields.

---

## Addendum (2026-08-31): the lexical rules a real project forced, and the one free diagnostic

Pulling `Lenze_MID-S100_V5_00_602_T51` - 373 engineer-drawn networks - refused **152 of them** at Volt's own
push gate (DIALECT C10). Closing that changed the *format*, not just the reader, so the LSP now has rules it
does not know about. Everything below is settled and measured; it needs implementing in `volt-lsp-iec`, not
deciding.

### `???` is a compile error, and Volt can report it before the build

CODESYS writes `???` into a box whose instance is unresolved. It is not a placeholder Volt invented and not
something to normalise away - it is the vendor's own marker for a box that **will not compile**, and it
reaches the workspace verbatim (five in this one project, one of them an assignment target:
`??? := ioAxis.xVirtual;`).

This is the cheapest real diagnostic on the list: an `???` operand is an error the IDE itself will raise, and
the LSP can raise it at the point of edit instead. It is also why network text has **no `?` token of its
own** - a sigil was tried for the unconnected pin and withdrawn precisely because `???` was already content.

| code | condition | severity |
|---|---|---|
| `network-unresolved-box` | an operand is `???` | error - the IDE will not compile this box |

### The empty slot is grammar, not a typo

A pin connected to nothing is written as **nothing**, in whichever operand position it occupies:
`( * iRPM * 6)`, `ctu(CU := a, RESET := , PV := )`, `f(, a)`, `f(a, )`, `coil := ;`, and a bare `;`. The LSP
must parse all of these (110 networks in one project) and must not report them as syntax errors. Worth
surfacing as a **hint**, not a warning - an unwired pin is ordinary in a live project, and half the ladders
here have one.

### Whitespace and quoting carry meaning in exactly five places

Everywhere else in the format whitespace is insignificant, so these are worth stating rather than inferring:

| Written | Means | The rule |
|---|---|---|
| `NOT x` | the negation **modifier** (a dot on the pin) | a space follows `NOT` |
| `NOT(x)` | a **box** named NOT (its own item) | the `(` is adjacent |
| `"he said ""no"""` | a title containing a quote | the quote is **doubled** |
| `//     aligned` | an indented comment | everything after the one separator space is the text, trailing spaces included |
| `a .b` | one qualified name | whitespace around the dot is the engineer's and is kept |

`DISABLED` is a header keyword recognised only **after** the title - never inside it.

### The `LET` prefix is load-bearing, which makes it a naming rule the LSP should enforce

`g<n>` is a fan-out wire, `i<n>` an opaque leaf, `en<n>` an enable echo. The reader honours the prefix rather
than counting uses, because a `BoxTreeDemux` with one consumer is still an item on the rung and an opaque
leaf is one variable rather than the expression its text spells. An engineer who hand-writes `LET g5 := ...`
therefore gets **wire** semantics whether they meant them or not.

| code | condition | severity |
|---|---|---|
| `network-reserved-wire-name` | a hand-written `LET` uses a `g<n>` / `i<n>` / `en<n>` name | warning - the prefix decides the semantics, and the writer will renumber it |

### One statement form the grammar gained

A **positional call may stand alone as a statement** (`MOVE(g0, iDec);` - a box whose output goes nowhere, 34
networks). Any LSP rule that assumed a bare call is an FB instance invocation, and that a missing `PIN :=` is
a mistake, is now wrong.

### The canonical order is the REVERSE of the IDE's, and an engineer will type the IDE's

Volt writes a network as header -> COMMENT -> LABEL -> statements. The IDE lays out a network's header the
other way round: the label first, and the single comment box below it. So the natural thing to type is

```
NETWORK 0 LD "interlock"
  Guard:
  // holds the drive off while the guard is open
  out := (a AND b);
END_NETWORK
```

and that is refused — not because it is ambiguous (the reader takes the two in either order) but because the
canonical-form gate re-emits them in Volt's order and the text no longer matches. The engineer gets a refusal
with the corrected body, which is recoverable but is friction on the one thing they were most likely to hand
write.

Two ways to close it, and the choice is not obvious:

- **The LSP reports it early** as a placement diagnostic, alongside the label/comment rules above. Cheap, and
  consistent with how every other unrepresentable shape is handled.
- **Volt swaps the emitted order** to label-then-comment so the text mirrors the IDE. Better for the engineer
  and costs nothing at read time, but it is a published-format change: every committed body with a comment AND
  a label is re-emitted, so it wants doing once, deliberately, rather than drifting into.

The network comment itself is NOT at risk and never was — it is `Network.Comment`, one per network, read and
written by both drivers, and it survives a destroy-and-rebuild because it lives on the network object rather
than on its items (gated by `test/e2e/graphical/rebuild.test.ts`, both vendors). The field that does NOT
survive is an operand's `SymbolComment`, which is per-variable and a different thing entirely.

### Still open, unchanged

The placement questions above (label/comment position and duplication) are untouched by this work.
