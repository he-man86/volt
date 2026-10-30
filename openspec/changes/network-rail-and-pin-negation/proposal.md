## Why

Two pictures CODESYS stores have no spelling of their own (measured 2026-10-30, archived `network-true-contact-or-rail`
and `network-not-contact-or-negated-pin`): a coil fed straight from the rail pulls as `x := TRUE;` (a TRUE contact), and
a pin negated on the box pulls as `IN := NOT a` (a negated input). A rebuild then stores the other picture: same logic,
different drawing. Drawn projects hold both (3 rail coils, 6 negated box pins). Owner, 2026-10-30: every shape the IDE
can store gets a spelling (also 2026-10-16, "support all LD/FBD").

## What changes

- A spelling for a coil on the bare rail and one for a pin negated on the box, designed against the stored model, in
  plain ST (every box is a call; no new `%` line, no edge case).
- Writer, both readers (C# and LSP), the exec twin and `network-text.html`; round-trip tests from the drawn samples.
