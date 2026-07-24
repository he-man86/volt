# Tasks

## Phase 0 — orient (do this first, in the fresh session)
- [ ] Read `proposal.md` + `design.md` (the antipattern catalog A–G and the NOT-a-finding guard).
- [ ] Read the two reference commits as worked examples: `git show 787381e991`, `git show 47ab25c7a1`.
- [ ] Skim `packages/volt-cli/ARCHITECTURE.md` for the load-bearing asymmetries that must NOT be flagged.

## Phase 1 — fan-out audit (read-only, one agent per subsystem)
Spawn one audit agent per subsystem below. Each gets `design.md`, its path, and the two reference commits, and
returns a structured findings list (file:line · class A–G · severity · one-line scenario · proposed action).
Nothing is edited in this phase.
- [ ] 1. `Volt.Cli` — CLI verbs + `Sync/*` (BridgeClient, BridgeResolver, Config, Commands, sidecar)
- [ ] 2. `Volt.Cli.Connector*` — connector core, ControlServer, TrayContext, the two `IProjectSource`s
- [ ] 3. `Volt.Engine` — `Wire/` (host, DTOs), `Ide/` (driver contract), `Sync/` (op services)
- [ ] 4. `Volt.Cli.Ide.Codesys` + `Volt.Cli.Ide.Twincat` — the drivers (asymmetry-aware; file `keep?` when unsure)
- [ ] 5. `volt-control/src` — health/status/actions/connector (class B/F most likely)
- [ ] 6. `volt-vscode/src` + `volt-desktop/src` — the frontends (class F: UI re-deriving what the endpoint returns)
- [ ] 7. `volt-lsp-iec/src` — the LSP (class D/G most likely)

## Phase 2 — synthesize + triage
- [ ] One synthesis agent merges all findings, dedups cross-subsystem ones (a shape duplicated across packages = ONE
      finding), and fills the ledger below, ranked most-impactful first.
- [ ] A human skims the ledger and marks each row `go` / `skip` / `discuss` before any edits.

### Findings ledger (filled by Phase 2)
| # | Class | Location | Finding (1 line) | Severity | Action | Verdict |
|---|-------|----------|------------------|----------|--------|---------|
| _ | | | _(to be filled by the audit)_ | | | |

## Phase 3 — apply the wins
- [ ] Work the ledger top-down. Each finding (or a tight cluster) = one self-contained commit.
- [ ] Every commit lands with the C# (`Volt.Cli.Tests` / `Volt.Engine.Tests` / `Volt.Cli.Connector.Tests`),
      volt-control (`bun test`), and — where touched — e2e suites green. Update `ARCHITECTURE.md` when a shape changes.
- [ ] For any wire/CLI-contract change, update the client-side DTOs on the far side (connector, volt-control, e2e
      harness) in the SAME commit — the two reference commits show the full blast radius.

## Phase 4 — guard against re-rot
- [ ] For each class that can silently regress (a collapsed shape re-nested, a vocabulary re-spelled, a field
      re-duplicated), add a cheap guard test where one exists in the `VendorParityGuardTests` /
      `WireVocabularyGuardTests` mould. Skip where a guard would cost more than the drift it prevents — record that
      decision so the next audit doesn't re-litigate it.

## Notes
- Keep it **endpoint-first**: the target end-state is that what each layer exposes IS its source's shape. When in
  doubt between "add a field to the source" and "derive it in the consumer", prefer putting it on the source once
  (that is the direction both reference fixes went — e.g. per-project `status` moved onto the row).
- This change archives when the ledger is worked through (or its remaining rows are explicitly deferred with a
  reason). Partial completion is fine — it is an audit, not an all-or-nothing migration.
