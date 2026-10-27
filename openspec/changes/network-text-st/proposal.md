> Owner, 2026-10-27: "what we did wrong is to create our own keywords … every block like GT or AND or blocks with
> enable can be seen as a function in ST … remove all custom keywords … this way the language can be purely ST …
> moves it even closer to 1 to 1". Plan first, read-only first. Not started; it follows language-line.

## Why

Network text (`docs/network-text.html`) is a language of its own: about 20 reserved words (`BRANCH`, `SHORTCIRCUIT`,
`EXECUTE`, `ENO … EN` suffixes, `MOVE … =>`, `JMP`, `split<n>`, backtick names, infix box words like `ADD`). It has its
own grammar, a 1,110-line reader with a 391-line lexer, a 2,734-line LSP port, and an error table. Every reader (an
engineer, an AI model, the LSP) has to learn it. IEC 61131-3 ST can already say almost all of it: every box is a
function or FB call with named pins, and EN/ENO are formal parameters of any call in IEC ST.

## The idea

A network body is PLAIN ST: assignments and calls, one network after another. Volt's only additions are `%` lines,
the property-line family `%LANGUAGE` joins, for facts that are not code (a network's boundary, title, label,
disabled flag). The LSP reads it with the ST parser and type checker it already has. The bridge maps the ST AST ⇄ the
NWL tree, 1:1.

```
%LANGUAGE LD
%NETWORK "Start the motor"
// runs while auto is on
w1 := start AND NOT stop;
motor := w1;
lamp := w1;
speed := MOVE(EN := w1, IN := 100, ENO => ready);
t1(IN := w1, PT := T#1S);
alarm := t1.Q;
```

## Draft mapping (to be measured: design.md)

| NWL element | Today | Plain ST |
|---|---|---|
| operator box (AND, ADD, GT, …) | `a ADD b ADD c` | `ADD(a, b, c)`. Standard functions; infix `a AND b` is kept only where it is a different node (below). |
| box with EN/ENO | `MOVE 1 => t ENO EN c` | `t := MOVE(EN := c, IN := 1, ENO => lamp);`. IEC formal call; ENO is an output pin like any other. |
| EN chain (staircase) | nested `… ENO EN …` | one call per box, joined by wire variables: `MOVE(EN := w1, …, ENO => w2)` |
| FB box | `t1 : TON(IN := a).Q` | `t1(IN := a, PT := T#1S); x := t1.Q;`. The type comes from the declaration. |
| function call | `LIMIT(MN := 0, …)` | unchanged; already ST |
| coil, S/R coil | `lamp := x;`, `x S= a;` | unchanged (CODESYS ST has `S=` / `R=`) |
| several coils on one rung | `motor := lamp := x;` | `w := x; motor := w; lamp := w;` (a wire, read back as one rung) |
| split (wire) | `split1 := …` | a wire variable (name and declaration: open point 3) |
| jump, return | `JMP done := a;` | `IF a THEN JMP done; END_IF` (CODESYS ST has JMP and labels) |
| network header | `NETWORK TITLE: "…"` / `END_NETWORK` | `%NETWORK "…"`, `%LABEL x`, `%DISABLED` (property lines) |
| backtick names | `` `arr[i + 1]` `` | gone: with no reserved words, targets are ordinary ST expressions |

## Where ST semantics erase a stored difference (the design's real work)

1:1 means every distinction the IDE stores needs a distinct spelling, and some NWL distinctions mean the same thing
in ST:
- LD parallel/serial contacts vs an OR/AND box;
- a NOT box vs a negated pin or contact;
- a negated coil;
- edge contacts (`R_EDGE`, `F_EDGE`);
- `BRANCH … SHORTCIRCUIT`;
- the `EXECUTE` box (ST inside a network).

Candidate rule: **operator syntax = the LD connection, call syntax = a box.** For example `a AND b` (series contacts)
vs `AND(a, b)` (an AND box), and `NOT x` (a negated contact or pin) vs `NOT(x)` (a NOT box). Both are plain ST with the
same meaning, so the ST compiles to what the network does, and the spelling carries what the IDE stores. Each case
gets measured before it is chosen; a difference ST cannot carry is listed for the owner, not hidden in a convention.

## Phasing (owner: read-only first)

1. **Read-only:** the writer (NWL → plain ST) and the LSP reading it with the ST front-end. A push of an LD/FBD body
   stays refused, as PLC Assist already treats it. Oracle: every corpus network written, read back to the same tree,
   AND the text compiled by CODESYS as an ST body to the same behaviour (exec oracle).
2. **Push:** the ST AST → NWL tree, after phase 1 is green on the corpora. The old reader, lexer and LSP port are
   deleted.

## The LSP (owner: "the only thing our LSP needs to check is what is allowed in the language, no new keywords")

The LSP parses a network body with its ST parser and type checker. A network is a SUBSET of ST, so the only
network-specific code is one check of what that subset allows: assignments, calls, `IF … THEN JMP/RETURN`, and the
`%` lines. A `FOR` loop, a `CASE` or a nested `IF` in an LD body is refused by name ("an LD network cannot hold a
FOR"). No lexer, no grammar and no keyword list of its own.
