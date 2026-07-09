# TwinCAT 3 PLC Language Reference (Local Mirror — Deltas Only)

A focused mirror of Beckhoff TwinCAT 3-specific extensions over the IEC 61131-3 ST language. TwinCAT was forked from CODESYS V3 (~2003), so the vast majority of the language is shared with [`docs/codesys-reference/`](../codesys-reference/00-index.md). This corpus captures **only the deltas** — what TwinCAT adds or changes.

## Attribution

Derived from the [Beckhoff Information System](https://infosys.beckhoff.com/), TwinCAT 3 PLC documentation. © Beckhoff Automation GmbH. This corpus is a derivative technical summary extracting **rules, facts, and catalog entries** — not a verbatim copy. Each section cites its source URL and retrieval date.

Source root: https://infosys.beckhoff.com/content/1033/tc3_plc_intro/

Retrieval date: **2026-06-07**

## Why this exists separately

Our LSP serves both CODESYS and TwinCAT users (the Beckhoff bridge is the first conformance-passing bridge). The intelligence layer (hover, diagnostics, completion) needs to know which vendor's namespace a given token belongs to:

- `{attribute 'qualified_only'}` — **shared** (both vendors). No warning.
- `{attribute 'TcRpcEnable'}` — **TwinCAT-only**. Should not fire `unknown-pragma` in a TwinCAT project, but should warn "TwinCAT-specific" in a CODESYS project.
- `__POOL` — **CODESYS-only**. Inverse case.

The LSP's `vendor` config option (`codesys` / `twincat` / `auto`) selects the active vendor; the wrong-vendor diagnostic uses this corpus to suggest equivalents.

## Sections (deltas only — refer to `codesys-reference/` for shared content)

Mirrors the structure of [`../codesys-reference/00-index.md`](../codesys-reference/00-index.md). Each file covers only what TwinCAT adds or changes relative to CODESYS.

| # | Section | Content |
|---|---|---|
| 01 | [Programming languages and editors](./01-languages.md) | XAE vs CODESYS IDE, online change, IL deprecation, CFC execution order |
| 02 | [Variables](./02-variables.md) | `VAR_STAT`, I/O linking via mapping, `PERSISTENT` vs `RETAIN`, ADS symbol visibility |
| 03 | [Operators](./03-operators.md) | `__NEW`/`__DELETE`, `__ISVALIDREF`, `__VARINFO`, `__QUERY_INTERFACE`/`__QUERY_POINTER`/`__TRY_CAST` |
| 04 | [Type conversion](./04-type-conversion.md) | `STRING`/`WSTRING` handling, `TcEncoding`, ANY type, strict enums |
| 05 | [Operands](./05-operands.md) | Direct address vs I/O mapping, `__SYSTEM.GetTimestamp`, `THIS`/`SUPER` |
| 06 | [Data types](./06-data-types.md) | `OTCID`, `PVOID`, global DUT files, `pack_mode` alignment, string limits |
| 07 | [Pragmas](./07-pragmas.md) | 19 `Tc*`-prefixed attribute pragmas + TwinCAT-only inherited attribute names |
| 08 | [Identifiers](./08-identifiers.md) | `__SYSTEM` namespace, `__` prefix reservation, `Tc` prefix convention, naming style |
| 09 | [Shadowing rules](./09-shadowing.md) | Same search order as CODESYS; method shadow warning; OOP override |
| 10 | [Keywords](./10-keywords.md) | `INTERFACE`, `IMPLEMENTS`, `EXTENDS`, `ABSTRACT`, `FINAL`, `OVERRIDE`, `PROPERTY` |
| 11 | [FB_Init, FB_Reinit, FB_Exit](./11-fb-lifecycle.md) | `call_after_online_change_slot`, `__NEW` calling `FB_Init`, ADS handle cleanup in `FB_Exit` |
| 12 | [Global init slots](./12-global-init-slots.md) | TwinCAT subsystem-reserved ranges (0–999), user range (1000+) |
| 13 | [Error messages and warnings](./13-error-messages.md) | C/L/W compiler codes, ADS runtime error hex codes, I/O mapping errors |
| 14 | [Library and namespace conventions](./14-libraries.md) | `Tc2_*`/`Tc3_*` library families, `.tsproj` reference format, CODESYS equivalents |

(Anything not listed here is shared with CODESYS — see [`../codesys-reference/`](../codesys-reference/00-index.md).)

## Status

Mirror covers TwinCAT 3.1 Build 4024 (current GA as of 2026-06-07). TwinCAT 4 is in beta as of late 2025 — if/when it ships, we'll add deltas as a separate section rather than retroactively merge.
