## 1. Spike — ANSWERED. The gate fails on TwinCAT; the change closes.

- [x] 1.1 **Ran the API-surface half of the spike** (reflection over the shipped vendor assemblies — offline,
      no IDE, decisive for "does the signal exist at all"). Result: **CODESYS has one, TwinCAT has none.**

      **CODESYS — a per-object change stamp EXISTS.** In `Objects.dll`
      (`C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common`):

      | interface | member |
      |---|---|
      | `IMetaObject4` | `ModificationCounter` |
      | `IMetaObject3` | `TimeStamp` |
      | `IMetaObjectStub3` | `ModificationCounter` |
      | `IMetaObjectStub2` | `TimeStamp` |
      | `ISVNode` | `GetMetaObjectStub()` |

      The STUB pair is the interesting part: a stub is the not-yet-deserialized handle, so a counter readable
      there is readable **without paying the materialization** — which is precisely the cost the walk pays.

      > **This corrects a load-bearing claim in `proposal.md`.** That document argued the only available signal
      > is `projectDirty`, "one boolean for the whole project", and built the whole "too risky to adopt" case on
      > it. That is false for CODESYS. The risk argument still holds, but for a different reason (below) — and
      > it should not be re-derived from the wrong premise next time.

      **TwinCAT — no per-item stamp.** `TCatSysManagerLib.dll`: **10 `ITcSmTreeItem*` interfaces, 502 members
      scanned**, zero modification stamps. The only `chang`-matching member is `ChangeChildSubType(...)`, a
      MUTATOR. The only version-ish members on the whole surface are `ITcSysManager14+.PinnedTcVersion` and
      `TcVersionFixed` — the TwinCAT PRODUCT version, nothing to do with project state. (Enumerated
      exhaustively rather than pattern-matched, so this is a looked-at negative, not an absent match.)

      **Verdict against the gate as written** — "CODESYS **AND** TwinCAT expose a cheap, comprehensive token" —
      **fails.** Per this task's own instruction, the change closes.

      **What is NOT proven, and would still be required for a CODESYS-only cache:** the entire "actively try to
      break it" half — undo/redo, programmatic edits, a library version swap, an externally loaded file. A
      counter that exists is not a counter that covers every mutation path, and the failure mode is unchanged
      and silent: a stale version map means the client misses a real incoming IDE change with no error. Existence
      was the cheap half; comprehensiveness is the expensive half and it is untouched.

- [x] 1.2 **Dropped** — conditional on 1.1 proving a cross-vendor signal, which it did not. The stated fallback
      ("pursue per-item materialize speedups instead of a cache") is the standing direction, and is where the
      measured wins have actually come from: see the archived `optimize-cli-sync-io` (blob+tree build
      45.3 s → 0.25 s, ~178×, by deleting a temp-file pass — no cache, no change signal, no staleness risk).

> Status: **CLOSED by evidence.** Slow-but-correct remains the deliberate choice on both vendors. If this is
> ever reopened it must be as a **CODESYS-only** proposal that starts from `IMetaObjectStub3.ModificationCounter`
> and whose gate is the break-it matrix, not the existence question — that one is now answered.
