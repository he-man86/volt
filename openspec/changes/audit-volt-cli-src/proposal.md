## Why

`packages/volt-cli/src` is **118 source files / ~15,150 LOC of C#** (the 52 other `.cs` under `obj/` are
generated) and it did not grow linearly. It is the sediment of four structural moves:

- the fork extraction that re-rooted this repo as standalone Volt,
- the absorption of the former `volt-bridge` + `volt-git` into one solution,
- the **HTTP wire → named pipes** rewrite,
- the `.volt/` snapshot → **git-native `refs/remotes/volt/ide`** rewrite.

Each move left the *behavior* correct and the *shape* half-migrated: two ways to do the same thing, a helper
that only the deleted path used, a defensive `?? fallback` that predates the field becoming required, an
exception swallowed by a layer that no longer owns the error. None of that shows up in a test run — the suites
are green — and none of it is visible from any single file. It is visible **line by line**, which is why this
change is an audit and not a refactor sprint.

This is the highest-leverage code in the product: `Volt.Engine` decides what bytes reach the user's git repo
and what bytes reach their live PLC. A latent bug here is data loss in someone's plant, not a 500.

## What Changes

A **file-by-file, line-by-line audit of every source file** in `packages/volt-cli/src`, executed as 36
review→implement→verify units across 12 batches in dependency order (Transport → Engine → IDE hosts → CLI → Connector), each
gated by a real build + test run. Driven by the `Workflow` tool: a three-role agent pipeline per file group
(auditor / surgeon / adversarial verifier), described in `design.md`.

The change is **behavior-preserving by construction**:

- Anything the auditor marks behavior-changing is **NOT implemented** — it is written to `arch-notes.md` and
  becomes its own proposal. This change ships zero intentional behavior deltas.
- The pipe wire stays byte-identical (the parity boundary), git object SHAs stay identical, and the
  **load-bearing CODESYS↔Beckhoff asymmetries `ARCHITECTURE.md` forbids unifying** are protected by the
  verifier's explicit checklist.
- Gates per unit: `dotnet build` + `Volt.Cli.Tests` + `Volt.Engine.Tests`. Gate per batch: the same, clean.
  Final gate: `bun test test/e2e` against **headless CODESYS** (`codesys-pipe.ps1`), plus a mid-point e2e run
  after the `Volt.Engine` batches so a regression is localized to ~7k LOC instead of 15k.

Two working docs live in this change dir and are the deliverable alongside the diff:

- **`ledger.md`** — one row per file: issues found, issues fixed, issues deliberately skipped (with reason),
  LOC before → LOC after, verifier verdict.
- **`arch-notes.md`** — architectural improvements observed but *not* taken, each with enough evidence to
  become a follow-up change.

## Capabilities

### New Capabilities

- `cli-source-quality`: the conventions `packages/volt-cli/src` conforms to, the behavior-parity contract a
  refactor of it must satisfy, and the requirement that the audit is recorded rather than implicit.

## Impact

- **Code:** every file under `packages/volt-cli/src` is read; a subset is edited. No public wire, CLI surface,
  file layout or git model change.
- **Docs:** the conventions the audit settles on land in `packages/volt-cli/ARCHITECTURE.md` (a short
  "Conventions" section) so the next contributor inherits them instead of re-deriving them.
- **Cost:** ~108 subagents across 12 workflows. This is the price of line-by-line on 15k LOC; batches are
  independently valuable, so it can stop after any batch with the ledger still coherent.
- **Risk:** the audit *touching* high-value code is the risk, not the audit finding nothing. Mitigated by
  behavior-preserving-only edits, one exclusive owner per file, an adversarial verify pass, and a real build +
  test + live-CODESYS gate rather than an agent's opinion that it looks fine.
