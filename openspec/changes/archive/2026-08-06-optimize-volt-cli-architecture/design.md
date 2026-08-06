## Context

118 source files, 15,295 LOC, 7 projects, two vendor IDEs, one wire. The audit
(`openspec/changes/audit-volt-cli-src`) already proved a single agent cannot hold this line by line. A structural
question is *harder*, not easier: it needs the whole graph in view at once, and no context holds 15k LOC of C#
plus its reflection edges plus 8.7k LOC of tests.

It also has a failure mode the audit did not: **an architecture proposal is unfalsifiable at the moment it is
written.** A plausible-sounding "extract this seam" costs a week and is only wrong later. So the design here is
not "one agent thinks hard" — it is *map before diagnose, diagnose before design, design in parallel and judge,
refute before touching code, then move one step at a time behind a real gate*.

`ARCHITECTURE.md` is both input and output: input as the stated invariants (its §"Load-bearing asymmetries" and
§"Conventions" are constraints, not suggestions — every convention there exists because breaking it produced a
real defect), output because the target shape has to be written down or it will drift back.

## Goals / Non-Goals

**Goals:**
- A **structural map** of `volt-cli/src` that is complete enough to reason about seams — including the edges
  static search cannot see (reflection, `dynamic`, the IronPython entry point, COM).
- Every structural defect **found by something whose only job is finding it**, with quoted evidence.
- A target architecture chosen by **comparing independent candidates**, not by iterating one agent's first idea.
- A migration expressed as **independently green, independently revertable moves** — never a big-bang rewrite.
- Observable behavior identical, proven by build + three unit suites per move and live e2e at both ends.

**Non-Goals:**
- **No observable behavior change.** Not one. Wire bytes, error codes, git SHAs, file layout, exit codes, stdout.
- **No new dependencies, no new frameworks, no DI container.** If the answer to a seam question is "add a
  container", the answer is wrong. (Reintroducing indirection the audit just removed is the sharpest failure
  mode here — see Risks.)
- **No re-litigating `ARCHITECTURE.md`'s load-bearing asymmetries.** They are constraints. A candidate design
  that "unifies" the hosting models or strips Beckhoff's per-node `try/catch` is disqualified, not debated.
- ~~No behavior-fixing.~~ **REVISED after phase 2 (user decision, 2026-08-05): the bugs are in scope.** They
  land as **fix moves** — separate commits, each red-first (a test that fails against today's behavior, then the
  fix), never folded into a shape move. What is still out of scope is fixing a bug *silently, inside* a shape
  move; that is the failure this non-goal existed to prevent, and it is still the failure.
  The pre-existing open defects in `audit-volt-cli-src/arch-notes.md` and `fix-push-data-loss` stay with their
  own changes — this change adds no second owner for a bug that already has one.
- Not the TS packages, not `test/e2e`'s own design, not the connector's UI.

## The five phases

### Phase 1 — Map (read-only, parallel)

One **cartographer** per project (7) + one **seam analyst** over the whole solution. Cartographers get their
project plus the full public surface of everything it references; the seam analyst gets the project references,
the `.csproj`/`sln`, and every cross-project call site.

Each returns schema-forced JSON, merged by the main loop into `map.md`:

| field | meaning |
|---|---|
| `type` | the type, its file, its LOC |
| `responsibility` | one sentence, in the domain's words — not "manages X" |
| `layer_claimed` | where its namespace/project says it lives |
| `layer_reached` | the lowest/highest layer it actually touches |
| `dependents` | who calls it, per project |
| `hidden_edges` | reflection / `dynamic` / IronPython / COM / string-keyed dispatch reaching it |
| `state` | static, cached, throttled, thread-affine (COM apartment), or none |

`hidden_edges` is the load-bearing column. `ARCHITECTURE.md` §Conventions rule 9 says static search does not
prove code dead; a map that omits those edges will confidently propose deleting a live path.

### Phase 2 — Diagnose (read-only, parallel, 7 lenses)

Each lens reads the merged `map.md` **and** the code it points at, and answers one question only. Separate
lenses, not one "find problems" agent, because a single reader anchors on the first defect kind it finds.

