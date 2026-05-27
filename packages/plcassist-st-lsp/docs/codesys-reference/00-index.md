# CODESYS ST Language Reference (Local Mirror)

A structured technical summary of the CODESYS Structured Text language reference, organized for use by tooling (LSP diagnostics, hover) and by AI agents editing PLC code.

## Attribution

Derived from the [CODESYS Online Help](https://content.helpme-codesys.com/), published by Smart Software Solutions GmbH (3S). CODESYS documentation is © Smart Software Solutions GmbH. This corpus is a derivative technical summary extracting **rules, facts, and catalog entries** — not a verbatim copy. Each section cites its source URL and retrieval date so claims can be traced back to the canonical source. Source root: https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_f_reference_programming.html

Retrieval date for all entries: **2026-05-26** (CODESYS Essentials, V3.5.22.0)

## Why this exists

The CODESYS ST language reference is comprehensive but scattered across ~250 individual HTML pages. No engineer holds it all in their head. PLC code generation by AI agents historically fails on the silent quirks — pragmas, FB lifecycle, init slots, shadowing rules — because those quirks are not derivable from syntax alone. By mirroring the reference into this repo we:

- Give the AI a complete, on-demand local reference (no MCP, no network roundtrip)
- Give tooling (LSP, codegen) a single source of truth for rules
- Preserve the knowledge if codesys.com changes structure or goes offline
- Make claims auditable — every rule cites a URL

## Sections

The 13 top-level sections under CODESYS *Reference: Programming*. Order matches the CODESYS TOC.

| # | Section | What's inside | Sub-pages |
|---|---|---|---|
| 01 | [Programming Languages and Editors](./01-languages-and-editors.md) | Editor surface for ST/FBD/LD/SFC/CFC/IL; ST statements (IF/FOR/CASE/etc.); assignment operators (`:=`, `=>`, `S=`, `R=`, `REF=`) | 24 |
| 02 | [Variables](./02-variables.md) | Every `VAR_*` kind, retentivity, scope, init rules, `THIS`/`SUPER` | 17 |
| 03 | [Operators](./03-operators.md) | Full operator catalog: arithmetic, logical, bit, comparison, system (`__NEW`/`__DELETE`/`__TRY`/`__VARINFO`/etc.), namespace operators | 64 |
| 04 | [Type Conversion Operators](./04-type-conversion.md) | `BOOL_TO_*`, `*_TO_REAL`, `TRUNC`, overloading, allowed coercions | 9 |
| 05 | [Operands](./05-operands.md) | Literals (BOOL, INT, REAL, STRING, UTF8#, char, TIME, DATE, typed); array/struct access; bit access; partial access; addresses | 14 |
| 06 | [Data Types](./06-data-types.md) | Elementary (BOOL, INT family, REAL, STRING, TIME, DATE, ANY, BIT, `__XINT`); derived (POINTER, REFERENCE, ARRAY, STRUCT, ENUM, ALIAS, UNION, subranges); `__VECTOR`, `VERSION` | 21 |
| 07 | [Pragmas](./07-pragmas.md) | Full pragma catalog: message, attribute (50+), conditional, region | 53 |
| 08 | [Identifier Designation](./08-identifiers.md) | Naming rules + recommendations for variables, DUTs, POUs, visualizations, library names | 8 |
| 09 | [Shadowing Rules](./09-shadowing.md) | When inner-scope names hide outer-scope names; legal vs error-prone shadows | 0 |
| 10 | [Keywords](./10-keywords.md) | The full reserved-word list (cannot be used as identifiers) | 0 |
| 11 | [FB Lifecycle: FB_Init / FB_Reinit / FB_Exit](./11-fb-lifecycle.md) | Instance-lifecycle method semantics: signatures, calling order, override rules | 0 |
| 12 | [Global Init Slots](./12-global-init-slots.md) | Initialization order for `VAR_GLOBAL`; slot numbers; `call_after_global_init_slot` pragma interaction | 0 |
| 13 | [Error Messages and Warnings](./13-error-messages.md) | CODESYS compiler diagnostic catalog (C0001–C0587), grouped and indexed | 190+ |

## Companion files

- [`_toc.json`](./_toc.json) — machine-readable tree of all 250+ sub-pages with URLs. Used by Stage 1+ TS modules.

## Status

| Stage | Section coverage |
|---|---|
| Stage 0 (this corpus) | Top-level summary per section + sub-page catalog with URLs |
| Stage 1 | Identifiers + Keywords deep-dive → `src/reference/identifiers.ts`, `src/reference/keywords.ts` + LSP diagnostics |
| Stage 2 | Pragmas deep-dive → `src/reference/pragmas.ts` |
| Stage 3 | FB Lifecycle deep-dive → `src/reference/lifecycle.ts` |
| Stage 4 | Shadowing → `src/reference/shadowing.ts` |
| Stage 5 | Data Types + Type Conversion + Operators deep-dive |
| Stage 6 | Operands + Init Slots + Error Messages |

## Conventions used in each section file

Each section file follows this template:

```
# <Section title>

> **Source:** <CODESYS URL>
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary
<One paragraph: what this section is about, why it matters for tooling/AI>

## Key rules
<Bulleted list of normative statements derived from the page>

## Catalog
<If the section has sub-pages: a table listing each with one-line description + source URL>

## Examples
<Short ST snippets illustrating the rules>

## Notes for tooling
<What of this is mechanically checkable; what's IDE-only>
```
