# network-text-lowering — design

The three open points of `proposal.md` are decided (below, "Decided 2026-10-31"); the measurements they were decided on
follow.

## Decided 2026-10-31

1. **Route (b).** Network boxes lower directly in `src/transpile/lower/network/`: each box form becomes the ST statements
   it runs as (AST nodes carrying the user's spans), lowered by `statements/`, `expressions/` and `calls/` as any ST. The
   exec twin (`test/support/network-twin*.ts`) stays in `test/` as the independent oracle (task 3.2). Hidden state has
   `__` names, which no ST identifier can spell.
2. **Wire paths: one spelling, positional.** `__nw<N>_<wire>`, `__nw<N>_eno<k>`, `__nw<N>_trig<k>`, `<N>` the 1-based
   index of the network in its body (a `%DISABLED` one counted); in a body that runs in another body's frame (an ACTION,
   a base body run by `SUPER^()`) `__nw_<body>_<N>_…`. No label variant.
3. **Scan 1 is recorded, not inferred.** `ExecCase.language` (`"LD" | "FBD"`) states a network body; its cases are
   recorded through a served CODESYS (`scripts/record-exec-network.ts`), and the lowering reads a wire before its
   definition as the recording says.

## Measured (read-only step, 2026-10-30)

### What exists

- The twin: `test/support/network-twin.ts` 301 lines, `-boxes.ts` 187, `-reads.ts` 68 (rules: 556), `-file.ts` 73 and
  `-project.ts` 61 (corpus glue), `network-twin.test.ts` 125. It imports only `src/frontend/{syntax,symbols,types}`
  (`plainStText`, `inferExprType`, `boxMember`, `NetworkBox` from `types/infer/network-box.ts`, 152 lines), which
  `src/transpile` may already import.
- The twin is a **text rewriter**: `twinOf` returns `{ code: string, declarations: string[], wires: string[] }`, built
  by slicing the source (`this.text(s)`) and naming hidden variables `vtw<k>_w1`, `vtw<k>_eno<n>`.
- The refusal: `src/transpile/lower/calls/routines.ts:235` (`bodyOf`, `isPlainStNetworkBody`), code `graphical-body`.
- The lowering: 97 non-test files, 21,137 lines in `src/transpile/lower` (all ST statements: `statements/` 4 files,
  585 lines; all calls: `calls/` 18 files, 2,535 lines).

### `TwinRefusal` cases today, and the corpus hits

`test/corpus/corpus-twins.test.ts:34` asserts `twins.refused` is `[]` on every corpus project: **0 corpus bodies hit
any of them** (the twins of 44 corpus bodies build with 0 errors).

| # | Where | Reason |
|---|---|---|
| 1 | `network-twin.ts:103` | a wire whose type the twin cannot declare (`inferExprType` unknown) |
| 2 | `network-twin.ts:138` | a statement in a network the twin does not write (by its text) |
| 3 | `network-twin.ts:157` | a statement kind in a network the twin does not write |
| 4 | `network-twin.ts:188` | a root box showing ENO without EN (CODESYS does not compile it) |
| 5 | `network-twin.ts:215` | an `EXECUTE` call that is no Execute box |
| 6 | `network-twin-boxes.ts:62` | an enabled non-comparison box read other than as an assignment's whole value |
| 7 | `network-twin-boxes.ts:128` | a `???` (no instance) FB box that is read or enabled |
| 8 | `network-twin-boxes.ts:152` | an FB box showing ENO without EN (CODESYS does not compile it) |
| 9 | `network-twin-boxes.ts:164` | an FB box read with no declaration naming its output |
| 10 | `network-twin-boxes.ts:167` | an FB box read through a VAR_OUTPUT other than `OUT` without ENO |

