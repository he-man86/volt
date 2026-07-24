## ADDED Requirements

### Requirement: One definition per closed vocabulary

Every closed wire/domain vocabulary MUST be defined in exactly one place per language and referenced everywhere
else. The centralized C# vocabularies are: pipe op codes (which also supply the progress/active-op labels),
item-kind strings (with both code→string and string→code directions), vendor id + display name, and health-status
words. Error codes are already centralized in `BridgeErrorCodes` and MUST be referenced, not re-spelled.

#### Scenario: A consumer references the constant, not the literal

- **WHEN** any C# file other than the vocabulary's definition needs an op code, item kind, vendor id/display name,
  health-status word, or error code
- **THEN** it references the named constant (e.g. `Ops.Refs`, `ItemKind.FunctionBlock`, `Vendors.Codesys`,
  `BridgeErrorCodes.PlcDisconnected`) and contains no raw string literal of that vocabulary

#### Scenario: Kind strings live once even in the create-code maps

- **WHEN** `PushService`'s kind→create-code maps (`PouKindToCode`/`ChildKindToCode`) or any `kind is "…"` comparison
  names an item kind
- **THEN** the kind is spelled via the shared `ItemKind.Kinds.*` constant, not a raw string literal (the maps
  themselves remain — they are domain logic, not a duplicate of `Map()`)

### Requirement: Wire values are preserved exactly

Centralizing a vocabulary MUST NOT change any string that crosses the pipe, connector HTTP, or file-extension
boundary. Naming is not renaming.

#### Scenario: Parity and wiring guards stay green

- **WHEN** the centralization is complete
- **THEN** `WireContractParityTests` passes (byte-identical responses on both vendors) and
  `volt-scripts/check-wiring.ts` passes (the cross-language extension copies still match the C# canonical)

### Requirement: Centralized C# vocabularies are protected from re-rot

A guard MUST fail if a centralized C# vocabulary's literal is re-spelled outside its definition class, so the
cleanup cannot silently regress the way `BridgeErrorCodes` did (three leaked `"PLC_DISCONNECTED"` literals).

#### Scenario: A reintroduced literal fails the build

- **WHEN** a raw string literal belonging to a centralized vocabulary is added outside that vocabulary's definition
  file
- **THEN** a test in the C# suite fails, naming the offending file and literal

### Requirement: Cross-language sharing is limited to file extensions

Cross-language guarding MUST be limited to the set of Structured-Text file extensions — the only vocabulary shared
independently across the C#↔TS boundary (the LSP and vscode classify ST files without invoking the CLI). All other
TS-side vocabularies are client DTOs of the CLI/connector contract and MUST NOT get a cross-language guard. The
existing extension guard MUST also cover the reference extensions (`.library`/`.device`/`.task`), currently unguarded.

#### Scenario: Reference extensions are guarded like source extensions

- **WHEN** the reference-extension list drifts between the C# canonical and its TS/JSON copies
- **THEN** `check-wiring.ts` fails, the same way it already does for the writable-source extensions

#### Scenario: The TS vendor type has one source

- **WHEN** TS code (`volt-control`/`volt-lsp-iec`/`volt-vscode`) needs the `Vendor` union or a vendor display name
- **THEN** it imports the single shared `Vendor` type and `displayName()` helper rather than re-declaring the union
  or copy-pasting the `"TwinCAT"/"CODESYS"` ternary
