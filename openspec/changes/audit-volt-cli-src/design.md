## Context

118 source files, ~15,150 LOC, 7 projects. A single agent cannot hold that line-by-line, and a single agent
that *both* proposes and applies a fix will rationalize its own proposal — the failure mode is a plausible
refactor that quietly drops an edge case in code that writes to someone's live PLC.

So the unit of work is **one cohesive file group (≤ ~700 LOC)**, and it passes through **three agents with
different jobs and different powers**. The orchestration is the `Workflow` tool: a `pipeline()` per batch, so
group B is being fixed while group C is still under review — no barrier between stages.

## Goals / Non-Goals

**Goals:**
- Every source line in `packages/volt-cli/src` is *read by an agent whose only job is to find what's wrong with
  it* — not skimmed on the way to an edit.
- Legacy patterns (the half-migrated shapes left by the HTTP→pipe and snapshot→git rewrites) are found and
  removed, and the conventions that replace them are written down once.
- Every fix is behavior-preserving, and that claim is **checked by something other than the agent that made it**.
- The audit leaves a record: `ledger.md` (per file: found / fixed / skipped / LOC before→after / verdict) and
  `arch-notes.md` (what we saw and deliberately did not do).

**Non-Goals:**
- No behavior change. Not one. Anything behavior-changing is a note, not a commit.
- No architectural restructuring in this change — no moved seams, no new abstractions, no split projects.
  `arch-notes.md` is where those go, as future proposals with evidence.
- No new dependencies, no new analyzers/formatters wired into CI (a separate, easy change if the audit shows
  a rule worth mechanizing).
- Not the TS packages. `volt-cli` first, precisely because it is the riskiest.

## The three roles

| | Auditor | Surgeon | Verifier |
|---|---|---|---|
| **Powers** | read-only | writes **only its own group's files** | read-only |
| **Sees** | the files + their callers + `ARCHITECTURE.md` | the files + the auditor's findings | **the `git diff` only** + the findings |
| **Job** | find everything wrong | apply the safe subset | try to **refute** the diff |
| **Output** | findings[] (schema-forced) | applied[] / skipped[] + LOC before→after | verdict + `must_revert[]` |

**1. Auditor** — reads its group line by line, plus every call site of what the group exports (so it can tell a
live path from a fossil). Emits, per finding: `file`, `line`, `kind`
(`bug | legacy | inconsistency | dead-code | defensive-fallback | doc-drift | style`), `claim`, `evidence`
(quoted code, not a summary), `fix`, `behavior` (`preserving | changing`), `scope`
(`local | cross-file | arch`). It never edits, so it has no incentive to prefer findings that are easy to fix.

**2. Surgeon** — applies only findings with `behavior: preserving` **and** `scope: local | cross-file` where
every touched file is inside its own group. Everything else it records as skipped with a reason. It does **not**
run `dotnet build` (concurrent builds fight over `obj/bin`), and it does not touch tests — a refactor that needs
a test edited to stay green is a behavior change wearing a costume, and gets escalated instead.

**3. Verifier (adversarial)** — reads the diff for that group and defaults to *reject*. Its checklist is
concrete, not vibes:
- does any observable behavior change — wire bytes, error code, git object SHA, file layout, exit code, log line
  another component parses?
- did a `try/catch`, null guard, or ordering constraint at a trust boundary disappear "for cleanliness"?
- did it "unify" a **load-bearing CODESYS↔Beckhoff asymmetry** (`ARCHITECTURE.md` §"Load-bearing asymmetries":
  hosting model, in-memory vs file-based PlcOpen transport, `TcPouReader` having no counterpart, **Beckhoff's
  per-node `try/catch` in the tree walk**)?
- did it break the **item-name-is-identity** invariant (e.g. by adding a duplicate-name guard that throws)?
- did it add a defensive default / `?? guess` instead of failing loud?
- is a "dead" deletion actually dead — including reflection, `dynamic`, and IronPython entry points that no
  static search finds?

