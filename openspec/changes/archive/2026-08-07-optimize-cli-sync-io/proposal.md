## Why

`volt init`/`pull` write every file's content to disk **more times than necessary**. `Git.WriteBlobs`
(`Git.cs:87`) stages ALL fetched content to **temp files** purely to feed `git hash-object --stdin-paths`,
then `Files.WriteSrcFiles` writes the **same content again** to `src/`. On an 8k-item init the fetched bytes
hit disk three times — temp file, git object, working-tree file (~24k writes) — and the temp pass is pure
overhead. This is the "batch blob hashing (237s→81s)" path; the remaining temp staging is the next bottleneck,
and it also surfaces as the perceived progress freeze while the silent tree-build runs.

## What Changes

- **Stop hand-rolling git.** `BuildVoltIdeTree` currently reproduces git's own bulk-import with four processes +
  a temp-file pass: `WriteBlobs`(temp→`hash-object`) + `update-index` + `write-tree`, then `commit-tree`. Replace
  all of it with **one `git fast-import` stream** that emits the blobs, tree, and commit together: changed items
  go **inline** (`M … inline` + `data <n>` raw bytes — no temp, no `hash-object`, no filters), unchanged/scaffold
  reference existing objects **by SHA** (from `ls-tree`, no re-hash). The entry composition is unchanged.
- Apply to **every command that spawns git per file.** Write side: `init` (biggest win) + `pull` stage blobs
  via `BuildVoltIdeTree` → `fast-import`. Read side: `push` reads each changed blob with a separate `git show`
  (`GitShowBytes`) — batch it via one `git cat-file --batch` (the read mirror; situational, large/force pushes).
  `merge` is already native (`--abort`/`--continue`/`checkout`); `status`/`build`/`show` do no bulk git.
- Content-to-disk drops from **3× to 2×** on init (temp + object + `src/` → object + `src/`), the irreducible git
  minimum. Optional follow-up: fuse `init`'s working-tree write with index population to drop the separate
  `ReadTreeToIndex` pass — measured, not assumed.
- **Behavior-preserving:** git object SHAs and round-trip content stay **byte-identical** — `fast-import` stores
  raw stream bytes (no gitattributes/CRLF filters), matching today's `--no-filters`. `git add` is explicitly
  rejected: `.gitattributes` (`* text=auto eol=lf`) would make it normalize line endings and change SHAs. No
  wire, bridge, or command-surface change — only how bytes reach git.

## Capabilities

### New Capabilities
- `cli-sync-io`: The disk-I/O contract for the sync path — fetched content is written to git objects and the
  working tree with no redundant intermediate copies, producing byte-identical objects/round-trip, verified by
  the C# git/command tests and the e2e parity suite.

### Modified Capabilities
<!-- None: no wire/command/bridge requirement changes; this is a behavior-preserving I/O optimization. -->

## Impact

- **Changed:** `src/Volt.Cli/Sync/Git.cs` (`WriteBlobs` → stream/path-based object write), `IdeTree.cs`
  (`BuildVoltIdeTree` ordering), `Commands.cs` (`Init`/`Pull` phase orchestration). Possibly `Files.cs`.
- **Verification gates:** `test/Volt.Cli.Tests` (`GitTests`, `IdeTreeTests`, `InitCommandTests`,
  `PullCommandTests`) must stay green with byte-identical SHAs; `bun test test/e2e` parity suite (`crud-cycle`,
  `graphical/roundtrip`) proves round-trip fidelity against a live bridge.
- **No change** to the pipe wire, the bridges, `push`, or the git-native `volt/ide` model.
- Measurable: init wall-clock + disk-write count drop; the progress bar reflects real work (paired with the
  silent-git-step progress labels already added).
