Grounding (verify still true when picking this up):
- `Git.WriteBlobs` (`src/Volt.Cli/Sync/Git.cs:87`) writes every content to a temp file then
  `hash-object -w --no-filters --stdin-paths`. `Files.WriteSrcFiles` (`Files.cs:23`) writes the same content to
  `src/`. `init`/`pull` both stage blobs via `IdeTree.BuildVoltIdeTree` (`IdeTree.cs:41`); `push` reads objects
  via `GitShowBytes` (out of scope).
- Byte-identity is load-bearing: `--no-filters` means the blob == raw UTF-8 bytes. Any new writer MUST match.
- The dotnet SDK path gotcha applies — build/test via `C:\Program Files\dotnet\dotnet.exe`.

## 1. `fast-import` commit writer (byte-identity gate first)

- [ ] 1.1 Add a `Git.CommitViaFastImport` (or similar) that drives `git fast-import`: one `commit <ref>` with
      `M <mode> inline <path>` + `data <n>` raw bytes for changed items, `M <mode> <sha> <path>` for
      unchanged/scaffold, and returns the commit SHA (via the commit mark / `get-marks`). Emit `done`; handle the
      empty set and a single item cleanly.
- [ ] 1.2 GOLDEN GATE: a `GitTests` case asserting the `fast-import` path yields the **same tree + commit SHAs**
      as the current `WriteBlobs` + `update-index` + `write-tree` + `commit-tree`. Reuse the already-baselined
      edge cases — the content set in `WriteBlobs_batch_matches_per_file_WriteBlob` (empty, CRLF, UTF-8 multibyte,
      no-trailing-newline, empty set) and `IdeTreeTests.Paths_with_spaces_round_trip_into_the_tree` — plus an
      unchanged-by-SHA entry and a single-item set. Red first. (Content is a `string`; no binary case.)
- [ ] 1.3 Keep the old `WriteBlobs`/`BuildTree`/`CommitVoltIde` path in place (fallback) until step 3.

## 2. Route init + pull through it

- [ ] 2.1 Rework `BuildVoltIdeTree`/`CommitVoltIde` (or a new `BuildAndCommitVoltIde`) to compute the same
      changed / unchanged-by-SHA / scaffold-by-SHA entry sets and feed them to the `fast-import` writer instead
      of temp-hashing + `write-tree` + `commit-tree`. Composition logic (which files) is unchanged.
- [ ] 2.2 `IdeTreeTests`: assert the produced **tree + commit SHAs are identical** to the pre-change path for the
      same inputs (init: `parentIde=null`; pull: with `parentIde` + removed set).
- [ ] 2.3 `InitCommandTests` + `PullCommandTests` stay green (behavior + resulting refs unchanged).

## 3. Prove fidelity end-to-end, then delete the temp path

- [ ] 3.1 Run `bun test test/e2e` (`crud-cycle`, `graphical/roundtrip`) against a live bridge on BOTH CODESYS and
      TwinCAT — round-trip is byte-identical. (Needs a live bridge; can't run headless — see the e2e note.)
- [ ] 3.2 Delete the temp-staging `WriteBlobs` once 1.2 + 2.2 + 3.1 are green; the streaming writer is the only
      path.

## 4. Measure + decide the index-fusion follow-up

- [ ] 4.1 Measure `init` before/after on the largest available CS project: wall-clock + content-to-disk write
      count. Record in the change log (target: 3× → 2× writes).
- [ ] 4.2 With D1 landed, measure whether `Git.ReadTreeToIndex` (init's third pass) is a material cost. If yes,
      task a follow-up to fuse working-tree write + index population (keeping the 3-way status-clean invariant);
      if not, `log()` that it was scoped out and leave it.

## 5. Close the loop

- [ ] 5.1 Confirm the perceived progress freeze is gone: with the silent-git-step labels already added
      (`Building tree`/`Finalizing`) plus fewer/faster steps, the bar advances with a live message end-to-end.
- [ ] 5.2 Update `packages/volt-cli/ARCHITECTURE.md` if the sync data-path description references the temp-staging
      behavior; keep it accurate to the streaming writer.
