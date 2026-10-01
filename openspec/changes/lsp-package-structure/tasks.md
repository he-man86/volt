Execution: `.claude/workflows/execute-change.js` with `{ change: "lsp-package-structure", requires: ["transpile-restructure"] }`.
Steps of at most 5 tasks; every step output-neutral (suites, map, snapshots unchanged).

## 0. Inventory
- [ ] 0.1 Measure the current tree: every folder and loose file of src/, test/, scripts/, docs/ with its purpose, its
      importers, and whether it is still used (scripts: referenced by package.json, docs, CI, or another script).

## 1. Design
- [ ] 1.1 design.md: the target tree with one sentence per folder, the old -> new map, what is deleted and why.

## 2. Moves (one task per move or group of moves, output-neutral)
- [ ] 2.1 src/ top level (no loose files; network folder decision recorded).
- [ ] 2.2 test/ mirrors src/; cross-cutting suites under one root.
- [ ] 2.3 scripts/ grouped by purpose; probes and finished codemods deleted; scripts/README.md complete.
- [ ] 2.4 docs/ current only; architecture.md shows the final tree.

## 3. Gate
- [ ] 3.1 The structure gate test (layer imports, no loose src/ files, every folder described, every script listed) — red
      first, green after 2.x.

## 4. Close
- [ ] 4.1 Cold full suite, README/TESTING updated, archive.
