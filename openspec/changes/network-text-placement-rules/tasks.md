## 1. Settle the one open question first

- [x] 1.1 **DONE — see FINDINGS.md**, pinned by `MetadataPlacementTests`. Four of five shapes are
      already refused; two comment LINES are accepted and LOSSLESS. Original:
- [x] 1.1-orig Check what `NetworkTextGate` does with each shape below TODAY — duplicate label, label mid-network,
      duplicate comment, comment mid-network. It may already refuse some, in which case the LSP is reporting
      earlier and better rather than introducing a new rule.
- [x] 1.2 **Decided: neither.** The gate already refuses the three real shapes, so there is nothing to
      newly refuse or normalise — the LSP RELOCATES an existing refusal into the editor. Original:
- [x] 1.2-orig Decide refuse-vs-normalise on the evidence from 1.1. Refusing matches how every other unrepresentable
      shape is handled; normalising is friendlier but silently edits the engineer's file.

## 2. The free diagnostics — settled, measured, just unimplemented

- [x] 2.1 `NETWORK_UNRESOLVED_BOX` — SHIPPED. Token-walked, so titles and comments are skipped for free;
      8 tests. Fires on real corpus content and `build-conformance` stays green, so the IDE's own build
      agrees those do not compile.
- [x] 2.2 ~~`network-reserved-wire-name`~~ — **DROPPED, would be 476 false positives.** The LSP cannot
      tell hand-written from pulled: Volt's writer emits exactly these names (247 `g<n>`, 196 `en<n>`,
      33 `i<n>` in the corpus). The narrower collision case is unreachable too — the writer renames a
      colliding wire. See FINDINGS.md.
- [x] 2.3 CONFIRMED — already true. Six empty-slot forms, zero errors; pinned by `network-real-shapes`.
- [x] 2.4 CONFIRMED — already true, and so are both `NOT` spellings and the opaque-leaf binding. Pinned.

## 3. The placement half — SHRUNK by §1.1, and it is ergonomics, not correctness

- [x] 3.1 SHIPPED as `NETWORK_DUPLICATE_NAME` (error) + `NETWORK_LABEL_NOT_FIRST` (warning). The duplicate's
      message is BYTE-IDENTICAL to the engine reader's, so one fact has one phrasing. Original: — both ALREADY refused at push. The LSP moves the
      refusal to the keystroke; it does not add a rule. Size it as such, and reuse the reader's wording rather
      than inventing a second phrasing for the same fact.
- [x] 3.2 ~~`network-duplicate-comment`~~ — **DROPPED, not a defect.** `Network.Comment` is multi-line;
      consecutive `//` lines are JOINED and round-trip exactly. The warning would fire on correct text.
      `network-comment-not-first` survives, and is likewise already refused.
- [x] 3.3 Done: the misplacement warnings say the metadata "moves to the head of the network on the next pull,
      so the pushed text and the project stop matching" — the symptom, not the grammar rule.

## 4. Gate

- [x] 4.1 `src/network/network-real-shapes.test.ts` — 24 cases: one per diagnostic, plus the shapes that must
      stay SILENT (empty slots, standalone calls, both NOT spellings, multi-line comments, either metadata order).
- [x] 4.2 Corpus identity + build-conformance green (13 pass / 1 skip / 0 fail). `NETWORK_UNRESOLVED_BOX` fires
      on real lenze-mid content and build-conformance still passes, so the IDE's own build agrees.

## 5. Fixed along the way

- [x] 5.1 `NetworkTextNetwork.label` renamed to `title`. It was populated from the header's QUOTED STRING —
      the title — while a network's actual LABEL is a `name:` statement, and the vendor model keeps them as
      two fields. One name for two concepts is how a later check gets written against the wrong one, and
      this change is exactly that later check.
