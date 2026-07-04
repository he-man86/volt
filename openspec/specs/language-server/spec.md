# language-server Specification

## Purpose

The Volt IEC 61131-3 language capability — unified into one spec so there is a single place to work from toward accurate, compiler-parity analysis.

It covers three concerns that were previously separate capabilities:

1. **The `volt-lsp-iec` language server** — navigation, diagnostics, symbol resolution, and the ST statement/expression AST (the treewalker). LSP-owned.
2. **The VG graphical sublanguage** the LSP analyzes (editable FBD/LD as text). Its *code correctness* is LSP-owned; its **format and PlcOpen⇄VG round-trip are bridge-owned** (`volt-bridge`).
3. **The on-disk workspace file layout** the LSP reads (kind-named files, in-content markers). This is **bridge/CLI-owned** (`volt-bridge` writes it, `volt-git` reconciles it); it lives here because the LSP consumes it offline.

Ownership note: sections A–D are LSP requirements. Sections E–F are **bridge/CLI-owned** — included because the LSP depends on them, but changes to VG format/round-trip or file materialization are implemented in `volt-bridge` / `volt-git`, not the language server. See also the sibling specs `bridge-protocol` (the HTTP wire) and the roadmap in `toolchain-map.md`.

### Direction (north star)

This spec states what is true *today*; the end-state we build toward is:

1. **Compiler-parity diagnostics** — accurate, type-aware analysis driven by the ST body AST (the treewalker) and an expression type-inference engine, so the LSP catches what the CODESYS/TwinCAT compiler catches (e.g. narrowing conversions, argument-type mismatches) without a build. *In flight:* change `st-type-inference`.
2. **Structural formatting** — a pretty-printer that formats from the AST (spacing, alignment, line-breaking), not keyword-indent heuristics. *Planned:* change `st-format`.
3. **Headless ST test execution** — let users unit-test their Structured Text in CI with no IDE/hardware: a scan-cycle **interpreter** over the same AST (`set inputs → run N scans → assert outputs`), so `bun test` can drive PLC logic. A JS/C **transpiler** is a deferred alternative, considered only if large/fast simulation is later needed. *Scoped:* change `st-interpreter`.

Each becomes a requirement here **only when it lands** (as the body-AST requirements did). Until then the goal lives in `toolchain-map.md` and the named change proposals — the spec stays a contract, not a wishlist.
## Requirements

<!-- ══════════ A. Analyzer — scope & boundaries (LSP-owned) ══════════ -->

### Requirement: Navigation and diagnostics, never type-checking

The language server SHALL provide navigation, hover, completion, signature help, semantic tokens,
and diagnostics. It MAY infer types to make its diagnostics accurate (e.g. narrowing conversions,
argument-type mismatches), but SHALL NOT be the authoritative type-checker or generate code — the
CODESYS/TwinCAT compiler remains the source of truth for final type-checking and codegen, and every
LSP type diagnostic SHALL be conservative (skip on any unresolved type rather than risk a false
positive). It speaks LSP 3.17 JSON-RPC over stdio and SHALL be spawned only with `--stdio`.

#### Scenario: The IDE compiler stays authoritative
- **WHEN** the LSP analyzes a project
- **THEN** it surfaces navigation + type-aware diagnostics but defers final, authoritative type-checking/codegen to the IDE

#### Scenario: Type-aware diagnostics are conservative
- **WHEN** the LSP cannot fully resolve the type of an expression
- **THEN** it emits no type diagnostic for it (unknown types skip), never a guess

### Requirement: The server is vendor-keyed

The server SHALL be named for the vendor ecosystem (`volt-lsp-iec` covers CODESYS + the
CODESYS-derived TwinCAT). A structurally-different vendor (e.g. Siemens) SHALL be a sibling LSP, not
a new language inside this one. The active dialect SHALL be selected by
`initializationOptions.vendor` (`codesys | twincat | auto`), so a CODESYS project never suggests
TwinCAT-only names.

#### Scenario: Dialect gates vendor-only names
- **WHEN** `vendor` is `codesys`
- **THEN** TwinCAT-only reference entries are not offered in completion or hover

### Requirement: The LSP is one vendor-neutral IEC engine with an evidence-backed dialect layer

