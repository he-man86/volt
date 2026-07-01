## Context

Today the LSP is validated by ~hundreds of small in-memory fixtures: `LanguageTest.source` is an inline
`.st` string (`src/tests/conformance/types.ts:27`), assembled into a two-document workspace by
`buildCorpusWorkspace` (`_shared.ts:46-62`), and each `corpus/*.test.ts` runs one LSP query over every
identifier token and snapshots the result. Nothing loads real `.st` from disk (only `language.test.ts`
reads the bridge-recorded `recordings/*.json`). Disk-`.st` loading *does* exist elsewhere and is the
model to copy: `scripts/run-diagnostics.ts:26-45` (`collectSt`) and `dispatch.ts:521-538`
(`walkForStFiles`).

A real full-option CODESYS project stresses three things the fixtures can't:
- **Precision** — the `unresolved-identifier` check (`check-unresolved-identifier.ts`, ON by default,
  documented "library-blind" at `config/index.ts:27`) fires on every reference to a library symbol
  that isn't a workspace `.st` file. On a library-heavy project that's a flood of false positives.
- **Coverage** — constructs and pragma shapes the fixtures never exercise.
- **Performance** — `Workspace.getProjectScope()` caches one flat scope but `invalidate()` clears it on
  *every* mutation (`workspace.ts:143-172`), so each edit rebuilds the whole-project symbol table; and
  `references` scans every unit body of every document per request (`references.ts:55-65`). Fine for
  tens of files, explicitly flagged as not for thousands (`workspace.ts:22`).

We have the project on hand, so we can capture it once and make it a permanent regression corpus.

## Goals / Non-Goals

**Goals:**
- A committed, disk-sourced conformance corpus materialized from the real project.
- **Zero false positives** on the valid corpus; full coverage of the constructs it contains.
- Interactive queries within a measured budget on the large corpus; index built once, not per-query.
- Correct cross-file nav/resolution across the whole project graph.
- A documented, repeatable regeneration path.

**Non-Goals:**
- The `volt-git` CLI pull/push round-trip against the project (separate follow-up change against `ide-sync`).
- Full type-checking / codegen (stays the IDE's job — see the `language-server` "never type-checking" requirement).
- Committing proprietary IP — the corpus is sanitized or a cleared subset (see Risks).

## Decisions

**1. Generate the corpus via the headless bridge + `/fetch` with an empty known-map.**
There is no dump endpoint, but `POST /fetch {knownItems:{}}` returns every item (`bridge/types.ts:88-103`)
and `volt pull` already materializes items → `src/**/*.st` (`sync/pull.ts:59-60`, `translate/materialize.ts:20-27`).
So: `codesys-bridge.ps1 up -Project <real.project>` on :8556 → fetch-all → write the `.st` tree → commit
as a fixture. Wrap this in a repeatable script (`volt-scripts/…` or a package script) so the corpus is
regenerable, not a mystery blob. *Alternative rejected:* a new `/dump` bridge endpoint — unnecessary, the
empty-known-map fetch already dumps everything and keeps the wire unchanged.

**2. Add `buildCorpusWorkspaceFromDisk(dir)` beside the string harness.**
Mirror `walkForStFiles` to read the committed corpus tree, `ws.openDocument(pathToFileURL(f), text, 1)`
each file into one `Workspace`, and expose `ws.getProjectScope()` — then reuse the existing per-query
snapshot loop and add a whole-corpus **diagnostics sweep** test. This keeps the corpus in the same
harness shape as the fixtures. The corpus tests run with **no live bridge** (committed `.st` only), so CI
stays hermetic.

**3. Precision: fix `unresolved-identifier` library-blindness — the core work.**
On a real project, a bare identifier that resolves in *no* workspace scope is almost always a library
symbol, not a bug. Candidate strategies (pick during apply, measured against the corpus):
- (a) **Library-symbol index** — parse the project's Library Manager / referenced-library manifest into a
  known-symbol set the resolver consults before flagging (most precise; needs the manifest materialized).
- (b) **Suppress bare top-level unknowns** — only flag identifiers that are members of a resolved local
  type or are clearly local (the check already "falls through silently" for member access at
  `check-unresolved-identifier.ts:63-91`; extend that stance to bare references absent from the project).
- (c) **Confidence downgrade** — emit unknown bare references as hint/off-by-default, keep errors for
  provably-local contradictions.
  Decision: start with (b) (no new inputs, immediately kills the flood), layer (a) if the corpus shows
  genuine misses. `unknownPragma`/`wrongVendorPragma`/`initSlotCollision` are already OFF by default
  (`config/index.ts:29-64`) — keep them off; the corpus confirms that's right.

**4. Performance: per-file symbol caching + a measured budget.**
Replace the all-or-nothing `invalidate()` (`workspace.ts:170-172`) with per-document symbol-table entries
so an edit re-parses only the changed file and `getProjectScope` recomposes cached per-file symbols. Batch
the `initialized` seed. Add a budget assertion in the corpus perf test (index-build time + representative
nav-query latency). *Alternative rejected:* leave it — the whole point of a real corpus is to expose and
fix this; the class doc already predicts it (`workspace.ts:22`).

**5. Baseline snapshots are the regression guard.**
Commit the corpus query snapshots and the clean diagnostics sweep. A future change that reintroduces a
false positive or breaks resolution fails the sweep/snapshots — the corpus pays off on every subsequent
edit, not just once.

## Risks / Trade-offs

- **Proprietary IP in the project** → Sanitize (rename identifiers/strings) or commit only a cleared,
  representative subset; get explicit sign-off before the corpus lands. This is the gating open question.
- **Corpus size → huge snapshots + slow CI** → Curate a representative subset for the snapshot/query tests;
  keep the full tree only for the diagnostics sweep and the (optionally flag-gated) perf test.
- **Precision vs. coverage tension** → Suppressing library-blind unresolved reports risks masking a real
  undefined-symbol bug. Mitigation: keep the check for symbols the project *should* define locally (types,
  locals), only relax bare cross-library references; measure both directions against the corpus.
- **Snapshot churn** → Real files produce large snapshots; a small parser change can move many. Keep the
  corpus subset tight and review snapshot diffs as signal, not noise.

## Migration Plan

No runtime migration. Land the harness + corpus + tuning together; the corpus tests are additive. The
regeneration script is documented so the corpus can be refreshed when the source project changes.

## Open Questions

- **Which project, and is it clearable to commit?** Full project vs. sanitized subset — needs an IP call
  before anything lands in the repo.
- **Performance budget numbers** — set the index-build and per-query thresholds from a first measurement on
  the real corpus, not a guess.
- **Library-symbol index (strategy 3a)** — only if strategy (b) leaves genuine gaps; would need the
  referenced-library manifest materialized alongside the `.st`.
