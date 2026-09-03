# Close-out — one diagnostic that mattered, three relocations, and three requirements it killed

Complete 2026-09-03, 14 of 14. Gated by `src/network/network-real-shapes.test.ts` (24 cases) and the engine's
`MetadataPlacementTests` (5). 727 LSP src tests green; corpus identity and build-conformance green.

## What shipped

| | |
|---|---|
| `NETWORK_UNRESOLVED_BOX` (error) | an operand of `???` — CODESYS's own marker for a box it could not resolve. The IDE raises it at BUILD; the LSP now raises it at the keystroke |
| `NETWORK_DUPLICATE_NAME` (error) | a second label in one network, **byte-identical to the engine reader's wording** |
| `NETWORK_LABEL_NOT_FIRST` / `NETWORK_COMMENT_NOT_FIRST` (warnings) | metadata after a statement — it moves to the network head on the next pull, so the pushed text and the project stop matching |
| `NetworkTextNetwork.label` → `title` | a field that named the wrong concept (below) |

Ten more cases pin what must stay SILENT, which is half the value: every empty-slot form
(`( * iRPM * 6)`, `ctu(CU := a, RESET := , PV := )`, `MOVE(, x)`, `coil := ;`, a bare `;`), the standalone
positional call, both `NOT` spellings, the opaque-leaf binding, several comment lines, and either order of label
and comment at the head. A false error on ordinary ladder content is worse than a missing check — it teaches an
engineer to stop reading the squiggles.

## The three requirements this change removed from itself

Every one was written from an assumption; every one died on contact with a measurement. Recorded because the
same assumptions will look reasonable again.

1. **`network-duplicate-comment` — there is no data loss.** The proposal's sharpest claim was that several
   comments "all collapse into the single `Network.Comment`". They do not: it is MULTI-LINE, the lines are
   joined, and `Write(Parse(text)) == text` exactly — which is why the push accepts them. The warning would have
   fired on correct, round-tripping content.
2. **`network-reserved-wire-name` — it would have been 476 false positives.** It asked to warn on a hand-written
   `LET g<n>` / `i<n>` / `en<n>`. The LSP cannot tell hand-written from pulled, because **Volt's own writer emits
   exactly those names**: 247 `g<n>`, 196 `en<n>`, 33 `i<n>` across the corpus, all correct output. The narrower
   collision case is unreachable too — the writer renames a colliding wire rather than emitting one.
3. **The §3 diagnostics are ergonomics, not correctness.** The proposal argued the LSP was needed because the
   push says only "not in canonical form", naming the mechanism rather than the mistake. False for labels: the
   READER refuses first, with a message naming the offending label. §3 relocates an existing refusal to the
   keystroke — worth doing, but it is a feedback-loop improvement and was sized as one.

Net: §1.1's "measure before designing" question removed more work than the rest of the change added.

## The field that named the wrong thing

`NetworkTextNetwork.label` was populated from the header's QUOTED STRING — the network's **title** — while a
network's actual LABEL is a `name:` statement, the target `JMP` resolves against. The vendor model keeps them as
two fields (`Network.Title`, `Network.Label`); the LSP had one name for both.

Found while implementing label diagnostics, which is exactly the hazard: one name for two concepts is how a
later check gets written against the wrong field, and this change WAS that later check. Renamed before anything
new read it — two real call sites.

## What is left, deliberately

Nothing. The `???` diagnostic fires on real lenze-mid content and `build-conformance` stays green, so the errors
it raises are inside what the IDE's own recorded build reports — the vendor agrees those do not compile.
