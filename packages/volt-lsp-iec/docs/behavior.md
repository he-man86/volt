# ST Language Server — behavior spec

## Purpose

The contracts the `volt-lsp-iec` language server guarantees. It covers three concerns:

1. **The language server** — navigation, diagnostics, symbol resolution over the ST statement/expression AST.
   LSP-owned.
2. **The graphical (FBD/LD) sublanguage** the LSP analyzes as readable text — *code correctness* is LSP-owned;
   *format and PlcOpen round-trip* are bridge-owned (`volt-bridge`).
3. **The on-disk workspace layout** the LSP reads (kind-named files, in-content markers) — bridge/CLI-owned
   (`volt-bridge` writes it, `volt-git` reconciles it); consumed here offline.

This capability is self-contained: together with its sibling docs — `architecture.md` (the layered structure +
build order), `data-model.md` (the concrete types), `language-reference.md` (the IEC catalog + the CODESYS↔
TwinCAT differences) — it holds everything needed to build the LSP from the ground up. The HTTP wire it consumes
is `bridge-protocol`.
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
it only binds the IDE project and installs vendor skills. An agent editing kind-named source in a bound PLC
project MUST receive the LSP's diagnostics through its tool loop.

#### Scenario: Agent gets PLC diagnostics in a consumer project
- **WHEN** the agent edits a kind-named source file in an end-user PLC project (not the Volt repo)
- **THEN** the volt LSP is running and its diagnostics are surfaced to the agent — it is not writing ST blind from training data

#### Scenario: The command resolves by bare name, not a repo-relative path
- **WHEN** opencode opens a PLC project whose directory is not the Volt repo
- **THEN** the LSP command resolves via the `OPENCODE_CONFIG_DIR` bin on `PATH` (published/global/bundled), not via `./packages/volt-lsp-iec/...`

### Requirement: The LSP-3.17 conformance surface is declared and kept in capability↔handler parity

The server SHALL keep its advertised LSP capabilities and its registered request/notification handlers in
lockstep: every capability advertised in the `initialize` result SHALL have a registered handler, and the
server SHALL NOT register a handler for a language feature it does not advertise. This prevents a feature
that is implemented but never wired to the protocol from silently returning nothing to clients.

The set of supported methods, the set of methods deliberately out of scope for a text-mirrored IEC 61131-3
Structured Text server (with reasons), and the remaining applicable gaps SHALL be documented as a conformance
matrix against LSP 3.17. Out-of-scope methods SHALL NOT be advertised. A `*/resolve` request SHALL be treated
as out of scope while the server returns fully-resolved items (completion, code lens, code action, inlay hint,
workspace symbol).

#### Scenario: Every advertised capability has a handler

- **WHEN** the server responds to `initialize` advertising a set of provider capabilities
- **THEN** each advertised capability has a registered handler for its method(s), and no handler is registered
  for a language-feature method the server does not advertise

#### Scenario: An out-of-scope method is not advertised

- **WHEN** a method is recorded as out of scope in the conformance matrix (e.g. `textDocument/documentColor`,
  `textDocument/moniker`, a `*/resolve` request)
- **THEN** the server does not advertise the corresponding capability, and a client that never sends that
  request observes no missing behavior it was promised

<!-- ══════════ B. Analyzer — parsing, indexing & the body AST (LSP-owned) ══════════ -->

### Requirement: Parsing is error-tolerant

The parser SHALL be error-tolerant, so a half-typed file still yields symbols and diagnostics
rather than failing wholesale.

#### Scenario: A half-typed file still yields symbols
- **WHEN** a file is mid-edit with a syntax error
- **THEN** the server still returns document symbols and diagnostics for the valid portions

### Requirement: The workspace is cross-indexed

The server SHALL cross-index the whole workspace so that types declared in unopened files resolve. This SHALL hold for the **running server**, not only the binder or offline corpus loads: on `initialize` (when a workspace root is provided) the server SHALL crawl the workspace for kind-named source files (`.fb`, `.prg`, `.fun`, `.itf`, `.dut`, `.gvl`) and seed the project symbol table from disk. For any file the client has opened, the open document SHALL take precedence over its on-disk contents (open buffer wins), so an unsaved edit still drives analysis. The eager index SHALL NOT introduce any diagnostic on valid code that would not have been produced when every file was open — the zero-false-positive guarantee holds unchanged.

#### Scenario: A type in an unopened file resolves
- **WHEN** a file references a DUT declared in another, unopened file
- **THEN** go-to-definition and type resolution succeed

#### Scenario: Cross-file resolution works with only the referencing file open
- **WHEN** the client has opened only `PLC_PRG.prg`, which references `E_Mode` declared in an unopened sibling `E_Mode.dut`
- **THEN** `E_Mode` resolves and no `Identifier 'E_Mode' not defined` diagnostic is produced

#### Scenario: An open buffer overrides the on-disk version
- **WHEN** a file is open with unsaved edits that differ from disk
- **THEN** analysis, resolution, and diagnostics reflect the open buffer, not the on-disk copy

### Requirement: The workspace index stays fresh on file changes

The server SHALL declare and handle `workspace/didChangeWatchedFiles` for kind-named source files and for the reference files it crawls (`.library`, `.device`, `.task`). On a create, change, or delete of a watched file, the server SHALL re-index so that subsequent queries reflect the new on-disk state without requiring the affected file to be opened, and SHALL invalidate any cached project scope. The reference-name crawl (library namespaces, device instance names, task program roots) SHALL be re-runnable on these events, not performed only at `initialize`.

#### Scenario: A newly added source file becomes resolvable without opening it
- **WHEN** a new `.dut` file is added on disk (e.g. by `volt pull`) and a watched-files change event is delivered
- **THEN** references to the new type resolve without the file being opened in the editor

