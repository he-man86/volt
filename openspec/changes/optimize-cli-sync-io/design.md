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

**D1 — Object writer: `git fast-import` over write-then-hash.**
Replace the temp-staging in `WriteBlobs` with `git fast-import`, which streams a `blob`/`data <n>` record per
content over one stdin pipe and emits objects directly — no temp files, no working-tree dependency, one process.
- *Why over write-src-then-hash-real-paths:* that approach only works when content is already on disk in the
  right place. It fits `init` (hashed set == `src/` set) but NOT `pull`, whose `volt/ide` tree is a **synthetic
  composition** (changed + `parentIde`-unchanged + `HEAD`-scaffold) that is deliberately NOT the working tree.
  `fast-import` is content-stream based, so it serves both with one code path.
- *Why over `git add`/`update-index --add`:* `git add` hashes from the working tree **with filters applied**
  (CRLF/gitattributes), which would change SHAs and threaten round-trip fidelity. `fast-import` writes raw bytes
  (equivalent to `--no-filters`). Byte-identity is preserved.
- SHAs come back via `fast-import`'s mark mechanism (`mark :n` per blob → `get-mark`/marks-file), mapping each
  content index to its object SHA, replacing the ordered stdout of `hash-object`.

**D2 — Keep `BuildVoltIdeTree`'s composition; swap only the blob step.**
`ListTree(parentIde)` + `ListTree(HEAD)` (reusing already-hashed SHAs, no rehash) and `write-tree` are already
optimal. Only the `Git.WriteBlobs(...)` call inside it changes to the stream writer. This bounds the blast radius
and keeps init/pull identical below the blob step.

**D3 — `init` index population stays `ReadTreeToIndex` for now.**
Fusing the working-tree write with index population (so no separate `read-tree`) is a smaller, separable win and
risks the working-tree/index/objects three-way consistency that keeps `git status` clean post-init. Do it only if
measurement shows `read-tree` is a material cost after D1; otherwise leave it. (Tracked as an optional task.)

**D4 — Verification is byte-identity first, perf second.**
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
5. (Optional, D3) fuse index population; re-run gates.

## Open Questions

- Does `read-tree` (D3) show up materially after D1, or is it noise? (Answer with the measurement in step 3.)
- Is there any item kind whose content is intentionally non-UTF-8 today (so the `data <n>` raw-byte path changes
  a SHA vs the current UTF-8 round-trip)? Confirm against the corpus/e2e fixtures before deleting the old path.
