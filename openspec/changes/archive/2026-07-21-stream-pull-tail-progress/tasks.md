Make the pull/init progress cover the whole operation, not just the bridge fetch — and fix the actual slowness
found underneath it (per-file `git hash-object`). Investigation notes and a follow-up are at the bottom.

## 1. CLI — a general multi-phase progress model — DONE
- [x] `PhaseProgress` (`packages/volt-cli/src/Volt.Cli/Sync/PhaseProgress.cs`): the CLI owns the phase sequence
      (the bridge only knows its own fetch), so composition lives here. Stamps each frame with the phase label +
      `PhaseIndex`/`PhaseCount`; `Wrap(i, label)` re-tags a sub-op's frames (the bridge fetch), `Report`/`Enter`
      drive CLI-side loops. Reusable by any multi-phase command.
- [x] `ProgressFrame` gains `PhaseIndex`/`PhaseCount` (null on a single-phase op — bare fetch/push/build).
- [x] `Commands.Init` reports three streamed phases — **Fetching** (bridge) → **Hashing objects**
      (`BuildVoltIdeTree` blob write) → **Writing files** (`WriteSrcFiles`). Materialize is negligible (fast
      in-memory transform), so it gets no phase.
- [x] `Commands.Pull` mirrors it — **Fetching** → **Hashing objects** → **Merging** (git checks out the merged
      tree; indeterminate, but beats a bar frozen at 100 %).
- [x] `ProgressFrame.Phase`/index flow through `Reporter` unchanged (it serializes them); human CLI still shows
      real per-phase counts.

## 2. The real bottleneck — batch the blob hashing — DONE
- [x] Profiling the tail showed it was **not** materialize/write — it was `IdeTree.BuildVoltIdeTree` calling
      `Git.WriteBlob` (`git hash-object -w --stdin`) **once per file**: 8104 items ⇒ 8104 git processes ≈ the whole
      227 s tail (`BuildTree` was already batched).
- [x] `Git.WriteBlobs` — one `git hash-object --no-filters --stdin-paths` process for all N blobs; byte-identical
      objects (regression test `WriteBlobs_batch_matches_per_file_WriteBlob`, incl. CRLF + empty cases).
      Measured init 237 s → **81 s**. 91 CLI + 277 engine tests stay green (git identity preserved).

## 3. Shells — phase-aware rendering — DONE
- [x] `formatProgress` (`volt-control`): fold `(phaseIndex + done/total) / phaseCount` into one MONOTONIC 0–100 bar
      (a per-phase reset would freeze VS Code's increment bar at 100 %); message = the phase label. Single-phase
      frames keep the raw 0–100. One mapping, both shells.
- [x] `progressBridge` (`volt-vscode`): unchanged — the overall pct is monotonic, so its increments stay ≥ 0.
- [x] `ProgressUpdate` (`volt-control/bridge/cli.ts`) gains `phaseIndex`/`phaseCount`.

## 4. Verify — DONE
- [x] `VOLT_PROGRESS_JSON=1` init on the 8104-file project: 976 frames stream across Fetching → Hashing → Writing
      up to ~81 s (was 326 frames stopping at 10.6 s). `bun typecheck` (control + vscode) + CLI/engine tests green.

## 5. Follow-up (NOT in this change) — kill the remaining ~55 s `git hash-object` hold
- [ ] Even batched, `git hash-object --stdin-paths` still **opens + reads 8104 files** (temp-file I/O + Windows AV
      ≈ 55 s), and it emits no progress — so the bar holds mid-"Hashing objects". The proper fix is `git
      fast-import` for the init commit: stream blob content **inline** (no per-file opens) + build the tree/commit
      in one process, ticking progress per blob. That rewrites the volt/ide commit construction (the
      correctness-critical merge baseline), so it wants its own focused change + validation — deliberately out of
      scope here.
