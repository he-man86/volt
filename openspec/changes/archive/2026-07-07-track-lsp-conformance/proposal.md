## Why

The ST language server implements a large slice of LSP 3.17, but there is **no map** of what it covers
versus the protocol — so gaps are discovered by accident (the call/type hierarchy providers were fully
built and unit-tested yet **never registered**, dark to every client, until `expose-workspace-navigation`).
We need (1) an authoritative feature matrix of LSP 3.17 → our implementation, (2) a durable **capability↔handler
parity** invariant so a "finished but unwired" feature can't ship again, and (3) a prioritized, trackable
backlog of the gaps worth closing (and an explicit record of what is deliberately out of scope for a
text-mirrored PLC ST LSP). This change is the living tracker for all three.

The full matrix lives in `design.md` (every LSP 3.17 method, status, and rationale). This change stays
**active** — it is the thing you follow: each backlog task is a pending LSP feature; ticking it closes a gap.

## What Changes

- **Add the LSP 3.17 conformance matrix** (`design.md`): every request/notification method, categorized as
  implemented (✅), partial (🟡), an applicable gap (❌), or out of scope (➖ with reason).
- **Add a `st-language-server` requirement** that the server's advertised capabilities and its registered
  handlers stay in lockstep (no advertised provider without a handler; no dark handler), and that the
  supported / out-of-scope method sets are the documented ones — turning the audit into an enforceable invariant.
- **Track the prioritized gap backlog** (`tasks.md`) in three tiers: agent-facing coverage (pull diagnostics,
  refresh-after-reindex), editor UX (ranged/delta semantic tokens, live config, progress), and nice-to-haves.

Non-goals: implementing the gaps here (each tier is its own follow-up change); notebook/debug/multi-root
surfaces (documented as out of scope, not backlog).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `st-language-server`: add a requirement that the LSP's LSP-3.17 conformance surface is declared and kept in
  capability↔handler parity, with the supported and out-of-scope method sets documented.

## Impact

- **Code:** none required to land the tracker. The parity requirement is guarded by a server test asserting
  every advertised capability has a registered handler (small addition, listed as task 2.1).
- **Docs/OpenSpec:** new `design.md` matrix + `tasks.md` backlog; one added requirement in the
  `st-language-server` spec on sync.
- **Process:** future LSP work references the matrix and moves a ❌ to ✅ (and ticks the backlog); the parity
  test fails CI if a capability is advertised without a handler.