The language server SHALL be a single binary that serves both CODESYS and TwinCAT through a runtime
`vendor` setting (`codesys | twincat | auto`) — there SHALL NOT be a separate per-vendor LSP for
CODESYS vs TwinCAT (they are the same IEC 61131-3 language). The package name SHALL be vendor-neutral.

Every vendor-gated behavior (the `wrong-vendor-pragma` check, the CODESYS-only `__`-operator check, and
each `codesys`/`twincat`-tagged reference-catalog entry) SHALL be justified by evidence that both vendors
do NOT accept the item. An item both vendors accept SHALL be tagged `shared`, not vendor-specific, so it
raises no `wrong-vendor` diagnostic.

#### Scenario: One LSP serves both vendors
- **WHEN** a workspace is CODESYS or TwinCAT
- **THEN** the same LSP binary analyzes it, differing only by the runtime `vendor` setting — no separate executable

#### Scenario: A construct both vendors accept is not flagged
- **WHEN** source uses a pragma / operator / identifier that both CODESYS and TwinCAT accept
- **THEN** the LSP raises no `wrong-vendor-pragma` or vendor-only-operator diagnostic for it (it is tagged `shared`)

#### Scenario: A genuinely dialect-specific construct is still flagged
- **WHEN** source uses a construct only one vendor accepts (e.g. a CODESYS-only `__`-operator under a TwinCAT project)
- **THEN** the LSP flags it, backed by recorded ground truth that the active vendor rejects it

### Requirement: The LSP is wired into the agent's session for a consumer PLC project

The volt LSP SHALL be available to the AI agent when it edits Structured Text in an **end-user PLC
project**, not only inside the Volt dev repo. The agent toolchain — LSP + `volt` tool + agent + theme
+ permissions — SHALL be handed to opencode as one read-only config dir via the **`OPENCODE_CONFIG_DIR`**
env var (set by the desktop shell and the `volt` binary), with that config's bin dir prepended to
`PATH` so its bare-name `volt-lsp-iec` command resolves **outside the Volt repo** (published /
global / bundled — never a repo-relative path). `volt init` SHALL NOT write a per-project `.opencode/`;
it only binds the IDE project and installs vendor skills. An agent editing `.st` in a bound PLC
project MUST receive the LSP's diagnostics through its tool loop.

#### Scenario: Agent gets PLC diagnostics in a consumer project
- **WHEN** the agent edits a `.st` file in an end-user PLC project (not the Volt repo)
- **THEN** the volt LSP is running and its diagnostics are surfaced to the agent — it is not writing ST blind from training data

#### Scenario: The command resolves by bare name, not a repo-relative path
- **WHEN** opencode opens a PLC project whose directory is not the Volt repo
- **THEN** the LSP command resolves via the `OPENCODE_CONFIG_DIR` bin on `PATH` (published/global/bundled), not via `./packages/volt-lsp-iec/...`

<!-- ══════════ B. Analyzer — parsing, indexing & the body AST (LSP-owned) ══════════ -->

### Requirement: Parsing is error-tolerant

The parser SHALL be error-tolerant, so a half-typed file still yields symbols and diagnostics
rather than failing wholesale.

#### Scenario: A half-typed file still yields symbols
- **WHEN** a file is mid-edit with a syntax error
- **THEN** the server still returns document symbols and diagnostics for the valid portions

### Requirement: The workspace is cross-indexed

The server SHALL cross-index the whole workspace so that types declared in unopened files resolve.

#### Scenario: A type in an unopened file resolves
- **WHEN** a file references a DUT declared in another, unopened file
- **THEN** go-to-definition and type resolution succeed

### Requirement: ST POU bodies are parsed into a statement/expression AST

The language server SHALL parse the body of every Structured Text POU (function block, program, function, method, action, property accessor) into a statement/expression abstract syntax tree, in addition to the existing token stream. The tree SHALL cover the ST statement forms (`IF`/`ELSIF`/`ELSE`, `CASE`, `FOR`, `WHILE`, `REPEAT`, assignment, `RETURN`/`EXIT`/`CONTINUE`, and bare call statements) and the ST expression forms (binary and unary operators with IEC precedence, member access `a.b`, indexing `a[i]`, dereference `p^`, address-of, function/method calls with positional and named `param := value` arguments, parenthesised sub-expressions, identifiers, and typed/untyped literals). Every node SHALL carry the source span of its tokens so LSP queries can map a node back to document coordinates.

