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

- [x] E.1 scripts/: every script listed with its purpose; probes (`scripts/probe-*`) and finished codemods
      (`codemod-frontend-paths.ts` …) deleted unless a doc or test still names them (then say which); stray scratch
      files in the package root (`scratch-lower.ts`, `_cmp-*.ts`, `_ed.ts` …) deleted; the rest grouped by purpose only
      if no workflow prompt, package.json script or doc names the old path — otherwise update those references in the
      same commit. scripts/README.md complete.
      **Done 2026-10-03.** DELETED: `codemod-frontend-paths.ts` (finished; named only by the archived
      frontend-conformance), `probe-ambiguous-uses.ts` and `probe-extends-ambiguity.ts` (named only by the archive and
      the README), `probe-fixture-run.py` (a finished unify-conformance-suite 3.1 probe whose scratch TS driver never
      existed in the tree; `record-exec.py`'s provenance comment now says so). KEPT, because something live names them:
      `probe-dep-depth.ts` (`src/frontend/symbols/library-namespaces.ts`), `probe-is-it-compiled.ts`
      (`test/conformance/fixtures/graphical/network-unresolved.ts`, `probe-position-length.ts`),
      `probe-lowering-refusals.ts` (`test/corpus/corpus.test.ts`, transpile-restructure design/tasks),
      `probe-order-dependence.ts` (`test/corpus/support/project.ts`), `probe-position-length.ts`
      (`test/conformance/support/divergences.ts`), `probe-projectsettings-effect.ts` (analysis-conformance tasks).
      Stray root files: none left in the package root (tracked or untracked) — already gone before this step.
      NOT moved into subfolders: open changes (transpile-restructure, analysis-conformance), tests and source comments
      name `scripts/<file>` flat, so the grouping is by README section (libraries · record · check · generate · audit ·
      measure), every one of the 35 files listed, live/offline and package.json alias stated; the README's false
      "nothing here is a test" fixed (`bridge.test.ts`, `held-as.test.ts` run under a bare `bun test`). TESTING.md's
      partial duplicate script table replaced by a pointer to scripts/README.md (one list).
- [x] E.2 docs/: legacy deleted (`docs/plcopen-xml/` — PLCopen is deleted), every remaining doc current or deleted;
      architecture.md's tree updated for what moved here. Every suite green; `bun run check` green.
      **Done 2026-10-03.** DELETED: `docs/plcopen-xml/` (the TC6 XSD; nothing named it); the 15 "Notes for tooling"
      sections of `codesys-reference/01–12,14,15` and `twincat-reference/07` and the "Status" stage table of
      `codesys-reference/00-index.md` — the July build plan (Stage 0–6, `src/lexer/`, `src/parser/ast.ts`,
      `src/reference/keywords.ts` … files that never existed or have moved; `ALL_KEYWORDS`, `wrong-vendor-pragma`),
      superseded by the code, the fixtures and `error-catalog.json`; `13-error-messages.md`'s notes are current and
      stay. CURRENT: `architecture.md` — a "The tree" section (src/ folders and loose files, test/, libraries/,
      scripts/, docs/, test-corpus/), F names `network-text/` beside `network/`, the testing loop names
      `fixtures/` + `scripts/record-language.ts` (not `catalog/` + `record.ts`), the two `spec.md` references (no such
      file) point to `server/server.test.ts` and `behavior.md`; `behavior.md` — no `volt-bridge`/`volt-git`/HTTP wire,
      no PlcOpen, network text routed by the `IMPLEMENTATION` line (it said "first token NETWORK", contradicting its own
      implementation-keyword requirement), CFC/SFC as the UNSUPPORTED line (not a marker comment); the package README's
      role diagram (named pipe + volt-cli, not HTTP + volt-git), layout table (network-text/, the loose src files, every
      test/ folder, scripts/, docs/) and doc list; `codesys-reference/14,15` the dead `.claude/skills/fbd-authoring`
      links and the P4/P5 plan lines; `twincat-reference/13` the HTTP response body → the `health` answer. Every
      backticked `src/`/`test/`/`scripts/`/`docs/` path in the package docs resolves. Network text parked: its
      PLCopenXML element mappings in 14/15 (vendor-format facts, not Volt claims) left for the LD/FBD coverage change.
      Gate: `bun typecheck` clean; `VOLT_REQUIRE_FULL=1 bun test` 8050 pass / 34 skip / 382 todo / 0 fail (8466 tests,
      207 files); root `bun run check` 15 passed / 0 failed; `bun run lint` exit 0 (warnings only).

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
