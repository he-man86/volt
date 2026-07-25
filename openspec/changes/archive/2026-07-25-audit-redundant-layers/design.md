# Design — the audit

## The antipattern catalog (what every agent hunts)

Each finding is one of these classes. The test for all of them is the same question: **does this layer add
information the source doesn't already have?** If no → it's a finding.

| # | Class | Smell | Reference fix |
|---|---|---|---|
| A | **Redundant wrapper/view DTO** | A type that re-shapes a source 1:1 with nothing added (rename, re-nest, subset). Consumer immediately flattens/unwraps it. | `ConnectorView.bridges` (deleted); `IdeInstance` nesting (flattened) |
| B | **Derived field duplicating source** | A field computed from other fields on the same object / a prior call, stored instead of derived at the edge. | `ConnectorView.status` aggregate (no consumer); per-project `ProbeAsync` re-computing `serving` the row already had |
| C | **Dead / legacy compat shim** | A field, op, param, fallback branch, or `?? legacy` kept for a client/version that no longer exists. Unused fields. | `activeOp`; `ideAlive`/`degradedReason`/`platformVariant`; the `instances` op |
| D | **One-impl abstraction / forwarding** | An interface with a single implementation, a factory for one product, a method that only forwards to one other, config for a value that never changes. | (hunt) |
| E | **Redundant round-trip** | Re-fetching / re-probing data a call earlier in the same flow already returned. | connector per-project `ProbeAsync` (was N calls/tick) |
| F | **UI transform of an endpoint** | The frontend re-derives per-item state (status/serving/label) that the endpoint could — and now should — return on the item. "Everything exposed should simply be the endpoint." | volt-control `boundStatus` (now reads the row) |
| G | **Duplicated vocabulary / shape** | The same closed set of strings or the same record shape re-declared independently in >1 place with nothing pinning them together. | `single-source-wire-vocabularies` (precedent) |

**Severity rubric** (for ranking): `high` = dead code a consumer could trip on, or a redundant round-trip on a hot
path; `med` = a wrapper/derived field with one internal consumer; `low` = cosmetic duplication, one-impl interface
with no churn. Record a one-line **failure/benefit scenario** per finding, like `/code-review` does.

## What is NOT a finding (guard against over-simplifying)

`ARCHITECTURE.md` documents load-bearing asymmetries that LOOK like redundancy but are irreducible — the audit must
recognize and KEEP them:

- CODESYS in-proc (net48, per-pipe) vs TwinCAT COM (net8 worker, one pipe) — two `Ide/` layers, not drift.
- Per-pipe CODESYS discovery vs one-worker TwinCAT ROT — the `IProjectSource` split.
- The **parity boundary is the wire**: Core deciding a wire outcome once (not per driver) is deliberate, not a
  redundant layer.
- A client-side DTO of a parsed CLI/HTTP response across the `volt` boundary is normal client/server practice, not
  duplication (see the `single-source-wire-vocabularies` proposal's reasoning on the C#↔TS boundary).

When an agent is unsure whether something is asymmetry or redundancy, it files the finding as `keep?` with the
question, rather than proposing a delete.

## Orchestration — the fan-out

Read-only audit agents, **one per subsystem**, run in parallel; a synthesis agent then merges. Suggested subsystems
(start at the CLI, widen outward — the ordering also front-loads the areas the two reference fixes touched):

1. `volt-cli/src/Volt.Cli` — the CLI verbs + `Sync/*` (BridgeClient, BridgeResolver, Config, Commands)
2. `volt-cli/src/Volt.Cli.Connector*` — connector core + control server + tray + sources
3. `volt-cli/src/Volt.Engine/Wire` + `Ide` + `Sync` — the wire host, driver contract, op services
4. `volt-cli/src/Volt.Cli.Ide.Codesys` + `Ide.Twincat` — the two drivers (asymmetry-aware!)
5. `volt-control/src` — the UI-agnostic core (health/status/actions/connector)
6. `volt-vscode/src` + `volt-desktop/src` — the two frontends (class F is most likely here)
7. `volt-lsp-iec/src` — the LSP (class D/G most likely)

Each agent gets: this `design.md` (the catalog + the NOT-a-finding guard), its subsystem path, and the two
reference commits (`787381e991`, `47ab25c7a1`) as worked examples. It returns a structured findings list
(file:line, class A–G, severity, one-line scenario, proposed action). The synthesis agent dedups cross-subsystem
findings (a shape duplicated across two packages is ONE finding), ranks by severity, and writes the ledger into
`tasks.md`'s Phase 2 table.

**How to run it (fresh context):** open a new session and either (a) drive it with the `Workflow` tool — a pipeline
of `agent()` per subsystem into a synthesis stage — or (b) run the audit agents by hand one subsystem at a time.
Either way the agents are **read-only**; nothing is edited until Phase 3, after a human skims the ledger.