The tree SHALL also cover the CODESYS/IEC constructs the real-project corpus exercises: the set/reset/reference assignment operators (`S=`, `R=`, `REF=`), chained assignment (`a := b := c`), inline assignment used as an expression (`(x := v)`, `IF x := f() THEN`), bit access (`x.0`), unconnected call arguments (`in := ,` / `out => ,`), the `__TRY`/`__CATCH`/`__FINALLY`/`__ENDTRY` exception block, and a bare-expression statement. An accessor's own access modifier (`SET PRIVATE …`) SHALL NOT leak into its body.

The parsed tree SHALL be exposed on the body model for `language: "st"` bodies. VG (graphical) bodies SHALL retain their existing dedicated model and SHALL NOT be given an ST statement tree.

#### Scenario: Member-chain expression is structured, not flattened
- **WHEN** a body contains `alarmCondition := IMM.AutoOperation AND (ActState = StateWaitForMouldClosed);`
- **THEN** the body model exposes an assignment statement whose right-hand side is a binary `AND` expression, whose left operand is a member-access expression (`IMM` . `AutoOperation`), each node carrying its own source span

#### Scenario: Call arguments are captured with names and positions
- **WHEN** a body contains `Increment.State(ActState, XUnitsToParking(), StateTakeover1PosCheck);`
- **THEN** the tree exposes a call expression on `Increment.State` with three positional arguments, the second of which is itself a call expression

#### Scenario: Statement structure is available for control flow
- **WHEN** a body contains a `CASE ActState OF … END_CASE` with labelled arms
- **THEN** the tree exposes a case statement with its selector expression and one entry per labelled arm, rather than an undifferentiated token run

### Requirement: Body parsing degrades conservatively and never regresses precision

Parsing a body into the statement/expression AST SHALL NOT raise any new diagnostic. When a body cannot be parsed cleanly into the tree, the language server SHALL fall back to the existing token-scan representation for that body so that all current queries and diagnostics continue to function unchanged. Introducing the AST SHALL NOT change the diagnostics produced on the committed real-project corpora: parse-clean percentage, ingest percentage, and the per-corpus diagnostic floors asserted by the corpus ratchet test SHALL be greater-than-or-equal to their current baselines for every corpus (pro2193, bakon-nano, awa-palletizer, lenze-mid).

#### Scenario: Unparseable body still resolves identifiers
- **WHEN** a body contains a construct the new grammar does not yet model
- **THEN** the body model still yields its identifier and call lists via the token-scan fallback, and no parse-error diagnostic is emitted for that body

#### Scenario: Corpus ratchet holds
- **WHEN** the corpus coverage test runs after the AST is introduced
- **THEN** each corpus reports parse-clean, ingest, and total-diagnostic counts no worse than its committed baseline

#### Scenario: The tree covers every body on the real-project corpus
- **WHEN** the corpus coverage test measures body-AST-clean (bodies that parse fully into the statement tree) across all four corpora
- **THEN** it reports 100% (pro2193, bakon-nano, awa-palletizer, lenze-mid) with zero identifier-set mismatches, so the token-scan fallback is exercised only by genuinely malformed input, never by real code

<!-- ══════════ C. Analyzer — diagnostics (LSP-owned) ══════════ -->

### Requirement: Diagnostic defaults mirror TwinCAT

A diagnostic check SHALL be enabled by default only if TwinCAT itself rejects the code; lints
stricter than the compiler SHALL ship off-by-default. Each check is individually gated by an enable flag.

#### Scenario: A stricter-than-compiler lint is off by default
- **WHEN** the default configuration is used
- **THEN** a lint that TwinCAT would accept is not reported unless explicitly enabled

### Requirement: LSP diagnostics cover what the bridge rejects

The LSP's diagnostics SHALL flag any Structured Text that the bridge will reject on push, so the agent's
write-time feedback predicts push success (invariant: LSP diagnostics ⊇ bridge rejections). Where Volt
chooses to accept a form (e.g. signature-only interface methods), the bridge SHALL accept it too — the
LSP and bridge MUST agree on validity.

