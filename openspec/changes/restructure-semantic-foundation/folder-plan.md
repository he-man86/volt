# Folder & file plan — the ground-up structure

Detailed, iterated target layout for the clean rebuild. Rule: **folders = layers, imports point downward
only** (`syntax ← symbols ← types ← analysis ← services ← server`; `reference`/`graphical` beside/above
`types`). Built from the 118-file inventory; every existing file is re-homed below (nothing orphaned), and the
layout is cross-checked against every LSP feature + diagnostic + sublanguage.

## Iteration log

- **v1** — map each current folder to a layer (lexer+parser→syntax, semantic split into symbols/types/analysis,
  lsp/queries→services, lsp/server→server, vg→graphical, reference kept).
- **v2 (feature cross-check)** surfaced: (a) `body.ts` straddles parse+VG-detect → it's *body materialization*,
  give it `syntax/body.ts`; (b) VG **checks** (`check-vg-*`) belong in `graphical/`, not `analysis/checks`;
  (c) VG **query variants** (`queries/vg/*`) are the VG branch of features → `graphical/services/`; (d)
  `capabilities.ts` mixes the capability *declaration* (→ server) with symbol-kind *mapping* (→
  services/shared); (e) the CLI (`bin.ts`, `init.ts`) is not part of the LSP layers → its own `cli/`.
- **v3 (grouping)** — group `analysis/checks` and `services` by concern (below), so the ~40 leaf files aren't a
  flat pile; give diagnostics `config` + `messages` explicit homes.
- **v4 (native graphical integration)** — `graphical/` is a **cohesive umbrella module that is native by
  *reuse*, not by duplication.** The old VG was non-native because it carried its OWN type engine
  (`vg/type-infer`, bare strings) and its own query variants — a parallel stack. The rebuilt `graphical/`
  *imports* the shared core (`types/`, `symbols/`, `analysis/` primitives, `services/shared`) and adds ONLY
  what is genuinely graphical: the surface syntax (a graph, not a statement tree) + graph-structure checks.
  One type engine, one diagnostics orchestrator, one service set — graphical is a second front-end that plugs
  in, not a second stack. Kept as one folder (easy to find; room for more graphical languages), but every
  semantic import points DOWN into the shared layers.

## Target tree (final)

