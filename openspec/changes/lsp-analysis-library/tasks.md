# Tasks

- [ ] `src/analysis-entry.ts` (or similar) re-exporting syntax · network-text · symbols · types · reference ·
      analysis — the pure layers only.
- [ ] `package.json` `exports["./analysis"]` → bun: src entry, default: dist entry.
- [ ] `check-layering.ts`: fail if anything reachable from the analysis entry imports `server/`,
      `workspace-refs`, `vscode-languageserver-protocol` or `node:*`.
- [ ] A test that imports `@volt/lsp-iec/analysis`, builds a two-file project in memory and gets a diagnostic —
      the whole consumer path, no filesystem.
- [ ] Drop `"private": true`, pick a registry (open question), add a publish script to `scripts/`.
- [ ] README: document the library surface beside the server — the three calls, and that `diagnoseDeadCode`
      exists (a consumer validating freshly written, not-yet-instantiated code needs it ON).
