## Why

On a large project, `volt init` / `volt pull` shows a progress toast that **fills to 100% in seconds, then sits
frozen for minutes** — it looks hung. It's not: the CLI simply stops reporting once the bridge fetch returns, and
on a big project the *local* half of the work (materialize → write files → git) dwarfs the fetch.

**Measured** (`Pro2193-94-95-96_COdesys`, 8104 files, warm signature cache), `volt init` with `VOLT_PROGRESS_JSON=1`:

| Moment | Time | Frame |
|---|---|---|
| First fetch frame | 0.0 s | `fetch 0/8122` |
| **Last progress frame** | **10.6 s** | `fetch 8122/8122` |
| **Process exits** | **272 s** | `pulled 8104 files` |

So **~261 s (96 % of the wall-clock) has no progress at all**, and the bar is pinned at 100 % the whole time.

### Root cause

`Commands.Init` / `Commands.Pull` pass `onProgress` **only** to the bridge call (`bridge.Init` / `FetchChanges`).
Everything after the fetch returns is silent:

- `Materialize.MaterializeItem` over every changed item (PLCopen→text, FBD/LD→VG) — CPU, 8104 items
- `IdeTree.BuildVoltIdeTree` + `CommitVoltIde` — git-hash + commit 8104 files
- `Files.WriteSrcFiles` — write 8104 files to disk
- `Git.ReadTreeToIndex` — populate the index

Then the shell's post-init refresh runs `volt status` → a full **`refs`** walk (~7 s), also unlabeled — a second
unexplained pause after the toast has already "finished".

### Not a regression, and not the signatures

The streaming chain is intact (bridge frames → `VOLT_PROGRESS` on stderr → volt-control `runVolt` line-parse →
VS Code `progressBridge`). The fetch `total` is **8122** = 880 project items **+ 7224 library signatures**, so the
counter is honest *during* the fetch — the signatures are not the cause of the pause. It "worked before" only
because on a small project the untracked tail was seconds, not minutes. Library signatures made the *fetch*
heavier and the file count made the *tail* enormous; both were always unreported, it just never mattered before.

### And the tail wasn't just unreported — it was slow for a bad reason

Profiling it (not assuming) showed the tail is **not** materialize or the disk writes — it's
`IdeTree.BuildVoltIdeTree` calling `Git.WriteBlob` (`git hash-object -w --stdin`) **once per file**: 8104 items ⇒
**8104 git subprocess spawns** ≈ the entire 227 s. So the fix is two things — report the phases *and* stop spawning
a git process per blob.

## What Changes

**1. A general multi-phase progress model in the CLI.** The CLI owns the phase sequence (the bridge only knows its
own fetch), so composition lives there, not as magic in the frontend: a small reusable `PhaseProgress` stamps each
frame with a phase label + `PhaseIndex`/`PhaseCount`. `init`/`pull` report three streamed phases (Fetching →
Hashing objects → Writing/Merging). Any future multi-phase command reuses it.

**2. Batch the blob hashing.** `Git.WriteBlobs` hashes all N blobs in ONE `git hash-object --stdin-paths` process
instead of one per file — byte-identical objects (regression-tested), init measured **237 s → 81 s**.

**3. One monotonic bar in the frontends.** `formatProgress` folds `(phaseIndex + done/total) / phaseCount` into a
single 0–100 that never resets (VS Code's `withProgress` can only add increments); the phase is the label.
`progressBridge` needs no change. Single-phase frames (push/build) keep the raw 0–100.

## Non-goals

- The remaining ~55 s `git hash-object` hold (it still opens 8104 files) — the `fast-import` follow-up in
  `tasks.md §5`, deliberately its own change (it rewrites the correctness-critical merge baseline).
- Labeling the post-op `volt status`/`refs` refresh — deferred; the refresh isn't inside the progress notification.
- Any change to the pipe wire's `refs`/`fetch` data contract (only additive `phaseIndex`/`phaseCount` on frames).
