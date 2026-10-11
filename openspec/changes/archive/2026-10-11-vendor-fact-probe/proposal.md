## Why

Volt's vendor seam rests on MEASURED facts: where an IDE keeps an item's kind, which task fields are real setters,
which names it refuses, where compiler options live, what a running IDE says about itself. `DIALECT.md` records them.
Until 2026-10-03 each fact had its own one-off probe in `packages/volt-cli/scripts/` — 54 scripts and their logs,
written once, run once, then left to rot. They were deleted in `chore(scripts): single-use probes deleted` (last commit
holding them: `b2496efb4b`); their findings stay as `DIALECT.md` rows and source citations that point at history.

Deleting them loses one thing: a way to notice when a vendor CHANGES a fact. A new CODESYS service pack or TwinCAT
build can move a kind to another source, make a setter read-only or refuse a new word, and nothing re-asks the
question. The owner: "otherwise we should combine them into 1 probe script that detects all types" — "something
that is maintainable".

## What Changes

- **One re-runnable script**, `packages/volt-cli/scripts/vendor-facts.ts`, in the dev loop, for both vendors. It runs on
  its own `ide.ps1` instance (`VOLT_E2E_INSTANCE=vendor-fact-probe`, a COPY of a committed fixture, the pipe resolved
  through `test/e2e/lib/fixture-ide.ts` like every other script), creates every item type the table names, and dumps
  every fact into ONE JSON snapshot per vendor.
- **Data-driven**: a table of item types × facts (`vendor-facts.table.ts`). Adding a type or a fact is ONE ROW — no new
  code path. Each row names the fact id, the item type(s), how to read it (an existing bridge op, or a named reader in
  the vendor core), and the `DIALECT.md` row it backs.
- **One probe core per vendor behind one interface** (`create`, `read`, `cleanup` per row): CODESYS through the
  in-proc runscript half that `ide.ps1 -RunScript` already serves, TwinCAT through COM on the instance's XAE. The two
  cores implement the same interface; the table never branches on vendor except to mark a fact one vendor lacks.
- **The snapshot is a baseline**: plain JSON, keys sorted, committed as `vendor-facts.<vendor>.json` and reviewed like
  any baseline. A run diffs against it and fails on any difference; the snapshot changes only on purpose
  (`--write`), and a change to it is a DIALECT finding to record.
- **A Repo.Gates check**: every `DIALECT.md` row marked `[PROBE: <fact-id>]` (a re-measurable vendor fact) has a row in
  the table, and every table row cites a DIALECT row that exists. A fact cannot be added to DIALECT as re-measurable
  without being probed, and the table cannot drift away from DIALECT.
- **One command** from `packages/volt-cli/scripts/README.md`:
  `bun scripts/vendor-facts.ts <codesys|twincat> [--write]`.
- **No per-fact one-off scripts ever again.** A new vendor question is a new table row; `scripts/README.md` says so.

Network text / NWL facts (the `probe-nwl-*` family, N-rows) are **deferred** to the LD/FBD design (the owner wants every
LD/FBD shape in network text — that design decides which of those facts are vendor facts and which are corpus
censuses). Their probes are listed below so their logic can be recovered then.

## Facts the table must cover (from the deleted probes)

Each is recoverable with `git show b2496efb4b:packages/volt-cli/scripts/<file>` (the probe) and its `.log` beside it.

**Item kind and its source**
- `probe-kind-source.py` + `kind-source.log` (CODESYS), `probe-tc-kind-source.ps1` + `tc-kind-source.log` (TwinCAT) —
  where each item type's kind lives (DUT subtype, POU kind), right after an in-place change, after a build, after a
  reload. DIALECT C2e, C2g, C2h.
- `probe-pou-kind-signature.py` + `pou-kind-signature.log`, `probe-pou-kind-parser.py` + `pou-kind-parser.log` — the
  precompile signature names a compiled POU's kind (pool POUs included); an uncompiled POU has none.
- `probe-kind-audit.py` + `kind-audit.log` — object classes per item type; a member keeps its class whatever its text.
  C2f, C2l.
- `probe-kind-audit2.py` + `kind-audit2.log` (CODESYS), `probe-tc-function-members.ts` + `tc-function-members.log`
  (TwinCAT) — which members a POU accepts follows its TEXT; the refusal messages verbatim. C2k.
- `probe-dut-subtype-in-place.py` + `dut-subtype-in-place.log`, `probe-dut-subtype-push.py` + `dut-subtype-push.log`,
  `probe-tc-dut-codes.ps1` + `tc-dut-codes.log` — a DUT takes another subtype in place (same guid); TwinCAT's tree code
  lags until reload. C2e.
- `probe-merged-classes.py` + `probe-merged-classes.ts` — every merged class (check function, persistent list, text-list
  enum, NVL, abstract method) keeps GUID and CLR class through write / rename / move. C2n. (Its log,
  `merged-classes.log`, is KEPT: open task bridge-refusal-review 4.31 cites it.)
- `probe-tc-graphical-callee-seed.ts` + `tc-graphical-callee-seed.log` — a graphical call of a POU created in the same
  session is built from the tree code, not the text. C2f, C2h.

