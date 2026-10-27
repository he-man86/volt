- [ ] 1.1 Census (read-only, no code): every NWL node kind and flag in the six corpora and the fixtures, with counts,
      and per kind the plain-ST spelling or "ST cannot carry it". Input for design.md.
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
      - Side finding (for lsp-field-false-positives family 2): declaring `r, s, xr : REAL;` failed in CODESYS (C0009
        "Unexpected token 'r'"). Check single declarations (`s : INT;`) and uses before calling the LSP's report a
        false positive.
- [ ] 1.3 design.md: the mapping, the wire variables (name, declaration), statement order (leaves first, as ST
      evaluates), the rung grouping rule, and every case ST cannot carry, for the owner.
- [ ] 1.4 STOP for the owner: review design.md.
- [ ] 2.x Phase 1 (read-only): writer + LSP, oracles green on the corpora.
- [ ] 3.x Phase 2 (push), then delete the old format.
