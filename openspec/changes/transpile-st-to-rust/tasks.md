Rehomed from `build-st-language-server` (task X.1). The architecture is in place; coverage is the work.

Every percentage below is measured by `bun run scripts/lower-completeness.ts` over the 4-project corpus,
against the **301 POUs that have a body**. Re-run it after each item — the number is the progress report, and
a task that does not move it was mis-prioritised.

## Phase 0 — the skeleton and the executable core · DONE

- [x] `ir/` — places-not-references, resolved `types/` `Type` per node, one loop shape, coded diagnostics.
- [x] `lower/` — assignment, expressions, IF/ELSIF, CASE, FOR/WHILE/REPEAT, EXIT/CONTINUE/RETURN.
      Total: never throws; every gap is a counted code.
- [x] `interp/` — runs the IR.
- [x] `emit/rust/` — flat struct + `scan(&mut self)`, `wrapping_*` numerics, source map. Verified by
      `rustc --emit=metadata -D warnings`, which is also the proof that decision 1 holds.
- [x] `scripts/lower-completeness.ts` — the ratchet, counted over POUs with a body.
- [x] `check-layering.ts` — inside `transpile/`, only `ir/` crosses folders.

## Phase 1 — the oracle · DO THIS FIRST

Nothing after this should be built on remembered vendor behaviour (design §7). This phase changes the risk of
every later phase, not its size.

- [ ] Extend the headless-CODESYS harness (`packages/volt-cli/scripts/codesys-pipe.ps1`) to read variable
      state after N scan cycles. The pipe and the fixture project already exist; the missing verb is a
      state read, not a new harness.
- [ ] `test/exec/differential.test.ts` — same POU, same inputs, IDE vs `interp/`; assert equal state.
      Recorded like `test/conformance/` so it replays offline in CI, live only when recording.
- [ ] Seed it with the executable core: arithmetic at type boundaries, integer division and MOD signs,
      REAL/LREAL precision, CASE range edges, FOR with a negative step.
- [ ] Settle the one construct already known-unverified: an all-constant expression in a REAL context
      (`x : REAL := 7 / 2`) — see design §4, and the `ponytail:` note in `lower.ts`.
- [ ] Re-verify C0582's wording while a live IDE is up. Its catalog entry is `verified: {codesys: false}`
      with PROVISIONAL wording, and its recorded `codesysActual` shows the repro never compiled.

## Phase 2 — the built-ins · 2,424 call sites, 81 names

Bounded, IEC-specified, and mandatory (a built-in cannot be stubbed the way a library FB can). Each one is
verified against phase 1, not against recollection.

- [ ] `MAX` 309 · `SEL` 209 · `LIMIT` 62 · `MIN` 57 — the value functions. One-liners over `types/elementary`.
- [ ] The conversion family — 504 sites, 43 names. Table-driven from family/bits/signed, **not** 43 cases.
- [ ] `CONCAT` 100 and the string functions — blocked on the STRING decision in phase 5.
- [ ] `ADR` 333 · `SIZEOF` 56 · `UPPER_BOUND` 46 · `LOWER_BOUND` 41 — blocked on phase 3's memory model.
- [ ] `__POUNAME` 304 · `__ISVALIDREF` 48 · `__QUERYINTERFACE` 33 — CODESYS compiler operators.
- [ ] `TRUNC`/`TRUNC_INT`, `ABS`, `EXPT`, `SIN`/`COS`/`ATAN` — numeric; watch rounding against the oracle.

## Phase 3 — the memory model, then the frame · BLOCKED ON A DECISION

**Decide design §9 before writing any of this.** Instances, methods and GVLs are what a pointer points at;
building them on slot indices and then finding `ADR` needs offsets means doing the work twice.

- [ ] **Decision: slot+path, byte-addressed image, or the hybrid.** Record it in `design.md` §9.
- [ ] `expr-member` (91 POUs, 30%) + `place-shape` (84, 28%) + `expr-index` (4) — fill in `Place.path`.
      ST arrays have arbitrary lower bounds; index normalisation belongs in lowering.
- [ ] `stmt-call_stmt` (254, **84%** — the single biggest unblocker) — FB instances in the frame.
      Instances nest statically, so composition works: `struct Parent { child: Child }`, `child.scan()`.
- [ ] METHOD/ACTION bodies — **34,090 of them**, sharing their FB's frame. A method is
      `fn(&mut self, params)`; an ACTION is a private method with no params.
- [ ] `place-not-local` (47, 16%) — GVLs. The frame widens from one POU to an `App` owning every POU and GVL.
- [ ] `expr-call` (60, 20%) — project FUNCTION calls, once the frame can hold a callee's locals.

## Phase 4 — aliasing

- [ ] `VAR_IN_OUT`, `POINTER TO`, `REFERENCE TO`, `expr-deref` — on the phase-3 model.
- [ ] `__ISVALIDREF` and the pointer built-ins, which only mean something here.

## Phase 5 — the remaining language

- [ ] **STRING(n) is a fixed-size buffer with defined truncation, not Rust `String`.** The current mapping in
      `emit/rust/rustType` is wrong for fidelity and must change before the string built-ins.
- [ ] Interfaces, `EXTENDS`, `__QUERYINTERFACE` — dynamic dispatch.
- [ ] `aggregate-init` (31, 10%) · `assign-op` S=/R= (17, 6%) · `expr-assign_expr` (1) — mechanical desugars.
- [ ] `stmt-try` (6, 2%) — `__TRY`/`__CATCH`. The interpreter can run it; Rust has no exceptions, so the
      emitter needs a strategy or an explicit refusal. Decide rather than default.
- [ ] `type-unknown` (16, 5%) — triage; each is a type the frontend could not resolve.

## Phase 6 — the standard library

- [ ] Create the Rust runtime crate. **Not before something needs it** (design §6); location undecided.
- [ ] `TON`/`TOF`/`TP` — the three that cannot be written in ST at all, since they read a clock the language
      does not expose. Simulated time, injected per scan; never a wall clock.
- [ ] `CTU`/`CTD`/`CTUD`/`R_TRIG`/`F_TRIG`/`RS`/`SR`.
- [ ] **Parameter names come from the bridge's library-signature extraction, not from memory** (design §6).
- [ ] Stub mechanism for third-party library FBs, so a POU that calls one is still testable (design §8).

## Non-goals

- Running a real project end to end. Third-party libraries ship compiled; see design §8.
- Replacing the IDE compiler. The IDE stays authoritative for type-checking and codegen.
- Shipping the emitted Rust as a product. It is a test target until a decision says otherwise.