```
src/
├── syntax/                    # A — lexical + syntactic (no semantics)
│   ├── token.ts               ← lexer/tokens.ts
│   ├── span.ts                ← lexer/span.ts
│   ├── lexer.ts               ← lexer/lexer.ts
│   ├── ast.ts                 ← parser/ast.ts                (COMPLETE model: structured type-exprs, literals w/ value)
│   ├── ast-walk.ts            ← parser/ast-walk.ts
│   ├── parser.ts              ← parser/parser.ts             (driver: parse → { units, diagnostics })
│   ├── cursor.ts · util.ts    ← parser/cursor.ts · parser/util.ts
│   ├── body.ts                ← semantic/body.ts            (materialize a POU body → statements | VG marker)
│   └── parse/
│       ├── expressions.ts     ← parser/expression.ts
│       ├── statements.ts      ← parser/statements.ts
│       ├── types.ts           ← parser/type-expr.ts
│       ├── var-section.ts     ← parser/var-section.ts
│       └── units/*            ← parser/units/*  (10 files)
├── symbols/                   # B — binder
│   ├── symbol.ts · scope.ts   ← semantic/symbol-table.ts (split types)
│   ├── binder.ts              ← semantic/symbol-table-build.ts (split via one makeScope)
│   ├── scope-nav.ts           ← NEW (the 6+ scope walks)
│   ├── resolver.ts            ← semantic/resolver.ts
│   └── occurrences.ts         ← semantic/identifier-scan.ts   (identifier index for references)
├── types/                     # C — the type system (clean core)
│   ├── elementary.ts          ← semantic/type-system/elementary.ts   ✅ built
│   ├── type.ts                ← NEW (the Type model)
│   ├── resolve.ts             ← semantic/type-resolver.ts
│   ├── infer.ts               ← semantic/type-infer.ts
│   ├── const-eval.ts          ← NEW
│   ├── compat.ts              ← NEW (isAssignable + isAcceptableSource + narrowing + temporalArith)
│   └── render.ts              ← NEW (merge 4 renderers)
├── analysis/                  # D — diagnostics
│   ├── diagnostics.ts         ← semantic/diagnostics.ts (orchestrator)
│   ├── config.ts              ← lsp/config/index.ts (which checks run, vendor-keyed)
│   ├── messages.ts            ← NEW (per-vendor builders; cannotConvert lives here)
│   ├── exclude-marker.ts      ← semantic/exclude-marker.ts
│   └── checks/
│       ├── _shared.ts         ← semantic/checks/_shared.ts (minus scope-nav, now in symbols/)
│       ├── types/             ← assignment · binary · conversion · narrowing · call-arguments · deref · vendor-only-operator
│       ├── declarations/      ← var-section-placement  + NEW: subrange · overflow · array-bounds · composite-shape · member-count
│       ├── names/             ← unresolved-identifier · identifier-shape · shadowing
│       ├── oop/               ← interface-implementation · abstract-instantiation · lifecycle · external-write
│       └── pragmas/           ← pragmas
├── services/                  # E — LSP language services
│   ├── shared/                ← resolve-at (symbol-refs+scope-at+st-body-at+identifier-at) · position · locations(NEW) · symbol-kinds(NEW, +humanKind) · token-scan(NEW)
│   ├── navigation/            ← definition · references · rename · document-highlight · implementation
│   ├── hierarchy.ts           ← call-hierarchy + type-hierarchy (merged)
│   ├── assist/                ← hover · completion · signature-help
│   ├── semantic-tokens.ts     ← semantic-tokens.ts
│   ├── structure/             ← document-symbol · workspace-symbol · folding-range · selection-range
│   ├── formatting/            ← format · format-print · editorconfig(NEW, extracted)
│   └── code-actions.ts        ← code-action.ts
├── reference/                 # F — language reference catalogs (data)
│   ├── index.ts · data-types · operators · type-conversion · pragmas · standard-functions · standard-fbs · lifecycle · init-slots · keywords
│   └── catalog.ts             ← semantic/reference-catalog.ts (semantic access)
├── graphical/                 # F — the graphical-languages family (cohesive; native by REUSE of the core)
│   ├── index.ts               ← vg/index.ts (isGraphicalBody, the public surface)
│   ├── text/                  # the readable text ENCODING (current VG/GT) — sibling room for a future format
│   │   ├── ast.ts · parser.ts · writer.ts · operators.ts · identifiers.ts   ← vg/*
│   ├── infer.ts               ← vg/type-infer.ts, REWRITTEN as a thin adapter onto types/infer (kill the parallel engine)
│   ├── checks/                ← check-vg-code · check-vg-structure (registered with analysis/diagnostics)
│   └── services/              ← queries/vg/*  (the graphical branch of nav/hover/tokens/symbols/folding; reuses services/shared)
├── server/                    # G — protocol
│   ├── server.ts              ← lsp/server/index.ts
│   ├── dispatch.ts · framing.ts · diagnostics-push.ts   ← lsp/server/*
│   ├── capabilities.ts        ← lsp/capabilities.ts (declaration only)
│   ├── workspace.ts           ← lsp/workspace.ts
│   ├── detect-vendor.ts       ← detect-vendor.ts
│   └── protocol-types.ts      ← lsp/types.ts
├── transpile/                 # (FUTURE) a compiler BACKEND — AST + types → target source. NOT built today;
│   │                          #   the structure reserves its home. Sibling consumer of the frontend, like services/.
│   ├── index.ts               # transpile(units, semantics) → emitted files
│   ├── lower.ts               # AST → a small IR (normalize control flow; attach resolved types/const values)
│   └── rust/                  # the first target (umbrella like graphical/ — room for c/ · wasm/ later)
│       ├── emit.ts            #   IR → Rust source
│       ├── types.ts           #   IEC type → Rust type (INT→i16, BYTE→u8, subrange/overflow semantics) — uses types/elementary
│       └── runtime/           #   Rust scaffolding: scan-cycle harness + IEC std blocks (TON/CTU/…)
├── cli/                       ← bin.ts · init.ts (+ fs-walk.ts)
├── index.ts                   # public API surface
└── test/                      # mirrors the src tree (conformance harness); test/exec/ runs transpiled Rust
```

## Feature-coverage cross-check (every capability + diagnostic has a home)

| LSP feature (capability) | Home |
|---|---|
| definition · references · rename · documentHighlight · implementation | `services/navigation/` |
| callHierarchy · typeHierarchy | `services/hierarchy.ts` |
| hover · completion · signatureHelp | `services/assist/` |
| semanticTokens | `services/semantic-tokens.ts` |
| documentSymbol · workspaceSymbol · foldingRange · selectionRange | `services/structure/` |
| formatting | `services/formatting/` |
| codeAction | `services/code-actions.ts` |
| publishDiagnostics | `analysis/` + `server/diagnostics-push.ts` |
| (VG variants of hover/nav/tokens/symbols/folding) | `graphical/services/` |

