Owner, 2026-10-27: "just go ahead". Read-only first. Section 1 is docs only and runs while language-line is being built;
sections 2–3 change network-text code that language-line also touches, so they start only after language-line is
archived.

## 1. Census and design

- [ ] 1.1 Census (no product code): every NWL node kind and flag in the six corpora and the fixtures, with counts, from the
      models the current reader builds (NetworkModel), not from text greps. Per kind: its plain-ST spelling per the
      1.2 measurements, or "ST cannot carry it". Written into design.md.
- [x] 1.2 Measured 2026-10-27, CODESYS 3.5.21.40, one POU per case, each called from PLC_PRG and built alone (228
      builds; an uncalled POU is never compiled). Results (raw: the session scratchpad's nts-results.tsv, not kept):
      - The 14 keyword operators (AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT) have NO call form: `ADD(i, j)` and
        `AND(a, b)` are syntax errors (C0189/C0007/C0009), positional, extensible, formal or with EN/ENO. Infix only:
        `a AND b AND c`, `i + j + k`, `i > j`, `i MOD j`. They are the most frequent boxes in the corpora (AND 996, NOT 385,
        OR 291, MOVE 102, ADD 17, GE 13, GT 11, LT 10, EQ 7, …).
      - Built-in operators (MOVE, SEL, MUX, LIMIT, MIN, MAX, ABS, SQRT, …, SHL…ROR, EXPT, TRUNC, ADR, SIZEOF, the
        conversions): positional calls only. Named pins are an error (C0077/C0046/C0018). MIN, MAX and MUX are extensible
        positionally.
      - Library and user functions (CONCAT, LEN, REPLACE, DELETE (pins STR/LEN/POS), user `NtsFn`): positional and
        formal both clean.
      - EN/ENO exist on NOTHING in CODESYS ST: operators, conversions, library and user functions and FBs all refuse
        them (C0037 'EN' is no input of 'TON', C0038, C0040, C0002/C0022). A box with EN/ENO has no direct ST call.
      - NOT: `NOT a` and `NOT(a)` are both the operator (one AST); `NOT(IN := a)` is an error.
      - FB calls clean: `t1(IN := a, PT := T#1S); x := t1.Q;` and `t1(…, Q => xb, ET => xt);`.
      - Clean: `JMP lbl;` and labels (`lbl:`, `lbl: ;`); `IF a THEN JMP lbl; END_IF`; `IF a THEN RETURN; END_IF`;
        `x S= a;`, `x R= a;`, `xb S= ok R= a;`, `xb := ok := a;` (a chained assignment).
      - Side finding: declaring `s` or `r` fails in CODESYS too (C0009); see lsp-field-false-positives task 2.
- [ ] 1.3 Measure what 1.1 leaves open, in CODESYS through the shipped bridge on a fixture copy (an `ide.ps1` instance
      of this change, closed after). Questions: does an LD body store an AND/OR box apart from series/parallel contacts,
      and how; what EN/ENO does at run time (is ENO always EN, for operators, functions and FBs?); and which ST each
      remaining node needs (branches, edge contacts, negated coils and pins, EXECUTE). No product code.
- [ ] 1.4 design.md (design-first, before any code): the mapping per node kind. It must decide:
      - EN/ENO: the `IF en THEN <box> END_IF` pattern, chains, and ENO targets; or a `%` line if ST cannot carry it;
      - the operator-chain rule (one chain = one extensible box, brackets nest);
      - wire variables: name and declaration;
      - statement order (ST evaluation order) and how statements group into one rung;
      - the `%NETWORK`/`%LABEL`/`%DISABLED` lines;
      - the network subset the LSP allows;
      - the oracles.
      Every case where plain ST cannot carry a stored difference is listed with the choice made and why. The owner
      said go ahead, so the design is decided by evidence here and reported to the owner. It does not wait.

## 2. Read-only (after language-line is archived)

- [ ] 2.1 Writer: NWL → plain ST network text (behind `NetworkTextSwitch`, as LD/FBD are today). A push of an LD/FBD body is
      refused by name until section 3 ("LD/FBD push comes back with the plain-ST reader").
- [ ] 2.2 C# reader of the plain-ST form into the NWL model (it is needed for the oracle). Round-trip oracle: every corpus and
      fixture network → text → model gives the identical tree.
- [ ] 2.3 LSP: a network body is read by the ST front-end, plus ONE subset check (what a network may hold, refused
      by name). No network lexer, grammar or keyword list. LSP conformance against the same case set.
- [ ] 2.4 Exec oracle: the corpus networks' text compiled in CODESYS as called ST bodies, 0 errors; behaviour equal on
      the exec-oracle cases.

## 3. Push and cleanup

- [ ] 3.1 Push through the new reader (NetworkPairing, the derivation, RebuildLoss as today); the full e2e suite on
      both vendors.
- [ ] 3.2 Delete the old reader, lexer, spelling and the LSP's network parser; rewrite `docs/network-text.html` (much
      smaller: the mapping table and the subset); the case set re-recorded.
- [ ] 3.3 Close: cold full suites, the release matrix, archive.