`must_revert[]` is authoritative: I revert those hunks before the gate runs. A group whose verifier rejects
wholesale is reverted entirely and re-queued with the objection appended to the auditor's prompt.

### Why not two agents, or one

The auditor/surgeon split exists so findings are chosen for *value*, not for *ease of edit*. The verifier exists
because the surgeon cannot see its own blind spot — and because it reads **only the diff**, it judges what
actually changed rather than what was intended. Redundant N-way voting is not used: a wrong verdict here is
caught by the build + test + live-CODESYS gate, so one adversarial reader plus a real gate beats three
opinions.

## Orchestration

```
per batch (a project, or a slice of Volt.Engine):
  Workflow: pipeline(groups, audit, surgeon, verify)        ← ≤4 groups = ≤12 agents per workflow
  ── serial, run by the main loop, never by an agent ──
  revert every must_revert hunk
  dotnet build Volt.Cli.sln -c Release                      (all TFMs: net48 / net8 / net8-windows)
  dotnet test test/Volt.Engine.Tests/  +  test/Volt.Cli.Tests/
  append the batch to ledger.md + arch-notes.md
  commit (one commit per batch: `refactor(cli): audit <project>`)
```

**Partitioning is the concurrency safety property.** Every file has exactly one owning group, so two surgeons
can never touch one file. That is why `isolation: 'worktree'` is *not* used: merging 7 worktrees of a shared C#
solution is strictly worse than never conflicting in the first place.

**The ledger is written by the main loop, not by agents.** Agents return schema-forced JSON; N agents appending
to one markdown file concurrently corrupts it.

**Order is bottom-up by dependency** — `Transport` → `Engine` → IDE hosts → `Cli` → `Connector.Core` →
`Connector` — so a lower layer is settled before its callers are audited, and a caller-side finding lands
against final code.

**e2e checkpoints.** `bun test test/e2e` against headless CODESYS (`pwsh scripts/codesys-pipe.ps1 up`, then
`VOLT_PIPE=…`) runs (a) after the `Volt.Engine` batches, so a wire/round-trip regression is localized to ~7k
LOC, and (b) at the very end. The unit suites don't drive a live IDE; only e2e proves round-trip fidelity
against a real project.

## Decisions

- **Behavior-preserving only, enforced by role, not by discipline.** The surgeon *cannot* ship a behavior change
  because the auditor classifies before it acts, and the verifier re-checks after. This is the single decision
  the whole design serves.
- **Gates are real commands, not agent claims.** No batch is "done" on an agent's say-so. `dotnet build` +
  both test suites, run serially by the main loop.
- **A test that must change to stay green = escalate, don't edit.** Tests are the oracle; a refactor that
  rewrites its own oracle is not verified. (Adding a *new* test for a bug found is welcome and separate.)
- **`ponytail:` comments are honored, not cleaned up.** A marked simplification is a recorded decision; the
  auditor may add one, never silently remove one.
- **Doc drift found in `ARCHITECTURE.md` / `CLAUDE.md` is a finding**, fixed with the batch (docs are the stated
  source of truth for invariants, so a stale invariant is a real defect).
- **Stop-anywhere.** Batches are independently committed and independently valuable; the ledger stays coherent
  if this stops after batch 3.

## Risks / Trade-offs

- **The audit itself is the risk.** 15k LOC of edits to the code that writes to a live PLC. Mitigated by
  behavior-preserving-only + exclusive ownership + adversarial verify + build/test/e2e gates, and by ordering
  batches so the highest-value code (`Volt.Engine`) is audited while attention is freshest and re-verified by a
  mid-point e2e run.
- **Agents "improving" load-bearing weirdness.** The most likely single failure: stripping Beckhoff's per-node
  `try/catch` for symmetry with CODESYS. It is on the verifier's checklist by name, and in the auditor's prompt.
- **Cost.** ~108 subagents over 12 workflows. Batches are the natural stopping points if the value/LOC ratio
  drops.
- **Findings the audit can't see.** A missing capability (an item kind never round-tripped, an excluded-from-
  build blind spot) is not a file-level defect; those belong to the corpus/e2e workflows, not here.
