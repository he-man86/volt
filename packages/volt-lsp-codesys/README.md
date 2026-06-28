# @opencode-ai/volt-lsp-codesys

> TypeScript-native language server for the **CODESYS / TwinCAT** language family — Structured Text, VG (graphical), and the declaration kinds.

A from-scratch language server for the textual languages of the **CODESYS / TwinCAT (Beckhoff)** ecosystem —
Structured Text and the declaration kinds (interfaces, GVLs, DUTs), plus **VG**, the textual form of FBD/LD
graphical bodies — written in TypeScript with no LSP framework. It speaks LSP 3.17 JSON-RPC over stdio and is
navigation-and-diagnostics first: type-checking and code generation stay the IDE's job. It's named for the
vendor ecosystem, not one language; a structurally-different vendor (Siemens) would be a sibling LSP (see
"Adding another vendor LSP").

## Role in Volt

This is the analysis layer of the Volt data path. `volt-git` materializes a live PLC project into one text file per
item under the project root; this LSP analyzes those files. opencode and editors attach it for `.st` (and the related
text extensions `volt-git` writes — `.gvl`, `.struct`, `.enum`, `.union`, `.alias`), and it cross-indexes the whole
workspace so types declared in unopened files resolve.

It provides go-to-definition, find-references, implementation, document/workspace symbols, call hierarchy, type
hierarchy, hover, completion, signature help, semantic tokens, folding, document highlights, selection ranges, rename,
conservative formatting, code actions, and both push and pull diagnostics. It does not type-check or generate code —
the CODESYS/TwinCAT compiler remains authoritative. Graphical bodies are handled too: FBD/LD bodies round-trip through
a textual **VG** form (Volt Graphical), which this server parses and analyzes as a first-class sublanguage rather than
as ST.

## How it works

The pipeline is a layered, single-direction stack (the rust-analyzer shape): `lexer` → `parser` → `semantic` → `lsp`,
with `reference` as a pure-data sidecar that none of the lower layers depend on.

- **Lexer / parser.** `src/lexer/` tokenizes ST; `src/parser/` builds an AST, with one parser per POU kind under
  `parser/units/` (program, function, function-block, method, action, property, interface, type-decl, namespace,
  global-var-list). The parser is error-tolerant so a half-typed file still yields symbols and diagnostics.
- **Semantic layer.** `src/semantic/` builds the symbol table and project scope, a name resolver, and a language-neutral
  `BodyModel` per POU body. Diagnostics are a registry of small checks in `semantic/checks/` (identifier shape, unresolved
  identifiers, pragmas, FB lifecycle signatures, shadowing, interface implementation, type/operator/assignment mismatch,
  deref-on-non-pointer, vendor-only operators, and the VG checks), each gated by a per-check enable flag. The default
  config mirrors TwinCAT: a check is on only if TC itself rejects the code; stricter-than-TC lints ship off-by-default.
- **Embedded language reference.** `src/reference/` is structured, machine-readable facts (keywords, data types,
  operators, type conversions, pragmas, lifecycle methods, standard FBs, init slots) derived from the markdown corpora in
  `docs/codesys-reference/` and `docs/twincat-reference/`. It drives hover and completion content and the pragma/vendor
  diagnostics. Each entry is tagged `shared | codesys | twincat`; an `initializationOptions.vendor` setting
  (`codesys | twincat | auto`) selects the active dialect, so a CODESYS project never suggests TwinCAT-only names.
- **LSP wire.** `src/lsp/` is the only layer that knows LSP types. `lsp/server/` hand-rolls JSON-RPC framing, a flat
  request/notification dispatcher, debounced (push) diagnostics, and cancellation; `lsp/queries/` has one module per
  capability (with `queries/vg/` mirroring them for graphical bodies). `runServer({ input, output })` is embeddable on
  any stream pair. Capabilities are advertised gated by what the client declares it supports.
- **Graphical bodies (VG).** A POU body whose first significant token is `NETWORK` is routed to `src/vg/` (lexer-on-tokens,
  parser, writer, type inference) and the `queries/vg/` handlers instead of the ST path. This is the textual form of an
  editable FBD/LD body; CFC/SFC are read-only and not analyzed here.

The package, directory, and bin are all `volt-lsp-codesys` — named for the **vendor ecosystem** (CODESYS, and
TwinCAT which is CODESYS-derived), since it already covers all of that family's languages (ST + VG + the
declaration kinds). opencode and editors only ever spawn the bin (`dist/bin.js`) with `--stdio`.

## Commands

Per-package, from `packages/volt-lsp-codesys`:

```bash
bun typecheck        # tsgo --noEmit
bun test             # bun test runner (unit + conformance + e2e under src/tests/)
bun run build        # tsc -> dist/ (also runs on `prepare`, i.e. before publish)
bun run dev          # tsc --watch
```

The e2e tests spawn the built `dist/bin.js`, so build before running the full suite. Standalone, the bin also exposes
`volt-lsp-codesys lex <file>` (dump the token stream) and `--version`.

## Running inside opencode