#### Scenario: A deleted source file stops resolving
- **WHEN** a source file is deleted on disk and a watched-files change event is delivered
- **THEN** the types it declared are no longer in the project scope and references to them are reported unresolved

#### Scenario: A changed library reference is picked up without restart
- **WHEN** a `.library` file changes on disk and a watched-files change event is delivered
- **THEN** the refreshed library namespaces are reflected in resolution without restarting the server

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

### Requirement: Expressions are type-inferred over the body AST

The language server SHALL infer the type of an ST expression by walking the expression tree, resolving names through the symbol table and named types through the type resolver. Inference SHALL propagate: literal types (integer width/signedness, REAL vs LREAL, STRING/WSTRING, TIME); member access (`a.b`) by resolving the base expression's type and looking up the member; array indexing to the element type; dereference to the pointer's target type; call expressions to the callee's return type; and binary operations to the IEC result type. When any step cannot be resolved, inference SHALL yield an `unknown` type, and every consumer SHALL treat `unknown` as "skip" — never emitting a diagnostic from an unknown-typed expression.

#### Scenario: Member-chain type is inferred, not abandoned
- **WHEN** `motor` is a struct/FB with a `REAL` field `speed`, and an expression reads `motor.speed`
- **THEN** the inferred type of `motor.speed` is REAL (whereas the prior token scan abandoned any `.` expression)

#### Scenario: Unknown type never false-positives
- **WHEN** an expression references a symbol from an unresolved library or an unmodeled construct
- **THEN** its inferred type is `unknown` and no type diagnostic is raised for it

<!-- ══════════ C. Analyzer — diagnostics (LSP-owned) ══════════ -->

### Requirement: Diagnostic defaults mirror TwinCAT

A diagnostic check SHALL be enabled by default only if TwinCAT itself rejects the code; lints
stricter than the compiler SHALL ship off-by-default. Each check is individually gated by an enable flag.

#### Scenario: A stricter-than-compiler lint is off by default
- **WHEN** the default configuration is used
- **THEN** a lint that TwinCAT would accept is not reported unless explicitly enabled

### Requirement: Diagnostics traverse every ST body through one shared iterator

The diagnostics engine SHALL iterate Structured Text bodies through a single shared body iterator, used by both the analysis checks and the language services, so there is one definition of "for each ST body, with its unit, scope, and parsed statements." The iterator SHALL cover every ST body of a unit — function block, program, function, method, action, and **property getter/setter accessors** — not only the primary POU body. Introducing the shared iterator SHALL NOT change the diagnostics produced on the committed real-project corpora below their current floors (parse-clean, ingest, and per-corpus ERROR floors), preserving the zero-false-positive guarantee.

#### Scenario: A property accessor body is diagnosed
- **WHEN** a property `GET` or `SET` accessor body contains a checkable error (e.g. an assignment type mismatch)
- **THEN** the diagnostic is produced for the accessor body (previously accessor bodies were skipped by the analysis checks)

#### Scenario: Corpus floors hold under the unified iterator
- **WHEN** the checks run over the four corpora through the shared iterator
- **THEN** parse-clean / ingest / per-corpus ERROR floors are greater-than-or-equal to their current baselines

### Requirement: Type-aware diagnostics resolve through compound expressions

The assignment-type, binary-operator, and conversion diagnostics SHALL evaluate operand types via the type-inference walker rather than a single-token heuristic, so that member access, indexing, dereference, calls, and nested expressions are typed rather than skipped. These diagnostics SHALL NOT raise a false-positive ERROR on any built object of the committed corpora.

#### Scenario: Assignment mismatch through a member l-value
- **WHEN** a `BOOL` value is assigned to `motor.speed` (a REAL field)
- **THEN** the assignment-type diagnostic can evaluate both sides (previously it skipped any member l-value)

#### Scenario: Corpus error precision holds
- **WHEN** the deepened checks run over the four corpora
- **THEN** ERROR-severity diagnostics on built objects are zero on all four; warnings the compiler also emits are oracle-validated and reported separately, not ratcheted

### Requirement: Call arguments are checked against the callee signature

The language server SHALL check a call expression against the resolved callee's declared parameters: the argument count SHALL be within the callee's required/optional input range, each positional and named argument's inferred type SHALL be assignment-compatible with its parameter, and a named argument SHALL name a parameter the callee actually declares. When the callee or a parameter type cannot be resolved, the affected check SHALL be skipped (no false positive). A call that MIXES a named argument with a positional one SHALL NOT bind the positional argument by index — that mapping is ambiguous, so positional type-checking runs only on all-positional calls. Omitting inputs SHALL NOT be flagged for callables whose inputs are optional (a function block retains its inputs between calls); a too-few-arguments error applies only where the callable requires them (e.g. a FUNCTION).

#### Scenario: Wrong argument type is flagged
- **WHEN** a function block input declared `INT` is called with a `STRING` argument
- **THEN** a call-argument-type diagnostic is raised

#### Scenario: Too many positional arguments is flagged
- **WHEN** a call passes more positional arguments than the callee declares inputs
- **THEN** a call-argument-count diagnostic is raised

#### Scenario: Unknown named parameter is flagged
- **WHEN** a call uses `paramX := value` and the callee declares no `paramX`
- **THEN** an unknown-named-argument diagnostic is raised

#### Scenario: A mixed named+positional call does not false-positive
- **WHEN** a call passes a named argument and then a positional one (`fb(In := x, y)`)
- **THEN** the positional `y` is NOT type-checked against parameter 0; the named argument is still checked by name

#### Scenario: Omitting an optional function-block input is allowed
- **WHEN** a function block with several inputs is called with only some of them
- **THEN** no call-argument-count diagnostic is raised (FB inputs are optional)

### Requirement: Narrowing-conversion diagnostic

