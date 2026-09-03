# Findings — §1.1 answered, and it shrinks the change to about a third

Measured 2026-09-03 against `NetworkTextGate.Validate`, pinned by
`test/Volt.Engine.Tests/format/network/MetadataPlacementTests.cs` (5 cases). §1.1 asked what the push gate does
with each shape TODAY, *before* designing diagnostics for them. The proposal assumed "nothing, silently". It was
wrong in both directions, and the corrections point the same way: **most of §3 is already enforced, and the one
case it called data loss is not.**

| Shape | Verdict today |
|---|---|
| label at head, one comment under it (control) | accepted, round-trips |
| **two labels in one network** | **REFUSED — and the message names the duplicate**: `label 'Second' …` |
| **a label after a statement** | **REFUSED** (canonical form: the re-emit moves it to the head) |
| **a comment after a statement** | **REFUSED**, same mechanism |
| **two `//` lines before the first statement** | **ACCEPTED, and LOSSLESS** |

## The claim that does not survive

The proposal's sharpest line was that *"several comments … all collapse into the single `Network.Comment`"*, and
it made `network-duplicate-comment` a diagnostic on that basis.

There is no collapse. `Network.Comment` is a MULTI-LINE string: consecutive `//` lines before the first statement
are read into it as separate lines, and the writer re-emits one `//` per line. The round trip is exact —
`Write(Parse(text)) == text` — which is precisely why the canonical gate accepts it. One comment BOX in the IDE
holding several lines is what the engineer sees and what Volt stores.

**A `network-duplicate-comment` warning would fire on correct, round-tripping text.** Dropped.

## The other correction, in the opposite direction

The proposal argued the LSP was needed because the push says only "not in canonical form", naming the mechanism
rather than the mistake. For duplicate labels that is false: the READER refuses first, before the canonical check
is reached, with a message that names the offending label. Moving that into the editor is still worth something —
it is the difference between finding out while typing and finding out at push — but it is a relocation, not an
improvement, and it should be argued as one.

## What §3 is left with

| Original | Now |
|---|---|
| `network-duplicate-label` (error) | already refused, with a good message — LSP relocates it |
| `network-label-not-first` (warning) | already refused — LSP relocates it |
| `network-duplicate-comment` (warning) | **dropped — not a defect** |
| `network-comment-not-first` (warning) | already refused — LSP relocates it |

Nothing in §3 is a new rule and nothing there is a data-loss fix. It is worth doing for the feedback loop, and it
should be sized as ergonomics rather than correctness.

## What is untouched and still worth the most

§2 — the diagnostics that have nothing to do with placement, and where the LSP is the only layer that can speak:

- **`NETWORK_UNRESOLVED_BOX`** — an operand of `???`. CODESYS's own marker for a box that will not compile,
  reaching the workspace verbatim. The IDE raises this at build; the LSP can raise it at the keystroke. This is
  the single highest-value item in the change and it is unaffected by anything above.
- **~~`network-reserved-wire-name`~~ — DROPPED, and for the same reason as the comment one.** The LSP cannot
  tell a hand-written binding from a pulled one, because **Volt's own writer emits exactly these names**. Counted
  across the corpus: **247 `LET g<n>`, 196 `LET en<n>`, 33 `LET i<n>` — 476 bindings, all correct output.** The
  warning would fire on every one of them. The narrower case that is genuinely ambiguous — a reserved name that
  also names a declared variable, which the reader conflates — is not reachable from Volt either: the writer
  RENAMES a colliding wire rather than emitting one (fixed 2026-09-01). The corpus carries one `i2` declaration,
  in a textual body, so it cannot arise there.
- **The empty slot must parse** (110 networks in one real project) and must never be a syntax error.
- **A standalone positional call is a statement** (34 networks) and must not be reported as a malformed FB call.

Those four are the change now.
