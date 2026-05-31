# `body/` — body-language plug-in surface

Each POU file is **declaration on top + body underneath**:

```
FUNCTION_BLOCK X
VAR_INPUT … END_VAR
VAR        … END_VAR        ← shared, parsed by the ST parser
                              regardless of body language

<body xmlns="…"><FBD>…</FBD></body>    ← body — language-specific

END_FUNCTION_BLOCK
```

The declaration is identical across **structured-text / plc-fbd /
plc-ld / plc-sfc / plc-cfc**. Only the body shape differs (ST source
text vs PLCopenXML islands).

This module owns "body" — every body language plugs in a parser that
emits a normalized `BodyModel`. The rest of the LSP (references,
hover, completion, diagnostics, …) reads `BodyModel.identifiers`
without knowing which language produced it. **80%+ of LSP features
work for every body language with zero language-specific code paths.**

---

## Architecture

```
body/
  README.md                     ← this file
  types.ts                      ← BodyModel discriminated union,
                                  BodyParser interface, language IDs
  index.ts                      ← parser registry + dispatch +
                                  cross-doc walker + lookup helpers
  st/parser.ts                  ← ST body parser (wraps existing
                                  ST identifier scan)
  fbd/parser.ts                 ← FBD body parser
  fbd/xml.ts                    ← dependency-free XML reader,
                                  shared with LD/SFC/CFC parsers
  ld/parser.ts                  ← (P4)
  sfc/parser.ts                 ← (P4)
  cfc/parser.ts                 ← (P4)
```

## `BodyModel` — the normalized surface

A discriminated union — `languageId` narrows TypeScript:

```ts
type BodyModel = STBodyModel | GraphicalBodyModel;

interface STBodyModel {
  languageId: "structured-text";
  span: Span;
  identifiers: IdentifierRef[];   // language-neutral
  calls: CallSite[];              // language-neutral
  st: BodySpan;                   // ST-only: raw token stream
}

interface GraphicalBodyModel {
  languageId: "plc-fbd" | "plc-ld" | "plc-sfc" | "plc-cfc";
  span: Span;
  identifiers: IdentifierRef[];   // language-neutral
  calls: CallSite[];              // language-neutral
  graph: GraphBody;               // graphical-only: nodes+connections
}
```

**Language-neutral fields** (`identifiers`, `calls`) are populated by
every parser. Queries that walk them (`references.ts`,
`document-highlight.ts`, `call-hierarchy.ts`,
`check-unresolved-identifier.ts`) work for every language without
branches.

**Variant-specific fields** (`st`, `graph`) are walked only by
language-specific code. ST-grammar diagnostics (`check-conversion`,
`check-assignment-types`, `check-binary-operators`, …) narrow via
`if (model.languageId === "structured-text")` to read `model.st`.
FBD-specific diagnostics (P5) narrow the other way to read
`model.graph`.

## Adding a new body language

1. **Edit `types.ts`** — add the languageId to `BODY_LANGUAGE_IDS` (and
   to `GRAPHICAL_LANGUAGE_IDS` if it's an XML/graphical language).
2. **Implement the parser** under `body/<lang>/parser.ts` —
   `BodyParser` with `parse(input): BodyModel`. For PLCopenXML-shaped
   languages, reuse `fbd/parser.ts::parseGraphicalBody(input, "<TAG>")`
   for the standard `inVariable`/`outVariable`/`block`/`connection`
   vocabulary; add language-specific element handling on top
   (LD: `<contact>`/`<coil>`; SFC: `<step>`/`<transition>`/`<jump>`).
3. **Register in `index.ts`** — add an entry to `bodyParsers`.
4. **Add a fixture** under `conformance/fixtures/<lang>/` —  a real
   export from CODESYS or TwinCAT proves the parser handles real
   vendor output.
5. **Add a parser test** under `body/<lang>/parser.test.ts` mirroring
   `body/fbd/parser.test.ts`.

That's it. No changes to LSP queries, no changes to existing
diagnostics, no changes to the workspace dispatch. The 80% of the
LSP that reads `BodyModel.identifiers` works on the new language
the moment its parser is registered.

## Adding a language-specific diagnostic

1. Put the check under `semantic/checks/_<lang>/<check-name>.ts`.
2. Register it in `semantic/diagnostics.ts::CHECKS` with
   `languages: ["plc-fbd"]` (or whichever language IDs it applies
   to). The orchestrator gates by `languageId` automatically; the
   check never runs on non-target languages.

## The diagnostic-check registry

`semantic/diagnostics.ts` walks `CHECKS: CheckSpec[]` once per
document — gates each entry by:

- `enabled(config)` — user-configurable flag
- `languages` — undefined = universal; otherwise the array of
  language IDs the check applies to

Universal checks (no `languages` field) operate on declarations or
on the language-neutral `BodyModel.identifiers` surface, so they
work for every body language automatically. Adding a language
doesn't require touching universal checks.
