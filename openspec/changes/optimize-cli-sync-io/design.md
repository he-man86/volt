## Context

The sync path turns fetched IDE content into two things: **git objects** (for the `refs/remotes/volt/ide`
commit that powers pull/merge/drift) and **working-tree files** (`src/`, what the user edits). Today, per
`Commands.cs` + `IdeTree.cs` + `Git.cs`:

```
fetch (pipe) → MaterializeItem → BuildVoltIdeTree:
                                    Git.WriteBlobs(contents):
                                      for each content: File.WriteAllBytes(TEMP/i)   ← redundant disk write
                                      git hash-object -w --no-filters --stdin-paths TEMP/*  → SHAs, delete temp
                                    (pull only) ListTree(parentIde) + ListTree(HEAD)  → compose unchanged/scaffold
                                    git update-index --index-info + write-tree        → tree SHA
              → CommitVoltIde → UpdateRef(volt/ide[, branch])
              → Files.WriteSrcFiles(contents): File.WriteAllText(src/path)            ← second write of same bytes
              → (init) Git.ReadTreeToIndex                                            ← third git pass
```

Verified facts (read, not inferred): `WriteBlobs` stages **every** content to a temp file (`Git.cs:97`) because
`hash-object --stdin-paths` consumes *paths*, not content. `WriteSrcFiles` writes the same content to `src/`
(`Files.cs:23`). Both use raw UTF-8 (no BOM); `--no-filters` means the blob is the raw bytes, so SHAs are a pure
function of content. `push` reads objects via `GitShowBytes` (no bulk write) — out of scope.

## Goals / Non-Goals

**Goals:**
- Eliminate the temp-file staging pass in `WriteBlobs` for every command that stages blobs (`init`, `pull`).
- Keep git object SHAs and round-trip content **byte-identical** — this is the content-fidelity core.
- Reduce init's content-to-disk writes from 3× (temp + object + src) to 2× (object + src), the irreducible git
  minimum.
- Keep the change confined to *how bytes reach git* — no wire/bridge/command/model change.

**Non-Goals:**
- Changing the `volt/ide`-as-git-remote model or the pull merge semantics.
- Optimizing `push` (already reads objects), `status`, `build`, `show`, `merge`.
- Collapsing the working-tree write itself — objects + working tree coexisting is inherent to git.

## Decisions

**D1 — Build the whole `volt/ide` commit with ONE `git fast-import` stream — stop hand-rolling git.**
Today `BuildVoltIdeTree` does `WriteBlobs`(temp files) + `update-index --index-info` + `write-tree`, then
`CommitVoltIde` runs `commit-tree` — four processes and a temp-file pass to reproduce what `fast-import` (git's
own bulk-history importer) does in one stream. Replace all of it with a single `fast-import` `commit`:
- **changed** items → `M <mode> inline <path>` + `data <n> <raw-bytes>` — content goes straight into the object,
  no temp file, no `hash-object` pass, no gitattributes/CRLF filters (byte-identical to today's `--no-filters`,
  and `data <n>` is a raw byte count so it's *more* faithful to non-UTF-8 than `Encoding.UTF8.GetBytes`).
- **unchanged** IDE items + **scaffold** → `M <mode> <sha> <path>`, referencing the existing objects by the SHAs
  we already read from `ls-tree(parentIde)` / `ls-tree(HEAD)` — no re-hash, identical to today's composition.
- The stream emits the blobs, the tree, AND the commit; `get-mark`/the commit mark yields the commit SHA.

The *entry composition* is unchanged (same changed/unchanged/scaffold sets we compute now) — only the mechanism
changes, so init and pull stay identical below this line. This eliminates: the temp-file pass, the separate
`hash-object`, `update-index`, `write-tree`, and `commit-tree` processes.
- *Why not `git add`/`update-index --add` from the worktree:* `.gitattributes` is `* text=auto eol=lf`, so
  `git add` would apply CRLF normalization → different SHAs and corrupted round-trip. `fast-import` stores the
  exact stream bytes (no filters), preserving byte-identity — which is the whole reason today's code uses
  `--no-filters`.
- *Why not write-src-then-hash-real-paths:* fits `init` (hashed set == `src/`) but NOT `pull`, whose `volt/ide`
  tree is synthetic (not the working tree). `fast-import` inline data serves both with one path and no worktree
  dependency.

**D2 — `init` index population stays `ReadTreeToIndex` for now.**
Fusing the working-tree write with index population (so no separate `read-tree`) is a smaller, separable win and
risks the working-tree/index/objects three-way consistency that keeps `git status` clean post-init. Do it only if
measurement shows `read-tree` is a material cost after D1; otherwise leave it. (Tracked as an optional task.)

**D3 — Verification is byte-identity first, perf second.**
A `GitTests` case asserts the new writer returns the **same SHAs** as the old `WriteBlobs` for a content set
(golden equality), `IdeTreeTests` asserts identical trees, and the e2e parity suite (`crud-cycle`,
`graphical/roundtrip`) proves the full round-trip against a live bridge. Perf (init wall-clock, write count) is
measured before/after but is not the gate — correctness is.

## Risks / Trade-offs

- **Byte-identity drift** (a wrong SHA silently corrupts the `volt/ide` history) → gate on a golden SHA-equality
  test vs the current `WriteBlobs` before deleting it; run the e2e round-trip.
- **`fast-import` availability/quirks** (it's a plumbing command, always present in git, but has its own stream
  grammar and needs a clean `done`) → keep `WriteBlobs` as a fallback path behind a flag during rollout; delete
  once the golden + e2e gates are green on both vendors.
- **Encoding edge cases** (a file whose bytes aren't clean UTF-8) → the current path already assumes UTF-8
  (`Encoding.UTF8.GetBytes`); `fast-import` takes a raw byte count (`data <n>`), so it is actually *more* faithful
  for non-UTF-8 bytes. Assert with a binary/opaque-item fixture.
- **Empty/edge sets** (0 items, 1 item, huge item) → unit-cover; `fast-import` must no-op cleanly on empty.

## Migration Plan

1. Add the `fast-import` writer beside `WriteBlobs`; add the golden SHA-equality test.
2. Route `BuildVoltIdeTree` through it; run C# + e2e gates on CODESYS and TwinCAT.
3. Measure init before/after (wall-clock + write count) and record in the change log.
4. Delete the temp-staging `WriteBlobs` once gates are green.
5. (Optional, D2) fuse index population; re-run gates.

## Open Questions

- Does `read-tree` (D2) show up materially after D1, or is it noise? (Answer with the measurement in step 3.)
- Is there any item kind whose content is intentionally non-UTF-8 today (so the `data <n>` raw-byte path changes
  a SHA vs the current UTF-8 round-trip)? Confirm against the corpus/e2e fixtures before deleting the old path.