Of these, 4 and 8 are CODESYS build errors (a refusal is the IDE's own answer); 1–3, 5–7, 9, 10 are limits of the
twin, each a candidate `refused by name` in the lowering whatever route is taken.

### Point 1 — twin as source (a) or as oracle (b)

**(a) move the rules into `src/` and lower the twin's ST.** Moves 556 lines (3 files) to e.g.
`src/transpile/network/`, plus ~40–80 lines in `bodyOf` to replace the refusal: twin → text → `execBodyStatements`
→ the existing pipeline, and the twin's `VAR` lines turned into hidden slots of the unit (an ACTION's: its POU's, as
`network-twin-file.ts` does). Measured costs of the text route:
- the lowered statements' spans point into the synthesized text, not the user's body (a runtime error, a debugger
  line, a Sim-Assist trace lands nowhere) — fixing it means a span map or rewriting the twin to build AST (another
  ~300–500 lines, the twin's whole output side);
- the twin's hidden names (`vtw1_w1`) are legal ST identifiers, so a user can collide with them; the `__` names point 2
  wants are not ST identifiers (no two consecutive underscores), so the ST parser refuses the twin text if it uses them.
  (a) must either keep collidable names or parse with a relaxed parser.

What (a) catches: every corpus/fixture body lowers exactly as its twin says. What it cannot catch: a wrong twin rule —
twin and lowering are the same code, so "lowered ≡ twin" (task 3.2) is vacuous. The only independent oracle left is
CODESYS: the recorded twin builds (44 bodies, 0 errors: proves the twin compiles, not that it means the network) and
the exec traces where the network and the twin run side by side (`st-spellings-run.test.ts`, N24 20/20, 1.4 6/6,
1c 6/6). Those stay independent in (a) — they compare CODESYS's network against CODESYS running the twin.

**(b) lower boxes directly to IR, twin stays in `test/`.** New code: a network lowering in `src/transpile/lower/` that
maps each box form (12 rules in the twin's header) to IR, reusing `calls/`, `expressions/` and `statements/` for the
ST that stands as it is (contacts, coils, `S=`/`R=`, labels, `JMP`, `RETURN`). Estimate by the twin's rule code and
the IR verbosity of the neighbours (`statements/`: 585 lines for every ST statement): **~700–1,000 lines, 4–6 files**,
plus colocated tests (~400 lines). Spans are the user's body's. Hidden slots get `__` names directly (no parser).

What (b) catches beyond (a): a defect in either implementation of a rule, on every corpus body (task 3.2 becomes a
real comparison: ~44 corpus bodies × scans, offline, every push); the twin's text-level bugs (e.g. the wire-merge
finding below). What it cannot catch: a rule both got wrong the same way — only the CODESYS exec traces catch that,
and they stay independent in (b) as in (a).

Finding from the read (either route): the twin keys wires by name across the **whole body**
(`Twinner.wires`, one `Map` over every network), while the text declares wires **per network** (`docs/network-text.html`
lines 23 and 78 both declare `w1`). Two networks' `w1` become one twin variable. Harmless when each is defined before it
is read in its network; a read before definition then reads the OTHER network's value. (b)'s comparison would show it
on a body that does that; (a) would ship it.

**Recommendation: (b).** The twin is already written and pinned by CODESYS; keeping it as a second implementation
costs ~700–1,000 lines and turns 3.2 into an offline oracle over every corpus body, with user spans and `__` names for
free. **Counter-case:** (a) is ~4× less new code and ships sooner; if the owner accepts the CODESYS exec traces
(N24, 1.4, 1c, the spelling run) as the only oracle and accepts synthesized spans for now, (a) is enough — and it can
be turned into (b) later only by writing (b).

**Owner question 1:** two implementations compared offline (b), or one implementation held only to the CODESYS
traces (a)?

### Point 2 — debug paths for wires and ENO temps

`Runner.get` resolves a path with `parsePath` (`src/transpile/ir/path.ts:15`, a segment is `[A-Za-z_]\w*`) and matches
the first segment against `pou.slots` by `namesVariable`, then `pou.globals`. A hidden slot named with a leading `__`
is reachable as-is (`__clock` already is, `runner.ts:43`) and no user ST identifier can be spelled that way, so none can
collide (the Rust names keep the `__` too, `emit/rust/names.ts:65`).

Proposed names, one slot per wire per network per body, kept across scans (as the twin's `VAR`):

- a wire: `__nw<N>_<wire>` in the POU's own body, `__nw_<body>_<N>_<wire>` in an ACTION's body (an ACTION shares its
  POU's frame, so its networks' `w1` must not meet the POU's); `<N>` is the 1-based network index in that body;
- an ENO temp: `__nw<N>_eno<k>` (`k` its order in the network), same body rule; an edge detector `__nw<N>_trig<k>`.

`Runner.get("__nw2_w1")` then needs no change in `runner.ts`; an instance's wire is `inst.__nw2_w1` through the FB's
layout field. A METHOD's or FUNCTION's wires live in its call frame (re-initialised per call, as its `VAR` is in
CODESYS), so they are visible only while it runs — not by a `Runner.get` path from the POU.

**Recommendation:** the names above. **Counter-case:** `<N>` is positional — inserting a network above shifts every
later wire's path, so a Sim-Assist watch on `__nw3_w1` silently follows a different wire after an edit. The stable
alternative is a network's label where it has one (`__nw_<label>_w1`), the index only where it has none — two spellings
for one fact, which the owner's one-way-per-fact rule weighs against.

**Owner question 2:** positional network index in the path (one spelling, shifts on edit), or label when present?

### Point 3 — scan 1 of a wire read before its definition

Existing recordings: `st-spellings-run.test.ts` (network `NET1`, `x6 := a AND w1; w1 := b OR c;`) proves CODESYS keeps
the wire across scans (equal to the twin on every scan, kept-vs-temp discriminated at n = 3). It does **not** answer
scan 1: at n = 1 the stimulus gives `b OR c` = FALSE, so the default (FALSE) and the scan's own definition (FALSE) read
the same. It is also a live run with no stored per-scan values. The graphical fixture
`ng_r5_split_before_definition` (`network-graphical-e.ts:47`) records the push/build, not a run. `semantics/execution-*.ts`
holds ST cases only; `ExecCase` (`execution-shared.ts:5`) has no language field. **No recording answers it.**

The exec case that would (needs `ExecCase` to carry the body language, `language?: "LD" | "FBD"`, which `record:exec`
pushes as the body's `%LANGUAGE` line — a harness change, not a fixture-only one):

```ts
{
  name: "nt_wire_read_before_definition_scan1",
  language: "FBD",
  vars: "i : INT := 7; y : INT; z : INT;",
  body: "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\ny := w1;\nw1 := ADD(i, 5);\nz := w1;",
  cycles: 1,
},
{
  name: "nt_wire_read_before_definition_scan2",
  language: "FBD",
  vars: "i : INT := 7; y : INT; z : INT;",
  body: "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\ny := w1;\nw1 := ADD(i, 5);\nz := w1;",
  cycles: 2,
},
```

An INT wire tells the readings apart where a BOOL cannot: scan 1 `y = 0` (the type's default) vs `y = 12` (definition
first); scan 2 `y = 12` (kept); `z = 12` both. A second pair with two networks each declaring `w1` (network 2 reading
its `w1` before defining it as `ADD(i, 1)`) would also settle the wire-merge finding above.

**Recommendation:** record the pair before the lowering is written; lower to the type's default on scan 1 only if the
recording says `y = 0`. **Counter-case:** the twin's `VAR` already implies the default, and CODESYS initialises every
`VAR` so — skipping the recording rests the rule on an inference, which the exec-oracle policy does not accept.

**Owner question 3:** extend `ExecCase` with a body language and record these cases (CODESYS; TwinCAT has no runtime
licence here), or answer scan 1 by adding a discriminating stimulus to `st-spellings-run.test.ts`?