| lens | the question it alone asks |
|---|---|
| **layering** | does any dependency point the wrong way, or skip a layer? does `layer_reached` ever contradict `layer_claimed`? |
| **duplication** | are there two ways to do one thing? near-clones left by the HTTP→pipe and snapshot→git moves? |
| **placement** | is each decision made in the layer that owns it? (parity-critical → Core; vendor primitive → driver; presentation → CLI) |
| **abstraction fit** | one-implementation interfaces, dead flexibility, and the inverse: a seam that *should* exist and doesn't |
| **state & lifetime** | caches, throttles, statics, singletons, thread/apartment affinity — who owns each, and can two of them disagree? |
| **testability** | what does `FakeIde` (and every fake) have to *pretend* to keep the suites green? each pretense is a design defect at the seam it fakes |
| **contract fit** | do the wire models, domain models and workspace models actually want to be the same types? where is a mapping missing, and where is one pointless? |

Output per finding: `lens`, `title`, `where` (file:line), `evidence` (quoted code), `why_it_costs` (a concrete
scenario, not "cleanliness"), `smallest_fix`, `blast_radius` (`file | project | cross-project | wire`).

The **testability** lens is the one to read first. The audit's single most valuable finding came from a fake
asserting an invariant the real driver breaks — a fake that has to lie is a seam in the wrong place.

### Phase 3 — Design (parallel candidates, then judges, then one synthesis)

Three **architects**, each given the same map + findings and a *deliberately different bias*, so the candidates
are genuinely different rather than three phrasings of one idea:

- **minimal-move** — the smallest set of moves that removes the top findings. Bias: keep the shape, fix the seam.
- **seam-first** — reason from the boundaries the domain actually has (live IDE ↔ engine ↔ git ↔ user) and place
  code accordingly, regardless of where it sits now.
- **delete-first** — assume every abstraction is guilty. What is the shape if only what earns its place survives?

Each returns: the target shape, the moves to reach it, what each move buys, what it costs, and what it does
**not** fix.

Then three **judges**, each scoring on a fixed rubric: invariant safety (does anything observable move?),
migration granularity (can it land in independently green steps?), risk to the live-PLC path, LOC delta,
and how much of `findings.md` it actually closes. A judge may not propose; it scores what it is given.

Then one **synthesizer** produces `target.md` from the winner, grafting the moves the judges scored highest from
the runners-up. Explicitly allowed to output "the current shape is right here" for any area — a phase that
cannot conclude *no change* is a phase that will invent work.

### Phase 4 — Refute (parallel, per move, before any code is touched)

Every move in `target.md` faces **three skeptics**, each prompted to *refute*, defaulting to refuted when
uncertain, and each given a distinct lens (invariants / migration mechanics / hidden edges). The checklist is
concrete:

- does anything **observable** change — wire bytes, an error code, a git object SHA, the `src/` layout, an exit
  code, a log line another component parses?
- does it touch a **load-bearing asymmetry** (`ARCHITECTURE.md` §"Load-bearing asymmetries": hosting models,
  in-memory vs file-based PlcOpen transport, `TcPouReader` having no counterpart, Beckhoff's per-node
  `try/catch`, the host **lifecycle** difference)?
- does it break **item-name-is-identity** (e.g. any new duplicate-name guard that throws)?
- does it violate a `ARCHITECTURE.md` §Conventions rule — add a defensive default, split the error channel,
  add a second answer to one question, re-spell centralized vocabulary, swallow a background failure?
- does it delete something reachable only by reflection / `dynamic` / IronPython / COM / a string-keyed op?
- does it require **any test to be edited** other than a mechanical file move? (That is a hard stop.)
- can it land **on its own**, green, or does it only work as part of a bigger bang?

≥2 of 3 refute → the move is dropped to `findings.md` with the objection. Survivors carry their objections into
the surgeon's prompt. This is where an unfalsifiable proposal gets falsified — before it costs anything.

### Phase 5 — Execute (one move at a time)

Per move, two agents and one real gate:

| | Surgeon | Verifier |
|---|---|---|
| **Powers** | writes **only the files this move names** | read-only |
| **Sees** | the move, the findings behind it, the surviving objections | **the `git diff` only** + the move |
| **Job** | apply exactly this move, nothing adjacent | try to **refute** the diff |
| **Output** | applied / deviated-and-why + LOC before → after | verdict + `must_revert[]` |

The surgeon does **not** run `dotnet build` or `dotnet test` — concurrent builds corrupt each other's `obj/bin`,
and an agent that gates itself will rationalize a red gate. `must_revert[]` is authoritative: those hunks are
reverted before the gate runs.

## Orchestration

