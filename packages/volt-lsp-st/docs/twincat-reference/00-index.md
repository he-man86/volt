# TwinCAT 3 PLC Language Reference (Local Mirror — Deltas Only)

A focused mirror of Beckhoff TwinCAT 3-specific extensions over the IEC 61131-3 ST language. TwinCAT was forked from CODESYS V3 (~2003), so the vast majority of the language is shared with [`docs/codesys-reference/`](../codesys-reference/00-index.md). This corpus captures **only the deltas** — what TwinCAT adds or changes.

## Attribution

Derived from the [Beckhoff Information System](https://infosys.beckhoff.com/), TwinCAT 3 PLC documentation. © Beckhoff Automation GmbH. This corpus is a derivative technical summary extracting **rules, facts, and catalog entries** — not a verbatim copy. Each section cites its source URL and retrieval date.

Source root: https://infosys.beckhoff.com/content/1033/tc3_plc_intro/

Retrieval date: **2026-05-26**

## Why this exists separately

Our LSP serves both CODESYS and TwinCAT users (the Beckhoff bridge is the first conformance-passing bridge). The intelligence layer (hover, diagnostics, completion) needs to know which vendor's namespace a given token belongs to:

- `{attribute 'qualified_only'}` — **shared** (both vendors). No warning.
- `{attribute 'TcRpcEnable'}` — **TwinCAT-only**. Should not fire `unknown-pragma` in a TwinCAT project, but should warn "TwinCAT-specific" in a CODESYS project.
- `__POOL` — **CODESYS-only**. Inverse case.

The LSP's `vendor` config option (`codesys` / `twincat` / `auto`) selects the active vendor; the wrong-vendor diagnostic uses this corpus to suggest equivalents.

## Sections (deltas only — refer to `codesys-reference/` for shared content)

| # | Section | Content |
|---|---|---|
| 01 | [Pragmas — TwinCAT additions](./01-pragmas-twincat.md) | 19 `Tc*`-prefixed attribute pragmas + TwinCAT-only inherited attribute names |
| 02 | [System operators (deltas)](./02-system-operators.md) | Operators where TwinCAT differs from CODESYS (e.g. `__SYSTEM` namespace) |
| 03 | [Reserved init slots](./03-init-slots.md) | TwinCAT subsystem-reserved `global_init_slot` ranges that differ from CODESYS |
| 04 | [Library and namespace conventions](./04-libraries.md) | `Tc2_*`/`Tc3_*` library namespace patterns and conventions |

(Anything not listed here is shared with CODESYS — see [`../codesys-reference/`](../codesys-reference/00-index.md).)

## Status

Mirror covers TwinCAT 3 (PLC reference docs as of 2026-05-26). TwinCAT 4 is in beta as of late 2025 — if/when it ships, we'll add deltas as a separate section rather than retroactively merge.
