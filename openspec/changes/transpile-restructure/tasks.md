Order is load-bearing: models before the lean groups that sit on them; within a phase, independent steps first.
Every step: test-first; the whole suite green; the map regenerated; its delta (fixtures changed, `edge`, median
`size`, `pedantic`, notes resolved) written under the task. A lean step must leave every recorded value and every
`edge` verdict byte-identical.

Loop: one implementer per step, one data-lens review, one fix, commit; a second review round only on a high finding;
a full-suite gate every step (these steps are large). Model steps start with their design section; the design is
committed before the code.

## 0. Baseline

- [ ] 0.1 After `transpile-fix-all`: record the baseline (map header: edge, size median, pedantic total, lint totals,
      open known divergences per task) in this file.
- [ ] 0.2 A corpus-output snapshot tool: run every lowered fixture's Rust and interpreter on recorded + edge inputs,
      write one canonical output file; "byte-identical" in the lean steps means this file does not change.

## 1. Loop execution model (tasks 27, 35, 36)

- [ ] 1.1 design.md "Loops": no iteration cap in emitted semantics (at most a harness-only guard behind a cfg), one
      counting rule shared by both backends, FOR step/limit typing per CODESYS (35, 36 recordings).
- [ ] 1.2 Implement; the loop_cap_* and tr_35/tr_36 fixtures pass; divergence marks removed.

## 2. String storage model (tasks 11, 34, 45)

- [ ] 2.1 design.md "Strings": STRING(n)/WSTRING(n) as the full n+1 buffer, len = first terminator, stores at or past
      len re-scan, conversions without the 80-character cut, `$00` literals per CODESYS; the same model in the
      interpreter's values.
- [ ] 2.2 Implement; tr_11/tr_34/tr_45 fixtures pass.

## 3. Pointer and reference model (tasks 14, 15, 16, 17, 44; parts of 18, 20)

- [ ] 3.1 design.md "Pointers": the options (extended tags / flat byte arena per program / references plus an address
      table), each measured against every recorded pointer fixture (ADR of own member across an FB copy, multi-target
      S=/R=, ANY pValue type, one-below-first element, __QUERYINTERFACE edges, output binding timing). Pick by
      fixtures passed and emitted-Rust cost; write down what stays refused.
- [ ] 3.2 Implement in both backends; the pinned fixtures pass; what stays refused is refused by name.

## 4. Instance initialization model (tasks 22, 23, 24, 25, 30)

- [ ] 4.1 design.md "Initialization": CODESYS's order (field initializers, FB_Init, VAR_TEMP per call, element defaults
      from enum/alias types) as one sequence both backends run.
- [ ] 4.2 Implement; tr_22..tr_25/tr_30 fixtures pass.

## 5. Lean groups (from transpile-lean-candidates), same output, less Rust

- [ ] 5.1 Group 10: transpiler source cleanup (one EXTENDS walk, one reaches-walk, one typed const fold, orphan docs).
- [ ] 5.2 Group 1: prelude on demand (emit only the helpers a program calls). ALLOWED `dead_code` removed or shrunk.
- [ ] 5.3 Group 9: prelude helpers (round, TRUNC helper, `iec_deref`, text helpers without the extra String).
- [ ] 5.4 Group 2: constants folded in lowering, one place (after review tasks 5/6/7).
- [ ] 5.5 Group 3: one emission per construct; narrow arithmetic where CODESYS's result is the same (DIV/MOD, mixed
      sign comparisons, shifts and wider stores stay promoted).
- [ ] 5.6 Group 5: loop shape (on the step-1 model).
- [ ] 5.7 Group 4: string copies (on the step-2 model).
- [ ] 5.8 Group 6: temporaries as locals (on the step-3 model).
- [ ] 5.9 Groups 7 + 8: routine signatures and derives/aggregate syntax (on the step-4 model); ALLOWED unused_* shrink.

## 6. Close

- [ ] 6.1 Final map delta vs 0.1; architecture.md / data-model.md describe the four models.
- [ ] 6.2 Final review (spec + layering) over the whole change; fix; archive this change and `transpile-lean-candidates`;
      delete the recreated openspec/specs/.
