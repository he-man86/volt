Delivered via the **durable-log** path (the proposal's "and/or a retrievable log" option), not a wire
`diagnostics[]` field. An audit of the 2026-07-06 edge cases against current code first removed the stale ones.

## Audit — points that were already covered or obsolete (removed)
- [x] **Dead-code omission (`omitDeadCode`) — OBSOLETE.** Zero references in Core; dead code is now returned as
      ordinary source (reachability moved to the LSP, openspec `move-deadcode-to-lsp`). Not a drop site.
- [x] **Unmatched library element "silently skipped" — NO LONGER SILENT.** Already surfaced loud under the
      `(unresolved)` workspace folder (`FetchService.AppendLibrarySignatures`, tested in `FetchExclusionTests`).
      Logging adds field-trace, but the motivating "~50 empty folders, no trace" was already solved.
- [x] **Malformed item (`SafeVersion` null) — COVERED this cycle.** Now logged at Warn with name + reason.

## Surface (log path)
- [x] Chose the observability surface: durable leveled **log** (`%LOCALAPPDATA%\Volt\logs`), not a wire field.
- [x] Log an entry at every real drop site in `FetchService`/`RefsService`: unmapped-kind, exclude-from-build,
      unreadable (Warn, via `SafeVersion`), lib-render-null, lib-unmatched. Each `/fetch`+`/refs` logs a
      completion line with a per-kind drop tally; `/push` logs a write-receipt (created/updated/renamed/moved/
      deleted, named).
- [x] Vendor-neutral — all in `Volt.Bridge.Core`, so CODESYS + TwinCAT log identically.

## Analyze the edge cases (decided)
- [x] **Library facade / Interfaces↔Implementation split** — DECISION: *surface + defer the fix*. Unmatched
      elements are foldered under `(unresolved)` and logged (`lib-unmatched`). The deep root-cause fix
      (introspect `EffectiveResolution` to build a ref→concrete-library map) is **deferred to its own change** —
      it's a matching-algorithm change, not observability.
- [x] **Libraries with no precompiled sigs** — DECISION: *accept, do not per-library signal*. A target/device
      library yielding 0 sigs headless is an expected limitation, not a bug; a per-library "0 elements" line
      every fetch would be noise that dilutes the real signals. The element-level `lib-render-null`/`lib-unmatched`
      logs already cover the cases that matter.
- [x] **Render-null** — DECISION: *log name + POUType at Debug*. Method/property sub-signatures are covered by
      their parent FB (by design); the log names any that don't render so an unknown `POUType` is visible.

## Tests / runbook
- [x] Committed test: a skipped item produces a log entry with the right kind/reason
      (`FetchLoggingTests` — exclude-from-build + lib-unmatched; drop behaviour already in `FetchExclusionTests`).
      xUnit parallelism disabled (`TestParallelism.cs`) so the process-global logger is testable.
- [x] Runbook: `packages/volt-bridge/docs/debugging-a-bridge-session.md`.

## Deferred (out of scope for this change)
- [ ] Wire `diagnostics[]` field on `/fetch`+`/refs` — only if a consumer (CLI/LSP) needs to READ drops
      programmatically; durable logs cover the human field-debugging need.
- [ ] Root-cause facade→concrete-library resolution map (see edge case #1 decision above).