#### Scenario: A bridge-rejected form is caught at write time
- **WHEN** the agent writes ST the bridge would reject (e.g. an interface `METHOD` with no `END_METHOD`, if Volt keeps that strict)
- **THEN** the LSP reports a diagnostic for it — or, if Volt accepts the form, the bridge accepts it too (no divergence)

### Requirement: Diagnostics skip build-excluded objects

The LSP SHALL NOT emit semantic diagnostics for an item whose `excludeFromBuild` flag is `true`. Because
the LSP analyzes files on disk with no live bridge, that flag reaches it as the in-file
`(* @volt-exclude-from-build *)` marker written on pull (see "Build-excluded source is marked in content,
not a side manifest" in section F below), not a separate manifest. Such
objects are never compiled by the IDE, so their references are never checked and have no ground truth;
diagnosing them produces false positives against code the toolchain itself ignores. Excluded items
SHALL still be parsed, indexed, and materialized — only diagnostics are gated. Consequently, the
coverage invariant "a clean-compiling project yields zero diagnostics" holds over **built** objects
only; the coverage harness and its ratchet SHALL measure precision over built objects and report
excluded-object counts separately, never ratcheting them.

#### Scenario: An excluded object produces no diagnostics
- **WHEN** an item is flagged `excludeFromBuild: true` and its body references identifiers declared nowhere
- **THEN** the LSP emits no unresolved-identifier (or other semantic) diagnostics for that item

#### Scenario: A built sibling is still fully checked
- **WHEN** a built item (`excludeFromBuild: false`) has a genuine unresolved reference
- **THEN** the LSP still reports it — exclusion never suppresses diagnostics on built objects

### Requirement: Graphical CFC/SFC bodies are not diagnosed and carry no read-only marker

The LSP SHALL treat a CFC/SFC body as a comment-only informational marker (no `READONLY <LANG>`
detection): it produces no diagnostics because it parses as a comment, and no code path classifies a
body as "read-only" from its content. Read-only *access* for POU languages is not a concept the LSP
models; graphical bodies are simply not analyzed and are edited in the IDE.

#### Scenario: A graphical body yields no diagnostics without special detection
- **WHEN** a POU (or inlined method) body is the CFC/SFC informational marker comment
- **THEN** the LSP produces no diagnostics for it and does not tag it read-only from content

<!-- ══════════ D. Analyzer — symbol resolution (LSP-owned) ══════════ -->

### Requirement: The LSP resolves library symbols from mirrored signatures + namespace stubs

The LSP SHALL resolve referenced-library symbols using the materialized artifacts, with NO dedicated
ambient-scope machinery: (a) library element signature files use the ordinary kind extensions
(`.fb`/`.fun`/`.struct`/`.enum`/`.gvl`/`.itf`/…), so the existing source scan ingests them into the project
symbol table — a bare or member reference to a library element resolves like any project symbol; (b) each
`.library` stub's `NAMESPACE` line registers that library's namespace, so a qualified-reference ROOT
(`PACK_ML.State`, `MEM.LowWord`) is not flagged unresolved. Namespaces are keyed independently of project
symbols, so a library `State` and a project `State` do not collide. The hand-curated standard-function
table is retained only as a fallback for names not covered by a mirrored library.

#### Scenario: A library element resolves via the ingested signature
- **WHEN** a built object references a library FB/function/type whose signature is materialized under the Library Manager
- **THEN** the LSP resolves it (and its members) and emits no unresolved-identifier diagnostic

#### Scenario: A transitive-dependency namespace root resolves
- **WHEN** source references `MEM.LowWord` and a `CAA Memory.library` stub with `NAMESPACE MEM` is present
- **THEN** the `MEM` root is not flagged unresolved

### Requirement: Bare members of a non-qualified_only enum resolve

The unresolved-identifier check SHALL skip a bare identifier that names a member of a project enum that does
NOT carry `{attribute 'qualified_only'}`. Per IEC 61131-3 / CODESYS such members are global constants
reachable unqualified (`StateAutomatic`), yet the member symbol lives in the enum's own scope (for qualified
access + go-to-definition), off the resolver's parent chain — so a bare reference would otherwise false-flag.
A member of a `{attribute 'qualified_only'}` enum SHALL still require qualification.

#### Scenario: A bare enum member is not flagged
- **WHEN** an enum `sState` (no `qualified_only`) declares `StateAutomatic` and source references it bare
- **THEN** the LSP does not flag `StateAutomatic` unresolved

