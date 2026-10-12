## 0. Measure and design

- [ ] 0.1 Baseline with the existing bench (pro2193, lenze-mid): one workspace pass, 10 idle pulls, one save (files
      re-parsed, ms blocked), time-to-first-hover during a pull. Record under this task.
- [ ] 0.2 design.md: the `DiagnosticsPublisher` (channels, gate, generations/resultIds, versions, debounce), incremental
      disk sync, cancellation strategy, progress, error isolation, where the moved findings live in `analysis/`; each
      choice with the alternative it beat.

## 1. Red tests first (test/lsp black-box + colocated)

- [ ] 1.1 10 idle workspace pulls answer `Unchanged` after the first (cost ≈ one pass); a change answers `Full` for that
      document only.
- [ ] 1.2 Saving one file re-parses one file (no wholesale re-scan); a reference-file change re-scans references.
- [ ] 1.3 A queued cancelled pull is never computed; progress `begin` precedes `end`; a throwing parse leaves the server
      serving and logs to `window/logMessage`; lifecycle: -32002 before initialize, refusal after shutdown, exit code.

## 2. Build

- [ ] 2.1 `DiagnosticsPublisher` (new file); the four duplicated gates removed; versioned publishes.
- [ ] 2.2 Incremental disk sync in `WorkspaceStore` (`upsertDisk` / `deleteDisk`, per-URI rebind).
- [ ] 2.3 Cancellation (ConnectionStrategy, same-URI coalescing), progress fix, logger, transactional rebind, lifecycle
      conformance, processId watchdog.
- [ ] 2.4 Domain findings moved to `analysis/` (missing language, unstated bodies, manifest warnings).
- [ ] 2.5 Watcher fallback (`fs.watch`) for clients without dynamic registration, or the limitation documented.

## 3. Verify and close

- [ ] 3.1 The bench after (same measures as 0.1); `docs/architecture.md` layer G; typecheck, lint, full suite cold green;
      archive.