```
phase 1   Workflow: parallel(7 cartographers + 1 seam analyst)     → main loop writes map.md
phase 2   Workflow: parallel(7 lenses)                             → main loop writes findings.md
phase 3   Workflow: parallel(3 architects) → parallel(3 judges) → 1 synthesizer  → target.md
          ── STOP AND READ. Nothing on disk has changed but the docs. ──
phase 4   Workflow: pipeline(moves, refute×3)                      → surviving moves + deferrals
phase 5   per move:  Workflow: pipeline([move], surgeon, verify)
          ── serial, main loop, never an agent ──
          revert must_revert
          codesys-pipe.ps1 down ; dotnet build Volt.Cli.sln -c Release
          dotnet test Volt.Engine.Tests + Volt.Cli.Tests + Volt.Cli.Connector.Tests
          append to ledger.md ; commit `refactor(cli): <move>`
```

- **Phase 3 is a hard checkpoint with the user.** Phases 1–4 are pure analysis; the whole target gets read
  before a single file moves. This is the cheapest possible place to discover the target is wrong.
- **Moves execute serially, not in parallel.** The audit could partition by file because every fix was local; a
  *move* by definition touches two places, and two concurrent moves can want the same file. Serial execution is
  the concurrency safety property here, and it is also what makes each commit independently revertable.
- **`isolation: 'worktree'` is not used.** Same reason as the audit: merging worktrees of a shared C# solution is
  strictly worse than never conflicting.
- **The docs are written by the main loop**, from schema-forced JSON. N agents appending to one markdown file
  concurrently corrupts it.
- **e2e checkpoints:** the pre-change baseline (before phase 5 starts, non-negotiable), after the last move that
  touches `Volt.Engine`, and at close-out. Unit suites run offline against a fake; only e2e proves round-trip
  fidelity against a real project on a real IDE.

## Decisions

- **Analysis is fully separated from execution, by phase.** Phases 1–4 cannot write source. This is what makes
  the stop-and-read checkpoint real rather than aspirational.
- **Candidates are compared, never iterated.** Three biased architects + judges, because the first plausible
  architecture is the one you are least able to argue against once you have written it.
- **A move that cannot land alone is not a move.** It is decomposed until it can, or it is deferred. There is no
  "temporarily red" state in this change.
- **Behavior fixes are out of scope, including ones we already know about.** They are named in the surgeon's
  prompt as known defects to report and step around, exactly as the audit did.
- **Tests are the oracle and may not be edited to pass.** The only permitted test edit is a *mechanical* move
  following a type it covers, recorded as such in `ledger.md`. `FakeIde`'s false invariant is the exception the
  rule anticipates: fixing it is fixing a *design* defect, and it must make a suite go red-then-green, not
  green-throughout.
- **`ponytail:` comments are decisions, not debris.** A move may not silently delete one; it must carry it or
  explain its retirement.
- **Doc drift is a finding.** `ARCHITECTURE.md` and `CLAUDE.md` are the stated source of truth for these
  invariants, so a stale one is a real defect and is fixed with the move that stales it.
- **Stop-anywhere.** Every move is its own commit; the ledger stays coherent if this stops after move 3.

## Risks / Trade-offs

- **The likeliest failure is re-adding indirection the audit just removed.** An architecture phase is
  *structurally biased toward adding structure* — that is what it is for. Countermeasures: the delete-first
  architect is a full peer candidate, LOC delta is on the judges' rubric, and "does this need to exist at all"
  is the first question in the abstraction-fit lens. **A target that is net-additive in LOC needs an explicit
  justification in `target.md`, not a shrug.**
- **A move that is *individually* green and *collectively* wrong.** Serial gating catches regressions, not
  incoherence. Mitigated by the target being agreed whole at phase 3, and by `target.md` recording the intended
  end state so drift mid-migration is visible.
- **Agents "unifying" load-bearing weirdness.** Still the single most likely regression, now with a bigger
  blast radius than in the audit (a move can relocate the weirdness rather than just delete it). Named in the
  architects' constraints, on the skeptics' checklist, and on the verifier's.
- **Deleting a path only reflection reaches.** The map's `hidden_edges` column exists for this; the live e2e run
  is the only real check, which is why the CODESYS host moves (if any) sit before an e2e checkpoint.
- **Cost.** ~100 subagents. Phases 1–4 are ~35 of them and produce the docs that make the rest optional.
- **What this cannot see.** A missing *capability* (an item kind never round-tripped, an excluded-from-build
  blind spot) is not a shape defect. Those belong to the corpus/e2e programme, not here.