#### Scenario: A qualified_only enum still requires qualification
- **WHEN** `sState` carries `{attribute 'qualified_only'}` and source references `StateAutomatic` bare
- **THEN** the LSP flags it (only `sState.StateAutomatic` resolves)

### Requirement: Navigation resolves through member/index/call chains

Go-to-definition, hover, and completion SHALL resolve a reference through its full expression chain — `a.b.c`, `arr[i].x`, `p^.x`, `fb.method`, and the static bases `THIS^`, `GVL.field`, `E_State.Member` — by inferring the base expression's type and looking up the member in that type's scope, rather than resolving only the bare tail identifier. When the chain's type cannot be resolved, the query SHALL fall back to name-based behavior (no worse than resolving the tail alone).

#### Scenario: Go-to-definition follows a member chain
- **WHEN** the cursor is on `speed` in `motor.speed` and `motor` is a struct/FB with a `speed` field
- **THEN** go-to-definition jumps to that field's declaration, not to every `speed` in the project

#### Scenario: Completion after a chain offers the right members
- **WHEN** completion triggers after `a.b.` where `b`'s type is a struct/FB
- **THEN** the offered members are `b`'s type's members, resolved through the chain

### Requirement: Occurrence queries narrow by symbol identity

References, rename, and document-highlight SHALL resolve the symbol at the cursor and report only occurrences that bind to that same symbol — a member `x.Start` matches only that type's `Start`, and a method-local that shadows an FB member does not report the member's occurrences (nor vice versa). Call-hierarchy SHALL include member-call sites (`fb.method()`). When the cursor's symbol cannot be resolved, the query SHALL fall back to name-based matching.

#### Scenario: Rename of a field does not rename unrelated same-named identifiers
- **WHEN** a struct field `Start` is renamed
- **THEN** only references to that struct's `Start` are renamed, not `Start` on other types

#### Scenario: A shadowing local and the shadowed member are distinct
- **WHEN** document-highlight runs on an FB member that a method-local shadows by name
- **THEN** the method-local's body usages are NOT highlighted (they bind to the local, not the member)

#### Scenario: Member calls appear in call-hierarchy
- **WHEN** call-hierarchy is computed for a method invoked as `fb.method()`
- **THEN** that call site is included

### Requirement: Bare enum members have full navigation

Beyond resolution (not flagging them unresolved), the LSP SHALL provide go-to-definition, hover, and completion for a bare reference to a non-`qualified_only` enum member.

#### Scenario: Go-to-definition on a bare enum member
- **WHEN** the cursor is on a bare enum member `StateAutomatic`
- **THEN** go-to-definition jumps to its declaration in the enum, and hover shows the enum + value

### Requirement: The graphical (VG) unresolved check consults the library and device catalogs

The VG (FBD/LD) `vg-undeclared-identifier` check SHALL skip the same names the Structured-Text
unresolved-identifier check skips: known library namespaces (from `.library` stubs) and device-tree
instances (from `.device` files). A device instance or library root referenced inside a graphical body
SHALL NOT false-flag when the equivalent Structured-Text reference resolves.

#### Scenario: A device instance in a graphical body resolves
- **WHEN** an FBD/LD network references a device instance (`EtherCAT_Master`, `Axis_MainDrive`) mirrored as a `.device`
- **THEN** the VG check does not flag it, matching Structured-Text behavior

<!-- ══════════ E. VG graphical sublanguage — code correctness LSP-owned; FORMAT & ROUND-TRIP BRIDGE-OWNED ══════════ -->

### Requirement: VG is its own language, routed by content

Editable FBD/LD graphical bodies SHALL be represented as VG (Volt Graphical) — a distinct language
with its own grammar, parser, and analysis, not Structured Text. A POU body whose first significant
token is `NETWORK` SHALL be routed to the VG analysis path; everything else is ST. The declaration
(`PROGRAM`/`VAR … END_VAR`) remains ordinary ST; the VG parser sees only the body.

#### Scenario: A NETWORK body is analyzed as VG
- **WHEN** a POU body begins with a `NETWORK` marker
- **THEN** it is parsed and analyzed by the VG path, not the ST path

### Requirement: The round trip is exact and the bridge is the source of truth

