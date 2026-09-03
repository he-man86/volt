## 1. Settle the one open question first

- [ ] 1.1 Check what `NetworkTextGate` does with each shape below TODAY — duplicate label, label mid-network,
      duplicate comment, comment mid-network. It may already refuse some, in which case the LSP is reporting
      earlier and better rather than introducing a new rule.
- [ ] 1.2 Decide refuse-vs-normalise on the evidence from 1.1. Refusing matches how every other unrepresentable
      shape is handled; normalising is friendlier but silently edits the engineer's file.

## 2. The free diagnostics — settled, measured, just unimplemented

- [ ] 2.1 `network-unresolved-box` — an `???` operand. The cheapest real one: the IDE will not compile it.
- [ ] 2.2 `network-reserved-wire-name` — a hand-written `LET` on a `g<n>` / `i<n>` / `en<n>` name.
- [ ] 2.3 Confirm the LSP parses every empty-slot form without a syntax error, and surface it as a HINT at most.
- [ ] 2.4 Confirm a standalone positional call is not reported as a malformed FB call.

## 3. The placement half

- [ ] 3.1 `network-duplicate-label` (error), `network-label-not-first` (warning).
- [ ] 3.2 `network-duplicate-comment`, `network-comment-not-first` (warnings).
- [ ] 3.3 Each message names the round-trip consequence, not the grammar rule.

## 4. Gate

- [ ] 4.1 A colocated src test per diagnostic, per the repo's LSP test policy (the corpus DISCOVERS; src ACKS).
- [ ] 4.2 Re-run the corpus ratchet — these must not add false positives to the 4-project corpus.