| Diagnostic family | Home |
|---|---|
| type compatibility (assign/binary/convert/narrow/call-arg/deref/vendor-op) | `analysis/checks/types/` |
| declaration well-formedness (var-section + the new typechecker rows: subrange/overflow/bounds/shape/member-count) | `analysis/checks/declarations/` |
| name resolution/shape (unresolved/identifier/shadowing) | `analysis/checks/names/` |
| OOP (interface-impl/abstract/lifecycle/external-write) | `analysis/checks/oop/` |
| pragmas | `analysis/checks/pragmas/` |
| VG code + structure | `graphical/checks/` |

**No feature is homeless; no file is orphaned.** The `st-static-typechecker` gap rows land in
`analysis/checks/declarations|types/`, consuming `types/` — they slot straight in.

## Naming: "graphical", not "VG"

The sublanguage is **the readable text form of the FBD/LD graphical languages** — graphical PLC logic
rendered as ST-like text that round-trips PlcOpen XML. "VG" (Volt Graphical) hides that. In the LSP we name it
descriptively: the module is **`graphical/`** and internal identifiers rename `isVgBody`→`isGraphicalBody`,
`check-vg-*`→`graphical/checks`, `VgType`→… . This reinforces native integration: because it is ST-readable
text, its expressions are ST-typed and flow through `types/` directly.

**Why `graphical/` (an umbrella), not a format name.** "Graphical" is the family of graphical PLC languages —
FBD/LD (editable, via the text form) today, CFC/SFC (read-only markers) now, and room for more editable ones
later. A format-specific name (`vg/`, `fbd/`) would need renaming the moment a second graphical language lands;
`graphical/` already has the room. So the module is the umbrella, and the current text *encoding* (VG/GT) is
just one file-set inside it (`graphical/text/`), leaving siblings free for a future format. **Scope note:** the `VG` *wire/protocol*
term (C# `VgParser`/`VgWriter`/`VG_NOT_CANONICAL`, `volt-git`, `volt-vscode`, the `vg-language.md` spec) is
product-wide and is NOT renamed here — a canonical rename (candidate: **GT, "Graphical Text"**) is a separate
cross-package change so the bridge protocol stays stable during this LSP rebuild.

## Future backend: the Rust transpiler (headless test execution)

Not built today, but the structure reserves its home so it fits natively when it lands. A transpiler is a
compiler **backend**: it reads the same frontend the LSP reads — `syntax/` (AST) + `symbols/` (resolved
names) + `types/` (types + `const-eval`) — and emits Rust instead of editor answers. So it is a **sibling
consumer of the frontend**, alongside `analysis/` and `services/`; it does NOT import them (a backend needs no
diagnostics or hover). This is the architecture paying off: one clean frontend, many backends (LSP today, Rust
transpiler next).

- **`transpile/`** owns AST→target lowering + emission; `transpile/rust/` is the first target (umbrella, room
  for `c/`/`wasm/`). IEC→Rust type mapping consumes `types/elementary` directly (INT→i16, BYTE→u8, subrange &
  overflow semantics from the ranges), so the type-system rebuild is its enabler.
- **Purpose = testing.** `test/exec/` transpiles a POU to Rust, `cargo build`s it, drives inputs across scan
  cycles, and asserts outputs — headless PLC-logic unit tests (the toolchain-map's Phase-5 north star, via the
  transpiler path rather than an interpreter).
- **Layering:** `transpile ← types ← symbols ← syntax`. Reserve the folder now; leave it empty until built.

## Open decisions (resolve before building the affected layer)

1. **VG query variants** — `graphical/services/` (own the VG branch) vs. folding the VG branch into each
   `services/*` file. *Lean:* keep in `graphical/services/`; `services/` delegates via a `withVgFallback`
   combinator, so a new position-query can't forget the VG branch.
2. **`analysis/config.ts` vs `server/`** — the diagnostic-enablement config is init-options-driven (server) but
   semantically an analysis concern. *Lean:* `analysis/config.ts` (consumed by `diagnostics.ts`); the server
   just passes init-options through.
3. **`body.ts` layer** — `syntax/` (it's parse-orchestration) vs a thin `model/`. *Lean:* `syntax/body.ts`.
4. **checks/types/ `deref` + `vendor-only-operator`** — type-ish but not compatibility; acceptable in `types/`
   or a `misc/`. *Lean:* `types/` (both are operand-type rules).

## Build order into this tree (unchanged from architecture.md)

A `syntax/` → B `symbols/` → C `types/` → D `analysis/` → E `services/`, with `reference/`+`graphical/` woven
at C+, `server/` last. Each layer: create the folder, build/rebuild its files clean, migrate consumers, delete
the old folder once subsumed (old stays as reference meanwhile). Suite green at every commit.
