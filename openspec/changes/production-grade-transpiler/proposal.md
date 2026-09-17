## Why

The transpiler works, on a subset. `transpile-st-to-rust` built it and proved it: 625 programs recorded from
CODESYS's own simulator, replayed through the interpreter and the emitted Rust. That is real, and it is not the
same thing as being safe for other people to depend on.

A 16-agent file-by-file review of all 22 source files found **42 distinct defects**, 11 high severity, each
verified by a second agent instructed to refute by default (10 further findings were refuted and discarded).
A second 4-agent critique of the first draft of this plan found **49 more issues in the plan itself**, including
two numbers in this proposal that were wrong by two orders of magnitude. Both lists are in `findings.md`.

**Neither review is the reason for this change.** The reason is three things they revealed together:

1. **The emitted Rust was verified on one machine.** `skipIf(rustc === null)` guarded the Rust half and no CI
   job installed a toolchain: 3,627 assertions with `rustc` on PATH, 2,423 without. *Fixed — commit
   `273a3da2f1`.* It explains the shape of the finding set: 5 of the 11 high-severity defects are in
   `emit/rust/`.
2. **The two backends are never compared to each other.** They are each compared to the CODESYS recordings and
   never to one another, so on any program without a recording they may disagree freely. **Five** such
   divergences are now confirmed — including `7 MOD 3` compiling to `0` (fixed, `1a81fe3ca5`) and a POU that
   fails loud in the interpreter and **hangs forever** in the compiled Rust.
3. **The contract the code states is not the contract the code keeps.** `index.ts` promises lowering "never
   throws and never invents a meaning". Both halves were false, in two places each.

## What this is, honestly

**Measured, with the repo's own tool, 2026-09-17:**

| | |
|---|---|
| corpus | **6** projects, 29,359 files |
| top-level POUs with a body | 304 — **55 lower (18.1%)** |
| METHOD/ACTION bodies | **56,629 — not reachable at all** (they share their FB's frame) |
| **of all executable bodies** | **~0.10%** |

Real PLC logic lives in methods and actions. A transpiler that reaches none of them cannot test a real project
today, and no amount of hardening changes that. So this change makes a **stated subset** trustworthy, and the
first task is to write that subset into `index.ts` as the contract — with the number, the date, and a gate that
fails when the doc and the measurement disagree.

The first draft of this proposal claimed the B↔C gate would "turn every one of the 26,175 corpus files into a
differential test". It reaches **55 POUs** — *narrower* than the 625 programs already tested through the
recordings. That error mattered, because the whole justification for the gate rested on it. The fix is not to
drop the gate but to give it a source with no coverage ceiling: **a generator of ST inside the input contract**,
moved from Phase 4 into Phase 0 as the gate's primary case source.

## What "production grade" means here

Not "IEC 61131-3 certified". The oracle is **CODESYS's measured behaviour**, which deviates from the standard in
ways this repo has recorded: `**` and `&` do not parse at all; `LIMIT`/`MIN`/`MAX` are reserved and cannot name
a variable; `REF= 7` and `REF= 314` produce *different* errors. A conformance checklist would tell us to "fix"
each of those.

But that argument is about IEC **as an oracle**, and the first draft over-applied it. IEC — and the CODESYS
reference this package already embeds — is exactly right **as an index**: a checklist of constructs that must
each resolve to a fixture or an explicit "not covered". This repo already blessed that pattern in
`coverage.test.ts`. The two uses are now separated.

The target state is that **three oracles agree across the stated subset**, and that the subset, the refusals and
the emitted surface are all things a stranger can read:

| | | status |
|---|---|---|
| **A** CODESYS recordings | external truth | 625 programs, gated |
| **B** `interp/` | internal reference | gated against A |
| **C** emitted Rust | the deliverable | gated against A — **in CI since `273a3da2f1`** |
| **B↔C** | the two backends against each other | **not gated — 5 confirmed divergences** |

## What Changes

Phases, in dependency order. Phase 0 is no longer "everything blocks on it" — its two blocking items are done —
but the contract and gate work still comes before the defect work, because a fix to a component with no gate is
a fix nobody can check twice.

0. **State the contract and gate it.** The measured subset in `index.ts` + a gate; the refusal-code registry and
   its three-way taxonomy (invalid / not-modelled / not-measured); a termination and allocation contract both
   backends obey; the B↔C gate **driven by a generator**; the emitted-API surface declared.
1. **The 11 high-severity defects**, each as a failing test first.
2. **The 13 medium defects**, plus the standard-FB refusal honesty.
3. **The 18 low / cleanup items** — duplicated rules, silent fallbacks, doc-versus-code contradictions.
4. **Hardening**: fixtures for every refusal code, the memory model under property tests, source-map correctness.

Coverage — making METHOD/ACTION bodies reachable — stays with `transpile-st-to-rust`. This change makes the
subset trustworthy and says plainly how small it is.
