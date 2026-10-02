Execution: `.claude/workflows/execute-change.js` with `{ change: "lsp-package-structure", requires: ["transpile-restructure"] }`.
Steps of at most 5 tasks; every step output-neutral (suites, map, snapshots unchanged).

## 0. Inventory
- [ ] 0.1 Measure the current tree: every folder and loose file of src/, test/, scripts/, docs/ with its purpose, its
      importers, and whether it is still used (scripts: referenced by package.json, docs, CI, or another script).

## 1. Design
- [ ] 1.1 design.md: the target tree with one sentence per folder, the old -> new map, what is deleted and why.

## E. Early cleanup (owner, 2026-10-02: allowed before transpile-restructure / analysis-conformance)

Only what those two changes do not move: scripts/, docs/, stray files. No src/ or test/ moves (src/analysis and
src/transpile are restructured by their own changes; network text is parked).

- [ ] E.1 scripts/: every script listed with its purpose; probes (`scripts/probe-*`) and finished codemods
      (`codemod-frontend-paths.ts` …) deleted unless a doc or test still names them (then say which); stray scratch
      files in the package root (`scratch-lower.ts`, `_cmp-*.ts`, `_ed.ts` …) deleted; the rest grouped by purpose only
      if no workflow prompt, package.json script or doc names the old path — otherwise update those references in the
      same commit. scripts/README.md complete.
- [ ] E.2 docs/: legacy deleted (`docs/plcopen-xml/` — PLCopen is deleted), every remaining doc current or deleted;
      architecture.md's tree updated for what moved here. Every suite green; `bun run check` green.

## 2. Moves (one task per move or group of moves, output-neutral)
- [ ] 2.1 src/ top level (no loose files); src/network and src/network-text dissolved into the layers (frontend/syntax/network,
      frontend/symbols+types, analysis/checks/network), unless the LD/FBD coverage change already did it.
- [ ] 2.2 test/ mirrors src/; cross-cutting suites under one root.
- [ ] 2.3 scripts/ — re-check after E.1 (what transpile/analysis added since); scripts/README.md complete.
- [ ] 2.4 docs/ — re-check after E.2; architecture.md shows the final tree.

## 3. Gate
- [ ] 3.1 The structure gate test (layer imports, no loose src/ files, every folder described, every script listed) — red
      first, green after 2.x.

## 4. Close
- [ ] 4.1 Cold full suite, README/TESTING updated, archive.
