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
