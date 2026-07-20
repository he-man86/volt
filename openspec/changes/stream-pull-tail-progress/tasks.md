Make the pull/init progress cover the whole operation, not just the bridge fetch. The data path is unchanged —
this is purely progress *reporting* threaded through the local tail plus phase-aware rendering in the two shells.

## 1. CLI — report the local tail
- [ ] `Commands.Init` (`packages/volt-cli/src/Volt.Cli/Sync/Commands.cs`): after `bridge.Init`, emit `writing`
      phase frames while materializing + writing — `done/total` over the changed-item list. Wrap
      `MaterializeItem`/`WriteSrcFiles` so each item (or a 25-item bucket, matching `ProjectSnapshot`) ticks a frame.
- [ ] Emit a `finalizing` phase (indeterminate: `Total = null`) around `BuildVoltIdeTree`/`CommitVoltIde`/
      `ReadTreeToIndex` so the git step reads as active, not hung.
- [ ] Do the same in `Commands.Pull` (fetch → materialize/merge → finalize), so `pull` matches `init`.
- [ ] Confirm `ProgressFrame.Phase` flows through `Reporter` (it serializes `phase` already) — no reporter change
      expected; add a test that a multi-phase op emits `fetch` then `writing` frames.

## 2. Shells — phase-aware rendering
- [ ] `formatProgress` (`packages/volt-control/src/view/progress.ts`): key the % off the current phase (reset or
      band per phase) and use the phase as the message label ("Fetching…", "Writing files…", "Finalizing…").
- [ ] `progressBridge` (`packages/volt-vscode/src/commands.ts`): reset `lastPct` on a phase change so the VS Code
      increment bar doesn't stall or jump backwards across phases.
- [ ] Desktop (`volt-control` view / `volt-desktop`) uses the same `formatProgress` — verify it renders the phases
      too (one mapping, both shells).

## 3. Post-op status refresh
- [ ] After init/pull, the shell's `ensureWorkspace`/tracker refresh runs `volt status` (`refs`). Surface it as a
      labeled "Refreshing status…" step (or fold it into the same progress notification) so the trailing ~7 s walk
      isn't an unexplained pause at 100 %.

## 4. Verify
- [ ] Re-run the `VOLT_PROGRESS_JSON=1` init against a large project; confirm frames continue past the fetch
      (`writing`/`finalizing` phases) up to near process-exit — the 10 s-vs-272 s gap should close to a live bar.
- [ ] `bun test` (volt-control progress) + the CLI multi-phase test green.
