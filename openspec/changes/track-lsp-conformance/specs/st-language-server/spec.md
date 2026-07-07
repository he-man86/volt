## ADDED Requirements

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