The bridge SHALL round-trip PlcOpen XML ⇄ graph ⇄ VG exactly (`VgWriter(VgParser(x)) == x`). A
push whose VG is non-canonical or non-convergent SHALL be refused before it reaches the IDE, with a
structured diagnostic that returns the canonical text. So a graphical body can be read, edited, and
written entirely as VG text without drift.

#### Scenario: A non-canonical body is refused with its canonical form
- **WHEN** a push sends VG that is valid but not canonical (`VgWriter(VgParser(x)) != x`)
- **THEN** the bridge refuses it with `VG_NOT_CANONICAL` and returns the canonical text to paste

### Requirement: The bridge owns format, the LSP owns code correctness

The bridge SHALL enforce VG *structural* well-formedness (the `VG_*` gate) since those checks depend
only on the text. The LSP SHALL provide *code* correctness — type inference (wire types are inferred,
never written), undeclared-variable detection, hover, completion, navigation — and SHOULD mirror the
structural codes as diagnostics so a body is fixed before it is pushed.

#### Scenario: A wire's type is inferred, not stored
- **WHEN** the LSP hovers an internal `LET` wire
- **THEN** it shows a type inferred from the defining expression (the VG text carries no wire type)

### Requirement: FBD/LD are editable; CFC/SFC are read-only

ST, FBD, and LD bodies SHALL be read-write and round-trip as text (FBD/LD as editable VG). CFC and SFC
bodies SHALL have **no text representation** and are authored only in the IDE; they are not a read-only
*access* state, they simply are not materialized as editable code. A CFC/SFC body SHALL materialize as
a single informational marker comment identifying the language and directing the reader to the IDE, and
SHALL NOT be analyzed as VG or ST. There is no read-only-language flag.

#### Scenario: A CFC body is materialized as an informational marker
- **WHEN** a project contains a CFC (or SFC) body
- **THEN** it materializes as an `(* @volt-graphical: <LANG> *)` informational marker comment (e.g. `(* @volt-graphical: CFC *)`, which the LSP hover explains) and is not analyzed as VG or ST

### Requirement: Content detection covers whole files and inlined graphical methods

`volt-vscode` SHALL highlight VG by a content injection on the `NETWORK` token. Because a POU is named
by its KIND (`.fb`/`.prg`/`.fun`), an editable graphical POU is stored in a kind-named file, not a
`.st`/`.fbd`/`.ld` file — so the injection SHALL be keyed purely by the `NETWORK` token (the same
discriminator the LSP router uses), never by a graphical extension, and SHALL cover both a whole
graphical POU (e.g. a `.fb` file whose body begins with `NETWORK`) *and* a graphical body inlined
inside a POU (a graphical method). The body discriminator is 2-way: a body beginning with `NETWORK` is
editable VG (FBD/LD); anything else is treated as text (ST, or a CFC/SFC informational marker comment,
which yields no analysis). There is no `READONLY <LANG>` control marker.

#### Scenario: An editable graphical body is detected by NETWORK
- **WHEN** a kind-named POU file's body begins with `NETWORK`
- **THEN** it is highlighted and analyzed as editable VG, regardless of extension

#### Scenario: A CFC/SFC informational marker is not analyzed
- **WHEN** a kind-named POU (or inlined method) body is a CFC/SFC informational marker comment
- **THEN** it is not highlighted or analyzed as VG, and produces no diagnostics (it is a comment)

<!-- ══════════ F. Workspace file layout & materialization — BRIDGE/CLI-OWNED (LSP consumes) ══════════ -->

### Requirement: Writable source items are named by kind

Every writable source item SHALL materialize with an extension that names its KIND:
`function_block → .fb`, `program → .prg`, `function → .fun`, `interface → .itf`, `structure → .struct`,
`enumeration → .enum`, `union → .union`, `alias → .alias`, `gvl → .gvl`. A POU SHALL be named by its
kind regardless of body language — an editable graphical (FBD/LD) body and a read-only graphical
(CFC/SFC) body of a function block are both `<name>.fb` — so the extension always reveals what the
item is. The bridge SHALL choose the extension from the item's kind (`ItemKind.ExtFor`); kind SHALL
NOT be carried on the wire (it is recovered from content on push).