opencode **registers** every configured LSP at startup but **spawns** it lazily — only when you open a matching
file, with **`cwd` = the project directory**. The `command` (in `.opencode/opencode.json`) is a repo-root-relative
path — `./packages/volt-lsp-codesys/dist/bin.js` — so it only resolves when **opencode's project dir is the built
monorepo root**; from any other cwd `node` ENOENTs and the server dies silently (exit 0). Two traps: the startup
line `enabled LSP servers: …` means *registered*, not *running* (the spawn is where a bad cwd bites); and bare bin
names don't work (opencode doesn't add `node_modules/.bin` to PATH) — always a path. The bin must route `--stdio`
(opencode only ever spawns with `--stdio`).

The one rule is **opencode's project dir must be the built monorepo root**:

| Surface | How | Why |
|---|---|---|
| CLI / TUI (from source) | `bun volt-scripts/dev.ts` | passes the repo root as the project dir |
| ~~`bun run dev`~~ | **broken** | forces `--cwd packages/opencode` → the relative path resolves one level too deep |
| Desktop (from source) | `bun run dev:desktop`, then open the monorepo root | same server; per-request `directory` = the opened folder |
| End user (their PLC project) | not yet | `volt init` should write an **absolute** LSP path — a productization gap |

Verify it actually loaded (build `dist/bin.js` first):

```bash
bun volt-scripts/verify-lsp.ts   # plants a bad .st, asserts source:"volt-lsp-codesys" diagnostics come back
bun volt-scripts/dev.ts          # opencode TUI from source with this LSP attached
```

By hand: `bun --conditions=browser packages/opencode/src/index.ts debug lsp diagnostics <file>.st` from the repo
root — JSON with `"source":"volt-lsp-codesys"` = loaded, `{}` = not (a clean file also yields `{}`, so the sample
plants an error on purpose).

## Layout

| Path | Role |
|---|---|
| `src/bin.ts` | CLI entry — routes `--stdio` to the server, plus `lex` / `--version` |
| `src/index.ts` | Public API re-exports (consumed by `volt-git` + the VS Code extension + the conformance harness) |
| `src/lexer/` | ST tokenizer (`lex`, tokens, spans) |
| `src/parser/` | AST + per-POU-kind parsers (`parser/units/`), type expressions, VAR sections |
| `src/semantic/` | Symbol table, resolver, type resolver, `BodyModel`, diagnostics orchestrator + `checks/` registry |
| `src/reference/` | Structured CODESYS/TwinCAT language facts (pure data) driving hover, completion, pragma diagnostics |
| `src/vg/` | VG (graphical FBD/LD textual form) — parser, writer, type inference, operator table |
| `src/lsp/` | LSP wire: `server/` (framing/dispatch/diagnostics-push), `queries/` (+ `queries/vg/`), `capabilities`, `config/`, `workspace` |
| `src/init.ts` | `installCorpus` — copies the reference corpus + writes `SKILL.md` into a consumer project at `volt init` |
| `src/detect-vendor.ts` | Vendor auto-detection from project files |
| `src/bridge-diagnostic-lines.ts` | Maps an IDE build diagnostic onto a line in the assembled `.st` file |
| `src/tests/` | Unit tests + the replayable conformance harness (`tests/conformance/`) and live/e2e tests |
| `docs/` | `codesys-reference/` + `twincat-reference/` corpora (shipped via `files`), `plcopen-xml/` notes |

## Adding another vendor LSP

A new LSP is a **different-structure vendor** (e.g. Siemens TIA Portal / SCL), **not** a new language — this
package already covers all of CODESYS/TwinCAT's languages. The recipe is config-only (never edit
`packages/opencode`):

1. **Package** `packages/volt-lsp-<vendor>/` (this package is the template): `bin: { "volt-lsp-<vendor>": "./dist/bin.js" }`, a `bin.ts` that routes `--stdio`, the server, and an `init.ts` exporting `installCorpus`.
2. **Wire opencode** — add an entry to `.opencode/opencode.json` (never the upstream `.jsonc`) with a repo-root-relative **path** + the file `extensions`.
3. **Ship the reference** — a `docs/<vendor>-reference/` corpus + a `buildSkillMd()` template in `init.ts`; `volt init` generates the skill into the consumer's `.claude/skills/` (never commit one).
4. **Verify** — extend `volt-scripts/verify-lsp.ts` + `check-volt-integration.ts`, and mention the vendor in `.opencode/agent/volt.md`.

Don't modify `packages/opencode`, rely on `.bin` shims, commit a `.claude/skills/` file, or add a per-vendor
agent persona (extend the single `volt` agent). `tryInstallCorpus` (`volt-git/src/init.ts`) installs from this
one package today — fan it out across LSP packages when the second vendor lands.

## See also

- [`../volt-bridge/docs/vg-language.md`](../volt-bridge/docs/vg-language.md) — the VG (Volt Graphical) language spec for FBD/LD bodies
- [`../volt-bridge/docs/vg-diagnostics.md`](../volt-bridge/docs/vg-diagnostics.md) — VG diagnostics reference
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — Volt design, roadmap, and decision log
- [`../../CLAUDE.md`](../../CLAUDE.md) — fork overview, architecture, and conventions
