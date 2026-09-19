# Close-out — production-grade-transpiler

**41 of 44 tasks done.** The three left cannot be finished without a live CODESYS SP21 session; each is
parked with the measurement it needs already written as a fixture, so the work resumes with a
`record:exec` rather than with a decision.

Suite at close: **2401 pass, 0 fail** (LSP), lint and typecheck clean.

---

## What this change was for, and whether it did it

The plan was to make the *existing* transpiler production-grade — not to widen it. That distinction held,
and it is worth being blunt about what it means: **documented reach went DOWN**, 55 → 46 of 304 top-level
bodies (18.1% → 15.1%). Every one of those nine bodies was refused on purpose, because each was lowering to a
value that was wrong. Refusing is more honest; it is not more useful.

The number that governs whether anyone can rely on this is unchanged and is stated in
`src/transpile/index.ts`: **56,629 METHOD/ACTION bodies are unreachable**, so roughly **0.10% of every
executable body in the corpus** lowers. Real PLC logic lives in methods and actions. That work is explicitly
out of scope here (D6) and is the natural next change.

## The defects that mattered

Each of these produced a wrong answer, silently, on ordinary code:

| What | Why it was invisible |
|---|---|
| A library FB call lowered to a routine that did nothing, so `t1.Q` read FALSE forever | 308 corpus files declare one; a declaration file has no body, and an empty body lowers cleanly |
| An enum variable started at 0, a value its type need not contain | 446 corpus enum types start non-zero; 15 corpus bodies were lowering on the wrong start |
| `REAL → integer` saturated in Rust and wrapped in the interpreter | The probe built for it was seeded, so it compared the backends on 43 instead of 1.0E19 |
| `-0.0` came out `+0.0` in the interpreter | Same seeding problem, in the probe named for exactly this |
| `MAX`/`MIN` over a STRING: the interpreter guessed, the Rust did not compile | Nothing ever compiled that program |
| A type containing itself recursed until the stack ran out | `TOTALITY` walks real projects, and no real project contains one |
| `-s` on a STRING lowered, then threw inside the interpreter | The `unary-op` refusal existed and never fired |
| A duplicate declaration and a STRING stored into an INT reached the emitter and threw there | Both are invalid ST; lowering accepted them |

## The theme worth carrying forward

**Several gates could not fail for the reason they existed.** That was the most valuable finding of the
change, and it was not on the original list:

- two B↔C probes were decorative, because seeding overwrites the declared values they are about;
- the refusal-registry gate could not see a code written as a ternary, so two codes were unregistered while
  the gate whose whole job is to catch that passed;
- the source map had one hand-written assertion over one line of one program;
- `lowering-totality` proves no corpus POU throws, which says nothing about shapes no real project contains.

Every gate added or repaired here was checked by breaking the thing it watches and confirming it fails: the
negative-zero probe, the layout property (an injected alignment fault), the emitted-surface refusal.

## What is parked, and what it needs

| Item | Needs |
|---|---|
| A math domain error (`SQRT(-1)`, `LN(0)`, division by zero, NaN propagation) | `record:exec` — five `overflow_domain_*` fixtures are written and waiting |
| `pack_mode` on a FUNCTION_BLOCK | `record:exec` — three `mem_fb_pack_mode_*` fixtures compare the same FB with and without it. Note `cc4_pack_mode_not_allowed` is named for a belief its own recording contradicts: CODESYS built it with no diagnostics |
| `instanceRelative` treats the root FB's own frame as multi-instance | A reaching case. The asymmetry is real in the code (`POU:NAME` vs `FB:NAME`), but three attempts to reach the refusal all lowered correctly or hit an earlier one. Not edited on inspection alone |

**~40 fixtures were added for gaps that are not defects** — constructs nothing exercised, behaviours nothing
recorded. They are skipped by replay until a recording exists (`rec === undefined → continue`), so they cost
nothing and never read as divergences; they only widen the denominator. The construct index went 51 → 59 of
60, and refusal reach 47 → 80 of 107.

## Things a reader should not re-derive

- `TRUNC` and `LREAL_TO_DINT` are **different operations** in CODESYS. `TRUNC(3.0E9)` to DINT is `i32::MIN`;
  `LREAL_TO_DINT(3.0E9)` is `-1294967296`, a plain wrap. Unifying them is a mistake the recordings catch.
- **A bitstring negates.** `-w` on a WORD compiles (warning only); `-b` on a BYTE fails on the STORE, not the
  negation. A type check written without this refuses two fixtures the vendor compiles.
- The `libraries` parameter of `lowerSource` is **not** a library marker — it carries a project's GVLs too.
  `isLibrarySymbol` (a `Library Manager/` path) is the discriminator.
- A field name in the emitted crate is a **contract** and a pure function of the ST name; a routine's locals
  are not. See `emit/rust/index.ts`.
