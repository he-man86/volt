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

## What Changes

**1. Report the local tail.** Emit `ProgressFrame`s from `Commands.Init` / `Commands.Pull` for the materialize +
write phase — the work is fully countable (the changed-item list is in hand). Use the existing `ProgressFrame.Phase`
field so the stream carries distinct phases: `fetch` → `writing` (done/total over the file list) → `finalizing`
(git commit/index, indeterminate).

**2. Label the post-op status refresh.** The shell's follow-up `volt status`/`refs` after init/pull should surface
as a labeled phase ("Refreshing status…") or an indeterminate spinner, not a dead toast at 100 %.

**3. Render phases in the frontends.** `formatProgress` (volt-control) and `progressBridge` (VS Code) currently
assume one monotonic 0→100 %. Make them phase-aware: reset the running % on a phase change and show the phase
label as the message, or map phases into bands (e.g. fetch 0–50 %, writing 50–95 %, finalizing 95–100 %).

## Non-goals

- Speeding up materialize/write/git itself — that's separate perf work; this change is only about *visibility*.
- Any change to the pipe wire or the `refs`/`fetch` data contract.