The language server SHALL emit a WARNING for EVERY implicit type conversion the compiler warns on — not only
`LREAL→REAL`, but the whole family, exactly as calibrated against the live compilers by the conversion matrix:
- **loss of information** — a real target that can't hold the source exactly: real narrowing (`LREAL→REAL`) and
  an integer wider than the float mantissa (REAL 24 bits, LREAL 53 bits: `DINT→REAL`, `LINT→LREAL`, …).
- **change of sign** — crossing the signed/unsigned boundary where the target can't represent the source's
  range: signed → unsigned at ANY width (`INT→WORD`, `SINT→UINT` — a negative never fits), and unsigned → signed
  only at the SAME width (`WORD→INT`; a WIDER signed target holds every unsigned value, so it stays a safe widen).

Integer NARROWING (`DINT→INT`) is NOT a warning — the compilers reject it as an ERROR (`Cannot convert type …`);
that severity likewise comes from `classifyConversion` (kind `incompatible`). Each warning SHALL be produced from
the one `classifyConversion` function (see "Type conversion is classified by a single function"), mapped to its
per-vendor wording via `messages`, and enabled by default only where a recorded conformance fixture confirms
both compilers emit it. The check SHALL remain conservative — an `UNKNOWN` operand yields no diagnostic — and,
being warnings (the code still compiles), these SHALL be validated by the conformance oracle and reported
separately by the corpus harness, never counted in the zero-ERROR precision floor.

#### Scenario: LREAL to REAL narrowing warns
- **WHEN** an `LREAL` expression is assigned to a `REAL` variable
- **THEN** a narrowing-conversion warning is raised, matching the compiler's warning on the same site

#### Scenario: Signed/unsigned conversion warns with "change of sign"
- **WHEN** a `WORD` (unsigned) value is assigned to an `INT` (signed) target, or a signed value to a WIDER
  unsigned target (e.g. `SINT→UINT`)
- **THEN** a warning is raised with the compiler's "Possible change of sign" wording — not silence

#### Scenario: A large integer assigned to a real warns "loss of information"
- **WHEN** an integer wider than the target real's mantissa is assigned (e.g. `DINT→REAL`, `LINT→LREAL`)
- **THEN** a "possible loss of information" warning is raised, matching the compiler; but a fitting int (`INT→REAL`,
  `DINT→LREAL`) is a silent safe widen

#### Scenario: An unknown operand suppresses the warning
- **WHEN** either side of a conversion resolves to `UNKNOWN` (an unresolved library/user type)
- **THEN** no conversion diagnostic is emitted (conservative-skip; zero false positives)

### Requirement: LSP diagnostics cover what the bridge rejects

The LSP's diagnostics SHALL flag any Structured Text that the bridge will reject on push, so the agent's
write-time feedback predicts push success (invariant: LSP diagnostics ⊇ bridge rejections). Where Volt
chooses to accept a form (e.g. signature-only interface methods), the bridge SHALL accept it too — the
LSP and bridge MUST agree on validity.

#### Scenario: A bridge-rejected form is caught at write time
- **WHEN** the agent writes ST the bridge would reject (e.g. an interface `METHOD` with no `END_METHOD`, if Volt keeps that strict)
- **THEN** the LSP reports a diagnostic for it — or, if Volt accepts the form, the bridge accepts it too (no divergence)

### Requirement: Dead code is detected structurally and its diagnostics are config-gated

Dead (uncalled/unreachable) code IS delivered to the workspace as ordinary source — the bridge does not omit it. The LSP SHALL determine reachability itself, from the project's own structure, and SHALL gate diagnostics on dead code behind a `diagnoseDeadCode` config flag.

Reachability SHALL be computed project-wide: the ROOTS are the PROGRAM POUs (IEC entry points — tasks invoke programs), and a unit is REACHABLE if it is in the transitive closure from a root via calls, FB instantiations (`inst : FB_A;` declarations count), `EXTENDS`/`IMPLEMENTS`, and declared-type references. A top-level POU not reachable is DEAD.

When `diagnoseDeadCode` is `false` (the default, matching the CODESYS compiler, which never compiles dead code), the LSP SHALL suppress ALL diagnostics whose owning top-level unit is dead. When `true`, the LSP SHALL diagnose every unit, dead or not.

The reachability analysis SHALL be conservative: when reachability is UNCERTAIN — dynamic dispatch, an interface-typed or pointer assignment, or any edge the analysis cannot resolve — the unit SHALL be treated as LIVE. Marking a reachable unit dead would suppress real diagnostics; over-including is the only safe bias. Consequently the coverage invariant "a clean-compiling project yields zero ERROR diagnostics" holds with `diagnoseDeadCode` off, because genuinely dead code (which the compiler never checked) is suppressed while every reachable unit is fully checked.

#### Scenario: A dead POU produces no diagnostics by default
- **WHEN** an FB is never called or instantiated from any PROGRAM's reachable graph, and its body references an identifier declared nowhere
- **THEN** with `diagnoseDeadCode` off (default) the LSP emits no diagnostic for it — matching the compiler, which never checked it

#### Scenario: The same dead POU is diagnosed when the flag is on
- **WHEN** the same dead FB is analyzed with `diagnoseDeadCode` on
- **THEN** the LSP reports its unresolved reference (and any other real diagnostic) — dead code is fully analyzed

#### Scenario: A reachable POU is always fully checked
- **WHEN** an FB is instantiated (`m : FB_Motor;`) inside a reachable program and has a genuine error
- **THEN** the LSP reports it regardless of the flag — instantiation is a reachability edge, and reachable code is never suppressed

#### Scenario: Uncertain reachability resolves to live
- **WHEN** an FB is only ever reached through an interface-typed variable or other dynamic dispatch the analysis cannot statically resolve
- **THEN** the LSP treats it as LIVE (never dead), so its diagnostics are never wrongly suppressed

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
(`.fb`/`.fun`/`.dut`/`.gvl`/`.itf`/…), so the existing source scan ingests them into the project
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

