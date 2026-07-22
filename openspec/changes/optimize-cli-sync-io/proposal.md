## Why

`volt init`/`pull` write every file's content to disk **more times than necessary**. `Git.WriteBlobs`
(`Git.cs:87`) stages ALL fetched content to **temp files** purely to feed `git hash-object --stdin-paths`,
then `Files.WriteSrcFiles` writes the **same content again** to `src/`. On an 8k-item init the fetched bytes
hit disk three times — temp file, git object, working-tree file (~24k writes) — and the temp pass is pure
overhead. This is the "batch blob hashing (237s→81s)" path; the remaining temp staging is the next bottleneck,
and it also surfaces as the perceived progress freeze while the silent tree-build runs.

## What Changes

- Replace `Git.WriteBlobs`'s **temp-file staging** with a stream-based object writer (`git fast-import`, or
  hash-object over already-written `src/` paths) so fetched content becomes git objects **without a throwaway
  temp copy**. One content→object write, from memory/stream, not memory→temp→object.
- Apply across **every command that stages blobs** — `init` (biggest win: full project) and `pull` (incremental
  changed-set), both via `IdeTree.BuildVoltIdeTree`. `push` is unaffected (it reads existing git objects via
  `GitShowBytes`); `status`/`build`/`show`/`merge` do no bulk blob staging.
- For `init` specifically, evaluate fusing the working-tree write + index population so `ReadTreeToIndex` isn't a
  separate third pass, while keeping `pull`'s compositional `volt/ide` tree (changed + `parentIde` + `HEAD`
  scaffold) — which is a synthetic tree, NOT the working tree, so it can't be replaced by `git add`.
- **Behavior-preserving:** git object SHAs and round-trip content stay **byte-identical** (`--no-filters`
  semantics preserved). No wire, bridge, or command-surface change — only how bytes reach git.

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