**Structure**
- `probe-tc-name-collision.ts` + `tc-name-collision.log` — TwinCAT refuses to create a folder whose name an object at
  that level has (an order constraint). D34.
- `probe-empty-folder-lifecycle.py` + `empty-folder-lifecycle.log` — a folder survives its last item on both vendors.
- `probe-task-config-survives-delete.py` + `task-config-survives-delete.log` — the task configuration is localized and
  survives its last task.

**Tasks**
- `probe-task-writable.py` — every scheduling field is a real setter; `priority` is a string.
- `probe-task-calllist.py` — the `pous` view discards mutation; `PerformWithWriteableCopy` is the door.
- `probe-task-callcomment.py` + `task-callcomment.log` — a call entry persists exactly `('Name', 'Comment')`.
- `probe-task-kind.py` + `task-kind.log` — `KindOfTask`'s six names, and that it is writable.
- `probe-task-create.py` — create / remove calls on the task configuration.
- `probe-tc-task.ps1` — TwinCAT's task schedule as the automation interface answers it. C19b.

**Accessors**
- `probe-accessor-decl.py` + `accessor-decl.log` — what CODESYS holds for a property's GET / SET declaration (a bare
  `VAR`/`END_VAR` is stored content). (`probe-accessor-census.py` + `accessor-census.log` counted it over five real
  projects — a corpus census, not a vendor fact; not in the table.)

**Project, settings, identity, diagnostics**
- `probe-project-container.py` — what the scripting project container is (`IScriptProject` / `IScriptTreeObject`).
- `probe-tc-project-object.ps1` — telling a TwinCAT PLC project from another solution project by what it answers. D35.
- `probe-projectsettings-scope.py` + `projectsettings-scope.log` — the compiler configuration is a session service over
  per-project state. C24.
- `probe-codesys-compile-options.py` + `codesys-compile-options.log`, `probe-tc-compile-options.ps1` +
  `compile-options.log` — the three compile options agree byte for byte across vendors. D38.
- `probe-tc-project-settings.ps1` + `probe-tc-project-settings-gui.ps1` + `tc-project-settings.log` — TwinCAT compiler
  settings live vs saved; the warning list has no automation surface (the fact to re-check is that ABSENCE). D37–D39.
- `probe-ide-identity.py` + `ide-identity.log`, `probe-tc-ide-identity.ps1` + `tc-ide-identity.log` /
  `tc-ide-identity-64.log` — what a running IDE states about itself. V1, V4, V5.
- `probe-diagnostic-child-guid.py` + `diagnostic-child-guid.log` — a build error in a member carries the child's own
  guid; `PositionOffset` is the column. C27.
- `probe-duplicate-method.py` — a second same-named method is refused at create (C0582 unreachable on SP21).

**Fold in after bridge-refusal-review is archived** (kept today because its open tasks name them):
`probe-identifier-names.py`, `probe-tc-refusal-measure.ps1`, `probe-wire-type-build.py`,
`probe-body-language-change.py`, `probe-member-language-change.py`, `probe-interface-accessor-write.py`, and
`probe-member-name-refusal.ts` (whose logs Repo.Gates `RefusedNamesMatchTheLogsTests` reads — the table's name facts
must keep that gate's input, or the gate moves to the snapshot).

**Deferred to the LD/FBD design** (network text / NWL): `probe-nwl-census.py`, `probe-nwl-census-v2.py`,
`probe-nwl-dump.py`, `probe-nwl-coils.py`, `probe-nwl-coil-modifiers.py`, `probe-nwl-boxoutputs.py`,
`probe-nwl-assign-outputs.py`, `probe-nwl-execute-compare.py`, `probe-nwl-execute-create.py`, `probe-nwl-slots.py`,
`probe-nwl-labels.py`, `probe-labels-edge-names.ts`, `probe-edge-names-order.py`, `probe-nwl-oracle-rungs.py`,
`probe-nwl-eno-build.py` (each with its `.log`). N13–N26.

**Not vendor facts — not in the table**: `probe-bridge-bundles.cs` (Volt's own bundles), `member-name-refusal-rule.ts`
(an analysis of the refusal logs), `probe-online-state.py` (the scripting online API — `record-exec.py` exercises it on
every recording), `probe-st-chained-set.py` and volt-lsp-iec's `probe-position-length.ts` (compiler language facts —
their home is the LSP conformance recordings), and volt-lsp-iec's `probe-dep-depth.ts`, `probe-order-dependence.ts`,
`probe-is-it-compiled.ts`, `measure-sfc-step-names.ts` (corpus or debug measurements).

## Impact

- New: `packages/volt-cli/scripts/vendor-facts.ts`, `vendor-facts.table.ts`, the two vendor cores,
  `vendor-facts.codesys.json`, `vendor-facts.twincat.json`; a Repo.Gates test; `[PROBE: …]` markers in `DIALECT.md`.
- Live only (needs an `ide.ps1` instance); never in CI. The Repo.Gates check is offline and runs in CI.
