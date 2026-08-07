## Status: COMPLETE — C# gates green, both live-bridge gates green (CODESYS 52/52 + TwinCAT 90/11/0).

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

- [x] 3.1 **CODESYS: validated live** (headless via `codesys-pipe.ps1`). e2e parity **52/52** (fetch, push,
      crud-cycle, roundtrip, clear, children, kinds). Real CLI cycle against the live bridge:
        - `volt init` — **593 files in 0.83s**, `git status` **CLEAN** (fast-import tree ≡ working tree, byte-identical).
        - `volt push` (a project POU) — read via `ReadBlobsBatch`, accepted, round-trip clean.
        - `volt pull` — clean.
      (The one "modified" file on the first run was a Windows `MAX_PATH` artifact of a deep temp dir, not a
      content diff — clean in a normal-length root.)
- [x] 3.1b **TwinCAT: validated live** (XAE pid 32004, worker from a fresh repo build). e2e **90 pass / 11 skip /
      0 fail** — the recorded baseline exactly. Real CLI cycle against the live bridge:
        - `volt init` — **10 files in 0.92s**, `git status` **CLEAN** (fast-import tree ≡ working tree, byte-identical).
        - `volt push` (an edited FB) — accepted, `pull` reported `already up to date`, tree still clean.
      Confirms the golden gate's vendor-independence claim: identical content in, identical tree out.

      > Two things the manual cycle turned up, both mine, both worth writing down. Windows PowerShell 5.1's
      > `Get-Content -Raw` reads as ANSI, so a read/write round-trip DOUBLE-ENCODED every non-ASCII character in
      > the fixture and I pushed the mojibake into the live project; and `Set-Content -Encoding utf8` writes a
      > BOM. Both were reverted (the fixture is byte-identical to HEAD again). Use
      > `[System.IO.File]::ReadAllText/WriteAllText` with an explicit `UTF8Encoding $false` when scripting
      > against a live PLC project — never the PS 5.1 text cmdlets. The BOM also produced a real product
      > finding; see the note under 3.2.
- [x] 3.2 **Resolved, partly by deviation.** `WriteBlobs` — the temp-file writer that WAS the cost — is deleted;
      `WriteTreeViaFastImport` is the only production path, as intended. `BuildTree` is deliberately KEPT: it has
      no production caller, but it is (a) the differential oracle
      `GitTests.FastImport_tree_matches_hash_object_plus_BuildTree` checks fast-import against, and (b) the
      tree-builder ~10 test setups across `GitTests`/`IdeTreeTests`/`StatusModelTests` use to construct fixtures.
      Deleting it would ADD code to the tests and remove a byte-identity check that costs nothing to keep — the
      opposite of this change's point. The comment at `Git.cs` already states this role.

## 4b. Push: batch the per-file blob read (the read-side mirror of init)  ✅

- [x] 4b.1 `Git.ReadBlobsBatch` drives ONE `git cat-file --batch` — feeds `<ref>:<repoPath>` specs, reads stdout
      at the BYTE level (`BaseStream.CopyToAsync`, like `GitShowBytes`), parses the size-prefixed responses
      byte-exactly (spaces-in-path + `missing` handled). Empty set → empty.
- [x] 4b.2 Push reads all changed/renamed blobs in one call after the read-only check (so a rejected push reads
      nothing); `HeadSrc` is now a dict lookup keyed by `HEAD:src/<rel>`.
- [x] 4b.3 Reads the BLOB, not the eol-smudged worktree. Gate: `GitTests.ReadBlobsBatch_matches_GitShowBytes_per_file`
      asserts batch bytes == `GitShowBytes` per file, incl. a CRLF blob + a spaced path + a missing spec. Green.
- [x] 4b.4 `PushCommandTests` green (full sync suite 96/96). Situational win — large/`--force` pushes drop from
      N `git show` spawns to one process.

## 4. Measure + decide the index-fusion follow-up

- [x] 4.1 Measured — see the perf result above (45.3 s → 0.25 s, ~178×).
- [x] 4.2 **Measured — immaterial; the fusion follow-up is dropped, not deferred.** `git read-tree` over a
      synthetic 8000-entry tree (init scale, the same size as the 45.3 s measurement) runs in **73 / 75 / 86 ms**
      across three runs. Fusing the working-tree write with index population would chase ~80 ms against the 0.25 s
      the whole blob+tree build now costs. There is no case for the added complexity; `Finalizing` stays one
      `read-tree`.

## 5. Close the loop  ✅ (docs pending only)

- [x] 5.1 Progress reworked: init 5→4 phases, pull 4→3 (the "Building tree" phase is obsolete — fast-import has no
      silent tree-build). `Finalizing` (init `read-tree`) and `Merging` (pull) remain the only indeterminate
      steps. `progress.ts` now LEADS the message with the live count (`1234/8000 · Importing objects`), per the
      preference for a file number over the bar.
- [x] 5.2 `ARCHITECTURE.md` does not describe the temp-staging — no update needed.