#### Scenario: A POU is named by kind, not body language
- **WHEN** the IDE contains a function block with a textual body, a second with an editable FBD body, and a third with a read-only CFC body
- **THEN** all three materialize as `<name>.fb`, and a program is `.prg` and a function is `.fun`

#### Scenario: DUTs, interfaces, and GVLs use their kind extension
- **WHEN** the IDE contains an enumeration, structure, union, alias, interface, or GVL
- **THEN** each materializes as `.enum`/`.struct`/`.union`/`.alias`/`.itf`/`.gvl` respectively

### Requirement: Read-only graphical POUs are marked in content, not by extension

Because POUs are named by kind, the extension SHALL NOT encode read-only access for a POU. A read-only
graphical POU (a CFC/SFC body) SHALL materialize with an in-content marker: its body is a leading
`READONLY <LANG>` line (e.g. `READONLY CFC`), stating it is read-only because the body is graphical.
Read-only for a POU SHALL be detected from this marker (the body's first significant token is
`READONLY`), never from the extension. Opaque reference kinds (`library`, `task`, `image_pool`,
`text_list`, `recipe_manager`, `visualization`, `visualization_manager`, `library_manager`,
`class_diagram`, `external_types`, `tmc`) SHALL remain read-only by their own extension. A folder SHALL
remain a `.gitkeep` marker.

#### Scenario: A read-only CFC POU carries a content marker
- **WHEN** the IDE contains a function block whose body is a read-only CFC
- **THEN** it materializes as `<name>.fb` whose body begins with `READONLY CFC` — no `.cfc` extension and no wire flag mark it

#### Scenario: A reference kind keeps its extension and is read-only
- **WHEN** the IDE contains a library, task, or visualization
- **THEN** it materializes with that kind's own extension and is read-only

### Requirement: Access is read from content; kind from content

The CLI SHALL derive a POU file's push-ability from its content — a body led by `READONLY` is
read-only, a `NETWORK`-led or textual body is writable — while reference kinds stay read-only by
their extension. The bridge SHALL recover an item's kind from file content on push-back (the ST
declaration header for textual kinds; the NETWORK-token VG body for editable graphical POUs), never
from the extension. The kind-based naming SHALL NOT lose kind or access information.

#### Scenario: Kind is recovered from content on push
- **WHEN** an agent edits and pushes a `.fb`/`.prg`/`.fun`/`.struct`/`.itf`/`.gvl` file
- **THEN** the bridge reconstructs the correct kind from the content and applies the push

#### Scenario: A read-only POU is not pushed
- **WHEN** a `.fb` file whose body begins with `READONLY` (a CFC/SFC body) is edited and a push is attempted
- **THEN** the CLI refuses it up front from the marker, and the bridge refuses it as a backstop

### Requirement: Build-excluded source is marked in content, not a side manifest

A source item's exclude-from-build state SHALL be recorded IN the file, NOT in a separate excluded-paths
manifest, because the LSP analyzes files on disk with no live bridge to read the per-item `excludeFromBuild`
wire flag (see bridge-protocol "Exclude-from-build is a per-item wire flag"). On pull, a source item whose
`excludeFromBuild` flag is `true` SHALL materialize with a leading `(* @volt-exclude-from-build *)` ST comment
(idempotent — never duplicated). This marker is Volt-managed, not real IDE source: on push the CLI SHALL strip
it before sending to the bridge, so it never reaches the IDE's stored source (and does not re-duplicate on the
next pull). The LSP and coverage harness SHALL read the marker as the on-disk source of the flag — it is how an
offline workspace or a committed corpus gates diagnostics on excluded objects. Only source-kind files carry it
(reference kinds are never analyzed and stay read-only by their extension).

#### Scenario: A build-excluded object materializes with the marker
- **WHEN** the IDE reports an item with `excludeFromBuild: true` and a pull materializes it
- **THEN** its source file begins with `(* @volt-exclude-from-build *)` — no side manifest records the exclusion

#### Scenario: The marker is stripped on push
- **WHEN** an excluded source file (leading `(* @volt-exclude-from-build *)`) is pushed back
- **THEN** the CLI strips the marker so the IDE's stored source is unchanged, and the next pull does not duplicate it

#### Scenario: The LSP reads the marker offline
- **WHEN** the LSP analyzes an on-disk workspace (or the committed corpus) with no live bridge
- **THEN** it skips diagnostics on files carrying the marker, exactly as if the wire flag were `true`

