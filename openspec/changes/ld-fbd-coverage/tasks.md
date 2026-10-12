## 0. Census

- [ ] 0.1 Pull the six corpora on both vendors (own `ide.ps1 -Instance ld-fbd-coverage`, corpus copies only) and count every
      LD/FBD body that pulls `IMPLEMENTATION LD|FBD UNSUPPORTED`, per vendor, per reason/shape, with one example network
      each; plus the bodies that pull as network text today (the denominator).
- [ ] 0.2 Per shape: the NWL tree it is (which node kinds, which flags, where the current writer/reader refuses), and whether
      a vendor fact is missing to spell it (→ a probe-table row, never a probe script).

## 1. Design (owner review before code)

- [ ] 1.1 design.md: a network-text spelling per census shape, consistent with the NWL model and identical on both vendors;
      the grammar delta for `docs/network-text.html`; what stays refused by name and why; the order to build the shapes
      (by corpus count); the split of the network-text code by concern (parser, lexer, checks, tests); which deferred
      `probe-nwl-*` / N23 / N25 facts become rows.
- [ ] 1.2 STOP for the owner's review of 1.1 (a file-format extension). Record the decision here.

## 2. Build (after 1.2)

- [ ] 2.1 Per shape, test-first: a recorded fixture on both vendors (pull → push → pull fixed point + build), writer,
      reader, gate, LSP parser and checks.
- [ ] 2.2 The network-text code split by concern; the shrink-only entries and dead-export allowlist emptied.
- [ ] 2.3 The probe-table rows from 1.1; DIALECT N-rows updated.

## 3. Verify and close

- [ ] 3.1 Re-pull the six corpora: no LD/FBD body UNSUPPORTED except the shapes 1.2 kept refused by name; e2e on both
      vendors; full LSP suite cold; archive.