### Requirement: Call hierarchy is exposed

The language server SHALL support call hierarchy: `textDocument/prepareCallHierarchy` at a callable SHALL return its hierarchy item; `callHierarchy/incomingCalls` SHALL return the callers whose call site resolves — type-aware — to that exact callable; `callHierarchy/outgoingCalls` SHALL return the callables invoked in its body. A same-named method on a different type SHALL NOT be reported as a caller.

#### Scenario: Incoming calls are type-aware
- **WHEN** `prepareCallHierarchy` targets method `Step` on FB `A`, and both `A.Step()` and an unrelated `B.Step()` exist
- **THEN** `incomingCalls` reports the caller of `A.Step()` and NOT the caller of `B.Step()`

#### Scenario: Outgoing calls list invoked callables
- **WHEN** `outgoingCalls` is requested for a POU whose body calls two function blocks
- **THEN** both callees are returned with the call-site ranges

### Requirement: Type hierarchy is exposed

The language server SHALL support type hierarchy: `textDocument/prepareTypeHierarchy` at a function block or interface SHALL return its item; `typeHierarchy/supertypes` SHALL return its `EXTENDS` base and `IMPLEMENTS` interfaces; `typeHierarchy/subtypes` SHALL return every workspace type that extends or implements it.

#### Scenario: Supertypes follow EXTENDS and IMPLEMENTS
- **WHEN** `supertypes` is requested for an FB that `EXTENDS Base IMPLEMENTS I`
- **THEN** both `Base` and `I` are returned

#### Scenario: Subtypes span the workspace
- **WHEN** `subtypes` is requested for an interface implemented by two FBs in different files
- **THEN** both FBs are returned

### Requirement: Workspace symbol search is exposed

The language server SHALL support `workspace/symbol`: given a query string, it SHALL return matching top-level symbols across the indexed workspace as `SymbolInformation`, using the same symbol-kind mapping as document symbols.

#### Scenario: A type is found by name across files
- **WHEN** the client issues `workspace/symbol` with a query matching a DUT declared in an unopened file
- **THEN** the DUT is returned with its location and kind

#### Scenario: Query narrows the result set
- **WHEN** the query matches a subset of symbol names
- **THEN** only matching symbols are returned

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

<!-- ══════════ D2. Editor services — formatting (LSP-owned) ══════════ -->

### Requirement: Structured Text is formatted from the statement/expression AST

`textDocument/formatting` SHALL produce canonical Structured Text by pretty-printing the statement/expression tree and the VAR-section declaration AST, layered over a token re-indenter that provides the baseline indentation and handles everything the AST printer does not own (POU header lines, whitespace). The printer SHALL emit: block indentation from tree nesting; one statement per line; a single space around `:=` and binary operators; `, ` between argument and list items; no space before `;`; canonical control-flow spelling (`IF … THEN`, `CASE … OF`, `FOR … DO`); and one declaration per line as `name : TYPE := init;` with the type, initializer, and `AT` clause reprinted verbatim from source and section modifiers (`CONSTANT`/`RETAIN`/`PERSISTENT`) kept in their source order. Parentheses SHALL be emitted only where operator precedence/associativity requires them to preserve meaning. Indent style, size, and end-of-line SHALL continue to resolve from `.editorconfig`, falling back to the editor's `FormattingOptions`. Keyword casing SHALL be left as written (IEC identifiers are case-insensitive).

#### Scenario: Internal spacing is canonicalized, not just indentation
- **WHEN** a body contains `x:=a+b*(c-d);` at any indentation
- **THEN** it is reformatted to `x := a + b * (c - d);` at the correct block indent — the prior re-indenter would have fixed only the leading whitespace

#### Scenario: Declarations get canonical column spacing
- **WHEN** a VAR section pads names to columns with tabs, e.g. `a\t\t\t: INT := 5;`
- **THEN** it is reformatted to `a : INT := 5;`, while a declaration with a multi-line initializer or a comment interleaved inside the `name : TYPE := init` run is left to the re-indenter (verbatim) rather than risk relocating content

#### Scenario: Meaning-preserving parentheses
- **WHEN** the source is `x := (a + b) * c;`
- **THEN** the parentheses are kept (removing them would change the result), whereas redundant `x := (a) + b;` may be normalized to `x := a + b;` only if the parse tree is unchanged

### Requirement: Formatting preserves comments and never corrupts code

The formatter SHALL guarantee three invariants over every formatted document: (A) a **semantic round-trip** — parsing the formatted output yields the same AST as parsing the input (identifiers, structure, and operator nesting unchanged); (B) **preservation** — the multiset of comment, pragma, and `%FOLDER` marker texts in the output is identical to the input (nothing dropped, duplicated, or altered), since these live only in the token stream and not in the AST; and (C) **idempotency** — formatting an already-formatted document changes nothing. Comments, pragmas, and markers SHALL be reconciled from the token stream by source position: an own-line comment prints on its own line at the current indent; a trailing comment prints after the statement's `;`; a comment embedded mid-expression is relocated to the nearest trailing position (never dropped). When a body cannot be parsed into a clean tree, that body SHALL fall back to the token re-indenter (which preserves comments and internal spacing verbatim) rather than risk corruption. These invariants are proven over every file in the 4-project corpus.

#### Scenario: An own-line and a trailing comment survive formatting
- **WHEN** a body has a comment on its own line and another after a statement (`x := 1; // set x`)
- **THEN** both appear in the output unchanged — the own-line comment at the block indent, the trailing comment after the reformatted `x := 1;`

#### Scenario: An interior comment is relocated, never dropped
- **WHEN** a statement embeds a comment mid-expression (`a := b (* note *) + c;`)
- **THEN** the comment is relocated to a trailing position rather than dropped — the comment-preservation invariant holds and the parse tree is unchanged

