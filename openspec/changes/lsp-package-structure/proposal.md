## Why

`packages/volt-lsp-iec` grew over time: loose files at the top of `src/`, two folders for one concern (`network/` and
`network-text/`), a `test/` tree whose folders follow history rather than `src/` (`catalog/`, `libraries/`, `frontend/`,
`corpus/`, `conformance/` side by side), 36 scripts mixing recorders, measures, gates and one-off probes, and docs that
still carry retired material (`docs/plcopen-xml/` — PLCopen is deleted). The owner (2026-10-01): finish with a very clean
folder structure that makes sense — one you can EXPLAIN, not one that grew.

This change runs LAST, after `frontend-conformance`, `analysis-conformance` and `transpile-restructure` have put every
piece of content in its final layer; it moves nothing those changes are still reshaping.

## What Changes

- **`src/`** tells the story at its top level and holds no loose files: `frontend/` (syntax, symbols, types, library) →
  `analysis/` and `transpile/` and `network/` (ONE folder for LD/FBD, if the LD/FBD coverage change has landed; otherwise its
  current two folders stay and this change says so) → `services/` and `server/`; `reference/` and the entry point in a home
  that is named, not left at the root.
- **`test/`** mirrors `src/`: colocated unit tests stay next to their code; cross-cutting suites (conformance, corpus,
  libraries, catalog, frontend baselines) get one root with one folder per concern, each with a one-line purpose.
- **`scripts/`** grouped by purpose — record (CODESYS/TwinCAT recorders), measure (censuses, snapshots, dumps), check (gates,
  layering, citations), generate (rate-fixtures, docs) — one-off probes and finished codemods deleted, `scripts/README.md`
  listing every script.
- **`docs/`** current only: retired material deleted; `architecture.md` shows the final tree with one sentence per folder.
- **A structure gate** (test): the layer import rules, no loose top-level files in `src/`, every folder of `src/` and
  `test/` described in `architecture.md`, no script not listed in `scripts/README.md`.

## Non-goals

- No behaviour change: every move is output-neutral (the suites, the fixture map and the output snapshots unchanged).
- Content reshaping that belongs to the earlier changes.

## Impact

- `packages/volt-lsp-iec/{src,test,scripts,docs}`, its README/TESTING, the repo's `bun run check` if it names paths.
