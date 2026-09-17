## Why

The transpiler works. `transpile-st-to-rust` built it and proved it: 625 programs recorded from CODESYS's
own simulator, replayed through the interpreter and the emitted Rust, byte-identical. That is a real
achievement and it is not the same thing as being safe for other people to depend on.

A 16-agent file-by-file review of all 22 source files (7,166 lines) found **43 confirmed defects**, 11 of
them high severity, each verified by a second agent instructed to refute by default. 10 further findings
were refuted and discarded. The list is in `findings.md`.

**The review is not the reason for this change.** The reason is what the review revealed about why those
defects could accumulate unseen:

> **The emitted Rust — the actual deliverable — is verified on one engineer's machine and nowhere else.**
> `transpile.test.ts` guards the Rust half with `describe.skipIf(rustc === null)`, and there is no `rust`
> or `cargo` anywhere in `.github/workflows/`. Measured: 3,627 assertions with `rustc` on PATH, 2,423
> without. **~1,200 assertions covering the emitter do not run in CI.**

That single gap explains the shape of the finding set — 5 of the 11 high-severity defects are in
`emit/rust/`, and three more are cases where the interpreter and the emitter simply disagree. It also
means something uncomfortable: **fixing those defects today would itself be unverifiable by anyone but the
engineer who did it.** Gates come first.

## What "production grade" means here, concretely

Not "IEC 61131-3 certified". That is the wrong target and would introduce bugs: this transpiler's oracle is
**CODESYS's measured behaviour**, which deviates from the standard in ways this repo has already recorded —
`**` and `&` do not parse in CODESYS at all; `LIMIT`/`MIN`/`MAX` are reserved and cannot name a variable;
`REF= 7` and `REF= 314` produce *different* errors by literal type. A conformance checklist would tell us to
"fix" each of those. (IEC 61131-3 declares conformance through feature tables plus a compliance statement,
and PLCopen runs a certification scheme — both are aimed at programming systems, both are paywalled, and
neither is the oracle we actually serve.)

The right frame is that there are **three oracles**, and production grade is the state where all three agree
across the whole input contract:

| | what it is | covers |
|---|---|---|
| **A** CODESYS recordings | external truth | 625 programs |
| **B** `interp/` | the internal reference | every lowered program |
| **C** emitted Rust | the deliverable | every lowered program |

- **A↔B** is gated today and green.
- **A↔C** is gated — *and does not run in CI*.
- **B↔C** is **not independently gated at all**. It is only ever checked *through* A, so the two backends
  can diverge freely on any program without a recording. Three confirmed divergences live exactly there.

That missing edge is the structural finding, and closing it is worth more than any individual bug fix: it
turns every one of the 26,175 corpus files into a differential test that needs no CODESYS at all.

## What Changes

Five phases, in this order, because each one makes the next one verifiable.

0. **Make the gates real.** rustc in CI; a B↔C agreement gate over the corpus; a totality gate (lowering
   must never throw — it currently does); an "emitted Rust compiles" gate over every lowered POU, not just
   recorded ones; IR-node and lowering-path coverage measurement.
1. **The 11 high-severity defects**, each as a failing test first.
2. **The 13 medium defects.**
3. **The 19 low / cleanup items** — mostly deletions and doc-versus-code contradictions, which are cheap and
   which are how the next reviewer is misled.
4. **Hardening past what the review could see**: randomized differential testing inside the contract, a
   fixture for every refusal code, and the memory model under property tests.

Phase 5 — closing the `lower-completeness` buckets that block real POUs — is deliberately **out of scope
here**. It is coverage, not quality, and it belongs to `transpile-st-to-rust`. This change is about making
what already exists trustworthy.

## The evidence this is built on

- 43 confirmed defects, adversarially verified — `findings.md`.
- The CI gap, measured: 3,627 vs 2,423 assertions.
- Two defects verified independently by hand before this was written:
  - a `FOR i : INT` with a `DINT` limit emits `self.i <= self.hi` — `i16 <= i32`, which rustc rejects (E0308)
    — with **zero** lowering diagnostics, on ordinary ST that CODESYS compiles;
  - an `ANY` argument bypasses every `bindInOut` guard, so a global passed to an `ANY_INT` input emits Rust
    that fails E0499, where the same variable on a plain `VAR_IN_OUT` is correctly refused.
- 22 source files, 4 test files. `lower/calls.ts` is 1,245 lines with no colocated test; the five-file
  memory model is 1,075 lines with none.
