## Status: IMPLEMENTED (C# gates green); e2e live-bridge gate is the only step left (user side).

**Perf result (this Windows machine, 8000 items):** the blob+tree build dropped from **45.3 s → 0.25 s
(~178×)**, byte-identical output. The 8000 temp-file writes are gone; magnitude is inflated by Windows temp
I/O + Defender, but eliminating the temp pass is universal. Content-to-disk on init is now 2× (object + `src/`),
down from 3× (temp + object + `src/`).

Grounding:
- The old `Git.WriteBlobs` wrote every content to a temp file for `hash-object --stdin-paths`. Byte-identity is
  load-bearing (`--no-filters` = raw UTF-8 bytes). Build/test via `C:\Program Files\dotnet\dotnet.exe`.

## 1. `fast-import` tree writer (byte-identity gate first)  ✅

- [x] 1.1 `Git.WriteTreeViaFastImport` drives ONE `git fast-import` stream: `M <mode> inline <path>` + `data <n>`
      raw bytes for changed items, `M <mode> <sha> <path>` for unchanged/scaffold, returns the tree SHA (via a
      throwaway commit whose identity is irrelevant). Empty set → the canonical empty tree. `StreamPath` leaves
      normal paths (incl. spaces + UTF-8) verbatim, C-quotes only a leading `"` / embedded newline.
      DECISION: build the TREE via fast-import and keep the deterministic `CommitTree` for the commit — lowest
      risk (the commit-object format is untouched); the commit is one cheap object.
- [x] 1.2 GOLDEN GATE: `GitTests.FastImport_tree_matches_WriteBlobs_plus_BuildTree` asserts the fast-import tree
      SHA == `WriteBlobs` + `BuildTree` across every edge case (empty, CRLF, UTF-8 multibyte, no-trailing-newline,
      spaced path, unchanged-by-SHA) + empty set. Green.
- [x] 1.3 `WriteBlobs`/`BuildTree` kept as the golden reference (and until the e2e gate); no longer used in prod.

## 2. Route init + pull through it  ✅

- [x] 2.1 `BuildVoltIdeTree` reworked: same changed / unchanged-by-SHA / scaffold-by-SHA composition + `seen`
      de-dup, now fed to `WriteTreeViaFastImport` (changed = inline, rest = by SHA). The `onTreeBuild` hook is
      gone — fast-import fuses blobs+tree, so the silent `BuildTree` gap it labelled no longer exists.
- [x] 2.2 `IdeTreeTests` (composition/content correctness) + the tree-SHA golden gate cover byte-identity for
      init (`parentIde=null`) and pull (`parentIde` + removed). Green.
- [x] 2.3 `InitCommandTests` + `PullCommandTests` green (19/19 in the sync + plumbing suite).

## 3. Prove fidelity end-to-end, then delete the temp path

- [ ] 3.1 Run `bun test test/e2e` (`crud-cycle`, `graphical/roundtrip`) against a live bridge on BOTH CODESYS and
      TwinCAT — round-trip byte-identical. (Needs a live bridge; can't run headless — USER side.)
- [ ] 3.2 Delete `WriteBlobs`/`BuildTree` (+ their tests) once 3.1 is green; `WriteTreeViaFastImport` is the only
      path.

## 4b. Push: batch the per-file blob read (the read-side mirror of init)

Push detects changes with one `git diff` (`DiffRefs`) but then reads each changed file with a separate
`GitShowBytes(HEAD, …)` — one `git show` spawn PER file (`HeadSrc` in `SetForChange`/rename). For a large or
`--force` push that's the same N-spawn cost init had. Batch it, git-native.

- [ ] 4b.1 Add `Git.ReadBlobsBatch(root, specs)` driving ONE `git cat-file --batch` (feed `HEAD:src/<path>` per
      changed file, parse the size-prefixed responses byte-exactly). Needs a byte-level `Run` variant — `cat-file
      --batch` output interleaves ASCII headers with raw content; don't UTF-8-decode the framing.
- [ ] 4b.2 Route push's `HeadSrc` through it (pre-read all changed/renamed paths once, look up per op).
- [ ] 4b.3 MUST read the BLOB, not the working tree — `.gitattributes` (`* text=auto eol=lf`) eol-smudges the
      worktree file, so `File.ReadAllBytes(src/…)` could diverge from what push must send. Gate: a `GitTests`
      case asserting batch-read bytes == `GitShowBytes` per file, incl. a CRLF blob.
- [ ] 4b.4 `PushCommandTests` stay green; situational win (small pushes are already fine — measure a large one).

## 4. Measure + decide the index-fusion follow-up

- [x] 4.1 Measured — see the perf result above (45.3 s → 0.25 s, ~178×).
- [ ] 4.2 `Git.ReadTreeToIndex` (init's third pass) is now the only remaining silent step; not yet measured in
      isolation. Defer the working-tree-write + index-population fusion until measurement shows it's material.

## 5. Close the loop  ✅ (docs pending only)

- [x] 5.1 Progress reworked: init 5→4 phases, pull 4→3 (the "Building tree" phase is obsolete — fast-import has no
      silent tree-build). `Finalizing` (init `read-tree`) and `Merging` (pull) remain the only indeterminate
      steps. `progress.ts` now LEADS the message with the live count (`1234/8000 · Importing objects`), per the
      preference for a file number over the bar.
- [x] 5.2 `ARCHITECTURE.md` does not describe the temp-staging — no update needed.