### Requirement: The scheme change re-materializes once

Because the wire item name includes the extension, moving from `.st` to kind extensions SHALL change
the affected items' wire names (and only their file paths — `structureVersion` hashes the sorted bare
names, so it is unchanged). On the first pull after the change, a bound workspace SHALL re-materialize
the affected items — the `*.st` files removed and the kind-named files created — reconciled through
native git as deletes and adds, with no custom migration step. Both vendor bridges SHALL apply the
same kind-based naming in shared Core.

#### Scenario: A bound workspace re-materializes on first pull
- **WHEN** a workspace bound under the `.st` scheme is pulled after this change
- **THEN** the `*.st` files are removed and equivalent `.fb`/`.prg`/`.fun`/`.itf`/`.struct`/… files appear, with no data loss

#### Scenario: structureVersion is unchanged by the rename
- **WHEN** only the extensions change (bare names identical)
- **THEN** `structureVersion` is unchanged, regardless of vendor

### Requirement: Library signatures materialize under the Library Manager, not a separate tree

Referenced-library public signatures SHALL materialize INTO the mirrored CODESYS tree — each element under
its owning library's folder in the Library Manager (`…/Library Manager/<LibraryName>/<Element>.<kind>`),
co-located with that library's `.library` stub — NOT into a separate `libs/` tree. Files SHALL use the same
kind-based extensions as project source (`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`/`.itf`)
and contain declarations/signatures only (no implementation bodies). They SHALL be **read-only**: never a
push target, never reconciled to the IDE. They are committed and change only when a referenced library is
added, removed, or version-bumped.

#### Scenario: A library element is a kind-named signature file in its library's folder
- **WHEN** the `L_MC4P` library exposes a struct `AxesGroup`
- **THEN** it materializes at `…/Library Manager/L_MC4P_MotionControlCam/AxesGroup.struct` (beside `L_MC4P_MotionControlCam.library`), containing only its declaration, and is not editable or pushable

#### Scenario: Library signatures are never pushed
- **WHEN** a push is computed
- **THEN** no library signature file is included — they are a read-only library mirror, not project source

### Requirement: The LSP is verified against a real-project conformance corpus

The LSP SHALL be tested against a committed conformance corpus materialized from a real, full-option
CODESYS project (the project's items rendered as `.st` files on disk). Every language construct the
corpus contains — POUs, DUTs, GVLs, interfaces, methods/properties/actions/transitions, pragmas, and
editable graphical FBD/LD bodies surfaced as VG — SHALL parse and analyze with **no spurious parse
errors and no analysis gaps**. The corpus SHALL be loadable from disk by the test harness and
regenerable via a documented step, so it is a durable regression guard, not a one-off.

#### Scenario: The whole corpus parses without spurious errors
- **WHEN** the LSP loads every `.st` file in the real-project corpus
- **THEN** each file parses into a usable model with no parse-error diagnostic on valid code, and every construct kind present is recognized (not silently skipped)

#### Scenario: The corpus is a committed, regenerable fixture
- **WHEN** the corpus tests run in CI (no live bridge, no CODESYS)
- **THEN** they read the committed `.st` fixtures from disk and pass deterministically, and the corpus can be regenerated from the source project by the documented materialization step

### Requirement: Diagnostics are false-positive-free on valid real code

On the valid, library-heavy code in the real-project corpus the LSP SHALL raise **zero
false-positive diagnostics**. The false-positive-prone semantic checks (unresolved identifier,
unknown pragma, wrong-vendor pragma, and their peers) and their config defaults SHALL be tuned so
that a symbol imported from a library, a vendor-legitimate pragma, or any construct the project
actually compiles is not flagged. Any diagnostic the LSP does raise on the corpus SHALL correspond
to a genuine defect, not to a gap in the LSP's model of real projects.

#### Scenario: A library-imported symbol is not flagged unresolved
- **WHEN** the corpus references a symbol declared in an imported library (not in the workspace `.st` files)
- **THEN** the LSP does not raise an unresolved-identifier diagnostic for it

#### Scenario: The corpus diagnostics sweep is clean
- **WHEN** the diagnostics sweep runs over the whole valid corpus
- **THEN** it reports no diagnostics — a regression that introduces a false positive fails the sweep

