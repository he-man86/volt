# Phase 0 research: FBD/LD body XML → ST source text

Date: 2026-06-03
Source: web research + reading CODESYS / TwinCAT scripting docs

## Question

Can we reuse an existing tool or vendor API to transpile PLCopen TC6 v2.01 FBD/LD `<body>` XML into ST source text?

## Findings

### Vendor APIs — both say no

**CODESYS Scripting Engine.** `IScriptObjectWithTextualImplementation.textual_implementation.text` returns content only for ST POUs (`has_textual_implementation == True`). For FBD/LD POUs the property is unavailable. CODESYS team forum statement: *"We can only edit Structured Text directly. For the graphical languages you have to import the POU from PLCopenXML or our native format."* `export_xml` / `import_xml` round-trip XML but don't transpile.

**TwinCAT XAE Automation Interface.** `ITcPlcImplementation.ImplementationText` + `ImplementationXml` exist, plus `ProduceXml` / `ConsumeXml`. But Beckhoff's documentation confirms: *"Language conversion between textual (ST, IL) and graphical (LD, FBD, SFC) representations is not supported in TwinCAT 3."* The XAE UI's "Convert Object…" option is grayed out for cross-paradigm conversions.

Conclusion: no free ride from either vendor. We can't ask the IDE "give me the ST equivalent of this FBD body."

### Open-source implementations — all GPL

**Beremiz IDE — `PLCGenerator.py`** (https://github.com/beremiz/beremiz). GPLv2-or-later, Python, ~1,350 lines. The canonical reference. From the documentation: *"A module is responsible to translate PLCOpen graphical language (FBD and LD) into ST. This part is integrated into the graphical editor, but may be used independently. The reverse value propagation algorithm is used to convert these graphical languages into ST."*

Key classes / methods to mine for algorithm:
- `ProgramGenerator`, `PouProgramGenerator`
- `ComputeProgram`, `ComputeFBDExpression`, `ComputeLDExpression`
- `ComputeConnectionTypes`, `ComputeBlockInputTypes`
- `GenerateCurrentProgram`

**OpenPLC Editor (v4)** (https://github.com/Autonomy-Logic/openplc-editor). GPL-3.0. v4 is an Electron+TS rewrite of an earlier Beremiz fork; the FBD→ST compile chain still bundles the same Python `PLCGenerator` from Beremiz heritage.

**MatIEC.** Doesn't take FBD as input — only textual IEC 61131-3 (ST/IL/SFC) → C. Not in this path.

License blocker: GPL contamination would force Volt to be GPL. Volt is a closed/proprietary SaaS. Direct reuse or porting line-by-line creates derivative-work risk.

### Other tooling — irrelevant

PyLC (FBD → Python, academic, abandoned), PLCOpen-XML-to-Text-Parser (pretty-prints XML, doesn't transpile), plcopen-xml-xcore (Java parser, no transpile). No npm package surfaced.

## Verdict — option (c)

**Write our own FBD/LD → ST transpiler in TypeScript, in `packages/volt-agent/src/engine/transpile-graphical-to-st.ts`, using Beremiz's `PLCGenerator.py` as an algorithmic REFERENCE (clean-room — read, understand, reimplement, do not copy code).**

Why not the other options:
- **(a) Direct reuse**: blocked by GPL.
- **(b) Port Beremiz to TS**: still produces a GPL-derivative work risk.
- **(d) Vendor APIs**: both CODESYS and TwinCAT explicitly disclaim FBD→ST conversion.

What clean-room means here:
- Read the Beremiz algorithm at a conceptual level (called "reverse value propagation")
- Reimplement from scratch in TS using only:
  - The PLCopen TC6 v2.01 XML schema (public standard)
  - IEC 61131-3 ST grammar (public standard)
  - Our existing PLCopen XML parser in volt-agent/volt-lsp-st
- Don't copy variable names, function names, comment structure, or line-by-line logic from Beremiz

Benefits beyond licensing:
- Full control over output style (match the project's ST formatter conventions)
- Tight integration with the existing `BodyModel` infrastructure
- Native handling of CODESYS-specific vs Beckhoff-specific XML quirks the bridges already normalize
- No Python sidecar in the workspace runtime

## Out-of-scope confirmations

- **SFC**: Beremiz handles SFC→ST in the same `PLCGenerator.py`. If/when Volt scopes SFC in, this research path extends naturally.
- **IL**: per project memory `il-out-of-scope`, deferred.
- **CFC**: CODESYS's free-form variant, NOT in PLCopen TC6 v2.01. Beremiz doesn't handle it. Separate research if it enters scope.

## Algorithm name to learn first

"Reverse value propagation" — Beremiz's documented algorithm for graphical → ST. Worth reading the paper / Beremiz source comments on this before writing Phase 2A code.