#### Scenario: Formatting is idempotent and never changes meaning
- **WHEN** an already-formatted document is formatted again
- **THEN** the output is byte-identical (idempotent), and for any document `parse(format(src))` deep-equals `parse(src)` and the comment multiset is unchanged

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
language-named file — so the injection SHALL be keyed purely by the `NETWORK` token (the same
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
`function_block → .fb`, `program → .prg`, `function → .fun`, `interface → .itf`, `gvl → .gvl`, and every
DUT (structure, enumeration, union, alias) → a single `.dut` (the struct/enum/union/alias distinction
lives in the declaration body, mirroring the IDEs' one-DUT-object model). A POU SHALL be named by its
kind regardless of body language — an editable graphical (FBD/LD) body and a read-only graphical
(CFC/SFC) body of a function block are both `<name>.fb` — so the extension always reveals what the
item is. The bridge SHALL choose the extension from the item's kind (`ItemKind.ExtFor`); kind SHALL
NOT be carried on the wire (it is recovered from content on push).

#### Scenario: A POU is named by kind, not body language
- **WHEN** the IDE contains a function block with a textual body, a second with an editable FBD body, and a third with a read-only CFC body
- **THEN** all three materialize as `<name>.fb`, and a program is `.prg` and a function is `.fun`

#### Scenario: DUTs, interfaces, and GVLs use their kind extension
- **WHEN** the IDE contains an enumeration, structure, union, alias, interface, or GVL
- **THEN** every DUT (enumeration/structure/union/alias) materializes as `.dut`, and interface/GVL as `.itf`/`.gvl`

### Requirement: Read-only graphical POUs are marked in content, not by extension

Because POUs are named by kind, the extension SHALL NOT encode read-only access for a POU. A read-only
graphical POU (a CFC/SFC body) SHALL materialize with an in-content marker: its body is a single
`(* @volt-graphical: <LANG> *)` informational comment (e.g. `(* @volt-graphical: CFC *)`), stating it is
read-only because the body is graphical and not round-tripped. Read-only for a POU SHALL be detected from
this marker (the body is a lone `@volt-graphical` comment), never from the extension. Opaque reference kinds
(`library`, `task`, `image_pool`, `text_list`, `recipe_manager`, `visualization`, `visualization_manager`,
`library_manager`, `class_diagram`, `external_types`, `tmc`) SHALL remain read-only by their own extension. A
folder SHALL remain a `.gitkeep` marker.

#### Scenario: A read-only CFC POU carries a content marker
- **WHEN** the IDE contains a function block whose body is a read-only CFC
- **THEN** it materializes as `<name>.fb` whose body is `(* @volt-graphical: CFC *)` — no `.cfc` extension and no wire flag mark it

#### Scenario: A reference kind keeps its extension and is read-only
- **WHEN** the IDE contains a library, task, or visualization
- **THEN** it materializes with that kind's own extension and is read-only

### Requirement: Access is read from content; kind from content

The CLI SHALL derive a POU file's push-ability from its content — a body that is a `(* @volt-graphical: … *)`
marker is read-only, a `NETWORK`-led or plain textual body is writable — while reference kinds stay read-only
by their extension. The bridge SHALL recover an item's kind from file content on push-back (the ST
declaration header for textual kinds; the NETWORK-token VG body for editable graphical POUs), never
from the extension. The kind-based naming SHALL NOT lose kind or access information.

#### Scenario: Kind is recovered from content on push
- **WHEN** an agent edits and pushes a `.fb`/`.prg`/`.fun`/`.dut`/`.itf`/`.gvl` file
- **THEN** the bridge reconstructs the correct kind from the content and applies the push (a `.dut` is one kind `dut`; the IDE derives struct/enum/union/alias from the declaration)

#### Scenario: A read-only POU is not pushed
- **WHEN** a `.fb` file whose body is a `(* @volt-graphical: … *)` marker (a CFC/SFC body) is edited and a push is attempted
- **THEN** the CLI refuses it up front from the marker, and the bridge refuses it as a backstop

### Requirement: Library signatures materialize under the Library Manager, not a separate tree

Referenced-library public signatures SHALL materialize INTO the mirrored CODESYS tree — each element under
its owning library's folder in the Library Manager (`…/Library Manager/<LibraryName>/<Element>.<kind>`),
co-located with that library's `.library` stub — NOT into a separate `libs/` tree. Files SHALL use the same
kind-based extensions as project source (`.fb`/`.prg`/`.fun`/`.dut`/`.gvl`/`.itf`)
and contain declarations/signatures only (no implementation bodies). They SHALL be **read-only**: never a
push target, never reconciled to the IDE. They are committed and change only when a referenced library is
added, removed, or version-bumped.

#### Scenario: A library element is a kind-named signature file in its library's folder
- **WHEN** the `L_MC4P` library exposes a struct `AxesGroup`
- **THEN** it materializes at `…/Library Manager/L_MC4P_MotionControlCam/AxesGroup.dut` (beside `L_MC4P_MotionControlCam.library`), containing only its declaration, and is not editable or pushable

#### Scenario: Library signatures are never pushed
- **WHEN** a push is computed
- **THEN** no library signature file is included — they are a read-only library mirror, not project source

### Requirement: LSP behavior is verified by feature tests against the live compiler, with the corpus as the safety net

The language server's behavior SHALL be verified by a test architecture with three layers, each with a distinct role and no duplication of mechanism:

1. **Feature tests, organized by language principle** — a catalog of cases grouped by IEC construct (operators, data types, conversions, interfaces, OOP, lifecycle, pragmas, …). Each case's **diagnostic outcome SHALL be verified against the live vendor bridge** (the CODESYS/TwinCAT compiler as oracle): the compiler's per-object diagnostics are recorded and the LSP's diagnostics on the same source SHALL agree (documented divergences excepted).
2. **Navigation queries** (go-to-definition, hover, completion, references, rename, …) SHALL be verified by assertion tests, since the compiler provides no navigation ground truth — each such query SHALL have exactly one authoritative test, not parallel snapshot + assertion coverage.
3. **The committed real-project corpus** SHALL serve as the regression safety net: a false positive or missed case it surfaces that the feature tests did not is a signal to **add a new feature test**, not merely to adjust a threshold.

The compiler ground truth SHALL be refreshable from within the LSP package (a `record:language` recorder that pushes each case + a `PLC_PRG` instantiation to a live bridge, builds, and records the compiler's diagnostics); the replay that diffs LSP vs recorded truth SHALL run offline.

#### Scenario: A language feature is proven against the real compiler
- **WHEN** a feature test's source is analyzed by the LSP and built by the live vendor compiler
- **THEN** the LSP's diagnostics match the compiler's for that case (or the divergence is explicitly documented)

#### Scenario: A corpus-surfaced miss becomes a feature test
- **WHEN** the corpus ratchet surfaces a diagnostic the feature tests did not cover
- **THEN** a new feature test is added for that case (and its compiler ground truth recorded), rather than only adjusting a corpus threshold

#### Scenario: Each query has one authoritative test
- **WHEN** a navigation query (definition/hover/completion/…) is tested
- **THEN** it has a single authoritative test, not duplicated snapshot-and-assertion coverage of the same behavior

### Requirement: The LSP is verified against a real-project conformance corpus

The LSP SHALL be tested against a committed conformance corpus materialized from a real, full-option
CODESYS project (the project's items rendered as kind-named files on disk). Every language construct the
corpus contains — POUs, DUTs, GVLs, interfaces, methods/properties/actions/transitions, pragmas, and
editable graphical FBD/LD bodies surfaced as VG — SHALL parse and analyze with **no spurious parse
errors and no analysis gaps**. The corpus SHALL be loadable from disk by the test harness and
regenerable via a documented step, so it is a durable regression guard, not a one-off.

#### Scenario: The whole corpus parses without spurious errors
- **WHEN** the LSP loads every kind-named source file in the real-project corpus
- **THEN** each file parses into a usable model with no parse-error diagnostic on valid code, and every construct kind present is recognized (not silently skipped)

#### Scenario: The corpus is a committed, regenerable fixture
- **WHEN** the corpus tests run in CI (no live bridge, no CODESYS)
- **THEN** they read the committed kind-named fixtures from disk and pass deterministically, and the corpus can be regenerated from the source project by the documented materialization step

### Requirement: Diagnostics are false-positive-free on valid real code

On the valid, library-heavy code in the real-project corpus the LSP SHALL raise **zero false-positive
ERROR diagnostics**. Precision is measured over ERROR severity because a clean-*building* project guarantees
zero errors; it does NOT guarantee zero warnings — the compiler legitimately emits warnings (e.g. an implicit
LREAL→REAL narrowing) without failing the build. WARNING-severity diagnostics are therefore validated by the
conformance oracle (dedicated recorded fixtures verifying the compiler emits the same warning), reported by
the corpus harness separately, and NOT ratcheted to zero. The false-positive-prone semantic checks (unresolved
identifier, unknown pragma, wrong-vendor pragma, and their peers) and their config defaults SHALL be tuned so
that a symbol imported from a library, a vendor-legitimate pragma, or any construct the project actually
compiles is not flagged as an error. Any ERROR the LSP raises on the corpus SHALL correspond to a genuine
defect, not to a gap in the LSP's model of real projects.

#### Scenario: A library-imported symbol is not flagged unresolved
- **WHEN** the corpus references a symbol declared in an imported library (not in the workspace source files)
- **THEN** the LSP does not raise an unresolved-identifier diagnostic for it

#### Scenario: The corpus error sweep is clean
- **WHEN** the diagnostics sweep runs over the whole valid corpus
- **THEN** it reports zero ERROR diagnostics — a regression that introduces a false-positive error fails the sweep

#### Scenario: A true-positive warning is not a false positive
- **WHEN** a check emits a WARNING the compiler also emits (a conformance fixture records the compiler warning)
- **THEN** it is validated by that oracle and reported separately by the corpus harness — it does not fail the precision sweep, which counts errors only

### Requirement: Type conversion is classified by a single function

The type system SHALL own ONE total function `classifyConversion(dst, src)` that returns a conversion kind
(`identity` / `widen` / `narrow` / `sign-change` / `incompatible`) computed from the elementary type lattice
(family, bit width, signedness, widening rank) per the IEC 61131-3 conversion hierarchy and the reference-compiler
behavior (cross-family int↔real folds into the same widen/narrow/incompatible kinds — no separate category). This function SHALL be the single source of truth for conversion decisions:
`isAssignable` is `classifyConversion(...) !== "incompatible"`, `isNarrowing` is `classifyConversion(...) ===
"narrow"`, and every conversion diagnostic (the narrowing/sign-change WARNINGS and the assignment /
conversion-source ERRORS) SHALL derive its severity from the returned kind rather than a second, duplicated
rule. The `analysis` layer maps a kind to a per-vendor message; it SHALL NOT re-decide the conversion.

#### Scenario: One classification drives both a warning and an error
- **WHEN** the same conversion (e.g. `INT := DINT`) is evaluated for a diagnostic
- **THEN** its kind is taken from `classifyConversion`, and the layer maps that one kind to the correct
  severity + wording — with no independent narrowing/assignability tables that could disagree

### Requirement: Type-conversion parity is matrix-verified against the compiler oracle

Conversion coverage SHALL be proven, not assumed: a generated conversion matrix (every elementary type pair
across the contexts that change the answer — plain assignment, typed and untyped literals, arithmetic results,
comparisons) SHALL be recorded against live CODESYS and TwinCAT, and the recording SHALL be diffed against
`classifyConversion` + `messages` through the conformance replay. Any disagreement between the LSP's
classification and the recorded compiler behavior SHALL be treated as a defect — corrected in the classification
or encoded as a per-vendor rule — so the recording validates the rules rather than the rules being guessed from
the recording. A representative slice SHALL be committed as fixtures; the full matrix SHALL be reproducible from
its generator.

#### Scenario: A misclassified pair is caught by the oracle
- **WHEN** `classifyConversion` labels a pair (say `USINT := 256`) differently from what CODESYS/TwinCAT emit for it
- **THEN** the conformance replay reports the divergence, and the classification (or a per-vendor rule) is fixed
  so the LSP and the build pane agree

### Requirement: Offline diagnostics are traceable to the CODESYS error catalog

The set of offline semantic diagnostics the LSP emits SHALL be driven by, and traceable to, the CODESYS compiler-error catalog (codes `C0001`–`C0587`). A structured catalog SHALL exist that records, for every code, its exact compiler message template(s), a category, a minimal repro, and a coverage status of exactly one of `covered` (an existing check mirrors it), `checkable` (offline-analyzable — a check SHALL be implemented), or `ide-only` (needs a live build or library resolution — out of LSP scope). Each diagnostic the LSP emits that mirrors a catalog code SHALL carry that `Cnnnn` code as metadata (not as the LSP's own `code`, which stays in the `volt-lsp-iec` namespace). Adopting the catalog SHALL NOT weaken the existing zero-false-positive guarantee or the "IDE stays authoritative" rule: an FP-prone code SHALL be implemented as an opt-in lint (default off), never an always-on check.

#### Scenario: Every emitted diagnostic maps to a catalog code

- **WHEN** the LSP emits an offline diagnostic that mirrors a CODESYS error
- **THEN** the catalog records that code as `covered` and the emitted diagnostic carries the mirrored `Cnnnn` code as metadata

#### Scenario: A checkable code without a check is a visible gap

- **WHEN** a catalog code is triaged `checkable` but no check implements it yet
- **THEN** its catalog status makes the gap explicit (it is not silently absent), and closing it is a unit of implementation work

#### Scenario: An FP-prone catalog code is opt-in, not always-on

- **WHEN** a catalog code cannot be checked offline without false positives (e.g. it depends on unloaded library types)
- **THEN** its check is registered as an opt-in lint that is off by default, and the corpus zero-false-positive gate stays green with the check off

### Requirement: Catalog-mirrored messages are conformance-verified against both IDEs

For any diagnostic the LSP shares with the compilers, the message text SHALL be verified byte-identical against how the live IDE actually builds — captured from the CODESYS and TwinCAT `/build` output, which emits each diagnostic as `Cnnnn: <message>`. Wording that has not yet been recorded against a live build SHALL be marked `PROVISIONAL` in the catalog and in the message builder. Per-vendor wording differences SHALL be represented as data in the vendor-keyed message builders, not as unverified guesses; where a vendor does not emit a given diagnostic, that SHALL be recorded rather than assumed.

#### Scenario: A recorded message is locked byte-for-byte

- **WHEN** a check's message has been recorded from a live build for a vendor
- **THEN** the message builder reproduces it exactly for that vendor and the catalog marks it verified (not `PROVISIONAL`)

#### Scenario: Unrecorded wording is provisional

- **WHEN** a check is implemented but its message has not been recorded against a live build
- **THEN** the message is marked `PROVISIONAL` and the code is flagged as awaiting a conformance recording

#### Scenario: A repro reproduces the exact code and message

- **WHEN** a catalog entry's minimal repro is compiled by the live IDE
- **THEN** the build emits the entry's recorded `Cnnnn` code and message, confirming the entry is accurate

### Requirement: Syntax errors are surfaced by resilient parsing, held to the zero-FP gate

The LSP SHALL surface statement- and declaration-level **syntax** errors (a missing or unexpected token in a
statement, expression, or declaration) as diagnostics, each with a precise span and a message, produced by
the parser it already runs. Parsing SHALL be **resilient (error-tolerant)**: an individual syntax error SHALL
produce one diagnostic and SHALL NOT prevent the rest of the body/unit from parsing (no cascade to an
unrelated enclosing error). Every parse SHALL still yield a usable tree for the surrounding valid code.

These surfaced syntax errors SHALL be held to the SAME zero-false-positive guarantee as the semantic checks:
a statement- or declaration-parse error emitted on code that the IDE compiles clean (the corpus and the
recorded conformance set) is a defect (a grammar gap to fix), enforced by the corpus test and the conformance
replay. This supersedes the prior `st-body-ast` design position that statement-parse errors are never
surfaced — now that grammar completeness is measured (100% of corpus ST bodies parse) and gated.

The guarantee that the IDE stays authoritative for statement **semantics** (types, flow, overload/library
resolution) is unchanged: this requirement covers syntax structure the parser already decides, not semantics.

#### Scenario: A missing keyword is reported precisely, not as a cascade

- **WHEN** a POU body contains an `IF` condition with no following `THEN`
- **THEN** the LSP emits a diagnostic at the offending token stating a `THEN` was expected there
- **AND** it does NOT instead emit an unrelated "unterminated <unit>" diagnostic, and the rest of the body
  still parses

#### Scenario: Parse errors never false-positive on clean code

- **WHEN** the parser runs over any body in the corpus or the recorded conformance set (all compile clean in
  the IDE)
- **THEN** it emits zero statement/declaration parse-error diagnostics, and CI fails if any appears

#### Scenario: A surfaced syntax error maps to its catalog code

- **WHEN** the LSP surfaces a syntax error that mirrors a documented CODESYS code (e.g. C0006 for the missing
  keyword)
- **THEN** the diagnostic carries that `Cnnnn` as metadata (not as the LSP's own `code`), consistent with the
  error-catalog mapping

### Requirement: A layered architecture with one source of truth per concern

The server SHALL be organized as strict layers — `syntax` (lexer/AST/parser), `symbols` (binder), `types` (the
type system), `analysis` (diagnostics), `services` (LSP features), `server` (protocol) — where imports point
only downward (`syntax ← symbols ← types ← analysis ← services ← server`). Each concern SHALL have exactly one
source of truth: elementary type facts, type compatibility, type rendering, scope navigation, cursor→symbol
resolution, and symbol-kind labels each live in a single module that every consumer uses. A second list or a
duplicated relation SHALL be treated as a defect.

#### Scenario: A fact or relation is defined once
- **WHEN** an elementary type's range/rank, or a type-compatibility rule, is needed by any check or query
- **THEN** it is read from the single owning module, so the same input yields the same answer everywhere and a
  change is made in exactly one place

### Requirement: The AST models the language completely

The parser SHALL produce an AST that carries the semantic content backends need, so no consumer re-parses raw
tokens: type expressions carry structured dimensions, string length, subrange bounds, and vector shape;
literals carry their evaluated value and precise type; variable initializers are expression trees. The parser
SHALL be error-tolerant — a malformed input yields a partial tree plus diagnostics, and precision never
regresses.

#### Scenario: A consumer reads structured nodes, not spans
- **WHEN** the formatter, a range check, or the transpiler needs an array bound, a string length, or an
  initializer value
- **THEN** it reads the structured/evaluated node directly from the AST rather than re-lexing a source span

### Requirement: One conservative type system, reused by every backend

The `types` layer SHALL provide a single expression-inference engine, a single compatibility relation, constant
evaluation, and a rich `Type` model whose `UNKNOWN` case is the total fallback. It SHALL be conservative and
non-authoritative: an unresolved type or non-constant value yields unknown / no result and raises no
diagnostic, and the IDE compiler remains the authority for final type-checking and codegen. The same type
system SHALL power diagnostics, hover, completion, navigation, and code generation — not a per-backend copy.

#### Scenario: Unknown types never false-positive
- **WHEN** an expression's type cannot be fully resolved
- **THEN** no type diagnostic is emitted for it — the zero-false-positive contract on valid real code holds

### Requirement: Diagnostics match the vendor compilers byte-for-byte

Every diagnostic the server shares with a compiler SHALL read byte-identical to that compiler's message, per
vendor. This SHALL be enforced by an oracle harness: each rule has a conformance fixture recorded against the
live CODESYS and TwinCAT compilers; an offline replay asserts the server's diagnostic message SET equals the
recording per vendor, with a documented divergence ledger the only opt-out. A committed real-project corpus
SHALL be the regression net — a miss it surfaces becomes a new fixture, never a threshold change.

#### Scenario: A diagnostic cannot ship unless it matches both compilers
- **WHEN** a check produces a message the compiler also produces
- **THEN** the replay passes only if the message is byte-identical to the recorded compiler output for that
  vendor; otherwise CI fails

### Requirement: Vendor differences are a single toggleable, provenance-tagged registry

Every place CODESYS and TwinCAT differ SHALL be a data entry in ONE registry — per-vendor message wording,
vendor-only rules, and documented divergences — NOT a hardcoded `activeVendor` branch scattered across
checks. Each entry SHALL be individually enable/disable-able and tagged with provenance (verified against the
live compiler vs. suspected bridge artifact vs. deferred). Checks and message builders SHALL read their
per-vendor output from the registry; disabling an entry SHALL fall back to a single shared behavior. So a
difference later found to be a bridge bug (e.g. a phantom `__SETVALUE` on a GET-only interface property) is
removed by flipping one flag, and every difference is auditable in one place.

#### Scenario: A suspected bridge artifact is disabled without touching checks
- **WHEN** a recorded CS↔TC difference is judged a bridge artifact rather than real vendor behavior
- **THEN** its registry entry is disabled (one flag), the LSP reverts to shared behavior for that construct, and
  no check code changes

#### Scenario: Every vendor difference is reviewable in one place
- **WHEN** someone audits the CODESYS↔TwinCAT surface
- **THEN** the full set of differences (with provenance and enabled state) is the registry — not a grep across
  check files

### Requirement: The graphical sublanguage is native, not a parallel stack

The FBD/LD graphical languages — materialized as readable text — SHALL be a front-end that reuses the shared
core: it has its own surface syntax and graph-structure checks, but its type inference, diagnostics
orchestration, and feature services are the shared `types`/`analysis`/`services`, not duplicates. The module
SHALL be an umbrella for the graphical-language family, with the current text encoding as one member and room
for future formats.

#### Scenario: Graphical type inference uses the shared engine
- **WHEN** a graphical wire expression's type is needed
- **THEN** it is inferred by the shared `types` engine, not a separate string-based inferencer

### Requirement: Modern LSP feature set and minimal configuration

The server SHALL implement the LSP 3.17 feature set appropriate to PLC code — including inlay hints (inferred
types + parameter names), code lens, type-definition, prepare-rename, on-type/range formatting, and push AND
pull diagnostics with progress and cancellation — in addition to the core navigation/display/structure/format
features. Configuration SHALL be minimal and meaningful: the vendor dialect plus a small opt-in set of
stricter-than-compiler lints; compiler-mirroring diagnostics are not individually configurable, and client
capabilities are read from the protocol, not re-declared as config.

#### Scenario: Inferred types are shown inline
- **WHEN** a variable's type is inferred and inlay hints are enabled
- **THEN** the server offers an inlay hint showing that type, sourced from the shared type engine

