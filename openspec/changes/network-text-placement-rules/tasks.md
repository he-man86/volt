## 1. Settle the one open question first

- [x] 1.1 **DONE — see FINDINGS.md**, pinned by `MetadataPlacementTests`. Four of five shapes are
      already refused; two comment LINES are accepted and LOSSLESS. Original:
- [ ] 1.1-orig Check what `NetworkTextGate` does with each shape below TODAY — duplicate label, label mid-network,
      duplicate comment, comment mid-network. It may already refuse some, in which case the LSP is reporting
      earlier and better rather than introducing a new rule.
- [x] 1.2 **Decided: neither.** The gate already refuses the three real shapes, so there is nothing to
      newly refuse or normalise — the LSP RELOCATES an existing refusal into the editor. Original:
- [ ] 1.2-orig Decide refuse-vs-normalise on the evidence from 1.1. Refusing matches how every other unrepresentable
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

- [ ] 3.1 `network-duplicate-label`, `network-label-not-first` — both ALREADY refused at push. The LSP moves the
      refusal to the keystroke; it does not add a rule. Size it as such, and reuse the reader's wording rather
      than inventing a second phrasing for the same fact.
- [x] 3.2 ~~`network-duplicate-comment`~~ — **DROPPED, not a defect.** `Network.Comment` is multi-line;
      consecutive `//` lines are JOINED and round-trip exactly. The warning would fire on correct text.
      `network-comment-not-first` survives, and is likewise already refused.
- [ ] 3.3 Each message names the round-trip consequence, not the grammar rule.

## 4. Gate

- [ ] 4.1 A colocated src test per diagnostic, per the repo's LSP test policy (the corpus DISCOVERS; src ACKS).
- [ ] 4.2 Re-run the corpus ratchet — these must not add false positives to the 4-project corpus.
