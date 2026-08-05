## 0. Baseline (a red baseline invalidates every verdict after it)

- [x] 0.1 `pwsh packages/volt-cli/scripts/codesys-pipe.ps1 down`, then
      `dotnet build Volt.Cli.sln -c Release` + all three suites (`Volt.Engine.Tests` 313 ·
      `Volt.Cli.Tests` 116 · `Volt.Cli.Connector.Tests` 76). Use `C:\Program Files\dotnet\dotnet.exe` — the
      `dotnet` on PATH is an x86 stub with no SDK.
- [ ] 0.2 **e2e green BEFORE anything moves** — this is the user-stated gate. `codesys-pipe.ps1 up`, wait for
      `\\.\pipe\volt.bridge.codesys.<pid>`, then `bun run test:e2e:codesys` (expect 92 pass / 0 fail) and
      `bun run test:e2e:twincat` (expect 90 pass / 0 fail, needs the connector up). Record the exact numbers at
      the top of `ledger.md`.
- [x] 0.3 Record the baseline shape in `ledger.md`: 118 files / 15,295 LOC across 7 projects
      (`Volt.Engine` 6,686 · `Volt.Cli` 2,122 · `Volt.Cli.Connector` 1,816 · `Volt.Cli.Ide.Codesys` 1,799 ·
      `Volt.Cli.Ide.Twincat` 1,311 · `Volt.Cli.Connector.Core` 1,129 · `Volt.Cli.Transport` 432), excluding
      generated `obj/`.
- [x] 0.4 Confirm the known-failing `ide-restart` recovery test is still the *only* known red, and that its
      root cause (`audit-volt-cli-src/arch-notes.md`, top entry) is on the known-defects list every agent gets.

## 1. Phase 1 — Map (read-only, ~8 agents)

- [x] 1.1 `Workflow`: `parallel(7 cartographers + 1 seam analyst)`, schema per `design.md` §Phase 1.
- [x] 1.2 Main loop merges the JSON into `map.md`: per type — responsibility, `layer_claimed` vs `layer_reached`,
      dependents, `hidden_edges`, `state`.
- [x] 1.3 Sanity-check `hidden_edges` by hand against the three known reflection surfaces (the CODESYS in-proc
      load, the IronPython entry point, string-keyed `Ops` dispatch). A map that misses these will propose
      deleting live code.

## 2. Phase 2 — Diagnose (read-only, 7 agents)

- [ ] 2.1 `Workflow`: `parallel(7 lenses)` — layering, duplication, placement, abstraction fit, state & lifetime,
      testability, contract fit.
- [ ] 2.2 Main loop writes `findings.md`, deduped, sorted by `blast_radius` then by lens.
- [ ] 2.3 Read the **testability** lens first and separately. A fake that has to lie names a misplaced seam —
      that is how the audit's most valuable finding surfaced.

## 3. Phase 3 — Design (7 agents) → **STOP**

- [ ] 3.1 `Workflow`: `parallel(3 architects)` (minimal-move / seam-first / delete-first) →
      `parallel(3 judges)` → 1 synthesizer.
- [ ] 3.2 Main loop writes `target.md`: the target shape + the ordered move list (each move: rationale, files,
      blast radius, what it closes in `findings.md`, its gate).
- [ ] 3.3 If the target is net-additive in LOC, `target.md` states why in as many words. Otherwise it is an
      architecture phase justifying its own existence.
- [ ] 3.4 **Review the whole target with the user before phase 4.** Nothing on disk has changed yet but the
      working docs; this is the cheapest place to discover the target is wrong.

## 4. Phase 4 — Refute (3 agents per move, before any code is touched)

- [ ] 4.1 `Workflow`: `pipeline(moves, refute×3)` with the `design.md` §Phase 4 checklist.
- [ ] 4.2 Drop every move ≥2 of 3 skeptics refute into `findings.md` under "Deferred", with the objection.
- [ ] 4.3 Decompose any survivor that cannot land alone and green until it can — or defer it. There is no
      temporarily-red state in this change.
- [ ] 4.4 Re-order the surviving moves bottom-up by dependency (`Transport` → `Engine` → IDE hosts → `Cli` →
      `Connector.Core` → `Connector`) so a lower layer is settled before its callers move.

## 5. Phase 5 — Execute (one move at a time)

Per-move loop — repeat for every surviving move, in order:

1. `Workflow`: `pipeline([move], surgeon, verify)`.
2. Revert every `must_revert` hunk. A wholesale `reject` → `git checkout --` the move's files and re-queue it
   with the objection appended.
3. Serial gate (main loop, never an agent): `codesys-pipe.ps1 down` → `dotnet build Volt.Cli.sln -c Release` →
   all three suites.
4. Append to `ledger.md`: move, files touched, LOC before → after, verifier verdict, gate result, and any test
   file that moved (mechanically) with a type.
5. Commit `refactor(cli): <move>`, **staging explicitly** — the TwinCAT fixtures under `test/TwinCAT Project*/`
   are rewritten whenever the IDE builds and must never be swept in by `git commit -a`.

- [ ] 5.1 Moves in `Volt.Cli.Transport`
- [ ] 5.2 Moves in `Volt.Engine`
- [ ] 5.3 **e2e checkpoint 1** — after the last `Volt.Engine` move, so a round-trip regression is localized to
      ~7k LOC instead of 15k.
- [ ] 5.4 Moves in `Volt.Cli.Ide.Codesys` / `Volt.Cli.Ide.Twincat` (both vendors checked for every move — shared
      Core, parity boundary is the wire)
- [ ] 5.5 Moves in `Volt.Cli`
- [ ] 5.6 Moves in `Volt.Cli.Connector.Core` / `Volt.Cli.Connector`
- [ ] 5.7 Any cross-project move (a type changing owner, a project boundary moving, `.csproj`/`.sln` edits) —
      last, because it is the least revertable.

## 6. Close-out

- [ ] 6.1 **e2e green AFTER, with no test edited to accommodate a move**: `bun run test:e2e:codesys` and
      `bun run test:e2e:twincat` back to the exact baseline numbers from 0.2. Any delta is a regression until
      proven otherwise.
- [ ] 6.2 Rewrite `packages/volt-cli/ARCHITECTURE.md` to describe the shape that now exists — the project map,
      the layer stack, the seams and what each earns. Keep §"Load-bearing asymmetries" and §"Conventions"; they
      were paid for in real defects.
- [ ] 6.3 Update `CLAUDE.md`'s package map if any project boundary moved.
- [ ] 6.4 Fold `map.md` into `ARCHITECTURE.md` if it earns its place there, or keep it in the change as the
      record. Do not leave two maps that can disagree.
- [ ] 6.5 Move everything still in `findings.md` under "Deferred" that is worth doing into its own proposal, and
      delete the rest. A note nobody will write up is a note that wasn't worth keeping.
