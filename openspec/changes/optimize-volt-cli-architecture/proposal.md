## Why

`openspec/changes/audit-volt-cli-src` read `packages/volt-cli/src` **line by line** and fixed what was wrong
*within* each file. It was behavior-preserving **and shape-preserving by construction**: no moved seams, no new
abstractions, no split or merged projects. Everything structural it found went to `arch-notes.md` as a note,
deliberately unimplemented.

That was the right order — you cannot judge a seam while you are still discovering what the code does. But it
means the one question the audit could not ask is still open:

> Given what all 118 files actually do, is **this** the shape they should be in?

The 15,295 LOC across 7 projects were not designed in one sitting. They are the sediment of four structural
moves (fork extraction, `volt-bridge` + `volt-git` absorption, HTTP → named pipes, `.volt/` snapshot →
git-native `refs/remotes/volt/ide`), and a seam that was correct before a move is not automatically correct
after it. The audit's own notes already point at this: a health cache whose throttle asymmetry decides whether
it can move into Core, a `DebugService` unreachable from any client, a precondition answered from two different
sources, a fake that had to encode a false invariant to keep 500 tests green. Those are not file-level defects.
They are the shape.

This is the highest-value code in the product — it decides which bytes reach a user's git repo and which reach
their live PLC — so the shape is worth getting right once, with evidence, rather than drifting into it.

## What Changes

A **structural analysis and restructuring of `packages/volt-cli/src`**, top to bottom, driven by the `Workflow`
tool in five phases (`design.md` has the roles):

1. **Map** — one cartographer per project plus a cross-cutting seam analyst produce `map.md`: every type, its
   real responsibility, its actual dependencies (including reflection / `dynamic` / IronPython edges no static
   search finds), and which layer it *claims* vs which it *reaches*.
2. **Diagnose** — seven independent lenses over that map (layering, duplication, responsibility placement,
   abstraction fit, state & lifetime, testability shape, contract fit) write `findings.md`. Each finding cites
   quoted code, not a summary.
3. **Design** — three *independent* target architectures from deliberately different biases (minimal-move /
   seam-first / delete-first), scored by judges on invariant safety, migration granularity, risk and LOC delta,
   then synthesized into **one** target in `target.md` with an ordered list of **moves**.
4. **Refute** — every move faces three adversarial skeptics with a concrete checklist. A move that two or more
   refute is dropped to `findings.md` as deferred, with the objection.
5. **Execute** — one move at a time, each applied by a surgeon, checked by a verifier reading **only the diff**,
   then gated by the main loop with a real build + all three unit suites. e2e checkpoints at the phase
   boundaries and at close-out.

**The contract, as revised after phase 2 (user decision, 2026-08-05).** Phase 2 returned 49 findings, and a
substantial minority are not shape defects at all — they are **behavior bugs** (a healthy TwinCAT worker reaped
on a partial probe, most reference kinds materializing as a constant string, an unreachable
`BeckhoffDriver.Disconnect`, a staleness demotion that can never fire). The original plan routed those to their
own proposals. **They are now in scope here**, because several of them are *symptoms of the shape* — the
per-vendor health divergence exists because the layer cycle forced `BuildHealthResponse` abstract — and fixing
the shape while deliberately leaving the symptom is worse than doing both at once.

So there are **two kinds of move**, and they are never mixed in one commit:

- **shape moves** — behavior-preserving by construction. Everything a client observes is identical before and
  after: wire bytes, `BridgeErrorCodes`, git object SHAs, `src/` layout, exit codes, stdout.
- **fix moves** — a deliberate, named behavior change, each landing **red-first**: a test that fails against
  today's behavior, then the fix that makes it pass. No fix move without one. A fix move states the old
  behavior, the new behavior, and who can observe the difference.

A move is one or the other. A shape move that "also fixes" something is a fix move wearing a costume, and the
verifier rejects it.

These invariants survive both kinds untouched:

- the **pipe wire bytes** and `BridgeErrorCodes` for a given failure (the vendor parity boundary),
- the **git object SHAs** produced for given content, and the `src/` working-tree layout the CLI writes,
- the CLI's command surface, exit codes and stdout contract,
- **item-name-is-identity**, and the **load-bearing CODESYS↔Beckhoff asymmetries** `ARCHITECTURE.md` names,
- every convention in `ARCHITECTURE.md` §"Conventions" — those were paid for in real defects.

**e2e is the gate, before and after.** `bun test test/e2e` against a live headless CODESYS (and TwinCAT where it
applies) must be green on the *pre-change* tree — a red baseline invalidates every verdict after it — and green
again at close-out, **with no test edited to accommodate a move**. A restructure that needs its oracle rewritten
is a behavior change wearing a costume.

Working docs, and the deliverable alongside the diff:

- **`map.md`** — the structural map (phase 1). Outlives this change; it is what the next contributor reads.
- **`findings.md`** — every structural defect found, and every move refuted or deferred, with its objection.
- **`target.md`** — the chosen target architecture and the ordered move list, each move with its rationale,
  its blast radius and its gate.
- **`ledger.md`** — one row per executed move: files touched, LOC before → after, verifier verdict, gate result.

## Capabilities

### New Capabilities

- `cli-architecture`: the structural rules `packages/volt-cli` conforms to — where a decision is allowed to
  live, what a seam must earn, and the observable-behavior contract a restructure must satisfy.

`cli-source-quality` (from `audit-volt-cli-src`, still in flight) is **not** modified here. Its
behavior-preserving requirement stands as written; this change adds the structural layer above it, stated in
terms of what a client observes rather than in terms of the files staying put. The two are archived
independently.

## Impact

- **Code:** every file under `packages/volt-cli/src` is in scope for the map; a subset moves, merges, splits or
  disappears. `.csproj` / `Volt.Cli.sln` may change if a project boundary moves. No wire, CLI surface, file
  layout or git model change.
- **Tests:** the three C# suites must stay green **unedited** except where a test's *location* follows a type it
  covers (a mechanical move, recorded as such). `test/shared/FakeIde.cs` is a legitimate target — the audit
  showed it encoding an invariant the real driver breaks, which is a design defect, not a test defect.
- **Docs:** `packages/volt-cli/ARCHITECTURE.md` is rewritten to describe the *target* shape (it is the stated
  source of truth for these invariants); `CLAUDE.md`'s package map follows if a project boundary moves.
- **Cost:** ~100 subagents across 5 workflow phases. Phases 1–4 change nothing on disk but the working docs, so
  the whole analysis can be run and read **before** committing to any execution — that is the natural
  stopping point if the target isn't worth the migration.
- **Risk:** a restructure of the code that writes to a live PLC. Mitigated by move-at-a-time execution with a
  real gate per move, adversarial refutation *before* any code is touched, and e2e against two live IDEs at both
  ends. Every move is independently revertable; none is a big-bang rewrite.
