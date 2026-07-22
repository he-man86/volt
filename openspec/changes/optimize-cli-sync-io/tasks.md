Grounding (verify still true when picking this up):
- `Git.WriteBlobs` (`src/Volt.Cli/Sync/Git.cs:87`) writes every content to a temp file then
  `hash-object -w --no-filters --stdin-paths`. `Files.WriteSrcFiles` (`Files.cs:23`) writes the same content to
  `src/`. `init`/`pull` both stage blobs via `IdeTree.BuildVoltIdeTree` (`IdeTree.cs:41`); `push` reads objects
  via `GitShowBytes` (out of scope).
- Byte-identity is load-bearing: `--no-filters` means the blob == raw UTF-8 bytes. Any new writer MUST match.
- The dotnet SDK path gotcha applies — build/test via `C:\Program Files\dotnet\dotnet.exe`.

## 1. Stream-based object writer (byte-identity gate first)

- [ ] 1.1 Add a `WriteBlobsStreaming` (or similar) to `Git.cs` using `git fast-import` — one process, a
      `blob`/`mark :n`/`data <n>` record per content over stdin, raw bytes (no filters), returning SHAs by mark.
      Handle the empty set (no-op) and a single item.
- [ ] 1.2 GOLDEN GATE: a `GitTests` case asserting `WriteBlobsStreaming(contents)` returns SHAs **identical** to
      the existing `WriteBlobs(contents)` across a representative set (ASCII, UTF-8 multibyte, empty file, large
      file, a binary/opaque blob). Red before the writer is correct, green after.
- [ ] 1.3 Keep the old `WriteBlobs` in place (fallback) until step 3 — do not delete yet.

## 2. Route init + pull through it

- [ ] 2.1 Point `IdeTree.BuildVoltIdeTree` at the streaming writer for the changed-content blob step; leave the
      `ListTree(parentIde)` + `ListTree(HEAD)` composition and `write-tree` unchanged.
- [ ] 2.2 `IdeTreeTests`: assert `BuildVoltIdeTree` yields an **identical tree SHA** to the pre-change path for
      the same inputs (init: `parentIde=null`; pull: with `parentIde` + removed set).
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
